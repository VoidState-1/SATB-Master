import { describe, expect, it } from "vitest";
import { formatPitchClass } from "../../../pitch";
import { validateProject, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferHarmony } from "../../inference";
import { checkHarmony } from "../../registry";
import { defaultHarmonyRuleSeverities, type HarmonyRuleId } from "../catalog";
import type { HarmonyRuleSeverity } from "../types";
import { counterexampleGuardrails } from "./fixtures";
import { scoreText, type ExpectedFinding, type RuleGuardrail } from "./fixtureContract";

const expectedSeverities: Partial<Record<HarmonyRuleId, Exclude<HarmonyRuleSeverity, "off">>> = {
  "cadence.cadential64-metric-position": "warning",
  "chord.augmented-sixth-voicing": "error",
  "chord.doubled-altered-tendency-tone": "error",
  "chord.doubled-leading-tone": "error",
  "chord.doubled-seventh": "error",
  "chord.incomplete-members": "warning",
  "chord.inversion-bass": "error",
  "chord.second-inversion-voicing": "warning",
  "chord.unclassified-nonchord-tone": "warning",
  "connection.second-inversion-context": "warning",
  "function.applied-dominant-target": "warning",
  "function.cadential64-target": "error",
  "function.retrogression": "warning",
  "melody.augmented-interval": "warning",
  "melody.consecutive-leaps": "suggestion",
  "melody.leap-over-octave": "error",
  "melody.leap-recovery": "warning",
  "nonchord.anticipation": "warning",
  "nonchord.neighbor-tone": "warning",
  "nonchord.passing-tone": "warning",
  "nonchord.suspension-preparation": "warning",
  "nonchord.suspension-resolution": "warning",
  "resolution.augmented-sixth": "error",
  "resolution.chord-seventh": "warning",
  "resolution.leading-tone": "warning",
  "rhythm.harmonic-syncopation": "warning",
  "voice-leading.all-voices-similar": "suggestion",
  "voice-leading.hidden-fifth": "warning",
  "voice-leading.hidden-octave": "warning",
  "voice-leading.overlap": "warning",
  "voice-leading.parallel-fifths": "error",
  "voice-leading.parallel-octaves": "error",
  "voice.crossing": "error",
  "voice.range": "warning",
  "voice.upper-spacing": "warning",
};

const conditionedOnlyRuleIds = [
  "connection.second-inversion-context",
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
  guardrail: RuleGuardrail,
  expected: readonly ExpectedFinding[],
  writeNonChordToneRoles?: boolean,
) {
  expect(validateProject(project)).toBe(true);
  const { ruleId, enableAt } = guardrail;
  const profile = enableAt ? { ...defaultHarmonyRuleSeverities(), [ruleId]: enableAt } : undefined;
  const { diagnostics, skippedRules } = checkHarmony(project, profile);
  expect(skippedRules.filter(item => item.reason === "rule-error" || (item.ruleId === ruleId && !item.partial))).toEqual([]);

  const findings = diagnostics.filter(item => item.ruleId === ruleId);
  const severity = expectedSeverities[ruleId];
  const positions = findings.map(({ ruleId, severity, tick, voiceIds }) => ({ ruleId, severity, tick, voiceIds }));
  const harmony = writeNonChordToneRoles !== undefined
    ? project.chordTrack.regions.map(({ startTick, identity, semantics }) => {
        const { root, bass, structure } = identity;
        const kind = structure.kind === "tertian" ? structure.quality : structure.variant;
        const role = semantics?.cadenceRole;
        return `${startTick}: ${formatPitchClass(root)} ${kind}/${formatPitchClass(bass)}${role ? ` (${role})` : ""}`;
      }).join(", ")
    : undefined;
  expect(positions, harmony === undefined ? undefined : `盲推和弦（角色回写 ${writeNonChordToneRoles}）：${harmony || "无"}`).toEqual(
    expected.map(({ tick, voiceIds }) => ({ ruleId, severity, tick, voiceIds })),
  );

  expected.forEach(({ tick, chordTicks, missing, noteEvidenceVoices }, index) => {
    if (noteEvidenceVoices) {
      const expectedNotes = noteEvidenceVoices.map(voiceId => {
        const track = project.satbTracks.find(item => item.id === voiceId);
        const note = track?.notes.find(item => item.startTick <= tick && tick < item.startTick + item.durationTicks);
        if (!note) throw new Error(`No sounding ${voiceId} note at tick ${tick}`);
        return note.id;
      });
      const evidenceIds = findings[index].evidence.filter(item => item.kind === "note").map(item => item.id);
      expect(evidenceIds.sort()).toEqual(expectedNotes.sort());
    }
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
  guardrail: RuleGuardrail,
  expected: readonly ExpectedFinding[],
  entryPoint: "conditioned" | "blind",
) {
  // The compiler throws on invalid .satbt; let that error fail this named fixture.
  const { project } = compileScoreText(source);
  if (entryPoint === "conditioned") {
    assertFindings(project, guardrail, expected);
    return;
  }

  expect(validateProject(project)).toBe(true);
  const stripped = stripToBlindProject(project);
  expect(validateProject(stripped)).toBe(true);
  const inference = inferHarmony(stripped);
  for (const writeNonChordToneRoles of [false, true]) {
    const inferred = applyHarmonyInference(stripped, inference, {
      mode: "replace-unlocked",
      writeNonChordToneRoles,
    }).project;
    assertFindings(inferred, guardrail, expected, writeNonChordToneRoles);
  }
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

  it("正式规则清单完整，每条至少一组对照、两个反例，至少 24 条支持双入口", () => {
    expect(counterexampleGuardrails.length).toBeGreaterThanOrEqual(35);
    expect(counterexampleGuardrails.filter(rule => rule.entryPoints.blind).length).toBeGreaterThanOrEqual(24);
    expect(counterexampleGuardrails.map(({ ruleId }) => ruleId).sort()).toEqual(Object.keys(expectedSeverities).sort());
    expect(counterexampleGuardrails.filter(({ entryPoints }) => !entryPoints.blind).map(({ ruleId }) => ruleId).sort())
      .toEqual([...conditionedOnlyRuleIds].sort());

    for (const { ruleId, entryPoints, pairs, enableAt } of counterexampleGuardrails) {
      if (enableAt) expect(defaultHarmonyRuleSeverities()[ruleId], ruleId).toBe("off");
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

  for (const guardrail of counterexampleGuardrails) {
    const { ruleId, entryPoints, pairs } = guardrail;
    describe(ruleId, () => {
      const entryPointNames = entryPoints.blind ? ["conditioned", "blind"] as const : ["conditioned"] as const;
      for (const entryPoint of entryPointNames) {
        describe(entryPoint, () => {
          for (const { name, control, counterexamples = [] } of pairs) {
            describe(name, () => {
              it("positive", () => runFixture(scoreText(control), guardrail, [], entryPoint));
              for (const { name: mutation, edits, expected, blindSkipReason } of counterexamples) {
                if (entryPoint === "blind" && blindSkipReason) continue;
                it(`negative · ${mutation}`, () =>
                  runFixture(scoreText(control, edits), guardrail, expected, entryPoint));
              }
            });
          }
        });
      }
    });
  }
});
