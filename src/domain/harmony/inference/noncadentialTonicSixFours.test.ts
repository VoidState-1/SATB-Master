import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { phraseInferenceFingerprint } from "../phrase/fingerprint";
import { applyHarmonyInference, inferHarmony } from "./harmonyInference";
import { inferChords } from "./inferChords";
import type { ChordInferenceResult } from "./types";

const weakerThenPredominant = `satb 1
key D major
meter 4/4
bars 1..3 {
  S: | G5/2 E5/4 F#5/4 | D5/2 E5/2 | F#5/1 |
  A: | B4/2 C#4/4 D4/4 | B4/2 C#4/2 | D4/1 |
  T: | E4/2 A3/2 | G3/2 A3/2 | A3/1 |
  B: | G2/2 A2/2 | G2/2 A2/2 | D3/1 |
}`;

const genuineCadential = `satb 1
key D major
meter 4/4
bars 1..2 {
  S: | G5/2 F#5/4 E5/4 | D5/1 |
  A: | B4/2 D4/4 C#4/4 | F#4/1 |
  T: | D4/2 A3/4 A3/4 | A3/1 |
  B: | G2/2 A2/4 A1/4 | D2/1 |
}`;

const tick = 3 * PPQ;
const at = (result: ChordInferenceResult, time = tick) =>
  result.regions.find(region => region.fromTick <= time && time < region.toTick);
const hasProof = (result: ChordInferenceResult) => result.regions.some(region =>
  region.selected?.evidence.some(item => item.code === "tonic-six-four-before-stronger-predominant"));
const compile = (text = weakerThenPredominant) => compileScoreText(text).project;

describe("较弱主四六与较强下属到点的局部判别", () => {
  it("用真实低音与完整下属区分同实体备选，保留 K46 和原路径分", () => {
    const project = compile();
    const inference = inferHarmony(project);
    const region = at(inference.chordInference)!;
    expect(region).toMatchObject({
      fromTick: tick, toTick: 4 * PPQ, status: "resolved",
      selected: { functionalBaseId: "T" },
      alternatives: [{ functionalBaseId: "K46" }],
    });
    expect(hasProof(inference.chordInference)).toBe(true);
    expect(region.selected?.identity).toEqual(region.alternatives[0].identity);
    expect(region.selected?.pathScore).toBe(region.alternatives[0].pathScore);
    const applied = applyHarmonyInference(project, inference, { mode: "fill-gaps" }).project;
    const written = applied.chordTrack.regions.find(item => item.startTick === tick);
    expect(written?.identity).toEqual(region.selected?.identity);
    expect(written?.semantics?.cadenceRole).toBeUndefined();
    expect(checkHarmony(applied).diagnostics).toContainEqual(expect.objectContaining({
      tick, ruleId: "chord.second-inversion-voicing", severity: "warning",
    }));
  });

  it("只选中证明区间的一部分时，仍用完整原谱前后文且保留备选", () => {
    const fromTick = tick + PPQ / 4, toTick = tick + PPQ / 2;
    const result = inferChords(compile(), { fromTick, toTick });
    expect(hasProof(result)).toBe(true);
    expect(result.regions).toMatchObject([{
      fromTick, toTick, status: "resolved", selected: { functionalBaseId: "T" },
      alternatives: [{ functionalBaseId: "K46" }],
    }]);
  });

  it("保留实际属根低音八度相接、有更弱属落点的真 K46", () => {
    const result = inferChords(compile(genuineCadential));
    expect(hasProof(result)).toBe(false);
    expect(at(result, 2 * PPQ)).toMatchObject({ status: "resolved", selected: { functionalBaseId: "K46" } });
  });

  it("下属更弱的同类实写转接继续显示双解", () => {
    const score = weakerThenPredominant.replace("E5/4 F#5/4", "E5/4 F#5/8 D5/8")
      .replace("C#4/4 D4/4", "C#4/4 D4/8 B4/8")
      .replace("E4/2 A3/2", "E4/2 A3/4. G3/8")
      .replace("G2/2 A2/2", "G2/2 A2/4. G2/8");
    const result = inferChords(compile(score));
    expect(hasProof(result)).toBe(false);
    expect(at(result)).toMatchObject({ status: "ambiguous", alternatives: [{ functionalBaseId: "K46" }] });
  });

  it.each([
    ["真实句界", "manual", false],
    ["仍匹配当前输入的自动句界", "inferred", false],
    ["标为历史的自动句界", "inferred", true],
  ] as const)("%s 按既有有效边界行为处理", (_label, source, stale) => {
    const project = compile();
    project.structure.phraseBoundaries.push({
      id: "context-boundary", tick: 4 * PPQ, source, stale, confidence: "certain",
      inferenceFingerprint: source === "inferred" ? phraseInferenceFingerprint(project) : undefined,
    });
    const result = inferChords(project);
    expect(hasProof(result)).toBe(stale);
    expect(at(result)?.status).toBe(stale ? "resolved" : "ambiguous");
  });

  it("调事件重置时保留双解，即使两端有效调名相同", () => {
    const project = compile();
    project.keyEvents.push({ ...project.keyEvents[0], tick: 4 * PPQ, id: "same-key-new-event" });
    const result = inferChords(project);
    expect(hasProof(result)).toBe(false);
    expect(at(result)).toMatchObject({ status: "ambiguous", alternatives: [{ functionalBaseId: "K46" }] });
  });

  it("局部低于男低音或目标异名时均不能使用证据", () => {
    const belowBass = weakerThenPredominant.replace("G3/2 A3/2", "G1/2 A3/2");
    const wrongSpelling = weakerThenPredominant.replace("C#4/4 D4/4", "C#4/4 C##4/4");
    for (const score of [belowBass, wrongSpelling]) expect(hasProof(inferChords(compile(score)))).toBe(false);
  });
});
