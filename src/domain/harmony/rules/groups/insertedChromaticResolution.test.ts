import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";

const textbook = `satb 1
key C major
meter 2/4
bars 1..3 {
  S: | C5/2 | B4/4. G5/8~ | G5/2 |
  A: | G4/2~ | G4/2~ | G4/2 |
  T: | E4/2 | E4/8 Eb4/8 D4/4~ | D4/8 Db4/8 C4/4 |
  B: | C3/2 | F3/2 | E3/2 |
}`;

const ascending = `satb 1
key Eb major
meter 6/8
bars 1..2 {
  S: | F5/4.~ F5/4.~ | F5/8 F#5/8 G5/2 |
  A: | Bb4/4.~ Bb4/4. | Bb4/4 Bb4/2 |
  T: | F4/4.~ F4/4. | Eb4/4.~ Eb4/4. |
  B: | Db3/4.~ Db3/4. | Eb3/4 Db3/2 |
}`;

const parallel = `satb 1
key G minor
meter 2/4
bars 1..2 {
  S: | A4/2~ | A4/8 Ab4/8 G4/4 |
  A: | D4/2~ | D4/2 |
  T: | C4/2~ | C4/8 Cb4/8 Bb3/4 |
  B: | F#2/2 | G2/2 |
}`;

function warningsAt(score: string, quarters: number, harmony?: string) {
  const source = harmony ? score.replace(/\}$/, `  H: ${harmony}\n}`) : score;
  const { project } = compileScoreText(source);
  const input = harmony ? project : applyHarmonyInference(project, { chordInference: inferChords(project) }, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
  // Test this evidence separately from the product's general same-harmony exemption.
  const result = checkHarmony(input, undefined, {}, { "melody.augmented-interval": { "same-harmony": "strict" } });
  expect(result.skippedRuleIds).not.toContain("melody.augmented-interval");
  return result.diagnostics.filter(d => d.ruleId === "melody.augmented-interval" &&
    d.tick === quarters * input.ppq).flatMap(d => d.voiceIds);
}

describe("第 45 章插入半音后解决", () => {
  it.each([undefined, "| I/2 | V42/2 | I6/2 |"])("例 45-661 两次单声部下行 %s", harmony => {
    expect(warningsAt(textbook, 2.5, harmony)).toEqual([]);
    expect(warningsAt(textbook, 4.5, harmony)).toEqual([]);
    // Same complete preparation chord, but without preparation in the same register.
    expect(warningsAt(textbook.replace("E4/2 |", "E3/2 |"), 2.5, harmony)).toContain("tenor");
  });

  it.each([undefined, "| v6/4. v6/4. | I/4 I42/2 |"])("单声部上行与低音增七 %s", harmony => {
    expect(warningsAt(ascending, 3.5, harmony)).toEqual([]);
    expect(warningsAt(ascending.replace("G5/2", "E5/2"), 3.5, harmony)).toContain("soprano");
    // Same sounding insertion, but the written leading step is lost.
    expect(warningsAt(ascending.replace("F#5/8", "Gb5/8"), 4, harmony)).toContain("soprano");
  });

  it.each([undefined, "| V65/2 | i/2 |"])("同时进行的平行六度 %s", harmony => {
    expect(warningsAt(parallel, 2.5, harmony)).toEqual([]);
    expect(warningsAt(parallel.replace("Bb3/4", "B3/4"), 2.5, harmony)).toEqual(
      expect.arrayContaining(["soprano", "tenor"]),
    );
  });
});
