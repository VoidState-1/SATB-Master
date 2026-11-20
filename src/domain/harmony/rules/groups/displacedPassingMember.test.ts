import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const exercise = `satb 1
key C major
meter 3/4
bars 1..1 {
  S: | C5/4. B4/8@p A4/4 |
  A: | F4/2 F4/4 |
  T: | A3/2 D4/4 |
  B: | F3/2 F3/4 |
  H: | IV/2 ii6/4 |
}
annotations {
  note p role=passing
}`;

function missing(text: string, cut?: number) {
  const { project } = compileScoreText(text);
  if (cut !== undefined) project.structure.phraseBoundaries.push({
    id: "cut", tick: cut, source: "manual", confidence: "certain",
  });
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === "chord.incomplete-members" && d.tick === 1440);
}

describe("经过音离开后三和弦的实写成员", () => {
  it("弱细分上的经过音取代原来唯一的五音", () => {
    expect(missing(exercise)).toHaveLength(0);
  });
  it("六和弦唯一的根音向上经过至三音", () => {
    const text = exercise.replace("C5/4. B4/8@p A4/4", "F4/4. G4/8@p A4/4")
      .replace("F4/2 F4/4", "C4/2 C4/4").replace("A3/2 D4/4", "A3/2 F3/4")
      .replace("F3/2 F3/4", "A2/2 F2/4").replace("IV/2 ii6/4", "IV6/2 IV/4");
    expect(missing(text)).toHaveLength(0);
  });
  it.each([
    ["出发处已经缺五音", "C5/4.", "A4/4."],
    ["中间为另一次起奏", "F4/2 F4/4", "F4/4. F4/8 F4/4"],
    ["下一音改在另一八度", "A4/4 |", "A5/4 |"],
    ["落点的身份与四声部冲突", "ii6/4", "V6/4"],
    ["手写标签与方向冲突", "role=passing", "role=neighbor"],
  ])("%s时保留实际缺音警告", (_label, old, replacement) => {
    expect(missing(exercise.replace(old, replacement))).toHaveLength(1);
  });
  it.each([1440, 1720, 1920])("句界 %i 隔开依据时保留警告", tick => {
    expect(missing(exercise, tick)).toHaveLength(1);
  });
});
