import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

interface Example {
  bass?: string;
  alto?: string;
  tenor?: string;
  harmony?: string;
  solo?: boolean;
  key?: string;
  boundary?: number;
  bassDeclaredAsTenor?: boolean;
}

function warnings({
  bass = "Eb3/4 E3/2 F#3/4", alto = "Eb4/4 E4/2 A4/4",
  tenor = "G3/4 G3/2 A3/4", harmony = "", solo = false,
  key = "G minor", boundary, bassDeclaredAsTenor,
}: Example = {}) {
  const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
  S: ${solo ? "empty" : "| C5/4 C5/2 D5/4 |"}
  A: ${solo ? "empty" : "| " + alto + " |"}
  T: ${solo || tenor === "empty" ? "empty" : "| " + tenor + " |"}
  B: | ${bass} |
  ${harmony ? "H: | " + harmony + " |" : ""}
}`);
  if (boundary !== undefined) project.structure.phraseBoundaries.push({
    id: "manual-cut", tick: boundary * project.ppq, source: "manual", confidence: "certain",
  });
  if (bassDeclaredAsTenor) {
    const bassTrack = project.satbTracks.find(track => track.voice === "bass")!;
    bassTrack.voice = "tenor";
  }
  return checkHarmony(project).diagnostics.filter(item =>
    item.ruleId === "melody.augmented-interval" &&
    item.voiceIds.includes("bass") && item.tick === project.ppq);
}

describe("小调低音变化半音接属六和弦", () => {
  it.each([
    ["四声部实音", {}],
    ["四声部与正确标签", { harmony: "iv6/4 IV6/2 V6/4" }],
    ["单低音", { solo: true }],
  ] satisfies [string, Example][])("%s 支持变化半音", (_label, example) => {
    expect(warnings(example)).toHaveLength(0);
  });

  it.each([
    ["出发处实际最低音是男高", { tenor: "G2/4 G3/2 A3/4", harmony: "iv6/4 IV6/2 V6/4" }],
    ["中间和弦内部有较低的男高", { tenor: "G3/4 G3/4 G2/4 A3/4" }],
    ["到达处实际最低音是男高", { tenor: "G3/4 G3/2 A2/4" }],
    ["中间标签与大下属六和弦冲突", { harmony: "iv6/4 i6/2 V6/4" }],
    ["到达属和弦的标签转位错误", { harmony: "iv6/4 IV6/2 V/4" }],
    ["标签在音高正确时仍明确与小下属六和弦冲突", { harmony: "VI/4 IV6/2 V6/4" }],
    ["伴随音破坏大下属和弦", { alto: "Eb4/4 Eb4/2 A4/4" }],
    ["四声部缺少男高", { tenor: "empty" }],
    ["轨道 ID 为 bass 但 voice 并非低音", { solo: true, bassDeclaredAsTenor: true }],
    ["没有后继", { bass: "Eb3/4 E3/2 r/4", solo: true }],
    ["隔休止后才到导音", { bass: "Eb3/4 E3/4 r/4 F#3/4", solo: true }],
    ["后继错八度", { bass: "Eb3/4 E3/2 F#4/4", solo: true }],
    ["音阶缺少本调关系", { key: "D minor", solo: true }],
    ["源音内部有句界", { solo: true, boundary: 0.5 }],
    ["到达导音处有句界", { solo: true, boundary: 3 }],
  ] satisfies [string, Example][])("%s 时低音半音不报 B.3", (_label, example) => {
    expect(warnings(example)).toHaveLength(0);
  });

  it("直接上行增二度仍报 B.3", () => {
    expect(warnings({ bass: "Eb3/4 F#3/2 r/4", solo: true })).toEqual([
      expect.objectContaining({ severity: "warning", voiceIds: ["bass"], params: expect.objectContaining({ intervalNumber: 2 }) }),
    ]);
  });
});
