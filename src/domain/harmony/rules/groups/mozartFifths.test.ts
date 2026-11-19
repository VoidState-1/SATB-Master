import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const example = `satb 1
key C major
meter 2/4
bars 1..1 {
 S: | F#5/4 G5/4 |
 A: | C5/4 B4/4 |
 T: | Eb4/4 D4/4 |
 B: | Ab2/4 G2/4 |
 H: | Ger+6/4 V/4 |
}`;

function parallelFifths(score: string) {
  const { project } = compileScoreText(score);
  return checkHarmony(project).diagnostics.filter(diagnostic =>
    diagnostic.ruleId === "voice-leading.parallel-fifths",
  );
}

describe("德增六解决到属三和弦的莫扎特五度", () => {
  it.each([
    ["大调，低音与男高", example],
    ["小调，低音与女低", example.replace("C major", "C minor")
      .replace("C5/4 B4/4", "Eb4/4 D4/4").replace("T: | Eb4/4 D4/4", "T: | C4/4 B3/4")],
    ["只有实奏四声部", example.replace(" H: | Ger+6/4 V/4 |\n", "")],
  ])("%s 的合规连接放行", (_title, score) => {
    expect(parallelFifths(score)).toEqual([]);
  });

  it.each([
    ["移到外声部", example.replace("F#5/4 G5/4", "Eb5/4 D5/4")
      .replace("T: | Eb4/4 D4/4", "T: | F#4/4 G4/4"), "soprano"],
    ["增六高端没有上行", example.replace("F#5/4 G5/4", "F#5/4 F5/4"), "tenor"],
    ["只有同音异名的小七度", example.replace("F#5/4 G5/4", "Gb5/4 G5/4"), "tenor"],
    ["重复低音导致德增六缺少主音", example.replace("C5/4 B4/4", "Ab4/4 G4/4"), "tenor"],
    ["落点五度移高八度", example.replace("Eb4/4 D4/4", "Eb4/4 D5/4"), "tenor"],
    ["落点声部构成属七", example.replace("F#5/4 G5/4", "F#5/4 F5/4").replace(" V/4", " V7/4"), "tenor"],
    ["明确给定其他源和弦", example.replace("Ger+6/4", "Fr+6/4"), "tenor"],
  ])("%s 时保留对应声部的五度错误", (_title, score, upper) => {
    expect(parallelFifths(score)).toContainEqual(expect.objectContaining({
      tick: 960, severity: "error", voiceIds: expect.arrayContaining([upper, "bass"]),
    }));
  });
});
