import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

interface Example {
  key?: string;
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
  onset?: number;
  boundary?: number;
  keyDetour?: boolean;
  changeMiddleLabelKey?: boolean;
}

function warnings({
  key = "G minor", soprano = "D5/4 Eb5/2", alto = "G4/2.", tenor = "D4/4 C4/2",
  bass = "Bb2/8 B2/8 C3/2", harmony, onset = 0.5, boundary, keyDetour, changeMiddleLabelKey,
}: Example = {}) {
  const { project } = compileScoreText(`satb 1
key ${key}
meter 3/4
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
  ${harmony ? "H: | " + harmony + " |" : ""}
}`);
  if (boundary !== undefined) project.structure.phraseBoundaries.push({
    id: "manual-cut", tick: boundary * project.ppq, source: "manual", confidence: "certain",
  });
  if (keyDetour) project.keyEvents.push(
    { id: "detour", tick: project.ppq / 4, tonic: { step: "C", alter: 0 }, mode: "minor" },
    { id: "return", tick: project.ppq / 2, tonic: { step: "G", alter: 0 }, mode: "minor" },
  );
  if (changeMiddleLabelKey) {
    const middle = project.chordTrack.regions[1];
    const secondHalf = structuredClone(middle);
    secondHalf.id = "middle-label-detour";
    secondHalf.startTick += project.ppq / 4;
    secondHalf.durationTicks /= 2;
    secondHalf.semantics!.interpretations[0].localKey = { tonic: { step: "D", alter: 0 }, mode: "minor" };
    middle.durationTicks /= 2;
    project.chordTrack.regions.splice(2, 0, secondHalf);
  }
  return checkHarmony(project, undefined, {}, {
    "melody.augmented-interval": { "same-harmony": "strict" },
  }).diagnostics.filter(item =>
    item.ruleId === "melody.augmented-interval" && item.voiceIds.includes("bass") &&
    item.tick === onset * project.ppq);
}

describe("小调低音升三音半音经过到下属", () => {
  it.each([
    ["裸四声部", {}],
    ["单列大主和弦第一转位", { harmony: "i6/8 I6/8 iv/2" }],
    ["持续小主和弦覆盖弱分拍", { harmony: "i6/4 iv/2" }],
    ["明确副属标签", { harmony: "i6/8 V6/IV/8 iv/2" }],
    ["移至 D 小调", { key: "D minor", soprano: "A4/4 Bb4/2", alto: "D4/2.",
      tenor: "A3/4 G3/2", bass: "F2/8 F#2/8 G2/2", harmony: "i6/8 I6/8 iv/2" }],
  ] satisfies [string, Example][])("%s 时检查完整半音经过", (_label, example) => {
    expect(warnings(example)).toHaveLength(0);
  });

  it.each([
    ["上声部重奏原音", { soprano: "D5/8 D5/8 Eb5/2", harmony: "i6/8 I6/8 iv/2" }],
    ["上声部同时换音", { soprano: "D5/8 G5/8 Eb5/2" }],
    ["右端响成大下属", { soprano: "D5/4 E5/2" }],
    ["右端根音低音换八度", { bass: "Bb2/8 B2/8 C4/2" }],
    ["中间低音后缺后继", { bass: "Bb2/8 B2/8 r/2" }],
    ["经过后有休止", { bass: "Bb2/8 B2/8 r/8 C3/4." }],
    ["中间声部下穿名义低音", { tenor: "D2/4 C4/2" }],
    ["中间独立和弦标签冲突", { harmony: "i6/8 VI/8 iv/2" }],
    ["持续经过音内部出现另一局部调标签", { harmony: "i6/8 I6/8 iv/2", changeMiddleLabelKey: true }],
    ["右端标签与原位小下属冲突", { harmony: "i6/8 I6/8 i/2" }],
    ["经过音落在整拍", { bass: "Bb2/4 B2/8 C3/4.", soprano: "D5/4. Eb5/4.",
      tenor: "D4/4. C4/4.", onset: 1 }],
    ["第三音仍在同一分拍级别", { bass: "Bb2/16 B2/16 C3/8 C3/2", soprano: "D5/8 Eb5/8 Eb5/2",
      tenor: "D4/8 C4/8 C4/2", onset: 0.25 }],
    ["句界落在右端", { boundary: 1 }],
    ["两音之间暂时换调再返回", { keyDetour: true }],
  ] satisfies [string, Example][])("%s 时保留 B.3", (_label, example) => {
    expect(warnings(example)).toEqual([expect.objectContaining({ severity: "warning", voiceIds: ["bass"] })]);
  });
});
