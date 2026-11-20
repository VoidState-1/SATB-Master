import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { accentedOrnamentOverWrittenTriad, leadingNeighborFrame } from "./leadingToneNeighbor";

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
  successor?: string;
}

function heldDominant({
  soprano = "D5/8 C#5/8 D5/8",
  alto = "F4/4.",
  tenor = "B3/8 A#3/8 B3/8",
  bass = "G3/4.",
  harmony = "V7/8 r/8 V7/8",
  successor = "C4/4.",
}: Example = {}) {
  return compileScoreText(`satb 1
key C major
meter 3/8
bars 1..2 {
 S: | ${soprano} | C5/4. |
 A: | ${alto} | E4/4. |
 T: | ${tenor} | ${successor} |
 B: | ${bass} | C3/4. |
 H: | ${harmony} | I/4. |
}`).project;
}

function accented({
  soprano = "D#5/8 C#5/8 C#5/4",
  tenor = "C#4/2",
  bass = "A#3/2",
  harmony = "r/8 V6/V/4.",
}: Example = {}) {
  return compileScoreText(`satb 1
key E major
meter 2/4
bars 1..2 {
 S: | C#5/2 | ${soprano} |
 A: | E#4/2 | F#4/2 |
 T: | C#4/2 | ${tenor} |
 B: | B3/2 | ${bass} |
 H: | r/2 | ${harmony} |
}`).project;
}

type Project = ReturnType<typeof heldDominant>;
function warnings(project: Project, voiceId: "tenor" | "soprano") {
  return checkHarmony(project).diagnostics
    .filter(item => item.ruleId === "resolution.leading-tone" && item.voiceIds.includes(voiceId))
    .map(({ tick, noteIds }) => ({ tick, noteIds }));
}

function accentedEvidence(project: Project) {
  const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  const accent = rules.sliceAt(2 * project.ppq)!;
  const frame = leadingNeighborFrame(rules, "soprano", accent.notes.soprano!);
  return frame && accentedOrnamentOverWrittenTriad(rules, frame);
}

function addPhraseBoundary(project: Project, tick: number) {
  project.structure.phraseBoundaries.push({ id: "manual-boundary", tick, source: "manual", confidence: "certain" });
}

describe("E.1 书写导音与同一和声中的实际装饰", () => {
  it("同声部 B3–A#3–B3，且另一上声部也折返，在真正 C4 处才解决", () => {
    expect(warnings(heldDominant(), "tenor")).toEqual([]);
  });

  it("回到同一属七时允许局部调换序，改变实际落音仍须解决导音", () => {
    for (const succeeds of [true, false]) {
      const project = heldDominant({ successor: succeeds ? "C4/4." : "E4/4." });
      const [first, returning] = project.chordTrack.regions.map(region => region.semantics!.interpretations[0]);
      first.localKey = { tonic: { step: "C", alter: 0 }, mode: "major" };
      returning.localKey = { mode: "major", tonic: { alter: 0, step: "C" } };
      expect(warnings(project, "tenor").map(item => item.tick)).toEqual(succeeds ? [] : [1440]);
    }
  });

  it("返回后错到 E4 仍在真实和声后继发 warning", () => {
    expect(warnings(heldDominant({ successor: "E4/4." }), "tenor")).toEqual([
      { tick: 1440, noteIds: ["note-T-0", "note-T-1440"] },
    ]);
  });

  it("暂时触及主音 B3–C4–B3 也不能提前解除义务", () => {
    expect(warnings(heldDominant({ tenor: "B3/8 C4/8 B3/8", successor: "E4/4." }), "tenor")).toEqual([
      expect.objectContaining({ tick: 1440 }),
    ]);
  });

  it("伴奏实音不变而本调导音仅是 F 和弦上方辅助音时不建立义务", () => {
    const project = heldDominant({
      soprano: "A4/8 B4/8 A4/8", alto: "F4/4.", tenor: "C4/4.", bass: "F3/4.",
      harmony: "IV/8 r/8 IV/8",
    });
    expect(warnings(project, "soprano")).toEqual([]);
  });

  it.each<[string, Example]>([
    ["折返错八度", { tenor: "B3/8 A#3/8 B4/8" }],
    ["实际下邻改为同音异名", { tenor: "B3/8 Bb3/8 B3/8" }],
    ["女高没有实际折返", { soprano: "D5/8 C#5/8 G4/8" }],
    ["只在离开前有一个和弦锚点", { harmony: "V7/8 r/4" }],
    ["持续低音改为同音重奏", { bass: "G3/8 G3/4" }],
    ["实际起奏是另一个已声明和弦", { harmony: "V7/8 II/8 V7/8" }],
  ])("%s 时保留原导音警告", (_label, options) => {
    expect(warnings(heldDominant(options), "tenor")).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it.each([480, 720, 960])("手动句界 %s 阻止借用另一句的折返", tick => {
    const project = heldDominant();
    addPhraseBoundary(project, tick);
    expect(warnings(project, "tenor")).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it("实际调号事件打断原地装饰证据", () => {
    const project = heldDominant();
    project.keyEvents.push({ ...project.keyEvents[0], id: "next-key", tick: 720, tonic: { step: "G", alter: 0 } });
    expect(warnings(project, "tenor")).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it("强拍 D#5 虽是 E 的导音拼写，三部实奏已确保 F#6，C#5 实际重复", () => {
    const project = accented();
    expect(accentedEvidence(project)).toBe(true);
    expect(warnings(project, "soprano")).toEqual([]);
  });

  it.each<[string, Example]>([
    ["中声部的冻结 B3 破坏独立三和弦", { tenor: "B3/2" }],
    ["只有回归音支持，不重复五音", { soprano: "D#5/8 C#5/4." }],
    ["明确写的是以 D# 为根音的小七和弦", { harmony: "vii43/8 V6/V/4." }],
    ["缺失回归和弦", { harmony: "r/2" }],
    ["三和弦低音在回归处才开始", { bass: "B3/8 A#3/4." }],
  ])("强拍处%s 时拒绝装饰解释", (_label, options) => {
    const project = accented(options);
    expect(accentedEvidence(project)).toBe(false);
    expect(warnings(project, "soprano")).toEqual([]);
  });

  it("同名不同八度构不成强拍邻音的实际折返", () => {
    const project = accented({ soprano: "D#5/8 C#6/8 C#6/4" });
    expect(accentedEvidence(project)).toBeUndefined();
    expect(warnings(project, "soprano")).toEqual([]);
  });

  it("同一个 D#5 确为本调导七根音时仍检查其解决", () => {
    const project = accented({ bass: "A3/8 A#3/4.", harmony: "viiø43/8 V6/V/4." });
    expect(accentedEvidence(project)).toBe(false);
    expect(warnings(project, "soprano")).toEqual([expect.objectContaining({ tick: 2400 })]);
  });

  it("女高实际从结构导音离开时保留原警告", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
 S: | B4/4 E5/4 |
 A: | F4/4 G4/4 |
 T: | D4/4 C4/4 |
 B: | G2/4 C3/4 |
 H: | V7/4 I/4 |
}`).project;
    expect(warnings(project, "soprano")).toEqual([expect.objectContaining({ tick: 960 })]);
  });

  it("强拍回归和五音复奏之间有手动句界", () => {
    const project = accented();
    addPhraseBoundary(project, 2640);
    expect(accentedEvidence(project)).toBe(false);
    expect(warnings(project, "soprano")).toEqual([]);
  });
});
