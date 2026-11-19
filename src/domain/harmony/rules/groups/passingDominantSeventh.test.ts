import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const passing = `satb 1
key C major
meter 3/4
bars 1..1 {
  S: | E4/4 F4/4 G4/4 |
  A: | C4/4 B3/4 C4/4 |
  T: | G3/4 G3/4 G3/4 |
  B: | C3/4 D3/4 E3/4 |
  H: | I/4 V43/4 I6/4 |
}`;

const unmarkedAnticipations = passing.replace("C3/4 D3/4 E3/4", "C3/8 D3/8@earlyD D3/8 E3/8@earlyE E3/4");
const anticipations = unmarkedAnticipations + `
annotations {
  note earlyD role=anticipation
  note earlyE role=anticipation
}`;

const descending = passing
  .replace("E4/4 F4/4 G4/4", "G4/4 F4/4 E4/4")
  .replace("C3/4 D3/4 E3/4", "E3/4 D3/4 C3/4")
  .replace("I/4 V43/4 I6/4", "I6/4 V43/4 I/4");

function seventhWarnings(score: string) {
  const { project } = compileScoreText(score);
  return {
    landing: 2 * project.ppq,
    diagnostics: checkHarmony(project).diagnostics.filter(diagnostic => diagnostic.ruleId === "resolution.chord-seventh"),
  };
}

describe("经过三四和弦中的七音", () => {
  it.each([
    ["大调", passing],
    ["小调", passing.replace("key C major", "key C minor").replace("E4/4", "Eb4/4")
      .replace("E3/4", "Eb3/4").replace("I/4 V43/4 I6/4", "i/4 V43/4 i6/4")],
    ["中音承担七音并亲自落到五音", passing.replace("E4/4 F4/4 G4/4", "C5/4 B4/4 C5/4")
      .replace("C4/4 B3/4 C4/4", "E4/4 F4/4 G4/4").replace("G3/4 G3/4 G3/4", "G3/4 G3/4 C4/4")],
    ["两处弱位低音分别先现并在换和弦时同音重奏", anticipations],
    ["两处先现低音无角色标注但实音与时值吻合", unmarkedAnticipations],
  ])("%s的上行进行按教材解决", (_name, score) => {
    expect(seventhWarnings(score).diagnostics).toEqual([]);
  });

  it.each([
    ["另一声部奏出五音，七音原声部跳到根音", passing.replace("F4/4 G4/4", "F4/4 C5/4")
      .replace("B3/4 C4/4", "B3/4 G4/4")],
    ["前和弦是下属四六和弦", passing.replace("E4/4 F4/4", "A4/4 F4/4")
      .replace("C4/4 B3/4", "F4/4 B3/4").replace("G3/4 G3/4 G3/4", "C4/4 G3/4 G3/4")
      .replace("I/4 V43/4", "IV64/4 V43/4")],
    ["中间是属五六和弦", passing.replace("C4/4 B3/4 C4/4", "C4/4 D4/4 C4/4")
      .replace("C3/4 D3/4 E3/4", "C3/4 B2/4 E3/4").replace("V43/4", "V65/4")],
    ["落到主和弦原位", passing.replace("E3/4", "C3/4").replace("I6/4", "I/4")],
    ["同声部跳到高八度的五音", passing.replace("F4/4 G4/4", "F4/4 G5/4")],
    ["结构低音换八度", passing.replace("D3/4 E3/4", "D3/4 E2/4")],
    ["落点重复主和弦三音", passing.replace("B3/4 C4/4", "B3/4 E4/4")
      .replace("G3/4 G3/4 G3/4", "G3/4 G3/4 C4/4")],
    ["低音提前移动却标为经过音", anticipations.replace("note earlyE role=anticipation", "note earlyE role=passing")],
    ["低音提前移动后换和弦时未同音重奏", anticipations.replace("E3/8@earlyE", "Eb3/8@earlyE")],
    ["逆向进行中七音仍然上行", descending.replace("F4/4 E4/4", "F4/4 G4/4")
      .replace("B3/4 C4/4", "B3/4 E4/4")],
  ])("%s时仍在原七音声部报警", (_name, score) => {
    const { diagnostics, landing } = seventhWarnings(score);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      tick: landing,
      severity: "warning",
      voiceIds: ["soprano"],
    }));
  });

  it("逆向的主六和弦到原位主和弦仍接受七音下行", () => {
    expect(seventhWarnings(descending).diagnostics).toEqual([]);
  });
});
