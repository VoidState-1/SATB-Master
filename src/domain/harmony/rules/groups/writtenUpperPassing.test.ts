import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const example = `satb 1
key Eb major
meter 3/4
bars 1..1 {
 S: | G4/8 Ab4/8 Bb4/2 |
 A: | Eb4/2. |
 T: | Bb3/2. |
 B: | G3/2. |
 H: | I6/2. |
}`;

function atPassing(score: string, split = false) {
  const { project } = compileScoreText(score);
  if (split) project.structure.phraseBoundaries = [{
    id: "break", tick: project.ppq, source: "manual", confidence: "certain",
  }];
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === "chord.unclassified-nonchord-tone" && d.tick === project.ppq / 2,
  ).map(d => d.voiceIds);
}

describe("同一三和弦内实写的自然经过音", () => {
  it("三个伴随声部持续时，未标角色的单声部级进成立", () => {
    expect(atPassing(example)).toEqual([]);
  });

  it.each([
    ["调外拼写", example.replace("Ab4", "A4")],
    ["离开时跳进", example.replace("Bb4/2", "Eb5/2")],
    ["另一声部在落点重新起奏", example.replace("Eb4/2.", "Eb4/4 Eb4/2")],
    ["到达端实奏缺少三音", example.replace("G3/2.", "G3/4 Eb3/2")],
  ])("%s 保留外音警告", (_reason, score) => {
    expect(atPassing(score)).toContainEqual(["soprano"]);
  });

  it("句界截断两端证据", () => {
    expect(atPassing(example, true)).toContainEqual(["soprano"]);
  });
});
