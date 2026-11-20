import { describe, expect, it } from "vitest";
import { PPQ } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";
import { applyHarmonyInference, inferHarmony } from "../../inference/harmonyInference";

const approach = `satb 1
key F major
meter 2/4
bars 1..3 {
  S: | F5/8 G5/8 G#5/4 | A5/4 G5/4 | F5/2 |
  A: | F4/2 | F4/4 E4/4 | F4/2 |
  T: | Bb3/4 B3/4 | C4/2 | A3/2 |
  B: | D3/2 | C3/2 | F3/2 |
}
`;

function warningVoices(project: ReturnType<typeof compileScoreText>["project"]) {
  return checkHarmony(project).diagnostics.filter(item =>
    item.tick === PPQ && item.ruleId === "melody.augmented-interval").flatMap(item => item.voiceIds).sort();
}

function compile(text: string) {
  const { project } = compileScoreText(text);
  const applied = applyHarmonyInference(project, inferHarmony(project), { mode: "fill-gaps" }).project;
  // A normal given-harmony check may have a gap at the incoming reduced seventh.
  applied.chordTrack.regions = applied.chordTrack.regions.filter(region => region.startTick !== PPQ);
  return applied;
}

describe("大调重属改写到完整终止四六的同声部增一度", () => {
  it("不开中间和弦标签也能凭实写升II、升IV和后接属识别合法解决", () => {
    const score = compile(approach);
    expect(score.chordTrack.regions.some(region => region.startTick === PPQ)).toBe(false);
    expect(warningVoices(score)).toEqual([]);
  });

  it.each([
    ["四部仍拼出 K46，但升IV进了和弦三音", approach.replace("C4/2", "A3/4 C4/4")],
    ["后继四部没有实写属导音", approach.replace("F4/4 E4/4", "F4/4 F4/4")],
  ])("%s 时两个半音入音均无 B.3", (_description, score) => {
    expect(warningVoices(compile(score))).toEqual([]);
  });

  it("普通四六标签也不导致半音入音报警", () => {
    const score = compile(approach);
    const landing = score.chordTrack.regions.find(region => region.startTick === 2 * PPQ)!;
    landing.semantics = undefined;
    expect(warningVoices(score)).toEqual([]);
  });

  it("局部调冲突或句界不构成半音入音的报错证据", () => {
    const conflict = compile(approach);
    const prep = conflict.chordTrack.regions.find(region => region.startTick === PPQ / 2)!;
    prep.semantics = { ...prep.semantics!, interpretations: prep.semantics!.interpretations.map(reading => ({
      ...reading, localKey: { tonic: { step: "B", alter: -1 }, mode: "major" },
    })) };
    expect(warningVoices(conflict)).toEqual([]);
    const cut = compile(approach);
    cut.structure.phraseBoundaries.push({ id: "cut", tick: 2*PPQ, source: "manual", confidence: "certain" });
    expect(warningVoices(cut)).toEqual([]);
  });
});
