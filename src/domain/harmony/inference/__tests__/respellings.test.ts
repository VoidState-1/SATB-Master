import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, buildHarmonyAnalysis, checkHarmony, inferChords } from "../..";
import type { ChordInferenceOptions } from "../types";
import { inferHarmony } from "..";
import { applyChordInference } from "../pipeline";
import { formatChordRegion } from "../../../chords";
import { validateProject } from "../../../project";

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

const leadingSeventhIntoLocalDominant = `satb 1
key Eb major
meter 2/4
bars 1..5 {
  S: | Eb5/2 | F#5/2 | G5/4 Eb5/4 | D5/2 | C5/2  |
  A: | G4/2  | C5/2  | B4/4 G4/4  | G4/2 | G4/2  |
  T: | Bb3/2 | Eb4/2 | D4/4 Eb4/4 | F4/2 | Eb4/2 |
  B: | Eb3/2 | A2/2  | B2/4 B2/4  | B2/2 | C3/2  |
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

const staggeredDoubleDominant = `satb 1
key D major
meter 3/4
bars 1..3 {
  S: | B4/4 B4/2         | A4/4 G4/2   | F#4/2. |
  A: | G4/4 E#4/2        | F#4/4 E4/2  | A3/2.  |
  T: | D4/4 D4/4 D4/4    | D4/4 C#4/2  | D4/2.  |
  B: | G3/4 G#3/4 A3/4   | A3/4 A2/2   | D3/2.  |
}`;

function labelledDoubleDominant(score: string, landing = "K46", start = "2:1") {
  return compileScoreText(score + `
