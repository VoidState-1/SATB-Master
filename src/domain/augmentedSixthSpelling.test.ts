import { describe, expect, it } from "vitest";
import { chordIdentityToneSpellings, resolveChordIdentity, type ChordDraft } from "./chordModel";
import { applyFunctionalDefinition, functionalDefinition } from "./functionalHarmonyCatalog";
import { formatPitchClass } from "./pitch";
import { compileScoreText, readKey } from "./scoreText";

const baseDraft: ChordDraft = { degree: 1, degreeAlteration: 0, quality: "major", inversion: 0, source: "manual", confidence: "certain" };
const cases = [
  ["C major", ["Ab", "C", "D", "F#"]],
  ["C minor", ["Ab", "C", "D", "F#"]],
  ["F# minor", ["D", "F#", "G#", "B#"]],
  ["G minor", ["Eb", "G", "A", "C#"]],
] as const;

describe("增六和弦的大小调书写", () => {
  it.each(cases)("%s 的三种增六使用正确六级音，不重复降低小调VI", (keyText, french) => {
    const key = readKey(keyText);
    for (const symbol of ["It+6", "Fr+6", "Ger+6"] as const) {
      const draft = applyFunctionalDefinition(baseDraft, functionalDefinition(symbol), key.mode);
      const identity = resolveChordIdentity(draft, key);
      expect(identity.root).toEqual(readKey(french[0] + " major").tonic);
      expect(draft.degreeAlteration).toBe(key.mode === "minor" ? 0 : -1);
      if (symbol === "Fr+6") {
        expect(chordIdentityToneSpellings(identity).map(formatPitchClass))
          .toEqual(french.map(value => value.replaceAll("b", "♭").replaceAll("#", "♯")));
      }
    }
  });

  it("简写标注明确localKey时，按后调小调构造法国增六", () => {
    const { reference } = compileScoreText(`satb 1
key C major
bars 1..1 {
 S: | C#5/1 |
 A: | G4/1 |
 T: | A3/1 |
 B: | Eb3/1 |
}
reference {
 chord fr range=[1:1,2:1) symbol=Fr+6 localKey="G minor"
}`);
    expect(chordIdentityToneSpellings(reference.chords[0].identity).map(formatPitchClass))
      .toEqual(["E♭", "G", "A", "C♯"]);
  });
});
