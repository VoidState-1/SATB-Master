import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference, buildHarmonyAnalysis, checkHarmony, inferChords } from "../index";
import type { ChordInferenceOptions } from "./types";

const rules = new Set([
  "chord.unclassified-nonchord-tone", "chord.incomplete-members", "chord.inversion-bass",
]);

const auxiliary = `satb 1
key F# major
meter 3/4
bars 1..1 {
  S: | C#5/4 D#5/4 C#5/4 |
  A: | F#4/2. |
  T: | C#4/4 B#3/4 C#4/4 |
  B: | A#2/4 G##2/4 A#2/4 |
}`;

const diminishedPivot = `satb 1
key A minor
meter 2/4
bars 1..6 {
  S: | C5/2 | D#5/4 F#5/4       | G5/2  | C5/2  | D5/2  | Eb5/2 |
  A: | E4/2 | A4/4 A4/4         | G4/2  | Ab4/2 | Ab4/2 | G4/2  |
  T: | A3/2 | B3/4 C4/4         | Bb3/2 | Eb4/2 | F4/2  | Bb3/2 |
  B: | A2/2 | F#3/4 Eb3/8 D3/8 | Eb3/2 | Ab2/2 | Bb2/2 | Eb3/2 |
}`;

const revoicedTriad = `satb 1
key C minor
meter 2/4
bars 1..6 {
  S: | Eb5/2 | C#5/4 B4/4  | G#4/2 | A4/2  | G#5/2                  | Ab5/8 G5/8 G5/4 |
  A: | G4/2  | F#4/4 F#4/4 | E#4/2 | F#4/2 | C#5/2                  | C5/2            |
  T: | C4/2  | A3/4 D4/4   | B3/2  | C#4/2 | E#4/2                  | Eb4/2           |
  B: | C3/2  | F#3/4 B2/4  | C#3/2 | F#3/2 | C#3/8 D3/8 D#3/8 E#3/8 | F#3/8 G3/8 G3/4 |
}`;

const writtenTriad = `satb 1
key Eb minor
meter 2/4
bars 1..2 {
  S: | Ab4/4 B4/4 | Bb4/4 Gb4/4 |
  A: | F4/4 E4/4  | F4/4 Eb4/4  |
  T: | Cb4/4 B3/4 | Bb3/4 Bb3/4 |
  B: | D3/4 G#2/4 | Bb2/4 Eb3/4 |
}`;

function diagnosticsAt(project: ReturnType<typeof compileScoreText>["project"], tick: number) {
  return checkHarmony(project).diagnostics.filter(d => d.tick === tick && rules.has(d.ruleId));
}