annotations {
  chord prep range=[1:1,1:2) symbol=IV
  chord source range=[1:2,1:3) symbol=DDVII7
  ${landing ? `chord landing range=[${start},2:2) symbol=${landing}` : ""}
  chord dominant range=[2:2,3:1) symbol=V7
}`).project;
}

function diagnosticsAt(project: ReturnType<typeof compileScoreText>["project"], tick: number) {
  return checkHarmony(project).diagnostics.filter(d => d.tick === tick && rules.has(d.ruleId));
}

function inferWrittenRespelling(score: string, beat: number, options?: ChordInferenceOptions) {
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
    const played = inferWrittenRespelling(auxiliary, 1, { allowAbsoluteFallback: false });
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
    const literal = inferWrittenRespelling(auxiliary.replace("G##2", "A2"), 1);
    expect(literal.respelling).toBeUndefined();
    expect(literal.region?.selected?.functionalBaseId).toBe("DDVII");
    expect(literal.chord?.semantics).toBeDefined();
  });

  it("减七枢纽保留七音下行的实写出口和旧调等音证据", () => {
    const played = inferWrittenRespelling(diminishedPivot, 3);
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
    const differentExit = inferWrittenRespelling(diminishedPivot.replace("Eb3/8 D3/8", "Eb3/8 D2/8"), 3);
    expect(differentExit.chord?.identity).toEqual(played.chord?.identity);
    expect(differentExit.region?.selected?.evidence.some(e => e.code === "written-diminished-pivot-to-seventh")).toBe(false);
    const oldSpelling = inferWrittenRespelling(diminishedPivot.replace("Eb3/8 D3/8", "D#3/8 D3/8"), 3);
    expect(oldSpelling.region?.selected?.functionalBaseId).toBe("DDVII");
    expect(oldSpelling.respelling).toBeUndefined();
  });

  it("实写导减七的两上两下解决支持已确认的局部属功能", () => {
    const played = inferWrittenRespelling(leadingSeventhIntoLocalDominant, 2);
    expect(played.chord?.identity).toMatchObject({ root: pitch("F", 1), bass: pitch("A") });
    expect(played.region?.selected?.functionalBaseId).toBe("DDVII");
    expect(played.chord?.semantics?.interpretations[0]).toMatchObject({
      localKey: { tonic: pitch("C"), mode: "minor" },
      appliedTarget: { degree: 5 }, designation: { kind: "double-dominant-leading-tone" },
    });
    expect(played.inference.warnings.some(w => w.fromTick === played.tick && w.code === "function-unresolved")).toBe(false);
    expect(played.diagnostics).toEqual([]);
    expect(checkHarmony(played.applied).diagnostics.some(d =>
      d.tick === 2 * played.tick && d.ruleId === "chord.doubled-leading-tone")).toBe(false);

    const wrongSpelling = inferWrittenRespelling(leadingSeventhIntoLocalDominant.replace("F#5/2", "Gb5/2"), 2);
    const wrongMotion = inferWrittenRespelling(leadingSeventhIntoLocalDominant.replace("| Eb4/2 | D4", "| Eb3/2 | D4"), 2);
    const target = (result: typeof played) => result.applied.chordTrack.regions.find(chord => chord.startTick === 2 * played.tick);
    expect(target(played)?.identity).toMatchObject({ root: pitch("G"), bass: pitch("B") });
    for (const wrong of [wrongSpelling, wrongMotion]) {
      expect(wrong.region?.selected?.evidence.some(e => e.code === "written-leading-seventh-into-local-dominant")).toBe(false);
      expect(target(wrong)?.identity).toEqual(target(played)?.identity);
    }
    expect(wrongMotion.chord?.identity).toEqual(played.chord?.identity);
    expect(wrongMotion.chord?.semantics).toBeUndefined();
  });

  it("同一实写低音换位保留原调属读法，新调增六出口使功能待复核", () => {
    const played = inferWrittenRespelling(revoicedTriad, 9.5);
    expect(played.chord?.identity).toMatchObject({
      root: pitch("C", 1), bass: pitch("E", 1), structure: { quality: "major" },
    });
    expect(played.chord?.semantics?.interpretations[0]).toMatchObject({
      localKey: { tonic: pitch("F", 1), mode: "minor" }, degree: 5,
      designation: { kind: "primary", primaryFunction: "dominant" }, confidence: "ambiguous",
    });
    expect(played.respelling?.enharmonicReadings).toMatchObject([{
      identity: { root: pitch("D", -1), bass: pitch("F") },
      semantics: { interpretations: [{ designation: { kind: "neapolitan" } }] },
    }]);
    expect(played.diagnostics).toEqual([]);
    expect(played.region?.selected?.evidence.some(e => e.code === "written-neapolitan-pivot-to-german-sixth")).toBe(true);
    expect(played.inference.warnings.some(w => w.fromTick === played.tick && w.code === "function-unresolved")).toBe(true);
    expect(checkHarmony(played.applied).diagnostics.filter(d => d.tick >= played.tick &&
      d.tick < played.tick + played.project.ppq &&
      ["chord.doubled-leading-tone", "resolution.leading-tone"].includes(d.ruleId))).toEqual([]);
    const reattack = inferWrittenRespelling(revoicedTriad.replace("G#5/2", "G#5/4. G#5/8"), 9.5);
    expect(reattack.chord?.identity).toEqual(played.chord?.identity);
    expect(reattack.chord?.semantics).toBeUndefined();
    const wrongExit = inferWrittenRespelling(revoicedTriad.replace("Ab5/8 G5/8 G5/4", "Ab5/8 G4/8 G4/4"), 9.5);
    expect(wrongExit.chord?.identity).toEqual(played.chord?.identity);
    expect(wrongExit.chord?.semantics).toBeUndefined();
  });

  it("同音型返回前调时保留属功能，真实重复导音和错解仍然报告", () => {
    const returns = revoicedTriad.replace("Ab5/8 G5/8 G5/4", "A5/2")
      .replace("| C5/2", "| C#5/2").replace("| Eb4/2", "| F#4/2")
      .replace("F#3/8 G3/8 G3/4", "F#3/2");
    const played = inferWrittenRespelling(returns, 9.5);
    const wrong = inferWrittenRespelling(returns.replace(/\| F#4\/2 *\|\n  B:/, "| C#4/2 |\n  B:"), 9.5);
    for (const result of [played, wrong]) {
      expect(result.chord?.semantics?.interpretations[0]).toMatchObject({
        localKey: { tonic: pitch("F", 1), mode: "minor" }, degree: 5, confidence: "probable",
      });
      expect(result.region?.selected?.evidence.some(e => e.code === "written-dominant-bass-revoicing")).toBe(true);
      expect(checkHarmony(result.applied).diagnostics).toContainEqual(expect.objectContaining({
        tick: result.tick, ruleId: "chord.doubled-leading-tone",
      }));
    }
    const failedTenor = (result: typeof played) => checkHarmony(result.applied).diagnostics.some(d =>
      d.tick === 10 * result.project.ppq && d.ruleId === "resolution.leading-tone" && d.voiceIds.includes("tenor"));
    expect([failedTenor(played), failedTenor(wrong)]).toEqual([false, true]);
  });

  it.each([false, true])("绝对回退=%s 时低音换位仍可按实写写回", allowAbsoluteFallback => {
    expect(inferWrittenRespelling(revoicedTriad, 9.5, { allowAbsoluteFallback }).region).toMatchObject({
      status: "resolved", selected: { confidence: "medium", fit: { spellingConsistent: true } },
    });
  });

  it("高置信筛选保留原有实写功能并排除待复核的等音读法", () => {
    expect(inferWrittenRespelling(revoicedTriad, 9.5, { minConfidence: "high", allowAbsoluteFallback: true }).chord).toBeUndefined();
    const exact = writtenTriad.replace("B4/4", "Cb5/4").replace("E4/4", "Fb4/4")
      .replace("B3/4", "Cb4/4").replace("G#2/4", "Ab2/4");
    expect(inferWrittenRespelling(exact, 1, { minConfidence: "high" }).region?.selected?.functionalBaseId).toBe("N6");
  });

  it("混合拼写、真实外音和最低音错位不能建立实写替代", () => {
    for (const score of [writtenTriad.replace("B3/4", "Cb4/4"), writtenTriad.replace("B3/4", "A3/4"),
      writtenTriad.replace("B3/4", "B1/4")])
      expect(inferWrittenRespelling(score, 1).respelling).toBeUndefined();
    const mixedSeventh = inferWrittenRespelling(auxiliary.replace("B#3", "C4"), 1);
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
    const legal = inferWrittenRespelling(score, 0);
    const wrongSpelling = inferWrittenRespelling(score.replace("A#4", "Bb4"), 0);
    const wrongMotion = inferWrittenRespelling(score.replace("D3/4", "D2/4"), 0);
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

  it("低音先到、共同音重奏时，按最早完整落点保留重属导七的实写许可", () => {
    const legal = inferWrittenRespelling(staggeredDoubleDominant, 1);
    expect(legal.chord?.identity).toMatchObject({
      root: pitch("G", 1), bass: pitch("G", 1), structure: { quality: "diminished7" },
    });
    expect(legal.region?.selected?.functionalBaseId).toBe("DDVII");
    expect(legal.region?.selected?.evidence).toContainEqual(expect.objectContaining({
      code: "written-double-dominant-into-six-four", details: {
        firstArrivalTick: 2 * legal.tick, landingTick: 3 * legal.tick,
      },
    }));
    expect(legal.diagnostics).toEqual([]);
    expect(legal.applied.chordTrack.regions.some(c => c.startTick === 2 * legal.tick)).toBe(false);
    for (const landing of ["", "K46"]) {
      const project = labelledDoubleDominant(staggeredDoubleDominant, landing);
      expect(diagnosticsAt(project, project.ppq)).toEqual([]);
    }
    const fromBassArrival = labelledDoubleDominant(staggeredDoubleDominant, "K46", "1:3");
    expect(diagnosticsAt(fromBassArrival, fromBassArrival.ppq)).toEqual([]);
  });

  it.each([
    ["互换解决声部", staggeredDoubleDominant.replace("| A4/4 G4/2", "| F#4/4 G4/2").replace("| F#4/4 E4/2", "| A4/4 E4/2")],
    ["低音错八度", staggeredDoubleDominant.replace("G#3/4 A3/4", "G#3/4 A2/4").replace("| A3/4 A2/2", "| A2/4 A2/2")],
    ["等候声部有休止", staggeredDoubleDominant.replace("E#4/2", "E#4/4 r/4")],
    ["先绕行再到预期终点", staggeredDoubleDominant.replace("B4/4 B4/2", "B4/4 B4/4 C5/8 B4/8")],
  ])("%s时不借后续终止四六保留重属功能", (_reason, score) => {
    const played = inferWrittenRespelling(score, 1);
    expect(played.chord?.identity.root).toEqual(pitch("E", 1));
    expect(played.chord?.semantics).toBeUndefined();
    const project = labelledDoubleDominant(score);
    expect(diagnosticsAt(project, project.ppq).map(d => d.ruleId).sort()).toEqual([
      "chord.incomplete-members", "chord.unclassified-nonchord-tone",
    ]);
  });

  it("显式冲突标签或错开的人工句界禁止借用实写许可", () => {
    const conflicting = labelledDoubleDominant(staggeredDoubleDominant, "I64 role=pedal64");
    expect(diagnosticsAt(conflicting, conflicting.ppq)).toHaveLength(2);
    const conflictingBridge = labelledDoubleDominant(staggeredDoubleDominant, "I64 role=pedal64", "1:3");
    expect(diagnosticsAt(conflictingBridge, conflictingBridge.ppq)).toHaveLength(2);
    const cut = labelledDoubleDominant(staggeredDoubleDominant);
    cut.structure.phraseBoundaries = [{
      id: "cut", tick: cut.ppq * 2, source: "manual", confidence: "certain",
    }];
    expect(diagnosticsAt(cut, cut.ppq)).toHaveLength(2);
    expect(inferChords(cut).regions.find(r => r.fromTick === cut.ppq)?.selected?.functionalBaseId).not.toBe("DDVII");
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

const code = "whole-written-triad-respelling";

function example(voices = { soprano: "B4", alto: "E4", tenor: "B3", bass: "G#2" }) {
  return compileScoreText(`satb 1
