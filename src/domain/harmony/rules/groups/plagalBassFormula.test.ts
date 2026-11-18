import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function plagalCadence(kind: "full" | "supplementary", sourceBass = "F3") {
  return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | F4/1 | E4/1 |
 A: | C4/1 | C4/1 |
 T: | A3/1 | G3/1 |
 B: | ${sourceBass}/1 | C3/1 |
 H: | S/1 | T/1 |
}
annotations {
 phrase p range=[1:1,3:1)
 cadence k phrase=p range=[1:1,3:1) kind=${kind} form=plagal
}`).project;
}

describe("变格终止低音公式", () => {
  it.each(["full", "supplementary"] as const)("%s/plagal 使用 4→1 低音", kind => {
    const diagnostics = checkHarmony(plagalCadence(kind)).diagnostics;
    expect(diagnostics.filter(item => item.ruleId === "cadence.bass-formula")).toHaveLength(0);
  });

  it.each(["full", "supplementary"] as const)("%s/plagal 仍拒绝错误的 6→1 低音", kind => {
    const diagnostics = checkHarmony(plagalCadence(kind, "A2")).diagnostics;
    expect(diagnostics.filter(item => item.ruleId === "cadence.bass-formula")).toHaveLength(1);
  });
});
