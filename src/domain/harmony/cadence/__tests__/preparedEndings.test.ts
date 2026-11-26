import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";

const k46 = `satb 1
key C major
meter 3/4
bars 1..3 {
 S: | D5/2. | E5/4 D5/4 D5/4 | B4/4 C5/2 |
 A: | G4/2. | G4/4 G4/4 G4/4 | F4/4 E4/2 |
 T: | B3/2. | C4/4 B3/4 D4/4 | D4/4 G3/2 |
 B: | G2/2. | G2/4 G2/4 B2/4 | G2/4 C3/2 |
 H: | V/2. | K46/4 V/4 V6/4 | V7/4 I/2 |
}`;

const applied = `satb 1
key C major
meter 4/4
bars 1..2 {
 S: | F#4/4 G4/2 B4/4 | C5/1 |
 A: | D4/4 D4/2 F4/4 | E4/1 |
 T: | A3/4 G3/2 D4/4 | G3/1 |
 B: | D3/4 B2/2 G2/4 | C3/1 |
 H: | V/V/4 V6/2 V7/4 | I/1 |
}`;

function full(score: string, cut?: number) {
  const { project } = compileScoreText(score);
  if (cut !== undefined)
    project.structure.phraseBoundaries = [{ id: "cut", source: "manual", tick: cut * project.ppq, confidence: "certain" }];
  return buildHarmonyAnalysis(project).cadenceCandidates.filter(c => c.kind === "full")
    .map(c => [c.fromTick, c.landingTick, c.toTick].map(t => t / project.ppq));
}

describe("有实奏依据的终止准备左界", () => {
  it("K46 串起属和弦转位与回归，左界止于此前普通属延长之后", () => {
    expect(full(k46)).toEqual([[3, 7, 9]]);
    expect(full(k46.replace("K46/4", "I64/4"))).toEqual([[6, 7, 9]]);
    expect(full(k46, 5)).toEqual([[6, 7, 9]]);
  });

  it("副属导音在同声部解决至属六时才越过转位回溯", () => {
    expect(full(applied)).toEqual([[0, 4, 8]]);
    expect(full(applied.replace("F#4/4 G4/2", "F#4/4 D5/2"))).toEqual([[3, 4, 8]]);
    expect(full(applied, 1)).toEqual([[3, 4, 8]]);
  });

  it("等长的下属与属占据完整终止小节，普通长主和弦后的换和弦不扩张左界", () => {
    const period = `satb 1
key C major
meter 2/4
bars 1..3 {
 S: | B4/4 C5/4 | A4/4 B4/4 | C5/2 |
 A: | G4/4 G4/4 | F4/4 G4/4 | G4/2 |
 T: | D4/4 E4/4 | C4/4 D4/4 | E4/2 |
 B: | G2/4 C3/4 | F3/4 G2/4 | C3/2 |
 H: | V/4 I/4 | IV/4 V/4 | I/2 |
}`;
    expect(full(period)).toContainEqual([2, 4, 6]);
    expect(full(period.replace("V/4 I/4", "I/2"))).toContainEqual([3, 4, 6]);
  });
});

function localPlagal(mode: "major" | "minor", broken = false) {
  const third = mode === "major" ? "B3" : "Bb3";
  const sixth = mode === "major" ? "E3" : "Eb3";
  const tonic = mode === "major" ? "I" : "i", subdominant = mode === "major" ? "IV64" : "iv64";
  const key = `localKey="G ${mode}"`;
  const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | ${broken ? "F4" : "F#4"}/1 | G4/1 |
 A: | C4/1 | ${third}/4 C4/4 ${third}/2 |
 T: | A3/1 | D3/4 ${sixth}/4 D3/2 |
 B: | D2/1 | G2/1 |
}
annotations {
 chord dom at=1:1 duration=1/1 symbol=V7 ${key}
 chord tonic at=2:1 duration=1/4 symbol=${tonic} ${key}
 chord plagal at=2:2 duration=1/4 symbol=${subdominant} ${key}
 chord end at=2:3 duration=1/2 symbol=${tonic} ${key}
}`);
  return buildHarmonyAnalysis(project).cadenceCandidates.map(c => [c.kind, c.form, c.fromTick / project.ppq, c.toTick / project.ppq]);
}

it.each(["major", "minor"] as const)("局部 %s 的正格终止与主持续音上变格尾部独立计入", mode => {
  expect(localPlagal(mode)).toEqual([["full", "authentic", 0, 5], ["supplementary", "plagal", 5, 8]]);
  expect(localPlagal(mode, true).some(([kind]) => kind === "supplementary")).toBe(false);
});
