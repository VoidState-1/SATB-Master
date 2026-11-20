import { describe, expect, it } from "vitest";
import { applyChordEditorAction } from "./chordEditorModel";
import { chordDraftFromIdentity, chordIdentityToneSpellingForDegree, resolveChordIdentity } from "./chordModel";
import { updateChordRegion } from "./editing";
import { formatPitchClass } from "./pitch";
import { validateProject } from "./project";
import { compileScoreText } from "./scoreText";
import { chordDraft } from "./scoreText/chords";

const fixture = (symbol: string) => compileScoreText(`satb 1
key C minor
meter 2/4
bars 1..1 {
 S: | A4/2 |
 A: | F4/2 |
 T: | B3/2 |
 B: | G2/2 |
 H: | ${symbol}/2 |
}`).project;

describe("Saved dominant ninths in the chord editor", () => {
  it.each([
    ["D9", undefined, "A"],
    ["V9", { degree: 9, alter: -1, tendency: "down" } as const, "A♭"],
    ["D9/V", { degree: 9, alter: 1, tendency: "up" } as const, "E♯"],
  ])("round trips %s when reselecting its form or function", (symbol, change, ninth) => {
    const project = fixture(symbol);
    const chord = project.chordTrack.regions[0];
    const key = project.keyEvents[0];
    const original = chordDraftFromIdentity(chord.identity, chord.semantics!);
    const configured = change ? { ...original, alterations: [change] } : original;
    const saved = updateChordRegion(project, chord.id, { draft: configured }).project;
    const loaded = JSON.parse(JSON.stringify(saved));
    expect(validateProject(loaded)).toBe(true);
    const reloaded = loaded.chordTrack.regions[0];
    const draft = chordDraftFromIdentity(reloaded.identity, reloaded.semantics!);
    expect(formatPitchClass(chordIdentityToneSpellingForDegree(reloaded.identity, 9)!)).toBe(ninth);
    for (const action of [
      { type: "select-functional-definition", id: "D" },
      { type: "select-functional-form", form: "ninth" },
    ] as const) {
      const next = applyChordEditorAction(draft, key, action);
      const written = updateChordRegion(loaded, reloaded.id, { draft: next });
      expect(written.error).toBeUndefined();
      expect(written.project.chordTrack.regions[0]).toEqual(reloaded);
    }
  });

  it("keeps legacy text and newly selected forms on the existing bare extension semantics", () => {
    for (const mode of ["major", "minor"] as const) {
      const key = { ...fixture("D9").keyEvents[0], mode };
      for (const [symbol, ninth] of [["D9", "A"], ["V9", "A"], ["D9/V", "E"]] as const) {
        const identity = resolveChordIdentity(chordDraft(symbol, mode), key);
        expect(formatPitchClass(chordIdentityToneSpellingForDegree(identity, 9)!)).toBe(ninth);
      }
      const next = applyChordEditorAction(chordDraft("D7", mode), key, {
        type: "select-functional-form", form: "ninth",
      });
      expect(resolveChordIdentity(next, key)).toEqual(resolveChordIdentity(chordDraft("D9", mode), key));
    }
  });
});
