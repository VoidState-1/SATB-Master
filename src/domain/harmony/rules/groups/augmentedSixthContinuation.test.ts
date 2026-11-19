import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const progression = `satb 1
key C minor
meter 3/4
bars 1..1 {
 S: | Eb5/4 D5/4 D5/4 |
 A: | C5/2 B4/4 |
 T: | F#4/2 G4/4 |
 B: | Ab2/2 G2/4 |
 H: | Ger+6/4 Fr+6/4 V/4 |
}`;

function errors(score: string) {
  const { project } = compileScoreText(score);
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.augmented-sixth")
    .map(item => [item.tick, item.severity]);
}

describe("德增六先转为法增六再解决", () => {
  it("只有五音下行半音时，两端的解决由后续连接检验", () => {
    expect(errors(progression)).toEqual([]);
    expect(errors(progression.replace("F#4/2 G4/4", "F#4/2 F4/4"))).toEqual([[1920, "error"]]);
  });

  it.each([
    ["高端保持在错误八度", progression.replace("F#4/2 G4/4", "F#4/4 F#3/4 G3/4")],
    ["只有法增六标签，五音没有下行", progression.replace("Eb5/4 D5/4", "Eb5/4 Eb5/4")],
    ["半音下行但改到错误的八度", progression.replace("Eb5/4 D5/4", "Eb5/4 D4/4")],
    ["将源五音同响异名改写", progression.replace("Eb5", "D#5")],
    ["没有后继和声", progression.replace(" V/4", " r/4")],
  ])("%s 仍保留错误", (_title, score) => {
    expect(errors(score)).toContainEqual([960, "error"]);
  });
});