key Eb minor
meter 2/4
bars 1..2 {
  S: | Ab4/4 ${voices.soprano}/4 | Bb4/4 Gb4/4 |
  A: | F4/4 ${voices.alto}/4 | F4/4 Eb4/4 |
  T: | Cb4/4 ${voices.tenor}/4 | Bb3/4 Bb3/4 |
  B: | D3/4 ${voices.bass}/4 | Bb2/4 Eb3/4 |
}`).project;
}

function inferWholeWrittenTriad(project: ReturnType<typeof example>, allowAbsoluteFallback = false) {
  const result = inferHarmony(project, { allowAbsoluteFallback });
  const region = result.chordInference.regions.find(item =>
    item.fromTick <= project.ppq && item.toTick > project.ppq);
  return {
    result, region,
    hasWrittenReading: region?.selected?.evidence.some(evidence => evidence.code === code) === true,
  };
}

function inversionReported(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics.some(diagnostic =>
    diagnostic.tick === project.ppq && diagnostic.ruleId === "chord.inversion-bass" &&
    diagnostic.severity === "error");
}

describe("完整三和弦一致等音换写的推导", () => {
  it("开启绝对回退时按实写 E/G♯ 提供待确认候选", () => {
    const project = example();
    const { result, region, hasWrittenReading } = inferWholeWrittenTriad(project, true);
    expect(hasWrittenReading).toBe(true);
    expect(region?.status).toBe("ambiguous");
    expect(region?.selected?.identity).toMatchObject({
      root: { step: "E", alter: 0 },
      bass: { step: "G", alter: 1 },
      structure: { kind: "tertian", quality: "major" },
    });
    expect(region?.selected?.semantics).toBeUndefined();
    const normal = applyHarmonyInference(project, result, { mode: "fill-gaps" }).project;
    expect(normal.chordTrack.regions.some(item => item.startTick === project.ppq)).toBe(false);
    const explicit = applyHarmonyInference(project, result, {
      mode: "fill-gaps", selection: new Set([region!.id]),
    }).project;
    expect(explicit.chordTrack.regions[0]?.identity).toEqual(region?.selected?.identity);
    expect(inversionReported(explicit)).toBe(false);
  });

  it("关闭绝对回退时不生成未经证实的功能或绝对候选", () => {
    const project = example();
    const { result, region } = inferWholeWrittenTriad(project);
    expect(region?.status).toBe("unclassified");
    expect(region?.selected).toBeUndefined();
    expect(applyHarmonyInference(project, result, { mode: "fill-gaps" }).project.chordTrack.regions
      .some(chord => chord.startTick === project.ppq)).toBe(false);
  });

  it("置信度过滤隐藏待确认项时也不写回旧等音功能", () => {
    const project = example();
    const result = inferHarmony(project, { minConfidence: "medium", allowAbsoluteFallback: true });
    const region = result.chordInference.regions.find(item =>
      item.fromTick <= project.ppq && item.toTick > project.ppq);
    expect(region?.status).toBe("unclassified");
    const applied = applyHarmonyInference(project, result, { mode: "fill-gaps" }).project;
    expect(applied.chordTrack.regions.some(item => item.startTick === project.ppq)).toBe(false);
  });
  it("真实的单低音拼写冲突仍由规则报告", () => {
    const project = example({ soprano: "Cb5", alto: "Fb4", tenor: "Cb4", bass: "G#2" });
    const { result, region, hasWrittenReading } = inferWholeWrittenTriad(project);
    expect(hasWrittenReading).toBe(false);
    expect(region?.status).toBe("resolved");
    expect(inversionReported(applyHarmonyInference(project, result, { mode: "fill-gaps" }).project)).toBe(true);
  });

  it("已经有完整实写功能时仍正常应用", () => {
    const project = example({ soprano: "Cb5", alto: "Fb4", tenor: "Cb4", bass: "Ab2" });
    const { result, region, hasWrittenReading } = inferWholeWrittenTriad(project);
    expect(hasWrittenReading).toBe(false);
    expect(region?.selected?.functionalBaseId).toBe("N6");
    expect(region?.status).toBe("resolved");
    expect(inversionReported(applyHarmonyInference(project, result, { mode: "fill-gaps" }).project)).toBe(false);
  });

  it("只有低音攻入、其余声部仍在持续时不切作新三和弦", () => {
    const project = compileScoreText(`satb 1
