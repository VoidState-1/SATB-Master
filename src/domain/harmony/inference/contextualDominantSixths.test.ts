import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyHarmonyInference, inferHarmony } from "./harmonyInference";

const applied = `satb 1
key C major
meter 2/4
bars 1..3 {
  S: | E5/2 | C5/4 B4/4 | A4/2 |
  A: | G4/2 | G#4/2 | A4/2 |
  T: | C4/2 | D4/2 | C4/2 |
  B: | C3/2 | E3/2 | F3/2 |
}`;

const modulating = `satb 1
key F major
meter 2/4
bars 1..3 {
  S: | A4/4 B4/4 | G5/4 F#5/4 | E5/2 |
  A: | F4/4 E4/4 | D#4/2 | E4/2 |
  T: | A3/4 G3/4 | A3/2 | G3/2 |
  B: | F3/4 G2/4 | B2/2 | E2/2 |
}`;

const annotation = `
annotations {
chord v range=[2:1,3:1) symbol=V7/VI
chord s range=[3:1,4:1) symbol=IV
}`;
const sourceTick = 2 * PPQ;
const fifthTick = 3 * PPQ;
const landingTick = 4 * PPQ;
const substitution = "dominant-sixth-substitution";
const extraTone = "chord.unclassified-nonchord-tone";

function withManualBoundary(project: ReturnType<typeof compileScoreText>["project"], tick?: number) {
  if (tick !== undefined) {
    project.structure.phraseBoundaries.push({ id: "edge", tick, source: "manual", confidence: "certain" });
  }
  return project;
}

function inferScore(score: string, boundary?: number) {
  const project = withManualBoundary(compileScoreText(score).project, boundary);
  const result = inferHarmony(project);
  const written = applyHarmonyInference(project, result, { mode: "replace-unlocked", writeNonChordToneRoles: true });
  const region = result.chordInference.regions.find(item => item.fromTick <= sourceTick && sourceTick < item.toTick)!;
  return { region, diagnostics: checkHarmony(written.project).diagnostics };
}

function annotatedDiagnostics(score: string, boundary?: number, chords = annotation) {
  const project = withManualBoundary(compileScoreText(score + chords).project, boundary);
  return checkHarmony(project).diagnostics;
}

function hasSubstitution(region: ReturnType<typeof inferScore>["region"]) {
  return [region.selected, ...region.alternatives].some(candidate =>
    candidate?.evidence.some(item => item.code === substitution),
  );
}

describe("有实奏确认的局部小调属七 6→5", () => {
  it("副属的六音从实际起奏恢复和弦，阻碍进行维持副属身份", () => {
    const { region, diagnostics } = inferScore(applied);
    expect(region).toMatchObject({
      fromTick: sourceTick, toTick: landingTick,
      selected: {
        semantics: { interpretations: [{ appliedTarget: { degree: 6 } }] },
        evidence: expect.arrayContaining([expect.objectContaining({ code: substitution, noteIds: [`note-S-${sourceTick}`] })]),
      },
    });
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
    expect(annotatedDiagnostics(applied)).not.toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
  });

  it("独立确认小主音后，起奏与完整属七拼合并保留小调身份", () => {
    const { region } = inferScore(modulating);
    expect(region).toMatchObject({
      fromTick: sourceTick, toTick: landingTick,
      selected: {
        semantics: { interpretations: [{ localKey: { tonic: { step: "E", alter: 0 }, mode: "minor" } }] },
        evidence: expect.arrayContaining([expect.objectContaining({ code: substitution })]),
      },
    });
  });

  it.each([
    ["低音同高度重奏", applied.replace("E3/2", "E3/4 E3/4")],
    ["低音换八度", applied.replace("E3/2", "E3/4 E2/4")],
    ["内声同音重奏", applied.replace("D4/2", "D4/4 D4/4")],
    ["六音改写为等音升五", applied.replace("C5/4", "B#4/4")],
    ["真实属七音未按级下行", applied.replace("D4/2 | C4/2", "D4/2 | C3/2")],
    ["落点属七音换声部且不重三", applied.replace("G#4/2 | A4/2", "G#4/2 | C5/2").replace("D4/2 | C4/2", "D4/2 | F4/2")],
  ])("%s 时不补足开头和声且给和弦后仍报告外音", (_description, score) => {
    expect(hasSubstitution(inferScore(score).region)).toBe(false);
    expect(annotatedDiagnostics(score)).toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
  });

  it.each([fifthTick, landingTick])("显式句界 %s 截断证据", tick => {
    expect(hasSubstitution(inferScore(applied, tick).region)).toBe(false);
    expect(annotatedDiagnostics(applied, tick)).toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
  });

  it("6→5 的内部同和声不能豁免女低进入副属七前的实际减四度", () => {
    const leap = applied.replace("G4/2", "C5/2").replace("C4/2 | D4", "A3/2 | D4")
      .replace("C3/2", "A2/2");
    const { region, diagnostics } = inferScore(leap);
    expect(hasSubstitution(region)).toBe(true);
    const diminished = expect.objectContaining({
      ruleId: "melody.diminished-interval", tick: sourceTick, voiceIds: ["alto"],
      params: expect.objectContaining({ intervalNumber: 4 }),
    });
    expect(diagnostics).toContainEqual(diminished);
    expect(annotatedDiagnostics(leap)).toContainEqual(diminished);
  });

  it("同一解读的标签拆分不能改变音符起奏；实际标签冲突需要报警", () => {
    const split = annotation.replace(
      "chord v range=[2:1,3:1) symbol=V7/VI",
      "chord v1 range=[2:1,2:1+1/2) symbol=V7/VI\nchord v2 range=[2:1+1/2,3:1) symbol=V7/VI",
    );
    const conflict = split.replace("symbol=V7/VI\nchord s", "symbol=I\nchord s");
    expect(annotatedDiagnostics(applied, undefined, split)).not.toContainEqual(expect.objectContaining({ ruleId: extraTone }));
    expect(annotatedDiagnostics(applied, undefined, conflict)).toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
  });
});
