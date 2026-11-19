import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function check(soprano: string, tonicStart: string) {
  const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${soprano} |
 A: | G4/1 |
 T: | E4/1 |
 B: | C3/1 |
}
annotations {
 chord tonic range=[${tonicStart},2:1) symbol=I
 note neighbor role=neighbor
}`);
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === "nonchord.neighbor-tone");
}

describe("持续到和弦内的辅助音准备", () => {
  const returns = "C5/2 B4/8@neighbor C5/4.";

  it("以前音离开时实际发声的和弦确认其结构音身份", () => {
    expect(check(returns, "1:2")).toEqual([]);
  });

  it.each([
    [returns, "1:3"],
    ["C5/4 r/4 B4/8@neighbor C5/4.", "1:2"],
    ["C5/2 B4/8@neighbor G4/4.", "1:2"],
  ])("前音无和声支撑、被休止隔开或没有返回时仍报警", (notes, tonicStart) => {
    expect(check(notes, tonicStart)).toContainEqual(expect.objectContaining({
      tick: 1920, severity: "warning", voiceIds: ["soprano"],
    }));
  });
});
