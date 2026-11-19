import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";

function secondBeatDiagnostics(soprano: string, alto: string, tenor: string, bass: string) {
  const { project } = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
}`);
  return checkHarmony(project).diagnostics.filter(item => item.tick === project.ppq);
}

describe("声部进行豁免的作用范围", () => {
  const overlap = "voice-leading.overlap";
  const unequalFifths = "voice-leading.unequal-fifths-inner-diminished-to-perfect";

  it.each([
    ["同一拍的另一对声部", "E5/4 C5/2", "C5/4 E5/2"],
    ["下一拍的交换", "E5/2 C5/4", "C5/2 E5/4"],
  ])("%s 的交换不会豁免男低音超越男高音", (_label, soprano, alto) => {
    const diagnostics = secondBeatDiagnostics(soprano, alto, "G3/2.", "G3/4 A3/2");
    expect(diagnostics).toContainEqual(expect.objectContaining({
      ruleId: overlap, voiceIds: ["bass", "tenor"],
    }));
  });

  it.each([
    ["两声部持续", "G3/2.", "A3/2."],
    ["低声部继续上行", "G3/2.", "A3/4 Bb3/2"],
    ["恢复正常音域", "G3/4 A3/2", "Bb3/4 D3/2"],
  ])("已有交叉后%s 时不重复报告超越", (_label, tenor, bass) => {
    const diagnostics = secondBeatDiagnostics("G5/4 A5/2", "D4/2.", tenor, bass);
    expect(diagnostics.some(item => item.ruleId === overlap && item.voiceIds.includes("bass"))).toBe(false);
  });

  it("发生超越的声部对实际交换时给予豁免", () => {
    const diagnostics = secondBeatDiagnostics("G4/4 E4/2", "E4/4 G5/2", "C4/2.", "C3/2.");
    expect(diagnostics.some(item => item.ruleId === overlap && item.voiceIds.includes("soprano"))).toBe(false);
  });

  it.each([
    ["F3/4 E3/4 F3/4", true],
    ["E3/4 F3/4 E3/4", false],
  ])("内声部减五度到纯五度按连接当拍的低音 %s 判断", (bass, warns) => {
    const diagnostics = secondBeatDiagnostics("C5/2.", "F4/4 G4/2", "B3/4 C4/2", bass);
    expect(diagnostics.some(item => item.ruleId === unequalFifths)).toBe(warns);
  });
});