function infer(score: string, beat: number, options?: ChordInferenceOptions) {
  const { project } = compileScoreText(score);
  const tick = beat * project.ppq;
  const inference = inferChords(project, options);
  const region = inference.regions.find(item => item.fromTick <= tick && tick < item.toTick);
  const applied = applyHarmonyInference(project, { chordInference: inference }, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
  const chord = applied.chordTrack.regions.find(item => item.startTick <= tick && tick < item.startTick + item.durationTicks);
  const respelling = region?.selected?.evidence.find(e => e.code === "written-enharmonic-identity");
  return { project, applied, chord, inference, region, respelling, tick, diagnostics: diagnosticsAt(applied, tick) };
}

const pitch = (step: string, alter = 0) => ({ step, alter });

describe("等音候选以完整实写身份写回", () => {
  it("辅助减七写入实写身份和低音，保留共同音回归证据", () => {
    const played = infer(auxiliary, 1, { allowAbsoluteFallback: false });
    expect(played.chord?.identity).toMatchObject({
      root: pitch("G", 2), bass: pitch("G", 2), structure: { quality: "diminished7" },
    });
    expect(played.chord?.semantics).toBeUndefined();
    expect(played.diagnostics).toEqual([]);
    expect(played.region?.selected?.evidence.some(e => e.code === "written-auxiliary-diminished-seventh")).toBe(true);
    expect(buildHarmonyAnalysis(played.applied).writtenProlongations.has(played.tick)).toBe(true);
    expect(played.inference.warnings).toContainEqual(expect.objectContaining({
      code: "function-unresolved", fromTick: played.tick,
    }));
    expect(played.applied.satbTracks).toEqual(played.project.satbTracks);
    const literal = infer(auxiliary.replace("G##2", "A2"), 1);
    expect(literal.respelling).toBeUndefined();
    expect(literal.region?.selected?.functionalBaseId).toBe("DDVII");
    expect(literal.chord?.semantics).toBeDefined();
  });

  it("减七枢纽保留七音下行的实写出口和旧调等音证据", () => {
    const played = infer(diminishedPivot, 3);
    expect(played.chord?.identity).toMatchObject({
      root: pitch("F", 1), bass: pitch("E", -1), structure: { quality: "diminished7" },
    });
    expect(played.chord?.semantics).toBeUndefined();
    expect(played.respelling?.enharmonicReadings).toMatchObject([{
      key: { tonic: pitch("A"), mode: "minor" },
      identity: { root: pitch("D", 1), bass: pitch("D", 1) },
      semantics: { interpretations: [{ designation: { kind: "double-dominant-leading-tone" } }] },
    }]);
    expect(played.region?.selected?.evidence.some(e => e.code === "written-diminished-pivot-to-seventh")).toBe(true);
    expect(played.diagnostics).toEqual([]);
    const differentExit = infer(diminishedPivot.replace("Eb3/8 D3/8", "Eb3/8 D2/8"), 3);
    expect(differentExit.chord?.identity).toEqual(played.chord?.identity);
    expect(differentExit.region?.selected?.evidence.some(e => e.code === "written-diminished-pivot-to-seventh")).toBe(false);
    const oldSpelling = infer(diminishedPivot.replace("Eb3/8 D3/8", "D#3/8 D3/8"), 3);
    expect(oldSpelling.region?.selected?.functionalBaseId).toBe("DDVII");
    expect(oldSpelling.respelling).toBeUndefined();
  });

  it("实写属和弦随低音换位，保留已确立的原调和等音那不勒斯读法", () => {
    const played = infer(revoicedTriad, 9.5);
    expect(played.chord?.identity).toMatchObject({
      root: pitch("C", 1), bass: pitch("E", 1), structure: { quality: "major" },
    });
    expect(played.chord?.semantics?.interpretations[0]).toMatchObject({
      localKey: { tonic: pitch("F", 1), mode: "minor" }, degree: 5,
      designation: { kind: "primary", primaryFunction: "dominant" },
    });
    expect(played.respelling?.enharmonicReadings).toMatchObject([{
      identity: { root: pitch("D", -1), bass: pitch("F") },
      semantics: { interpretations: [{ designation: { kind: "neapolitan" } }] },
    }]);
    expect(played.diagnostics).toEqual([]);
    const reattack = infer(revoicedTriad.replace("G#5/2", "G#5/4. G#5/8"), 9.5);
    expect(reattack.chord?.identity).toEqual(played.chord?.identity);
    expect(reattack.chord?.semantics).toBeUndefined();
  });

  it.each([false, true])("绝对回退=%s 时低音换位仍可按实写写回", allowAbsoluteFallback => {
    expect(infer(revoicedTriad, 9.5, { allowAbsoluteFallback }).region).toMatchObject({
      status: "resolved", selected: { confidence: "medium", fit: { spellingConsistent: true } },
    });
  });

  it("高置信筛选保留原有实写功能并排除待复核的等音读法", () => {
    expect(infer(revoicedTriad, 9.5, { minConfidence: "high", allowAbsoluteFallback: true }).chord).toBeUndefined();
    const exact = writtenTriad.replace("B4/4", "Cb5/4").replace("E4/4", "Fb4/4")
      .replace("B3/4", "Cb4/4").replace("G#2/4", "Ab2/4");
    expect(infer(exact, 1, { minConfidence: "high" }).region?.selected?.functionalBaseId).toBe("N6");
  });

  it("混合拼写、真实外音和最低音错位不能建立实写替代", () => {
    for (const score of [writtenTriad.replace("B3/4", "Cb4/4"), writtenTriad.replace("B3/4", "A3/4"),
      writtenTriad.replace("B3/4", "B1/4")])
      expect(infer(score, 1).respelling).toBeUndefined();
    const mixedSeventh = infer(auxiliary.replace("B#3", "C4"), 1);
    expect(mixedSeventh.respelling).toBeUndefined();
    expect(mixedSeventh.diagnostics.some(d => d.ruleId === "chord.inversion-bass")).toBe(true);
  });

  it("共享四声部解决证据，保留重属导七而区分升二级与降三级的实写", () => {
    const score = `satb 1
key G major
meter 1/4
bars 1..2 {
  S: | A#4/4 | B4/4 |
  A: | G4/4  | G4/4 |
  T: | E4/4  | D4/4 |
  B: | C#3/4 | D3/4 |
}`;
    const legal = infer(score, 0);
    const wrongSpelling = infer(score.replace("A#4", "Bb4"), 0);
    const wrongMotion = infer(score.replace("D3/4", "D2/4"), 0);
    expect(legal.region?.selected).toMatchObject({
      functionalBaseId: "DDVII", identity: { root: pitch("C", 1) },
      fit: { spellingConsistent: false },
    });
    expect(legal.region?.selected?.evidence.some(e => e.code === "written-double-dominant-into-six-four")).toBe(true);
    expect(wrongSpelling.region?.selected?.fit.spellingConsistent).toBe(true);
    expect(wrongMotion.chord?.identity.root).toEqual(pitch("A", 1));
    const augmented = (result: typeof legal) => checkHarmony(result.applied).diagnostics.some(d =>
      d.ruleId === "melody.augmented-interval" && d.tick === result.applied.ppq && d.voiceIds.includes("soprano"));
    expect([augmented(legal), augmented(wrongSpelling)]).toEqual([false, true]);
  });

  it.each([["E3", 0], ["Fb3", 3], ["F3", 3]])("手工 I6 配 %s 继续按实写检查", (bass, count) => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
  S: | G4/1 |
  A: | C4/1 |
  T: | C4/1 |
  B: | ${bass}/1 |
  H: | I6/1 |
}`);
    expect(diagnosticsAt(project, 0)).toHaveLength(count);
  });
});
