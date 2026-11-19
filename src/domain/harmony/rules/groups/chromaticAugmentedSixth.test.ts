import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { recognizesAugmentedSixthPreparation } from "./chromaticAugmentedSixth";

interface Example {
  key?: string;
  keyEvents?: string;
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  before?: string;
  middle?: string;
  landing?: string;
  landingStart?: string;
  annotations?: string;
  boundary?: number;
}

function exampleProject({
  key = "D minor", keyEvents = "",
  soprano = "E5/4 D5/4 C#5/2",
  alto = "G4/4 G#4/4 A4/2",
  tenor = "C4/4 D4/4 E4/2",
  bass = "C3/4 Bb2/4 A2/2",
  before = "", middle = "", landing = "V", landingStart = "1:3",
  annotations = "", boundary,
}: Example = {}) {
  const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
${keyEvents}
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
}
annotations {
 ${before ? "chord before range=[1:1,1:2) symbol=" + before : ""}
 ${middle ? "chord middle range=[1:2,1:3) symbol=" + middle : ""}
 ${landing ? "chord landing range=[" + landingStart + ",2:1) symbol=" + landing : ""}
 ${annotations}
}`);
  if (boundary !== undefined) {
    project.structure.phraseBoundaries.push({
      id: "boundary", tick: project.ppq * boundary, source: "manual", confidence: "certain",
    });
  }
  return project;
}

function matches(example: Example = {}) {
  const project = exampleProject(example);
  const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  return context.melodyTransitions()
    .where(transition => recognizesAugmentedSixthPreparation(context, transition))
    .select(transition => [transition.voiceId, transition.current.startTick / project.ppq])
    .toArray();
}

describe("从实音识别无标注的意大利增六", () => {
  it.each([
    ["两端均在原声部半音解决", "A4", false],
    ["低端正确而高端改落属和弦五音", "E4", true],
  ] as const)("checkHarmony 在%s时核对女低增一度", (_label, upperArrival, shouldWarn) => {
    const project = exampleProject({ before: "V7/V confidence=probable", alto: `G4/4 G#4/4 ${upperArrival}/2` });
    const warnings = checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "melody.augmented-interval" &&
      item.tick === project.ppq &&
      item.voiceIds.includes("alto"),
    );
    expect(warnings).toEqual(shouldWarn ? [
      expect.objectContaining({
        severity: "warning",
        endTick: 2 * project.ppq,
        voiceIds: ["alto"],
        params: { intervalNumber: 1, quality: "增", semitones: 1 },
      }),
    ] : []);
  });

  it.each(["", "VII", "V7/V", "V7/V confidence=probable"])(
    "同一原谱准备音与解决在前一拍标注为 %j 时结果相同",
    before => {
      expect(matches({ before })).toEqual([["alto", 1]]);
    },
  );

  it("允许按已标且完整实奏的 K46 解决", () => {
    expect(matches({ soprano: "E5/4 D5/4 D5/2", tenor: "C4/4 D4/4 F4/2", landing: "K46" }))
      .toEqual([["alto", 1]]);
  });

  it("大调实奏下属六和弦可同时引入增六的两端", () => {
    expect(matches({
      key: "D major", soprano: "D5/4 D5/4 C#5/2", alto: "G4/4 G#4/4 A4/2",
      tenor: "G3/4 D4/4 E4/2", bass: "B2/4 Bb2/4 A2/2",
    })).toEqual([["alto", 1], ["bass", 1]]);
  });

  it("不受低音同音重奏的额外切片影响", () => {
    expect(matches({ bass: "C3/4 Bb2/8 Bb2/8 A2/2" })).toEqual([["alto", 1]]);
  });

  it.each<[string, Example]>([
    ["当前记为别的和弦", { middle: "VI" }],
    ["当前已有明确增六标注", { middle: "It+6" }],
    ["后继无和弦标注", { landing: "" }],
    ["后继标成另一和弦", { landing: "i" }],
    ["后继同根但为副属", { landing: 'V/V localKey="G major"' }],
    ["后继同根但明确属于同主音大调", { landing: 'V localKey="D major"' }],
    ["后继写成小属和弦", { landing: "v" }],
    ["普通主四六缺少终止依据", { soprano: "E5/4 D5/4 D5/2", tenor: "C4/4 D4/4 F4/2", landing: "i64" }],
    ["标 K46 但实音是属和弦", { landing: "K46" }],
    ["后继说是 V 但缺三音", { soprano: "E5/4 D5/4 A5/2" }],
    ["后继出现和弦外音", { tenor: "C4/4 D4/4 F4/2" }],
    ["落点等音异名", { alto: "G4/4 G#4/4 Bbb4/2" }],
    ["低端跨八度向上", { bass: "C3/4 Bb2/4 A3/2" }],
    ["高端跨八度向下", { alto: "G4/4 G#4/4 A3/2" }],
    ["高端的正确目的音只在其他声部", { alto: "G4/4 G#4/4 E4/2", tenor: "C4/4 D4/4 A3/2" }],
    ["半音低端出现在其他声部", { bass: "C3/4 D3/4 A2/2", tenor: "C4/4 Bb3/4 E4/2" }],
    ["拍内暂缺一声部", { tenor: "C4/4 D4/8 r/8 E4/2" }],
    ["增六低端等音异名", { bass: "C3/4 A#2/4 A2/2" }],
    ["声部被标为经过音", { annotations: "note A@1:2 role=passing" }],
    ["高端重奏后才到达属音", { alto: "G4/4 G#4/4 G#4/4 A4/4", landingStart: "1:4" }],
    ["准备音前休止", { alto: "G4/8 r/8 G#4/4 A4/2" }],
    ["着陆前休止", { alto: "G4/4 G#4/8 r/8 A4/2" }],
    ["前一拍实音不是同调三和弦", { soprano: "Eb5/4 D5/4 C#5/2", before: "VII" }],
    ["前一拍标明别的局部调", { before: 'VII localKey="F minor"' }],
    ["落点换了总调", { keyEvents: "at 1:3 key A major" }],
    ["进入增六处分句", { boundary: 1 }],
    ["到达属和弦处分句", { boundary: 2 }],
    ["法增六留待独立验证", { tenor: "C4/4 E4/4 E4/2" }],
    ["德增六留待独立验证", { tenor: "C4/4 F4/4 E4/2" }],
  ])("%s 时保留诊断", (_label, example) => {
    expect(matches(example)).toEqual([]);
  });
});
