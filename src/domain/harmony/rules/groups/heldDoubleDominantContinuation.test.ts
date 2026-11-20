import { describe, expect, it } from "vitest";
import { functionalTargetForDegree } from "../../../chordModel";
import type { ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";
import { buildHarmonyAnalysis } from "../../analysis";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { isProvenHeldDoubleDominantContinuation } from "./heldDoubleDominantContinuation";

interface Example {
  soprano?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
  boundary?: number;
  changeMiddleTarget?: boolean;
  localKeyDetour?: boolean;
  passing64?: boolean;
}

function exercise({
  soprano = "Bb4/4 A4/4 G4/4 | G4/2 F#4/4 | G4/2.",
  tenor = "G3/4 A3/4 Bb3/4 | Bb3/2 C4/4 | Bb3/2.",
  bass = "C#3/2. | D3/2. | G2/2.",
  harmony = "viio7/V/4 V6/V/4 viio7/V/4 | K46/2 V7/4 | i/2.",
  boundary, changeMiddleTarget, localKeyDetour, passing64,
}: Example = {}) {
  const { project } = compileScoreText(`satb 1
key G minor
meter 3/4
bars 1..3 {
 S: | ${soprano} |
 A: | E4/2. | D4/2. | D4/2. |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}`);
  if (boundary !== undefined) project.structure.phraseBoundaries.push({
    id: "manual-cut", tick: boundary * project.ppq, source: "manual", confidence: "certain",
  });
  if (changeMiddleTarget) {
    project.chordTrack.regions[1].semantics!.interpretations[0].appliedTarget =
      functionalTargetForDegree(4);
  }
  if (localKeyDetour) {
    project.chordTrack.regions[1].semantics!.interpretations[0].localKey =
      { tonic: { step: "D", alter: 0 }, mode: "minor" };
  }
  if (passing64) {
    project.chordTrack.regions[3].semantics!.cadenceRole = "passing64";
  }
  return project;
}

function warnings(project: ProjectDocument) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "function.applied-dominant-target");
}

describe("G.2 同一重属导音低音上的功能延续", () => {
  it("完整导减七和属六交替后，经实际 K46 至省五音属七", () => {
    expect(warnings(exercise())).toEqual([]);
  });

  it("同一个实写导音低音上，由重属六到重属五六再到原位属", () => {
    const { project } = compileScoreText(`satb 1
key G major
meter 3/4
bars 1..1 {
 S: | A4/2. |
 A: | E4/2 D4/4 |
 T: | A3/4 G3/4 F#3/4 |
 B: | C#3/2 D3/4 |
 H: | V6/V/4 V65/V/4 V/4 |
}`);
    expect(warnings(project)).toEqual([]);
  });

  it.each([
    ["低音只是同音重奏", { bass: "C#3/4 C#3/4 C#3/4 | D3/2. | G2/2." }],
    ["导音落到目标音级的错误八度", { bass: "C#3/2. | D2/2. | G2/2." }],
    ["导音以下另有声部穿越", { tenor: "G3/4 A2/4 Bb3/4 | Bb3/2 C4/4 | Bb3/2." }],
    ["中间实谱缺少分析标签所需的根音", { soprano: "Bb4/4 E4/4 G4/4 | G4/2 F#4/4 | G4/2.",
      tenor: "G3/4 E3/4 Bb3/4 | Bb3/2 C4/4 | Bb3/2." }],
    ["中间标签指向另一局部目标", { changeMiddleTarget: true }],
    ["持音链末端改为另一个和弦", { harmony: "viio7/V/4 V6/V/4 viiø7/II/4 | K46/2 V7/4 | i/2." }],
    ["落点标为经过四六", { passing64: true }],
    ["有 K46 标签却缺实际属和弦", { soprano: "Bb4/4 A4/4 G4/4 | G4/2. | G4/2.",
      tenor: "G3/4 A3/4 Bb3/4 | Bb3/2. | Bb3/2.", harmony: "viio7/V/4 V6/V/4 viio7/V/4 | K46/2. | i/2." }],
    ["属七省五音却重复导音", { tenor: "G3/4 A3/4 Bb3/4 | Bb3/2 F#3/4 | Bb3/2.",
      soprano: "Bb4/4 A4/4 G4/4 | G4/2 F#4/4 | G4/2." }],
    ["源首音内部有句界", { boundary: 0.5 }],
    ["四六到属之间有句界", { boundary: 4.5 }],
  ] satisfies [string, Example][])("%s 时保留链内真实未达提醒", (_label, options) => {
    const project = exercise(options);
    expect(warnings(project)).toContainEqual(expect.objectContaining({ tick: project.ppq, severity: "warning" }));
  });

  it("中间标签另有局部调时证据失败，并沿用跨局部调不评估的策略", () => {
    const project = exercise({ localKeyDetour: true });
    const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    const view = rules.spanAt(project.ppq);
    const connection = view && rules.connections({ targetSpanId: view.span.id }).first();
    expect(connection).toBeDefined();
    expect(isProvenHeldDoubleDominantContinuation(rules, connection!)).toBe(false);
    expect(warnings(project)).toEqual([]);
  });

  it("超出一小节长度的持音链不延后真实未达提醒", () => {
    const project = exercise();
    project.lengthTicks *= 2;
    for (const track of project.satbTracks) for (const note of track.notes) {
      note.startTick *= 2;
      note.durationTicks *= 2;
    }
    for (const chord of project.chordTrack.regions) {
      chord.startTick *= 2;
      chord.durationTicks *= 2;
    }
    expect(warnings(project)).toContainEqual(expect.objectContaining({ tick: 2 * project.ppq, severity: "warning" }));
  });
});
