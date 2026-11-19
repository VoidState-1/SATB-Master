import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const major = `satb 1
key C major
meter 3/4
bars 1..2 {
 S: | A4/2 G4/4 | C5/2. |
 A: | F4/2 F4/4 | E4/2. |
 T: | C4/2 B3/4 | C4/2. |
 B: | F2/2 G3/4 | C3/2. |
 H: | IV/2 V7/4 | I/2. |
}`;

const minor = `satb 1
key A minor
meter 3/4
bars 1..2 {
 S: | F5/2 E5/4 | A4/2. |
 A: | A4/2 G#4/4 | A4/2. |
 T: | D4/2 D4/4 | C4/2. |
 B: | D3/2 E3/4 | A3/2. |
 H: | iv/2 V7/4 | i/2. |
}`;

function outerOctaves(project: ReturnType<typeof compileScoreText>["project"], tick = 2880) {
  return checkHarmony(project).diagnostics.filter(diagnostic =>
    diagnostic.ruleId === "voice-leading.parallel-octaves" && diagnostic.tick === tick &&
    diagnostic.voiceIds.includes("soprano") && diagnostic.voiceIds.includes("bass"),
  ).map(diagnostic => diagnostic.severity);
}

const ornamentedEnding = minor.replace("A4/2. |\n A:", "A4/2 r/4 |\n A:")
  .replace("A4/2. |\n T:", "A4/8 G#4/8 E4/4 r/4 |\n T:")
  .replace("C4/2.", "C4/8 B3/8 C4/4 r/4")
  .replace("A3/2.", "A3/4 A2/4 r/4").replace("i/2.", "i/8 r/8 i/4 r/4");

describe("结束终止中的外声部反行八度", () => {
  it.each([
    ["大调扩张，保持准备音", major],
    ["小调收缩，保持准备音", minor],
    ["七音由连续下行级进进入", major.replace("F4/2 F4/4", "G4/2 F4/4")],
    ["实际静止至项目结束", major.replace("C5/2.", "C5/4 r/2")
      .replace("E4/2.", "E4/4 r/2").replace("C4/2.", "C4/4 r/2")
      .replace("C3/2.", "C3/4 r/2").replace("I/2.", "I/4 r/2")],
    ["持续主音上有短暂内声部装饰，末拍恢复主和弦", ornamentedEnding],
  ])("%s", (_label, text) => {
    expect(outerOctaves(compileScoreText(text).project)).toEqual([]);
  });

  it.each([
    ["普通八度复进，缺少实际功能依据", major.replace(" H: | IV/2 V7/4 | I/2. |\n", "")],
    ["主体继续，属主处不是全曲收束", major + `
bars 3..3 {
 S: | D5/2. |
 A: | B4/2. |
 T: | G4/2. |
 B: | G2/2. |
 H: | V/2. |
}`],
    ["没有前一实奏配音准备", major.replace("A4/2", "r/2")],
    ["男高实际低于属低音", major.replace("C4/2 B3/4 | C4/2.", "C3/2 B2/4 | C3/2.")],
    ["女低实际高于女高", major.replace("F4/2 F4/4 | E4/2.", "F5/2 F5/4 | E5/2.")],
    ["七音由四度跳入", major.replace("F4/2 F4/4", "C4/2 F4/4")],
    ["七音不在原声部解决", major.replace("E4/2.", "C4/2.").replace("C4/2. |\n B:", "E4/2. |\n B:")],
    ["导音等音改写", major.replace("C4/2. |\n B:", "B#3/2. |\n B:")],
    ["属五音取代导音", major.replace("C4/2 B3/4", "C4/2 D4/4")],
    ["外声部同向，即使实奏不完全属七到主和弦", major.replace("C3/2.", "C4/2.")],
    ["和弦标签与实响冲突", major.replace("I/2.", "vi/2.")],
    ["内声部装饰时低音同时换八度", ornamentedEnding.replace("A3/4 A2/4", "A3/8 A2/8 A2/4")],
  ])("%s 仍报", (_label, text) => {
    expect(outerOctaves(compileScoreText(text).project)).toEqual(["error"]);
  });

  it("跨过明确句界仍报", () => {
    const { project } = compileScoreText(major);
    project.structure.phraseBoundaries.push({ id: "manual-cut", tick: 2880, source: "manual", confidence: "certain" });
    expect(outerOctaves(project)).toEqual(["error"]);
  });

  it("斯波索宾例 10-120 第一组的原位属三到主仍报", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | G5/2 C5/2 |
 A: | B4/2 G4/2 |
 T: | D4/2 E4/2 |
 B: | G3/2 C4/2 |
 H: | V/2 I/2 |
}`);
    expect(outerOctaves(project, 1920)).toEqual(["error"]);
  });
});
