import { expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const leapRule = "melody.large-leap";

it.each([[true, false], [false, true]])("核对其他声部延留准备的同音加倍 %s", (doubled, reports) => {
  const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | C5/4 ${doubled ? "G4" : "E5"}/4 A4/2 |
 A: | G4/4 G4/2 F4/4 |
 T: | E4/4 C4/4 C4/2 |
 B: | C4/4 E3/4 F3/2 |
 H: | I/4 I6/4 IV/2 |
}`);
  project.satbTracks.find(track => track.voice === "alto")!.notes[1].nonChordToneRole = "suspension";
  const hasLeap = (strict: boolean) =>
    checkHarmony(project, undefined, {}, strict ? { [leapRule]: { "same-harmony": "strict" } } : {})
      .diagnostics.some(d => d.ruleId === leapRule && d.tick === project.ppq && d.voiceIds.includes("bass"));
  expect(hasLeap(true)).toBe(true);
  expect(hasLeap(false)).toBe(reports);
});

function leaps(score: string, strict = false) {
  const { project } = compileScoreText(score);
  return checkHarmony(project, undefined, {}, strict ? { [leapRule]: { "same-harmony": "strict" } } : {})
    .diagnostics.filter(d => d.ruleId === leapRule);
}

it("保留跨和弦的女高八度，先前在同一和弦内的换位只解释当时的进行", () => {
  const score = `satb 1
key Bb major
meter 4/4
bars 1..1 {
 S: | C5/4 F4/2 F5/4 |
 A: | F4/2 Eb4/4 D4/4 |
 T: | A3/2 A3/4 Bb3/4 |
 B: | F3/2 Eb3/4 D3/4 |
 H: | V/2 V2/4 I6/4 |
}`;
  expect(leaps(score)).toContainEqual(expect.objectContaining({ tick: 2880, voiceIds: ["soprano"] }));
});

it("长音经过换和弦后，在实际起跳的位置核对转位和实音", () => {
  const score = `satb 1
key D minor
meter 3/4
bars 1..1 {
 S: | Bb4/4 A4/4 D5/4 |
 A: | G4/4 F4/4 A4/4 |
 T: | Bb3/4 D4/4 A3/4 |
 B: | D3/2 F2/4 |
 H: | iv64/4 i/4 i6/4 |
}`;
  const bassLeap = expect.objectContaining({ tick: 1920, voiceIds: ["bass"] });
  expect(leaps(score, true)).toContainEqual(bassLeap);
  expect(leaps(score)).not.toContainEqual(bassLeap);
});