key Eb minor
meter 2/4
bars 1..2 {
  S: | B4/2 | Bb4/4 Gb4/4 |
  A: | E4/2 | F4/4 Eb4/4 |
  T: | B3/2 | Bb3/4 Bb3/4 |
  B: | F#2/4 G#2/4 | Bb2/4 Eb3/4 |
}`).project;
    expect(inferWholeWrittenTriad(project, true).hasWrittenReading).toBe(false);
  });

  it("显式句界禁止借相邻的另一句成立候选", () => {
    const project = example();
    project.structure.phraseBoundaries = [{
      id: "manual-boundary", tick: 2 * project.ppq, source: "manual", confidence: "certain",
    }];
    expect(inferWholeWrittenTriad(project, true).hasWrittenReading).toBe(false);
  });

  it("标签低音不是最低实音时不接受书写替代", () => {
    const project = example({ soprano: "B4", alto: "E4", tenor: "B1", bass: "G#2" });
    expect(inferWholeWrittenTriad(project, true).hasWrittenReading).toBe(false);
  });
});

// First tonicization in Huang §47, written exercise 10, with straight eighths.
const seventh = `satb 1
key Ab major
meter 2/4
bars 1..2 {
  S: | Ab4/8 Ab4/8~ Ab4/8 Bbb4/8 | G4/2 |
  A: | Cb4/8 Ebb4/8 Db4/4 | Db4/2 |
  T: | Ab3/8 Fb3/8 Fb3/4 | Eb3/2 |
  B: | Fb3/4 Bbb2/4 | Bb2/2 |
}`;

const italian = `satb 1
key Ab major
meter 2/4
bars 1..2 {
  S: | Ab4/8 Ab4/8 G4/4 | Ab4/2 |
  A: | Cb4/8 D4/8 Eb4/4 | Eb4/2 |
  T: | Ab3/8 Ab3/8 Bb3/4 | C4/2 |
  B: | Fb3/4 Eb3/4 | Ab2/2 |
}`;

function analyze(score: string, cut?: number) {
  const project = compileScoreText(score).project;
  if (cut !== undefined) project.structure.phraseBoundaries = [
    { id: "cut", source: "manual", tick: cut, confidence: "certain" },
  ];
  const inferred = inferChords(project);
  const applied = applyChordInference(project, inferred, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  });
  const at = (tick: number) => applied.project.chordTrack.regions.find(r => r.startTick === tick);
  const source = inferred.regions.find(r => r.fromTick === 480)?.selected;
  return { source, at, applied, project, diagnostics: checkHarmony(applied.project).diagnostics };
}

describe("书写小七度与等音意式增六", () => {
  it("核实先行低音和后到上方导音后才写回省五属七", () => {
    const { source, at, applied, project, diagnostics } = analyze(seventh);
    expect(source?.evidence).toContainEqual(expect.objectContaining({
      code: "written-seventh-over-enharmonic-italian",
      details: { targetRoot: "B:-2", targetQuality: "major", omittedDegree: 5, bassArrivalTick: 960, upperResolutionTick: 1440 },
    }));
    expect(at(480)).toMatchObject({
      startTick: 480, durationTicks: 480,
      identity: { root: { step: "F", alter: -1 }, bass: { step: "F", alter: -1 }, structure: { quality: "dominant7" } },
    });
    const reading = at(480)?.semantics?.interpretations[0];
    expect(reading).toMatchObject({ degree: 6, degreeAlteration: -1 });
    expect(reading?.localKey).toBeUndefined();
    expect(reading?.appliedTarget).toBeUndefined();
    expect(at(1440)?.identity).toMatchObject({ root: { step: "B", alter: -2 }, structure: { quality: "major" } });
    expect(applied.project.keyEvents).toEqual(project.keyEvents);
    expect(applied.project.satbTracks).toEqual(project.satbTracks);
    expect(diagnostics.filter(d => d.ruleId === "chord.augmented-sixth-voicing")).toEqual([]);
  });

  it("开启绝对回退仍选取有解决证据的实写属七，并遵守高置信门槛", () => {
    const { project } = compileScoreText(seventh);
    const atSource = (options: Parameters<typeof inferChords>[1]) =>
      inferChords(project, options).regions.find(region => region.fromTick <= 480 && 480 < region.toTick);
    const resolved = atSource({ allowAbsoluteFallback: true });
    expect(resolved).toMatchObject({
      status: "resolved", selected: { identity: { root: { step: "F", alter: -1 }, structure: { quality: "dominant7" } } },
    });
    expect(atSource({ minConfidence: "high" })?.selected).toBeUndefined();
  });

  it("同一写实解决可同步到达", () => {
    const direct = seventh.replace("Ab4/8 Ab4/8~ Ab4/8 Bbb4/8", "Ab4/8 Ab4/8 Bbb4/4");
    expect(analyze(direct).source?.evidence).toContainEqual(expect.objectContaining({
      code: "written-seventh-over-enharmonic-italian",
      details: expect.objectContaining({ bassArrivalTick: 960, upperResolutionTick: 960 }),
    }));
  });

  it("实写增六的两声部向属低音反向解决", () => {
    const { at, diagnostics } = analyze(italian);
    expect(at(480)?.identity.structure).toMatchObject({ kind: "augmented-sixth", variant: "italian" });
    expect(diagnostics.filter(d => d.ruleId === "chord.augmented-sixth-voicing")).toEqual([]);
  });

  it("同声响改写为 D 后仍查意式增六的错误重复", () => {
    const { at, diagnostics } = analyze(seventh.replace("Ebb4/8", "D4/8"));
    expect(at(480)?.identity.structure).toMatchObject({ kind: "augmented-sixth", variant: "italian" });
    expect(diagnostics).toContainEqual(expect.objectContaining({ ruleId: "chord.augmented-sixth-voicing", tick: 480 }));
  });

  it.each([
    ["目标低音错误，即使上三声部同音", seventh.replace("Bbb2/4", "Db3/4"), undefined],
    ["实际七音解决错八度，音级集合不变", seventh.replace("Ebb4/8 Db4/4", "Ebb4/8 Db5/4"), undefined],
    ["实际导音解决错八度，音级集合不变", seventh.replace("Bbb4/8", "Bbb5/8"), undefined],
    ["前一低音没有保持到切片", seventh.replace("Fb3/4 Bbb2/4", "Fb3/8 Fb3/8 Bbb2/4"), undefined],
    ["邻拍没有结束原属七的五音", seventh.replace("Cb4/8", "C4/8"), undefined],
    ["导音重新起奏，不能代替原音符的延线", seventh.replace("Ab4/8~ Ab4/8", "Ab4/8 Ab4/8"), undefined],
    ["句界切断延迟解决", seventh, 1440],
  ] as const)("证据不足时保留原候选（%s）", (_label, score, cut) => {
    expect(analyze(score, cut).at(480)?.identity.structure).toMatchObject({ kind: "augmented-sixth", variant: "italian" });
  });
});

const resolution = "raised-fifth-to-doubled-third";
const score = `satb 1
key F major
meter 4/4
bars 1..1 {
  S: | G4/4 G#4/4 A4/2 |
  A: | E4/2 F4/2 |
  T: | Bb3/2 A3/2 |
  B: | C3/2 F3/2 |
}`;

describe("原位升五属七到重复三音的原位大主和弦", () => {
  it("保留普通属七，默认写回变音与只省五音的主和弦", () => {
    const { project } = compileScoreText(score);
    const result = inferHarmony(project);
    const [ordinary, altered, tonic] = result.chordInference.regions;
    expect(result.chordInference.unresolvedObservationIndices).toEqual([]);
    expect(ordinary.selected?.identity.structure).toMatchObject({ quality: "dominant7", alterations: [] });
    expect(altered.selected?.fit).toMatchObject({ omittedChordDegrees: [], nonChordToneNoteIds: [] });
    expect(tonic.selected?.fit).toMatchObject({ omittedChordDegrees: [5], nonChordToneNoteIds: [] });
    expect([altered, tonic].map(region => region.status)).toEqual(["resolved", "resolved"]);
    for (const region of [altered, tonic]) {
      expect(region.selected?.evidence.some(evidence => evidence.code === resolution)).toBe(true);
    }

    const { project: written, skipped } = applyHarmonyInference(project, result, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    });
    expect(skipped).toEqual([]);
    expect(written.satbTracks).toEqual(project.satbTracks);
    expect(validateProject(JSON.parse(JSON.stringify(written)))).toBe(true);
    expect(written.chordTrack.regions.map(region => formatChordRegion(written, region).functional))
      .toEqual(["D7", "D7(♯5)", "T"]);
    expect(written.chordTrack.regions[1].identity.structure).toMatchObject({
      quality: "dominant7", alterations: [{ degree: 5, alter: 1, tendency: "up" }],
    });
  });

  it("选区内仍可用选区外相邻配置证明变音与省五", () => {
    const { project } = compileScoreText(score);
    const fromTick = project.ppq + 1;
    const toTick = 2 * project.ppq + 1;
    const selected = inferHarmony(project, { fromTick, toTick }).chordInference;
    expect(selected.regions.map(region => [region.fromTick, region.toTick, region.selected?.functionalBaseId]))
      .toEqual([[fromTick, 2 * project.ppq, "D"], [2 * project.ppq, toTick, "T"]]);
    const onlyTonic = inferHarmony(project, { fromTick: 2 * project.ppq, toTick }).chordInference;
    expect(onlyTonic.regions[0].selected?.fit.omittedChordDegrees).toEqual([5]);
  });

  it.each([
    ["降拼等音", score.replace("G#4/4", "Ab4/4")],
    ["升五音越过八度", score.replace("A4/2", "A5/2")],
    ["七音越过八度", score.replace("Bb3/2 A3/2", "Bb3/2 A4/2")],
    ["导音越过八度", score.replace("E4/2 F4/2", "E4/2 F5/2")],
    ["低音越过一个八度", score.replace("C3/2 F3/2", "C3/2 F1/2")],
    ["低音在解决前休止", score.replace("C3/2 F3/2", "C3/4. r/8 F3/2")],
    ["来源为第一转位", score.replace("E4/2 F4/2", "C4/2 F4/2").replace("C3/2 F3/2", "E3/2 F3/2")],
    ["落点包含五音", score.replace("Bb3/2 A3/2", "Bb3/2 C4/2")],
    ["小调", score.replace("F major", "F minor")],
    ["落点变调", score.replace("meter 4/4", "meter 4/4\nat 1:3 key C major")],
    ["落点重申调号", score.replace("meter 4/4", "meter 4/4\nat 1:3 key F major")],
  ])("%s 时保留普通推导，无成对解决证据", (_name, text) => {
    const { project } = compileScoreText(text);
    const regions = inferHarmony(project).chordInference.regions;
    const candidates = regions.flatMap(region => [region.selected, ...region.alternatives]);
    expect(candidates.some(candidate => candidate?.evidence.some(e => e.code === resolution))).toBe(false);
  });

  it("承认改调之后完全位于新调的连接", () => {
    const { project } = compileScoreText(score.replace("key F major", "key C major")
      .replace("meter 4/4", "meter 4/4\nat 1:2 key F major"));
    const regions = inferHarmony(project).chordInference.regions;
    expect(regions.slice(-2).map(region => region.selected?.evidence.some(e => e.code === resolution)))
      .toEqual([true, true]);
  });

  it("沿用独立确立的本地调，单靠这组音不建立新调", () => {
    const local = `satb 1
