import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";
import { buildHarmonyAnalysis } from "../../analysis";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { diminishedIntervalRule, tritoneRule } from "./melody";

const score = `satb 1
key D major
meter 3/4
bars 1..1 {
 S: | G4/4 A4/4 F#4/4 |
 A: | D4/4 E4/4 D4/4 |
 T: | B3/4 A3/4 A3/4 |
 B: | G3/4 C#3/4 D3/4 |
 H: | IV/4 V6/4 I/4 |
}`;
function checks(text: string, boundary?: number) {
  const project = compileScoreText(text).project;
  if (boundary !== undefined) project.structure.phraseBoundaries.push({
    id: "manual", tick: boundary, source: "manual", confidence: "certain",
  });
  const c = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  return [...tritoneRule(c), ...diminishedIntervalRule(c)].filter(d =>
    d.tick === 960 && d.voiceIds.includes("bass")).map(d => d.ruleId);
}
const both = ["melody.tritone", "melody.diminished-interval"];

describe("低音下跳减五度进入属六并在原声部解决", () => {
  it.each([
    ["manual", "IV/4 V6/4 I/4", "D3/4 Eb3/4", false],
    ["confirmed", "IV/4 V6/4 I/4", "D3/4 Eb3/4", false],
    ["inferred", "IV/4 V6/4 I/4", "D3/4 Eb3/4", true],
    ["manual", "IV/4 r/4 I/4", "D3/4 Eb3/4", true],
    ["manual", "IV/4 V6/4 I/4", "D4/4 Eb4/4", true],
  ] as const)("单线低音核验三处和声标注及解决方向 %s %s %s", (source, harmony, line, reported) => {
    const { project } = compileScoreText(`satb 1
key Eb major
meter 3/4
bars 1..1 {
 S: empty
 A: empty
 T: empty
 B: | Ab3/4 ${line} |
 H: | ${harmony} |
}`);
    for (const chord of project.chordTrack.regions) {
      for (const reading of chord.semantics!.interpretations) reading.source = source;
    }
    const result = checkHarmony(project).diagnostics.some(d =>
      d.ruleId === "melody.tritone" && d.tick === project.ppq && d.voiceIds.includes("bass"));
    expect(result).toBe(reported);
  });
  it("按实写 S–D6–T 放行，给定或缺标签均须有四部支持", () => {
    expect(checks(score)).toEqual([]);
    expect(checks(score.replace(/ H:.*\n/, ""))).toEqual([]);
  });
  it("接受第一转位的二级小三和弦作下属", () => {
    expect(checks(score.replace("G4/4", "E4/4").replace("D4/4 E4", "B3/4 E4")
      .replace("B3/4 A3", "G3/4 A3").replace("IV/4", "ii6/4"))).toEqual([]);
  });
  it.each([
    ["同音重奏", score.replace("C#3/4 D3/4", "C#3/4 C#3/4")],
    ["错误音区", score.replace("C#3/4 D3/4", "C#3/4 D4/4")],
    ["导音后休止", score.replace("C#3/4", "C#3/8 r/8")],
    ["属六含外音", score.replace("D4/4 E4/4", "D4/4 F4/4")],
    ["低音保持时中途变和声", score.replace("D4/4 E4/4", "D4/4 E4/8 F4/8")],
    ["标签与实音冲突", score.replace("V6/4", "V65/4")],
    ["落点并非主三", score.replace("A4/4 F#4/4", "A4/4 G4/4")],
  ])("%s 时保留两个底层音程报告", (_, text) => expect(checks(text)).toEqual(both));
  it("进入或解决时跨句均保留警告", () => {
    expect(checks(score, 960)).toEqual(both);
    expect(checks(score, 1920)).toEqual(both);
  });
  it("低音反向改成上跳增四并继续上行，仍有 B.5", () => {
    expect(checks(score.replace("C#3/4 D3/4", "C#4/4 D4/4"))).toContain("melody.tritone");
  });
});
