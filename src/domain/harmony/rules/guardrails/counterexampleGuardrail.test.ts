
import { describe, expect, it } from "vitest";
import { formatPitchClass } from "../../../pitch";
import { validateProject, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferHarmony } from "../../inference";
import { checkHarmony } from "../../registry";
import type { HarmonyRuleId } from "../catalog";
import { counterexampleGuardrails, scoreText, type ExpectedFinding } from "./fixtures";

const errorRuleIds = [
  "voice-leading.parallel-fifths",
  "voice-leading.parallel-octaves",
  "voice.crossing",
  "chord.inversion-bass",
  "chord.doubled-leading-tone",
  "chord.doubled-seventh",
  "function.cadential64-target",
  "melody.leap-over-octave",
  "chord.augmented-sixth-voicing",
  "resolution.augmented-sixth",
] as const satisfies readonly HarmonyRuleId[];

const warningRuleIds = [
  "resolution.leading-tone",
  "resolution.chord-seventh",
  "chord.incomplete-members",
  "nonchord.passing-tone",
  "nonchord.suspension-preparation",
  "nonchord.suspension-resolution",
  "nonchord.neighbor-tone",
  "nonchord.anticipation",
  "voice-leading.hidden-fifth",
  "voice-leading.hidden-octave",
  "function.retrogression",
] as const satisfies readonly HarmonyRuleId[];

const errorRules = new Set<HarmonyRuleId>(errorRuleIds);
const requiredRuleIds = [...errorRuleIds, ...warningRuleIds];
const conditionedOnlyRuleIds = [
  "chord.inversion-bass",
  "function.cadential64-target",
  "nonchord.passing-tone",
  "nonchord.suspension-preparation",
  "nonchord.suspension-resolution",
  "nonchord.neighbor-tone",
  "nonchord.anticipation",
] as const;

function stripToBlindProject(project: ProjectDocument): ProjectDocument {
  const stripped = structuredClone(project);
  stripped.chordTrack.regions = [];
  for (const track of stripped.satbTracks) {
    for (const note of track.notes) {
      delete note.nonChordToneRole;
    }
  }
  stripped.structure.phraseBoundaries = [];
  stripped.chordTrack.cadenceAnnotations = [];
  return stripped;
}

function assertFindings(
  project: ProjectDocument,
  ruleId: HarmonyRuleId,
  expected: readonly ExpectedFinding[],
  entryPoint: "conditioned" | "blind",
) {
  expect(validateProject(project)).toBe(true);
  const { diagnostics, skippedRules } = checkHarmony(project);
  expect(skippedRules.filter(item => item.reason === "rule-error")).toEqual([]);

  const findings = diagnostics.filter(item => item.ruleId === ruleId);
  const severity = errorRules.has(ruleId) ? "error" : "warning";
  const positions = findings.map(({ ruleId, severity, tick, voiceIds }) => ({ ruleId, severity, tick, voiceIds }));
  const harmony = entryPoint === "blind"
    ? project.chordTrack.regions.map(({ startTick, identity, semantics }) => {
        const { root, bass, structure } = identity;
        const kind = structure.kind === "tertian" ? structure.quality : structure.variant;
        const role = semantics?.cadenceRole;
        return `${startTick}: ${formatPitchClass(root)} ${kind}/${formatPitchClass(bass)}${role ? ` (${role})` : ""}`;
      }).join(", ")
    : undefined;
  expect(positions, harmony === undefined ? undefined : `盲推和弦：${harmony || "无"}`).toEqual(
    expected.map(({ tick, voiceIds }) => ({ ruleId, severity, tick, voiceIds })),
  );

  expected.forEach(({ chordTicks, missing }, index) => {
    if (chordTicks) {
      const chordIds = chordTicks.map(tick => {
        const region = project.chordTrack.regions.find(
          chord => chord.startTick <= tick && tick < chord.startTick + chord.durationTicks,
        );
        if (!region) throw new Error(`No chord at tick ${tick}`);
        return region.id;
      });
      expect([...findings[index].chordIds].sort()).toEqual(chordIds.sort());
    }
    if (missing !== undefined) expect(findings[index].params.missing).toBe(missing);
  });
}

