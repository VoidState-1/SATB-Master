import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
  boundary?: number;
  turnIntoPassing64?: boolean;
  keyDetour?: boolean;
}

function warnings({
  soprano = "Eb5/4 C#5/4 D5/4 F#5/4", alto = "Bb4/4 Bb4/4 Bb4/4 A4/4",
  tenor = "G4/4 G4/4 G4/4 C4/4", bass = "Eb3/4 Eb3/4 D3/4 D3/4",
  harmony = "", boundary, turnIntoPassing64, keyDetour,
}: Example = {}) {
  const { project } = compileScoreText(`satb 1
key G minor
meter 4/4
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
  if (turnIntoPassing64) {
    const landing = project.chordTrack.regions.find(chord => chord.startTick === 2 * project.ppq)!;
    landing.semantics!.cadenceRole = "passing64";
  }
  if (keyDetour) project.keyEvents.push(
    { id: "detour", tick: project.ppq / 2, tonic: { step: "C", alter: 0 }, mode: "minor" },
    { id: "return", tick: project.ppq, tonic: { step: "G", alter: 0 }, mode: "minor" },
  );
  return checkHarmony(project, undefined, {}, {
    "melody.diminished-interval": { "same-harmony": "strict" },
  }).diagnostics.filter(item =>
    item.ruleId === "melody.diminished-interval" && item.tick === project.ppq && item.voiceIds.includes("soprano"));
}

describe("德国增六前的下行减三度", () => {
  it.each([
    ["裸四声部", {}],
    ["升六级在原声部经过且进入属和弦时低音下移八度", {
      soprano: "Eb5/4 C#5/4 D5/8 E5/8 F#5/4", bass: "Eb3/4 Eb3/4 D3/4 D2/4",
    }],
    ["完整给定和声", { harmony: "VI/4 Ger+6/4 K46/4 V7/4" }],
    ["普通主四六标签并有实际属和弦", { harmony: "VI/4 Ger+6/4 i64/4 V7/4" }],
    ["第一转位的 VI 准备", { bass: "G3/4 Eb3/4 D3/4 D3/4", tenor: "Eb4/4 G4/4 G4/4 C4/4" }],
  ] satisfies [string, Example][])("%s 有明确半音解决", (_label, example) => {
    expect(warnings(example)).toHaveLength(0);
  });

  it.each([
    ["后音重奏升四级", { soprano: "Eb5/4 C#5/4 C#5/4 F#5/4" }],
    ["后音缺失", { soprano: "Eb5/4 C#5/4 r/4 F#5/4" }],
    ["解决音错八度", { soprano: "Eb5/4 C#5/4 D6/4 F#5/4" }],
    ["低音没有半音下行", { bass: "Eb3/4 Eb3/4 Eb3/4 D3/4" }],
    ["到属和弦时低音越过两个八度", { bass: "Eb3/4 Eb3/4 D3/4 D1/4" }],
    ["经过音从其他声部才到导音", { soprano: "Eb5/4 C#5/4 D5/8 E5/8 A5/4",
        alto: "Bb4/4 Bb4/4 Bb4/4 F#4/4" }],
    ["未标和弦的四六与属之间另起和声", { alto: "Bb4/4 Bb4/4 Bb4/8 C5/8 A4/4" }],
    ["德国增六的内声错误", { alto: "Bb4/4 A4/4 Bb4/4 A4/4" }],
    ["德国增六的内声低过实际低音", { tenor: "G4/4 G2/4 G4/4 C4/4" }],
    ["两个共同音之一搬八度", { tenor: "G4/4 G4/4 G3/4 C4/4" }],
    ["减三度之前是另一个和弦", { alto: "C5/4 Bb4/4 Bb4/4 A4/4" }],
    ["中间标签明确冲突", { harmony: "VI/4 Fr+6/4 K46/4 V7/4" }],
    ["落点明确标为经过四六", { harmony: "VI/4 Ger+6/4 i64/4 V7/4", turnIntoPassing64: true }],
    ["四六无后续实际属和弦", { soprano: "Eb5/4 C#5/4 D5/2", alto: "Bb4/4 Bb4/4 Bb4/2",
        tenor: "G4/4 G4/4 G4/2", bass: "Eb3/4 Eb3/4 D3/2" }],
    ["属音重奏后才到属和弦", { soprano: "Eb5/4 C#5/4 D5/8 D5/8 F#5/4",
        alto: "Bb4/4 Bb4/4 Bb4/4 A4/4", bass: "Eb3/4 Eb3/4 D3/8 D3/8 D3/4" }],
    ["源音内有句界", { boundary: 0.5 }],
    ["四六和属之间有句界", { boundary: 2.5 }],
    ["源音内暂时换调", { keyDetour: true }],
  ] satisfies [string, Example][])("%s 时保留 B.4", (_label, example) => {
    expect(warnings(example)).toEqual([expect.objectContaining({ severity: "warning", voiceIds: ["soprano"] })]);
  });
});
