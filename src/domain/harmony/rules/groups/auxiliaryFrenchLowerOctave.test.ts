import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const germanPreparation = `satb 1
key C minor
meter 4/4
bars 1..2 {
 S: | B3/2 C4/2~ | C4/1 |
 A: | G3/2 G3/2 | F#3/2 G3/2 |
 T: | F3/2 F3/8 Eb3/4. | Eb3/4 D3/4 Eb3/2 |
 B: | G2/2 C3/2 | Ab2/2 C2/2 |
 H: | V7/2 r/8 i/4. | Ger+6/4 Fr+6/4 i/2 |
}`;

const passingBass = `satb 1
key C minor
meter 3/4
bars 1..2 {
 S: | B3/4 C4/2~ | C4/2. |
 A: | G3/4 G3/2 | F#3/4 G3/2 |
 T: | F3/4 Eb3/2 | D3/4 Eb3/2 |
 B: | G2/4 C3/4 Bb2/4 | Ab2/4 C2/2 |
 H: | V7/4 i/4 r/4 | Fr+6/4 i/2 |
}`;

function errorAtReturn(score: string) {
  const { project } = compileScoreText(score);
  const tick = project.lengthTicks - 2 * project.ppq;
  return checkHarmony(project).diagnostics.filter(d =>
    d.tick === tick && d.ruleId === "resolution.augmented-sixth" && d.severity === "error",
  );
}

describe("已收束主和弦的法增六辅助回归与低音八度下移", () => {
  it.each([germanPreparation, passingBass])("实奏内声半音回归，末主在下方八度复奏", score => {
    expect(errorAtReturn(score)).toEqual([]);
  });

  it.each([
    ["低音再低八度", germanPreparation.replace("C2/2", "C1/2")],
    ["原属七七音实奏有误", germanPreparation.replace("F3/2 F3/8", "F#3/2 F3/8")],
    ["德国到法国的共同音被改变", germanPreparation.replace("F#3/2 G3/2", "G3/4 F#3/4 G3/2")],
    ["保持的主音在辅助配置中重新起奏", passingBass.replace("C4/2~ | C4/2.", "C4/2 | C4/2.")],
    ["前置低音跳进", passingBass.replace("Bb2/4", "A2/4")],
  ])("%s时保留回归拍的解决错误", (_reason, score) => {
    expect(errorAtReturn(score)).toHaveLength(1);
  });
});
