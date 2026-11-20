import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const score = `satb 1
key A minor
meter 4/4
bars 1..1 {
  S: | B4/2 D5/4 C5/4 |
  A: | G#4/2 E4/2 |
  T: | E4/2 B3/4 A3/4 |
  B: | E3/4. F#3/8@passing G#3/4 A3/4 |
  H: | V/2 V65/4 i/4 |
}
annotations {
  note passing role=passing
}`;

const inversion = "chord.inversion-bass";
const doubling = "chord.triad-root-position-doubling";
function findings(text = score, boundary?: number) {
  const { project } = compileScoreText(text);
  if (boundary !== undefined) project.structure.phraseBoundaries.push({
    source: "manual", confidence: "certain", id: "cut", tick: boundary,
  });
  return checkHarmony(project).diagnostics.filter(d => d.tick === 1440).map(d => d.ruleId);
}

describe("旋律小调属和弦上行经过低音", () => {
  it("五至主的连续低音经过升六级，属和弦的结构低音仍是根音", () => {
    const ids = findings();
    expect(ids).not.toContain(inversion);
    expect(ids).not.toContain(doubling);
  });

  it("原位属三和弦经过同一写法到属六时也能核实", () => {
    const triad = score.replace("D5/4 C5/4", "E5/4 C5/4").replace("V65/4", "V6/4");
    expect(findings(triad)).not.toContain(inversion);
  });

  it("经过音占据次强拍时仍查转位", () => {
    const text = `satb 1
key A minor
meter 4/4
bars 1..2 {
  S: | B4/2. D5/4 | C5/1 |
  A: | G#4/2. E4/4 | E4/1 |
  T: | E4/2. B3/4 | A3/1 |
  B: | E3/2 F#3/4@passing G#3/4 | A3/1 |
  H: | V/2. V65/4 | i/1 |
}
annotations {
  note passing role=passing
}`;
    const { project } = compileScoreText(text);
    expect(checkHarmony(project).diagnostics.some(d => d.tick === 1920 && d.ruleId === inversion)).toBe(true);
  });

  it.each([
    ["导音移高八度", "G#3/4", "G#4/4"],
    ["在另一声部到达小调主音", "G#3/4 A3/4", "G#3/4 C4/4"],
    ["属七音反向", "D5/4 C5/4", "D5/4 E5/4"],
    ["不同的外音角色", "role=passing", "role=neighbor"],
    ["上方声部在经过音处重新起奏", "G#4/2", "G#4/4. G#4/8"],
    ["省掉结构五音", "B4/2", "E5/2"],
    ["回主之前有休止", "G#3/4 A3/4", "G#3/8 r/8 A3/4"],
    ["到点标成属原位", "V65/4", "V7/4"],
  ])("%s时保留转位错误", (_label, from, to) => {
    expect(findings(score.replace(from, to))).toContain(inversion);
  });

  it.each([1440, 1920, 2400, 2880])("句界 %i 隔开取证时保留原诊断", cut => {
    expect(findings(score, cut)).toContain(inversion);
  });
});
