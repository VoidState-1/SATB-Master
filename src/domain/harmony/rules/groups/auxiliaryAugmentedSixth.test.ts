import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { augmentedSixthResolutionRule } from "./connection";

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
  continuing?: boolean;
  boundaryBeat?: number;
}

function exampleProject({
  soprano = "B4/2.",
  alto = "D4/4 C#4/4 D4/4",
  tenor = "F#3/4 E#3/4 F#3/4",
  bass = "B2/4 G2/4 B2/4",
  harmony = "i/4 Fr+6/4 i/4",
  continuing = false,
  boundaryBeat,
}: Example = {}) {
  const { project } = compileScoreText(`satb 1
key B minor
meter 3/4
bars 1..${continuing ? 2 : 1} {
 S: | ${soprano} | ${continuing ? "B4/2. |" : ""}
 A: | ${alto} | ${continuing ? "G4/2. |" : ""}
 T: | ${tenor} | ${continuing ? "E4/2. |" : ""}
 B: | ${bass} | ${continuing ? "E3/2. |" : ""}
 H: | ${harmony} | ${continuing ? "iv/2. |" : ""}
}`);
  if (boundaryBeat !== undefined) {
    project.structure.phraseBoundaries.push({
      id: "test-boundary", tick: boundaryBeat * project.ppq, source: "manual", confidence: "certain",
    });
  }
  return project;
}

function resolutionErrors(project: ReturnType<typeof exampleProject>) {
  return checkHarmony(project).diagnostics.filter(diagnostic =>
    diagnostic.ruleId === "resolution.augmented-sixth" && diagnostic.severity === "error",
  );
}

describe("第30章句末辅助法增六", () => {
  it("法增六后回到原位小主和弦，内声部回原音、低音回原八度", () => {
    expect(resolutionErrors(exampleProject())).toEqual([]);
  });

  it("6/8 单个经过低音之后仍可辨认前一主和弦和完整回归", () => {
    const { project } = compileScoreText(`satb 1
key F# minor
meter 6/8
bars 1..1 {
 S: | F#5/2. |
 A: | A4/4 G#4/8 A4/4. |
 T: | C#4/4 B#3/8 C#4/4. |
 B: | F#2/8 E2/8 D2/8 F#2/4. |
 H: | i/8 r/8 Fr+6/8 i/4. |
}`);
    expect(resolutionErrors(project)).toEqual([]);
  });

  it("中途位置只有存在明确的句末边界才作为补充终止", () => {
    expect(resolutionErrors(exampleProject({ continuing: true, boundaryBeat: 3 }))).toEqual([]);
    expect(resolutionErrors(exampleProject({ continuing: true }))).toHaveLength(1);
  });

  it.each([false, true])("没有 endBoundary 时，继续发声=%s", continuing => {
    const project = exampleProject({ continuing, boundaryBeat: 3 });
    const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    const result = augmentedSixthResolutionRule({
      ...context,
      phraseAt(tick) {
        const phrase = context.phraseAt(tick);
        return phrase && { ...phrase, endBoundary: undefined };
      },
    });
    expect(result).toHaveLength(continuing ? 1 : 0);
  });

  it.each<[string, Example]>([
    ["前一拍的主三和弦没有真实发全", { alto: "C#4/4 C#4/4 D4/4" }],
    ["没有主和弦锚点，只有相同音响", { harmony: "r/4 Fr+6/4 i/4" }],
    ["低音错八度返回", { bass: "B2/4 G2/4 B1/4" }],
    ["高端返回的是属音的另一八度", { tenor: "F#3/4 E#3/4 F#2/4", bass: "B1/4 G1/4 B1/4" }],
    ["高端的属音由别的声部接手", { alto: "D4/4 C#4/4 F#4/4", tenor: "F#3/4 E#3/4 D4/4" }],
    ["没有同声部保持共同主音", { soprano: "B4/2 D5/4", alto: "D4/4 C#4/4 B3/4" }],
    ["落点标为主和弦第一转位", { harmony: "i/4 Fr+6/4 i6/4" }],
    ["法增六的二级被同响音改写", { alto: "D4/4 Db4/4 D4/4" }],
    ["法增六另一个声部缺少应有构成音", { alto: "D4/4 D4/4 D4/4" }],
    ["增六变体是德增六", { harmony: "i/4 Ger+6/4 i/4", alto: "D4/2." }],
    ["增六到主和弦之间另有分句", { boundaryBeat: 2 }],
  ])("%s 时保留解决错误", (_label, example) => {
    const project = exampleProject(example);
    expect(resolutionErrors(project)).toEqual([expect.objectContaining({
      tick: 2 * project.ppq,
      params: expect.objectContaining({ target: "other" }),
    })]);
  });

  it.each([
    ["V", "B4/2 A#4/4", "D4/4 C#4/2", "C#3"],
    ["K46", "B4/2.", "D4/4 C#4/4 D4/4", "B3"],
  ])("常规趋向 %s 时仍要求原高端按半音解决", (target, soprano, alto, wrongArrival) => {
    const example = {
      soprano, alto, tenor: "F#3/4 E#3/4 F#3/4", bass: "B2/4 G2/4 F#2/4",
      harmony: `i/4 Fr+6/4 ${target}/4`,
    };
    expect(resolutionErrors(exampleProject(example))).toEqual([]);
    const broken = exampleProject({ ...example, tenor: `F#3/4 E#3/4 ${wrongArrival}/4` });
    expect(resolutionErrors(broken)).toEqual([expect.objectContaining({
      tick: 2 * broken.ppq,
      message: expect.stringContaining("增六高端未上行半音到属音"),
      params: expect.objectContaining({ target: target === "V" ? "D" : target, lowDelta: -1 }),
    })]);
    const octaveDisplaced = exampleProject({ ...example, bass: "B2/4 G2/4 F#1/4" });
    expect(resolutionErrors(octaveDisplaced)).toEqual([expect.objectContaining({
      tick: 2 * octaveDisplaced.ppq,
      message: expect.stringContaining("增六低端未下行半音到属音"),
      params: expect.objectContaining({ lowDelta: -13, highDelta: 1 }),
    })]);
  });
});
