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

  it.each([
    { sourceBass: "C3", role: "pedal64", reports: false },
    { sourceBass: "C2", role: "pedal64", reports: true },
    { sourceBass: "C3", role: "passing64", reports: true },
  ])("补充变格使用 $role 时检查主音低音 $sourceBass", ({ sourceBass, role, reports }) => {
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | F4/1 | E4/1 |
 A: | C4/1 | C4/1 |
 T: | A3/1 | G3/1 |
 B: | ${sourceBass}/1 | C3/1 |
}
annotations {
 chord s range=[1:1,2:1) symbol=IV64 role=${role}
 chord t range=[2:1,3:1) symbol=I
 phrase p range=[1:1,3:1)
 cadence k phrase=p range=[1:1,3:1) kind=supplementary form=plagal
}`).project;
    expect(checkHarmony(project).diagnostics.some(d => d.ruleId === "cadence.bass-formula")).toBe(reports);
  });

  it.each([
    { qualifier: "", bass: "F3", reports: false },
    { qualifier: "form=authentic", bass: "F3", reports: true },
    { qualifier: "", bass: "A3", reports: true },
  ])("半终止 $qualifier 核对下属低音 $bass", ({ qualifier, bass, reports }) => {
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | E4/1 | F4/1 |
 A: | C4/1 | C4/1 |
 T: | G3/1 | A3/1 |
 B: | C3/1 | ${bass}/1 |
 H: | I/1 | IV/1 |
}
annotations {
 phrase p range=[1:1,3:1)
 cadence k phrase=p range=[1:1,3:1) kind=half ${qualifier}
}`).project;
    expect(checkHarmony(project).diagnostics.some(d => d.ruleId === "cadence.bass-formula")).toBe(reports);
  });

  it.each([
    { completion: "imperfect", bass: "B2", reports: false },
    { completion: "imperfect", bass: "D3", reports: true },
    { completion: "perfect", bass: "B2", reports: true },
  ])("$completion 正格终止区分属六的正确低音与根音要求", ({ completion, bass, reports }) => {
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | D5/1 | C5/1 |
 A: | G4/1 | G4/1 |
 T: | G3/1 | E3/1 |
 B: | ${bass}/1 | C3/1 |
 H: | V6/1 | I/1 |
}
annotations {
 phrase p range=[1:1,3:1)
 cadence k phrase=p range=[1:1,3:1) kind=full form=authentic completion=${completion}
}`).project;
    expect(checkHarmony(project).diagnostics.some(d => d.ruleId === "cadence.bass-formula")).toBe(reports);
  });
});
