import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";

const motif = `satb 1
key C major
meter 3/4
bars 1..2 {
 S: | G5/2 G#5/4 | A5/2. |
 A: | F#5/4 E5/4 E5/4 | E5/2. |
 T: | B4/2 B4/4 | A4/2. |
 B: | E4/2 D4/4 | D4/4 C4/2 |
}
`;

const annotations = `
annotations {
 chord dominant range=[1:3,2:1) symbol=D2 localKey="A minor"
 chord tonic range=[2:1,3:1) symbol=t6 localKey="A minor"
}
`;

function project(text = motif) {
  return compileScoreText(text).project;
}

function warns(input: ProjectDocument) {
  return checkHarmony(input, undefined, {}, { "melody.augmented-interval": { "same-harmony": "strict" } })
    .diagnostics.some(d => d.ruleId === "melody.augmented-interval" && d.tick === 2 * input.ppq &&
      d.severity === "warning" && d.voiceIds.includes("soprano"));
}

describe("chromatic preparation of a V7 with a reattacked seventh", () => {
  it("reads the two resolutions directly and checks through blind inference", () => {
    const input = project();
    expect(warns(input)).toBe(false);
    const blind = applyHarmonyInference(input, { chordInference: inferChords(input) },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(warns(blind)).toBe(false);
  });

  it("accepts compatible labels even when the displaced bass has a suspension role", () => {
    const input = project(motif + annotations);
    input.satbTracks.find(t => t.voice === "bass")!.notes[2].nonChordToneRole = "suspension";
    expect(warns(input)).toBe(false);
  });

  it.each([
    ["wrong written third", motif.replace("D4/4 C4/2", "D4/4 C#4/2")],
    ["reattack at the wrong register", motif.replace("| D4/4 C4/2", "| D3/4 C4/2")],
    ["seventh goes to a tonic member in another voice", motif.replace("| D4/4 C4/2", "| D4/4 A3/2").replace("A4/2.", "A4/4 C4/2")],
    ["late leading tone", motif.replace("A5/2.", "E5/4 A5/2")],
    ["a rest before the reattack", motif.replace("| D4/4 C4/2", "| r/8 D4/8 C4/2")],
    ["the third is supplied by a sustained rather than reattacked note", motif.replace("D4/4 | D4/4", "D4/4~ | D4/4")],
    ["another voice changes at the same late arrival", motif.replace("A4/2.", "A4/4 E4/2")],
    ["another copy of the natural note", motif.replace("E4/2 D4/4", "G4/2 D4/4")],
    ["a separate written D minor at the delayed onset", motif.replace("| E5/2. |","| F5/4 E5/2 |")],
    ["incompatible middle labels", motif + annotations.replace("symbol=t6", "symbol=iv")],
  ])("keeps the soprano G–G♯ free of B.3 with %s", (_name, text) => {
    const input = project(text);
    expect(warns(input)).toBe(false);
  });

  it("does not infer a spelling error at G–G♯ before a manual phrase boundary", () => {
    const cut = project();
    cut.structure.phraseBoundaries.push({ id: "phrase-cut", tick: 4 * cut.ppq, source: "manual", confidence: "certain" });
    expect(warns(cut)).toBe(false);
  });
});
