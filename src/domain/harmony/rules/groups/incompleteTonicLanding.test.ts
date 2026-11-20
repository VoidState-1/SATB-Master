import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const rootPosition = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | B4/4 C5/4 C5/2 |
 A: | F4/4 E4/4 E4/2 |
 T: | D4/4 C4/4 G3/2 |
 B: | G2/4 C3/4 E3/2 |
 H: | V7/4 I/4 I6/2 |
}`;
const secondInversion = rootPosition
  .replace("B4/4 C5/4", "G4/4 C5/4")
  .replace("D4/4 C4/4", "B3/4 C4/4")
  .replace("G2/4 C3/4", "D3/4 C3/4")
  .replace("V7/4", "V43/4");

function missing(score: string, split = false) {
  const { project } = compileScoreText(score);
  if (split) project.structure.phraseBoundaries = [{
    id: "break", tick: project.ppq, source: "manual", confidence: "certain",
  }];
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === "chord.incomplete-members" && d.tick === project.ppq,
  ).map(d => d.params.missing);
}

describe("由实奏属七解决证明主和弦省五", () => {
  it.each([rootPosition, secondInversion])("三根一三只需当前连接成立", score => {
    expect(missing(score)).toEqual([]);
  });

  it.each([
    ["属七先已省五", rootPosition.replace("D4/4 C4", "G3/4 C4")],
    ["五音跳到另一个八度", rootPosition.replace("D4/4 C4/4", "D4/4 C3/4")],
    ["三四和弦根音跳过落点八度", secondInversion.replace("G4/4 C5/4", "G4/4 C6/4")],
    ["目标没有三音", rootPosition.replace("F4/4 E4/4", "F4/4 C4/4")],
  ])("%s 保留缺音", (_reason, score) => {
    expect(missing(score)).toHaveLength(1);
  });

  it("显式分句截断解决", () => {
    expect(missing(rootPosition, true)).toEqual(["G"]);
  });
});
