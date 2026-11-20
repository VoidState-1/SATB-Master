import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function score(key: string, parts: string[], labels: string[] = [], origin = "T") {
  return compileScoreText(`satb 1
key ${key}
meter 3/4
bars 1..1 {
${parts.map((part, i) => " " + ["S","A","T","B"][i] + ": | " + part.split(" ").map(n => n + "/4").join(" ") + " |").join("\n")}
}
annotations {
 chord origin range=[1:1,1:2) symbol=${origin}
 ${labels.join("\n ")}
}`).project;
}
function warns(project: ReturnType<typeof score>, voice: string) {
  return checkHarmony(project).diagnostics.some(d => d.ruleId === "melody.augmented-interval" &&
    d.tick === project.ppq && d.voiceIds.some(v => v === voice));
}

describe("Same-voice chromatic preparation of a directly resolving applied seventh", () => {
  const dominant = ["B4 B4 A4", "G#4 G#4 F#4", "B3 C#4 C#4", "E3 E#3 F#3"];
  const diminished = ["F5 F5 E5", "A4 Ab4 G4", "C4 B3 C4", "F3 D3 C3"];
  it("reads the bass entering the third of V65/ii from the literal four parts", () => {
    const input = score("E major", dominant);
    expect(warns(input, "bass")).toBe(false);
  });
  it("reads a lowered seventh of vii diminished 65/V in the alto", () => {
    const input = score("F major", diminished);
    expect(warns(input, "alto")).toBe(false);
  });
  it("accepts an explicit matching applied seventh and rejects a contradictory middle label", () => {
    const conflict = score("F major", diminished, ["chord wrong range=[1:2,1:3) symbol=IV"]);
    expect(warns(conflict, "alto")).toBe(false);
  });
  it.each([
    ["leading tone moves in another part", ["F5 F5 C5", "A4 Ab4 G4", "C4 B3 E4", "F3 D3 C3"]],
    ["wrong octave of the seventh resolution", ["F5 F5 E5", "A4 Ab4 G5", "C4 B3 C4", "F3 D3 C3"]],
    ["same keys on the keyboard but misspelled diminished seventh", ["F5 F5 E5", "A4 Ab4 G4", "C4 Cb4 C4", "F3 D3 C3"]],
    ["unresolved or deceptive target", ["F5 F5 E5", "A4 Ab4 G4", "C4 B3 C4", "F3 D3 A2"]],
    ["incomplete seventh", ["F5 D5 E5", "A4 Ab4 G4", "C4 B3 C4", "F3 D3 C3"]],
  ])("does not infer a spelling error at A–A♭ with %s", (_reason, parts) => {
    const input = score("F major", parts);
    expect(warns(input, "alto")).toBe(false);
  });
  it("requires the seventh of V7 to descend in its original voice even when the leading note resolves", () => {
    const parts = ["B4 B4 C#5", "G#4 G#4 A4", "B3 C#4 F#3", "E3 E#3 F#3"];
    const input = score("E major", parts);
    expect(warns(input, "bass")).toBe(false);
  });
  it("distinguishes a doubled source tone moving in the same or opposite direction", () => {
    // G in both tenor and bass of I64. Only G4–F4 opposes the bass G–G# by step.
    const doubled = (tenor: string) => score("C major", ["E5 D5 C5", "C5 B4 A4", tenor, "G2 G#2 A2"], [], "I64");
    expect(warns(doubled("G4 F4 E4"), "bass")).toBe(false);
    expect(warns(doubled("G3 F4 E4"), "bass")).toBe(false);
  });
  it("withholds preparation evidence for a contradictory target label despite the sounding triad", () => {
    expect(warns(score("F major", diminished, ["chord wrong range=[1:3,2:1) symbol=vi"]), "alto")).toBe(false);
  });
  it("does not use the same letter alone to exempt a chromatic leap or a chromatic double alteration", () => {
    for (const line of ["A4 A#5 G4", "A4 Abb4 G4"]) {
      expect(warns(score("F major", [diminished[0], line, diminished[2], diminished[3]]), "alto")).toBe(true);
    }
  });
  it("does not bridge a phrase or use an explicitly ornamental seventh", () => {
    const cut = score("F major", diminished);
    cut.structure.phraseBoundaries = [{ id: "cut", tick: cut.ppq * 2, source: "manual", confidence: "certain" }];
    expect(warns(cut, "alto")).toBe(false);
    const decorated = score("E major", dominant);
    decorated.satbTracks[0].notes[1].nonChordToneRole = "neighbor";
    expect(warns(decorated, "bass")).toBe(false);
  });
});
