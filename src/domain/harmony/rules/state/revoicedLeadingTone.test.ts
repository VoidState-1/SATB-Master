import { describe, expect, it } from "vitest";
import type { ProjectDocument, VoiceId } from "../../../project/types";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";

const score = `satb 1
key C major
meter 2/4
bars 1..2 {
 S: | B4/8 A#4/8 B4/4 | C5/2 |
 A: | D4/2 | G4/2 |
 T: | G3/2 | C4/2 |
 B: | G2/4 F2/4 | E2/2 |
 H: | D/8 r/8 D2/4 | T6/2 |
}`;

function read(text = score, blind = false) {
  const input = compileScoreText(blind ? text.replace(/^ H:.*$/m, "") : text).project;
  return blind ? applyHarmonyInference(input, { chordInference: inferChords(input) },
    { mode: "replace-unlocked", writeNonChordToneRoles: true }).project : input;
}

function warnings(project: ProjectDocument, voice: VoiceId = "soprano") {
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === "resolution.leading-tone" && d.severity === "warning" && d.voiceIds.includes(voice));
}

describe("the owner of a decorated dominant third", () => {
  it.each([false, true])("holds the original obligation into D2, blind=%s", blind => {
    expect(warnings(read(score, blind))).toEqual([]);
    const bad = read(score.replace("C5/2", "G4/2"), blind);
    expect(warnings(bad)).toEqual([expect.objectContaining({
      tick: 1920, noteIds: ["note-S-0", "note-S-1920"],
    })]);
  });

  it.each([
    ["wrong return register", score.replace("A#4/8 B4/4", "A#4/8 B3/4")],
    ["literal minor chord at the middle", score.replace("A#4/8", "Bb4/8")],
    ["authored minor reading over the enharmonic neighbor", score.replace("r/8", "v/8")],
    ["no return harmony", score.replace("D2/4", "r/4")],
    ["no written fifth on return", score.replace("D4/2", "D4/4 G4/4")],
    ["wrong destination inversion", score.replace("D2/4", "D65/4")],
  ])("keeps the warning at the first departure with %s", (_reason, text) => {
    expect(warnings(read(text))).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it("respects an explicit boundary between the neighbor and its return", () => {
    const project = read();
    project.structure.phraseBoundaries.push({ id: "break", source: "manual", tick: 960, confidence: "certain" });
    expect(warnings(project)).toContainEqual(expect.objectContaining({ tick: 480 }));
  });

  it("checks the authentic leading tone of the applied chord without opening a home-key obligation on its neighbor", () => {
    const applied = score.replaceAll("B4", "C#5").replace("A#4", "B4").replace("C5/2", "D5/2")
      .replace("D4/2 | G4/2", "E4/2 | A4/2").replace("G3/2 | C4/2", "A3/2 | D4/2")
      .replace("G2/4 F2/4 | E2/2", "A2/4 G2/4 | F3/2")
      .replace("D/8 r/8 D2/4 | T6/2", "V/II/8 r/8 V2/II/4 | ii6/2");
    expect(warnings(read(applied))).toEqual([]);
    expect(warnings(read(applied.replace("D5/2", "A4/2")))).toEqual([expect.objectContaining({
      tick: 1920, noteIds: ["note-S-0", "note-S-1920"],
    })]);
  });

  it("tracks a bass neighbor while a doubled root fills in the step down to the seventh", () => {
    const bass = score.replace("B4/8 A#4/8 B4/4 | C5/2", "G4/8 F#4/8 F4/4 | E4/2")
      .replace("G3/2 | C4/2", "G3/2 | G3/2").replace("G2/4 F2/4 | E2/2", "B2/8 A#2/8 B2/4 | C3/2")
      .replace("D/8 r/8 D2/4 | T6/2", "D6/8 r/8 D65/4 | T/2");
    expect(warnings(read(bass), "bass")).toEqual([]);
    expect(warnings(read(bass.replace("F#4/8", "C5/8")), "bass")).toContainEqual(expect.objectContaining({ tick: 480 }));
  });
});
it("retains the inner voice's legal deceptive resolution after its return", () => {
  const deceptive = `satb 1
key C major
meter 2/4
bars 1..2 {
 S: | G4/4 D5/4 | C5/2 |
 A: | D4/4 G4/4 | E4/2 |
 T: | B3/8 A#3/8 B3/4 | A3/2 |
 B: | G2/2 | A2/2 |
 H: | D/8 r/8 D/4 | TSVI/2 |
}`;
  expect(warnings(read(deceptive), "tenor")).toEqual([]);
  expect(warnings(read(deceptive.replace("A3/2", "G3/2")), "tenor")).toEqual([
    expect.objectContaining({ tick: 1920, noteIds: ["note-T-0", "note-T-1920"] }),
  ]);
});
