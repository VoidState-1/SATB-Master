import { expect, it } from "vitest";
import { PPQ, type ProjectDocument } from "../../project";
import { applyTeachingPreset, type TeachingPreset } from "../../ruleProfile";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { scoreText, type Score } from "./guardrails/fixtureContract";
import type { HarmonyRuleId } from "./catalog";

function example(voices: Score["voices"], annotations?: string[]) {
  return compileScoreText(scoreText({ voices, annotations })).project;
}

function findings(project: ProjectDocument, id: HarmonyRuleId, preset: TeachingPreset) {
  applyTeachingPreset(project, preset);
  const result = checkHarmony(project);
  expect(result.skippedRules.filter(row => row.reason === "rule-error")).toEqual([]);
  return result.diagnostics.filter(d => d.ruleId === id)
    .map(({ tick, severity, voiceIds }) => [tick / PPQ, severity, voiceIds]);
}

it.each([
  ["K46/1 | V/1", [0, "warning", []], undefined],
  ["K46/2 V/2", undefined, undefined],
  ["I/4 K46/4 V/2", [1, "warning", []], [1, "warning", []]],
  ["I/4 K46/2 V/4", [1, "warning", []], [1, "warning", []]],
] as const)("K46 拍位 %s", (H, strict, textbook) => {
  const sustained = H.includes("|") ? "G3/1 | G3/1" : "G3/1";
  const project = example({ S: sustained, A: sustained, T: sustained, B: sustained, H });
  const rule = "cadence.cadential64-metric-position";
  expect(findings(project, rule, "strict")).toEqual(strict ? [strict] : []);
  expect(findings(project, rule, "textbook")).toEqual(textbook ? [textbook] : []);
});

it("句尾切分须实际跨过强拍，空白尾段须有人工句界", () => {
  const project = example({
    S: "E5/4 D5/2.", A: "C5/4 B4/2.", T: "G3/1", B: "C3/4 G2/2.", H: "I/4 V/2.",
  });
  const rule = "rhythm.harmonic-syncopation";
  expect(findings(project, rule, "strict")).toEqual([]);
  expect(findings(project, rule, "textbook")).toEqual([[1, "warning", []]]);
  project.lengthTicks += PPQ * 4;
  expect(findings(project, rule, "textbook")).toEqual([]);
  project.structure.phraseBoundaries.push({ id: "end", tick: 4 * PPQ, source: "manual", confidence: "certain" });
  expect(findings(project, rule, "strict")).toEqual([]);
  expect(findings(project, rule, "textbook")).toEqual([[1, "warning", []]]);
  project.chordTrack.regions[1].durationTicks = PPQ;
  project.structure.phraseBoundaries[0].tick = 2 * PPQ;
  expect(findings(project, rule, "textbook")).toEqual([]);
});

it("女高上限 A5 通过，超出一半音的事件仅改变级别", () => {
  const project = example({ S: "A5/2 Bb5/2", A: "C4/1", T: "G3/1", B: "C3/1", H: "I/1" });
  expect(findings(project, "voice.range", "strict")).toEqual([[2, "warning", ["soprano"]]]);
  expect(findings(project, "voice.range", "textbook")).toEqual([[2, "suggestion", ["soprano"]]]);
});

it.each([
  ["alto", "E5/2 C5/2", "B4/2 G4/2", "F4/2 E4/2", false],
  ["tenor", "E5/2 C5/2", "F4/2 E4/2", "B3/2 G3/2", false],
  ["soprano", "B4/2 G4/2", "D4/2 C4/2", "F3/2 E3/2", true],
  ["alto", "E5/2 C5/2", "B4/2 E4/2", "F4/2 G3/2", true],
] as const)("属七到主三，%s 声部 %s / %s / %s", (voice, S, A, T, both) => {
  const annotations = S.startsWith("E5") ? ["note S@1:1 role=other"] : [];
  const project = example({ S, A, T, B: "G2/2 C3/2", H: "V7/2 I/2" }, annotations);
  const expected = [[2, "warning", [voice]]];
  expect(findings(project, "resolution.leading-tone", "strict")).toEqual(expected);
  expect(findings(project, "resolution.leading-tone", "textbook")).toEqual(both ? expected : []);
});

it("两档均报告低音导音错跳以及内声部落到非主和弦的 G", () => {
  const bass = example({ S: "G4/2 C5/2", A: "D4/2 E4/2", T: "G3/2 C4/2", B: "B2/2 G2/2", H: "V6/2 I64/2" });
  const mediant = example({ S: "D5/2 E5/2", A: "B4/2 G4/2", T: "F4/2 B3/2", B: "G2/2 E3/2", H: "V7/2 iii/2" });
  for (const preset of ["strict", "textbook"] as const) {
    expect(findings(bass, "resolution.leading-tone", preset)).toEqual([[2, "warning", ["bass"]]]);
    expect(findings(mediant, "resolution.leading-tone", preset)).toEqual([[2, "warning", ["alto"]]]);
  }
});
