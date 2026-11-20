import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";

const minor = `satb 1
key E minor
meter 4/4
bars 1..2 {
 S: | G4/2 E5/4. F5/8 | F#5/2 G5/2 |
 A: | E4/1 | D#4/2 E4/2 |
 T: | B3/1 | A3/2 B3/2 |
 B: | E3/1 | B2/2 E3/2 |
}
`;

const major = minor.replace("E minor", "C major")
  .replace("E5/4. F5/8 | F#5/2 G5/2", "C5/4. C#5/8 | D5/2 E5/2")
  .replace("D#4/2 E4/2", "B3/2 C4/2")
  .replace("B3/1 | A3/2 B3/2", "C4/1 | F3/2 G3/2")
  .replace("E3/1 | B2/2 E3/2", "C3/1 | G2/2 C3/2");

const ruleId = "melody.augmented-interval";
function project(text: string) {
  return compileScoreText(text).project;
}

function diagnostics(input: ProjectDocument) {
  return checkHarmony(input, undefined, {}, { [ruleId]: { "same-harmony": "strict" } }).diagnostics;
}

function b3(input: ProjectDocument) {
  return diagnostics(input).filter(d => d.ruleId === ruleId && d.voiceIds.includes("soprano"));
}

describe("a written chromatic passing tone after arpeggiation", () => {
  it.each([["missing third", minor], ["missing fifth", major]])(
    "recovers a %s in bare input and after blind inference", (_label, score) => {
      const raw = project(score);
      const blind = applyHarmonyInference(raw, { chordInference: inferChords(raw) },
        { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
      expect(b3(raw)).toEqual([]);
      expect(b3(blind)).toEqual([]);
    },
  );

  it("keeps the passing role separate from an enharmonic spelling correction", () => {
    for (const [pitch, wrong] of [["F5", false], ["E#5", true]] as const) {
      const text = minor.replace("F5/8", pitch + "/8").replace(" B:", " H: | i/2 r/4. i/8 | V7/2 i/2 |\n B:");
      const input = project(text);
      input.satbTracks.find(t => t.voice === "soprano")!.notes[2].nonChordToneRole = "passing";
      const found = diagnostics(input);
      expect(found.filter(d => d.ruleId === "nonchord.passing-tone")).toEqual([]);
      const chromatic = found.filter(d => d.ruleId === ruleId);
      if (wrong) expect(chromatic).toEqual([expect.objectContaining({
        tick: 3360, messageKey: ruleId + ".passing-spelling", message: expect.stringContaining("F5"),
      })]);
      else expect(chromatic).toEqual([]);
    }
  });

  it("gives the same specific spelling correction in bare input", () => {
    expect(b3(project(minor.replace("F5/8", "E#5/8")))).toEqual([expect.objectContaining({
      tick: 3360, messageKey: ruleId + ".passing-spelling", message: expect.stringContaining("F5"),
    })]);
  });

  it.each([
    ["no complete preparation", minor.replace("G4/2", "E4/2")],
    ["a rest between the arpeggiation and the proved harmony", minor.replace("G4/2", "G4/4 r/4")],
    ["a reattack in the accompaniment", minor.replace("E4/1", "E4/2 E4/2")],
    ["an independent label during the passing note", minor.replace(" B:", " H: | r/2 r/4. iv/8 | V7/2 i/2 |\n B:")],
    ["an incomplete destination", minor.replace("D#4/2 E4/2", "F#4/2 E4/2")],
  ])("does not infer a spelling error with %s", (_label, score) => {
    expect(b3(project(score))).not.toContainEqual(expect.objectContaining({ tick: 3840 }));
  });

  it("withholds a spelling correction when the local-key label conflicts", () => {
    const conflicting = minor.replace("F5/8", "E#5/8") + `
annotations {
 chord handoff range=[1:4+1/2,2:1) symbol=vi localKey="G major"
}
`;
    expect(b3(project(conflicting))).not.toContainEqual(expect.objectContaining({ messageKey: ruleId + ".passing-spelling" }));
  });

  it("does not import the accompaniment's harmony across a key event or phrase boundary", () => {
    const misspelled = minor.replace("F5/8", "E#5/8");
    const key = project(misspelled);
    key.keyEvents.push({ ...key.keyEvents[0], id: "new-key", tick: 1920 });
    const phrase = project(misspelled);
    phrase.structure.phraseBoundaries.push({ id: "cut", confidence: "certain", source: "manual", tick: 1920 });
    for (const input of [key, phrase]) expect(b3(input)).not.toContainEqual(expect.objectContaining({ messageKey: ruleId + ".passing-spelling" }));
  });
});
