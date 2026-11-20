import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const ruleId = "melody.augmented-interval";

function evaluate(notes: string[]) {
  const score = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${notes.map(note => `${note}/4`).join(" ")} |
 A: empty
 T: empty
 B: empty
}`).project;
  return checkHarmony(score).diagnostics.filter(diagnostic => diagnostic.ruleId === ruleId);
}

describe("实写旋律增音程", () => {
  it.each([
    ["F4", "F#4", "F4", "E4"],
    ["Bb4", "B4", "Bb4", "A4"],
    ["A4", "Ab4", "G4", "F4"],
  ])("无和弦标注时允许半音往返及经过 %s %s %s %s", (...notes) => {
    expect(evaluate(notes)).toEqual([]);
  });

  it.each([
    ["Fb4", "F4", "G#4", "增2度", 2, 3],
    ["E4", "E#4", "Eb4", "倍增1度", 1, 2],
    ["Cb4", "C4", "C#5", "增8度", 8, 13],
    ["Cb4", "C4", "F##4", "倍增4度", 4, 7],
  ] as const)("%s 到 %s 的半音不影响下一音 %s 的%s诊断", (chromaticApproach, from, to, label, number, semitones) => {
    const diagnostics = evaluate([chromaticApproach, from, to, to]);
    expect(diagnostics).toEqual([expect.objectContaining({
      tick: 1920, voiceIds: ["soprano"], messageKey: `${ruleId}.增`,
      params: { intervalNumber: number, quality: "增", semitones },
      message: expect.stringContaining(label),
    })]);
  });
});
