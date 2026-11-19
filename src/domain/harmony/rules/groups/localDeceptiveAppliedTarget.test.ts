import { describe, expect, it, vi } from "vitest";
import { functionalTargetForDegree } from "../../../chordModel";
import type { ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import * as localProof from "./localDeceptiveAppliedTarget";

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
  later?: string;
  key?: string;
}

function example({
  soprano = "G4/4 G#4/4 | A4/2 | G4/2 | A4/2",
  alto = "E4/4 D4/4 | C4/2 | E4/2 | E4/2",
  tenor = "C4/4 B3/4 | A3/2 | C4/2 | C4/2",
  bass = "C3/4 E3/4 | F3/2 | C3/2 | A2/2",
  harmony = "I/4 V7/VI/4 | IV/2 | I/2 | vi/2",
  later = "",
  key = "C major",
}: Example = {}) {
  return compileScoreText(`satb 1
key ${key}
meter 2/4
${later}
bars 1..4 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}`).project;
}

function warnings(project: ProjectDocument) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "function.applied-dominant-target")
    .map(({ tick, severity, message }) => ({ tick, severity, message }));
}

function warningsWithoutException(project: ProjectDocument) {
  // The G.2 change is only this guard. Disable it to compare the same input with the old warning path.
  const guard = vi.spyOn(localProof, "isProvenLocalDeceptiveTarget").mockReturnValue(false);
  try {
    return warnings(project);
  } finally {
    guard.mockRestore();
  }
}

function proofApplies(project: ProjectDocument) {
  const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  const target = context.spanAt(2 * project.ppq);
  const landing = target && context.connections({ targetSpanId: target.span.id }).first();
  return !!landing && localProof.isProvenLocalDeceptiveTarget(context, landing);
}

function replaceReading(project: ProjectDocument, change: Partial<
  NonNullable<ProjectDocument["chordTrack"]["regions"][number]["semantics"]>["interpretations"][number]
>) {
  const source = project.chordTrack.regions[1];
  const semantics = source.semantics!;
  source.semantics = { ...semantics, interpretations: [{ ...semantics.interpretations[0], ...change }] };
}