key C major
meter 4/4
bars 1..2 {
  S: | G4/2. G4/8 G#4/8 | A4/1 |
  A: | D4/2. E4/4 | F4/1 |
  T: | Bb3/2. Bb3/4 | A3/1 |
  B: | G2/2. C3/4 | F3/1 |
}`;
    const { project } = compileScoreText(local);
    const pair = inferHarmony(project).chordInference.regions.slice(-2);
    expect(pair.map(region => region.selected?.semantics?.interpretations[0].localKey))
      .toEqual(Array(2).fill({ tonic: { step: "F", alter: 0 }, mode: "major" }));
    expect(pair.map(region => region.selected?.evidence.some(e => e.code === resolution))).toEqual([true, true]);

    const unprepared = compileScoreText(local.replace("Bb3/2.", "B3/2.")).project;
    const regions = inferHarmony(unprepared).chordInference.regions;
    const candidates = regions.flatMap(region => [region.selected, ...region.alternatives]);
    expect(candidates.some(candidate => candidate?.evidence.some(e => e.code === resolution))).toBe(false);
  });

  it("解决不能跨手动画定的句界", () => {
    const { project } = compileScoreText(score);
    project.structure.phraseBoundaries = [{
      id: "manual-phrase", tick: 2 * project.ppq, source: "manual", confidence: "certain",
    }];
    const regions = inferHarmony(project).chordInference.regions;
    const candidates = regions.flatMap(region => [region.selected, ...region.alternatives]);
    expect(candidates.some(candidate => candidate?.evidence.some(e => e.code === resolution))).toBe(false);
  });
});
