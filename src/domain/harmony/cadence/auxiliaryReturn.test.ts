import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";

const closedReturn = `satb 1
key D major
meter 4/4
bars 1..1 {
  S: | D5/1 |
  A: | F#4/2 G4/4 F#4/4 |
  T: | A3/2 B3/4 A3/4 |
  B: | D3/1 |
  H: | I/2 IV64/4@auxiliary I/4 |
}
annotations {
  chord auxiliary role=pedal64
}`;

function cadences(text: string) {
  return buildHarmonyAnalysis(compileScoreText(text).project).cadenceCandidates;
}

describe("句末下属四六辅助回返", () => {
  it.each([
    ["女高持续", closedReturn],
    ["女低持续", closedReturn.replace("S: | D5/1", "S: | F#5/2 G5/4 F#5/4")
      .replace("A: | F#4/2 G4/4 F#4/4", "A: | D4/1")],
    ["和弦标注没有预填辅助用途", closedReturn.replace("@auxiliary", "")
      .replace(/\nannotations \{[\s\S]+$/, "")],
  ])("%s，实写短辅助闭环无需另发终止", (_label, text) => {
    expect(cadences(text)).toEqual([]);
  });

  it.each([
    ["同音低音重奏", closedReturn.replace("B: | D3/1", "B: | D3/2. D3/4")],
    ["低音回主时换八度", closedReturn.replace("B: | D3/1", "B: | D3/2. D2/4")],
    ["实音缺失", closedReturn.replace("B: | D3/1", "B: | D3/2 r/4 D3/4")],
    ["上声部回主时另起", closedReturn.replace("S: | D5/1", "S: | D5/2. D5/4")],
    ["回主后低音另作节奏收束", closedReturn.replace("B: | D3/1", "B: | D3/2.. D3/8")],
    ["内声跨八度回到相同音级", closedReturn.replace("G4/4 F#4/4", "G4/4 F#5/4")],
    ["辅助标签不符实际声部", closedReturn.replace("A3/2 B3/4", "A3/2 C4/4")],
    ["中间四六较强", closedReturn
      .replace("D5/1", "r/4 D5/2.").replace("D3/1", "r/4 D3/2.")
      .replace("F#4/2 G4/4 F#4/4", "r/4 F#4/4 G4/4 F#4/4")
      .replace("A3/2 B3/4 A3/4", "r/4 A3/4 B3/4 A3/4")
      .replace("I/2 IV64/4@auxiliary I/4", "r/4 I/4 IV64/4@auxiliary I/4")],
  ])("%s，不能用辅助闭环排除候选", (_label, text) => {
    expect(cadences(text)).toMatchObject([{ kind: "supplementary", form: "plagal" }]);
  });

  it("实写根位下属与低音归主保留独立变格", () => {
    const text = closedReturn.replace("S: | D5/1", "S: | D5/2. A4/4")
      .replace("B: | D3/1", "B: | D3/2 G2/4 D3/4").replace("IV64", "IV");
    expect(cadences(text)).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect" }]);
  });

  it("保留真正正格落主和随后持音补充变格", () => {
    const text = closedReturn.replace("1..1", "1..2")
      .replace("S: | D5", "S: | E5/1 | D5")
      .replace("A: | F#4", "A: | C#5/1 | F#4")
      .replace("T: | A3", "T: | A3/1 | A3")
      .replace("B: | D3", "B: | A2/1 | D3")
      .replace("H: | I", "H: | V/1 | I");
    expect(cadences(text)).toMatchObject([
      { kind: "full", form: "authentic", completion: "perfect", fromTick: 0, toTick: 5760 },
      { kind: "supplementary", form: "plagal", fromTick: 5760, toTick: 7680 },
    ]);
  });

  it("正格后实际休止和明确句界仍保留补充", () => {
    const text = closedReturn.replace("1..1", "1..2")
      .replace("S: | D5", "S: | E5/2 D5/4 r/4 | D5")
      .replace("A: | F#4", "A: | C#5/2 F#4/4 r/4 | F#4")
      .replace("T: | A3", "T: | A3/2 A3/4 r/4 | A3")
      .replace("B: | D3", "B: | A2/2 D3/4 r/4 | D3")
      .replace("H: | I", "H: | V/2 I/4 r/4 | I")
      .replace("chord auxiliary", "phrase first range=[1:1,1:4)\n  chord auxiliary");
    expect(cadences(text)).toMatchObject([
      { kind: "full", form: "authentic", completion: "perfect", fromTick: 0, toTick: 2880 },
      { kind: "supplementary", form: "plagal", fromTick: 5760, toTick: 7680 },
    ]);
  });
});