function runFixture(
  source: string,
  ruleId: HarmonyRuleId,
  expected: readonly ExpectedFinding[],
  entryPoint: "conditioned" | "blind",
) {
  // The compiler throws on invalid .satbt; let that error fail this named fixture.
  const { project } = compileScoreText(source);
  if (entryPoint === "conditioned") {
    assertFindings(project, ruleId, expected, entryPoint);
    return;
  }

  expect(validateProject(project)).toBe(true);
  const stripped = stripToBlindProject(project);
  expect(validateProject(stripped)).toBe(true);
  const inferred = applyHarmonyInference(stripped, inferHarmony(stripped), {
    mode: "replace-unlocked",
  }).project;
  assertFindings(inferred, ruleId, expected, entryPoint);
}

describe("核心规则双入口反例护栏", () => {
  it("盲推输入清空和弦、外音、人工句界与终止式，原工程不受影响", () => {
    const { project } = compileScoreText(`satb 1
key C major
bars 1..2 {
  S: | E5/2 F5/4@neighbor E5/4 | D5/1 |
  A: | G4/1 | B4/1 |
  T: | C4/1 | G3/1 |
  B: | C3/1 | G2/1 |
  H: | I/1 | V/1 |
}
annotations {
  note neighbor role=neighbor
  phrase opening range=[1:1,2:1)
  phrase closing range=[2:1,3:1)
  cadence halfClose phrase=closing range=[2:1,3:1) kind=half
}`);
    const original = structuredClone(project);
    const stripped = stripToBlindProject(project);

    expect(stripped.chordTrack.regions).toEqual([]);
    expect(stripped.chordTrack.cadenceAnnotations).toEqual([]);
    expect(stripped.structure.phraseBoundaries).toEqual([]);
    expect(stripped.satbTracks.flatMap(track => track.notes).every(note => note.nonChordToneRole === undefined)).toBe(true);
    expect(project).toEqual(original);
    expect(project.chordTrack.regions).toHaveLength(2);
    expect(project.chordTrack.cadenceAnnotations).toHaveLength(1);
    expect(project.structure.phraseBoundaries).toHaveLength(1);
    expect(project.satbTracks.flatMap(track => track.notes).filter(note => note.nonChordToneRole)).toHaveLength(1);
    expect(validateProject(stripped)).toBe(true);
  });

  it("覆盖所有 21 个 ruleId，每条至少一组对照、两个反例", () => {
    expect(counterexampleGuardrails.map(({ ruleId }) => ruleId).sort()).toEqual([...requiredRuleIds].sort());
    expect(counterexampleGuardrails.filter(({ entryPoints }) => !entryPoints.blind).map(({ ruleId }) => ruleId).sort())
      .toEqual([...conditionedOnlyRuleIds].sort());

    for (const { ruleId, entryPoints, pairs } of counterexampleGuardrails) {
      expect(pairs.length, ruleId).toBeGreaterThanOrEqual(1);
      const negatives = pairs.flatMap(pair => pair.counterexamples ?? []);
      expect(negatives.length, ruleId).toBeGreaterThanOrEqual(2);
      if (!entryPoints.blind) {
        expect(entryPoints.blindSkipReason.trim(), ruleId).not.toBe("");
      } else {
        const blindActive = negatives.filter(item => !item.blindSkipReason);
        expect(blindActive.length, `${ruleId} blind`).toBeGreaterThanOrEqual(2);
      }

      for (const { name, edits, expected, blindSkipReason } of negatives) {
        const noteEdits = edits.filter(([part]) => part !== "H");
        expect(noteEdits.length, name).toBeGreaterThanOrEqual(1);
        expect(noteEdits.length, name).toBeLessThanOrEqual(2);
        expect(new Set(edits.map(([part, index]) => `${part}:${index}`)).size, name).toBe(edits.length);
        expect(expected.length, name).toBeGreaterThan(0);
        if (blindSkipReason !== undefined) expect(blindSkipReason.trim(), name).not.toBe("");
      }
    }
  });

  for (const { ruleId, entryPoints, pairs } of counterexampleGuardrails) {
    describe(ruleId, () => {
      const entryPointNames = entryPoints.blind ? ["conditioned", "blind"] as const : ["conditioned"] as const;
      for (const entryPoint of entryPointNames) {
        describe(entryPoint, () => {
          for (const { name, control, counterexamples = [] } of pairs) {
            describe(name, () => {
              it("positive", () => runFixture(scoreText(control), ruleId, [], entryPoint));
              for (const { name: mutation, edits, expected, blindSkipReason } of counterexamples) {
                if (entryPoint === "blind" && blindSkipReason) continue;
                it(`negative · ${mutation}`, () =>
                  runFixture(scoreText(control, edits), ruleId, expected, entryPoint));
              }
            });
          }
        });
      }
    });
  }
});