describe("G.2 副属到局部小调 VI 的实谱核对", () => {
  it("完整 E7→F 同声部解决，已标为指向 a 小调时认可阻碍", () => {
    const project = example();
    expect(proofApplies(project)).toBe(true);
    expect(warningsWithoutException(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
    expect(warnings(project)).toEqual([]);
  });

  it.each<[string, Example]>([
    ["拼写错误的导音", { soprano: "G4/4 Ab4/4 | A4/2 | G4/2 | A4/2" }],
    ["导音到落点同名音的另一八度", { soprano: "G4/4 G#4/4 | A3/2 | G4/2 | A4/2" }],
    ["七音改由另一声部接手，落点实音仍相同", {
      alto: "E4/4 D4/4 | A3/2 | E4/2 | E4/2",
      tenor: "C4/4 B3/4 | C4/2 | C4/2 | C4/2",
    }],
    ["属七五音跳到局部主音的另一八度", { tenor: "C4/4 B3/4 | A4/2 | C4/2 | C4/2" }],
    ["降八度的七音声部落到名义低音下方", { alto: "E4/4 D4/4 | C3/2 | E4/2 | E4/2" }],
    ["各声部按级进但男高音实为最低音", { tenor: "C4/4 B2/4 | A2/2 | C4/2 | C4/2" }],
    ["落点根、三、五俱全但重根", { tenor: "C4/4 B3/4 | F3/2 | C4/2 | C4/2" }],
    ["源标成普通副属三和弦", { harmony: "I/4 V/VI/4 | IV/2 | I/2 | vi/2" }],
    ["源缺五音", { tenor: "C4/4 E4/4 | A3/2 | C4/2 | C4/2" }],
    ["实际低音换八度", { bass: "C3/4 E3/4 | F2/2 | C3/2 | A2/2" }],
    ["实谱是 F 而标注到 F 第一转位", { harmony: "I/4 V7/VI/4 | IV6/2 | I/2 | vi/2" }],
  ])("%s 时照常保留 warning", (_label, options) => {
    const project = example(options);
    expect(proofApplies(project)).toBe(false);
    expect(warnings(project)).toEqual(warningsWithoutException(project));
    expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq, severity: "warning" })]);
  });

  it.each([
    ["另一个级数", functionalTargetForDegree(2)],
    ["相同级数但不同功能", functionalTargetForDegree(6, { primaryFunction: "dominant" })],
  ] as const)("目标标成%s 时不能由音响改写", (_label, appliedTarget) => {
    const project = example();
    replaceReading(project, { appliedTarget });
    expect(proofApplies(project)).toBe(false);
    expect(warnings(project)).toEqual(warningsWithoutException(project));
    expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
  });

  it("目标是调内大三和弦时，后面出现同主音小和弦也不免除 G.2", () => {
    const project = example({ key: "E major", harmony: "I/4 V7/IV/4 | bII/2 | I/2 | iv/2" });
    expect(proofApplies(project)).toBe(false);
    expect(warnings(project)).toEqual(warningsWithoutException(project));
    expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
  });

  it("落点被明确标为另一副属时，实际 F 三和弦也不能代替关系证明", () => {
    const project = example({ harmony: "I/4 V7/VI/4 | V/VII/2 | I/2 | vi/2" });
    const arrival = project.chordTrack.regions[2];
    arrival.identity = {
      ...arrival.identity, root: { step: "F", alter: 0 }, bass: { step: "F", alter: 0 },
    };
    expect(proofApplies(project)).toBe(false);
    expect(warnings(project)).toEqual(warningsWithoutException(project));
    expect(warnings(project).map(item => item.tick)).toEqual([2 * project.ppq, 4 * project.ppq]);
  });

  it("隔一和弦才出现同一 F 配置，稍后也出现 vi，仍在直接落点报警", () => {
    const project = example({
      soprano: "G4/4 G#4/4 | G4/2 | A4/2 | A4/2",
      alto: "E4/4 D4/4 | E4/2 | C4/2 | E4/2",
      tenor: "C4/4 B3/4 | C4/2 | A3/2 | C4/2",
      bass: "C3/4 E3/4 | C3/2 | F3/2 | A2/2",
      harmony: "I/4 V7/VI/4 | I/2 | IV/2 | vi/2",
    });
    expect(proofApplies(project)).toBe(false);
    expect(warnings(project)).toEqual(warningsWithoutException(project));
    expect(warnings(project).map(item => item.tick)).toEqual([2 * project.ppq]);
  });

  it("目标不确定时声部外形没有豁免资格，沿用 G.2 对未决标注的处理", () => {
    const project = example();
    const source = project.chordTrack.regions[1];
    const semantics = source.semantics!;
    source.semantics = { ...semantics, alternatives: [{
      ...semantics.interpretations[0], id: "competing-target", appliedTarget: functionalTargetForDegree(2),
    }] };
    expect(proofApplies(project)).toBe(false);
    expect(warnings(project)).toEqual(warningsWithoutException(project));
    expect(warnings(project)).toEqual([]);
  });

  it("实际调号改变时，即使两段分析沿用同一局部调也不豁免", () => {
    const project = example({ later: "at 2:1 key G major", harmony: "I/4 V7/VI/4 | bVII/2 | IV/2 | ii/2" });
    const sourceKey = { tonic: { step: "C", alter: 0 }, mode: "major" } as const;
    replaceReading(project, { localKey: sourceKey });
    const arrival = project.chordTrack.regions[2];
    const semantics = arrival.semantics!;
    arrival.semantics = { ...semantics, interpretations: [{
      ...semantics.interpretations[0], localKey: sourceKey, degree: 4, degreeAlteration: 0,
    }] };
    expect(proofApplies(project)).toBe(false);
    expect(warnings(project)).toEqual(warningsWithoutException(project));
    expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
  });

  it.each([0, 0.5])("句界在落点前 %s 拍时不把两侧当作一次局部解决", beforeLanding => {
    const project = example();
    project.structure.phraseBoundaries.push({
      id: "phrase-edge", tick: (2 - beforeLanding) * project.ppq, source: "manual", confidence: "certain",
    });
    expect(proofApplies(project)).toBe(false);
    expect(warnings(project)).toEqual(warningsWithoutException(project));
    expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
  });

  it("原有直接目标解决仍然通过", () => {
    const project = example({
      alto: "E4/4 D4/4 | C4/2 | E4/2 | E4/2",
      tenor: "C4/4 B3/4 | E4/2 | C4/2 | C4/2",
      bass: "C3/4 E3/4 | A2/2 | C3/2 | A2/2",
      harmony: "I/4 V7/VI/4 | vi/2 | I/2 | vi/2",
    });
    expect(proofApplies(project)).toBe(false);
    expect(warnings(project)).toEqual(warningsWithoutException(project));
    expect(warnings(project)).toEqual([]);
  });
});
