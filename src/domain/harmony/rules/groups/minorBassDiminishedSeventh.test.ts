import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

interface Example {
  bass?: string;
  soprano?: string;
  tenor?: string;
  harmony?: string;
  solo?: boolean;
  key?: string;
  boundary?: number;
}

function warnings({
  bass = "C4/4 D#3/4 E3/2", soprano = "E5/4 F#5/4 E5/2",
  tenor = "A4/4 B3/4 B3/2", harmony = "", solo = false,
  key = "E minor", boundary,
}: Example = {}) {
  const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
  S: ${solo ? "empty" : "| " + soprano + " |"}
  A: ${solo ? "empty" : "| C5/4 D#5/4 G4/2 |"}
  T: ${solo ? "empty" : "| " + tenor + " |"}
  B: | ${bass} |
  ${harmony ? "H: | " + harmony + " |" : ""}
}`);
  if (boundary !== undefined) project.structure.phraseBoundaries.push({
    id: "manual-cut", tick: boundary * project.ppq, source: "manual", confidence: "certain",
  });
  return checkHarmony(project).diagnostics.filter(item =>
    item.ruleId === "melody.diminished-interval" &&
    item.voiceIds.includes("bass") && item.tick === project.ppq);
}

describe("小调低音下行减七度的解决", () => {
  it.each([
    ["四声部实音", {}],
    ["四声部与正确标签", { harmony: "iv6/4 V6/4 i/2" }],
    ["单低音", { solo: true }],
  ] satisfies [string, Example][])("%s 支持反向半音解决", (_label, example) => {
    expect(warnings(example)).toHaveLength(0);
  });

  it.each([
    ["借用音区导致低音上方成为实际低音", { tenor: "A3/4 B3/4 B3/2", harmony: "iv6/4 V6/4 i/2" }],
    ["主音到达处有更低的男高", { tenor: "A4/4 B3/4 B2/2" }],
    ["属和弦转位与实谱冲突", { harmony: "iv6/4 V/4 i/2" }],
    ["表面音型的出发和弦标为 VI", { harmony: "VI/4 V6/4 i/2" }],
    ["主音到达处的标签冲突", { harmony: "iv6/4 V6/4 iv/2" }],
    ["多声部未凑全下属三和弦", { soprano: "A5/4 F#5/4 E5/2" }],
    ["错八度", { bass: "C4/4 D#3/4 E4/2", solo: true }],
    ["没有后继", { bass: "C4/4 D#3/4 r/2", solo: true }],
    ["后继前有休止", { bass: "C4/4 D#3/4 r/4 E3/4", solo: true }],
    ["源音内部有句界", { solo: true, boundary: 0.5 }],
    ["到达主音处有句界", { solo: true, boundary: 2 }],
    ["音高并非当前小调的对应音级", { solo: true, key: "B minor" }],
  ] satisfies [string, Example][])("%s 时保留警告", (_label, example) => {
    expect(warnings(example)).toEqual([expect.objectContaining({ severity: "warning", voiceIds: ["bass"] })]);
  });
});
