import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const example = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | E5/4 C5/4 C5/2 |
 A: | F4/4 E4/4 E4/2 |
 T: | B3/4 C4/4 G3/2 |
 B: | G2/4 C3/4 E3/2 |
 H: | V7/4 I/4 I6/2 |
}`;

function missing(score: string, keepSourceLabel = false, boundary = false) {
  const { project } = compileScoreText(score);
  if (!keepSourceLabel) project.chordTrack.regions.shift();
  if (boundary) project.structure.phraseBoundaries = [{
    id: "break", tick: project.ppq, source: "manual", confidence: "certain",
  }];
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === "chord.incomplete-members" && d.tick === project.ppq,
  ).map(d => d.params.missing);
}

describe("六音代五的属七实奏直解至省五主和弦", () => {
  it("源切片无标签时仍按四部实际解决判断", () => {
    expect(missing(example)).toEqual([]);
    expect(missing(example, true)).toEqual([]);
  });

  it.each([
    ["六音书写不合调式", example.replace("E5/4", "Eb5/4")],
    ["女高错过下行三度的音区", example.replace("E5/4 C5/4", "E5/4 C6/4")],
    ["内声不再是完整的三音与七音", example.replace("F4/4", "G4/4")],
    ["属与主之间四部齐休", example
      .replace("E5/4", "E5/8 r/8").replace("F4/4", "F4/8 r/8")
      .replace("B3/4", "B3/8 r/8").replace("G2/4", "G2/8 r/8")],
  ])("%s 保留落点缺五", (_reason, score) => {
    expect(missing(score)).toEqual(["G"]);
  });

  it("相冲突的明确源标签或句界阻断实奏证明", () => {
    expect(missing(example.replace("V7/4", "IV/4"), true)).toEqual(["G"]);
    expect(missing(example, false, true)).toEqual(["G"]);
  });
});
