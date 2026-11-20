import { describe, expect, it } from "vitest";
import { toMidi } from "../../../pitch";
import { validateProject, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";
import type { RuleExceptionPolicy } from "../types";

const rule = "melody.augmented-interval";
const structural = rule + ".structural-spelling";
const strict = { "same-harmony": "strict", arpeggiation: "strict" } as const;
const defaultExempt = { "same-harmony": "exempt" } as const;
const sequence = `satb 1
key C major
meter 4/4
bars 1..1 {
  S: | G4/4 F#4/4 F4/4 E4/4 |
  A: | C#4/4 C4/4 B3/4 C4/4 |
  T: | E3/4 D3/2 E3/4 |
  B: | A2/4 D3/4 G2/4 C3/4 |
}`;

function check(project: ProjectDocument, beat: number, voice: string, policy?: RuleExceptionPolicy) {
  expect(validateProject(project)).toBe(true);
  return checkHarmony(project, undefined, {}, policy && { [rule]: policy }).diagnostics
    .filter(d => d.ruleId === rule && d.tick === beat * project.ppq && d.voiceIds.some(id => id === voice));
}

function score(text = sequence) {
  return compileScoreText(text).project;
}

function withAnnotations(text: string, explicit: boolean, conflict = false) {
  const labels = conflict ? "T/1" : "V7/II/4 V7/V/4 D7/4 T/4";
  const project = score(text.replace("}", " H: | " + labels + " |\n}"));
  for (const chord of project.chordTrack.regions) {
    chord.locked = explicit;
    for (const interpretation of chord.semantics!.interpretations) {
      interpretation.source = explicit ? "manual" : "inferred";
    }
  }
  return project;
}

describe("Written third becoming the next dominant seventh", () => {
  it("accepts a written fifth omitted from either root-position seventh", () => {
    const input = score();
    expect(check(input, 1, "alto", strict)).toEqual([]);
    expect(check(input, 2, "soprano", strict)).toEqual([]);
    const explicit = withAnnotations(sequence, true);
    expect(check(explicit, 1, "alto", strict)).toEqual([]);
    expect(check(explicit, 2, "soprano", strict)).toEqual([]);
  });

  it("uses sound for the inspected part and attaches the correction only to its actual link", () => {
    const respelt = sequence.replace("F4/4 E4/4", "E#4/4 E4/4");
    const bad = score(respelt);
    const clean = score();
    expect(bad.satbTracks[0].notes.map(note => toMidi(note.pitch)))
      .toEqual(clean.satbTracks[0].notes.map(note => toMidi(note.pitch)));
    const wrongOverOneInferredRegion = withAnnotations(respelt, false, true);
    for (const project of [bad, wrongOverOneInferredRegion, withAnnotations(respelt, true)]) {
      expect(check(project, 1, "alto")).toEqual([]);
      expect(check(project, 2, "soprano", defaultExempt)).toMatchObject([{
        messageKey: structural, message: expect.stringContaining("F"),
        voiceIds: ["soprano"], noteIds: ["note-S-1920", "note-S-960"],
        evidence: [
          { kind: "note", label: "前一音" }, { kind: "note", label: "当前音" },
          { kind: "note", label: "另一声部的原七音" }, { kind: "note", label: "同次进行解决到新三音" },
        ],
      }]);
      expect(check(project, 2, "alto").every(d => d.messageKey !== structural)).toBe(true);
    }
    const explicitConflict = withAnnotations(respelt, true, true);
    expect(check(explicitConflict, 2, "soprano").every(d => d.messageKey !== structural)).toBe(true);
  });

  it("reports the misspelling when the preceding reattack is inside a separately marked D7", () => {
    const original = sequence.replace("F#4/4 F4/4", "F#4/8 F#4/8 F4/4");
    const bad = original.replace("F#4/8 F4/4", "E##4/8 E#4/4");
    for (const policy of [undefined, defaultExempt]) {
      expect(check(withAnnotations(original, true), 2, "soprano", policy)).toEqual([]);
      expect(check(withAnnotations(bad, true), 2, "soprano", policy)).toMatchObject([{
        messageKey: structural, noteIds: ["note-S-1440", "note-S-1920"],
        message: expect.stringMatching(/F♯.*F/),
      }]);
    }
  });

  it("keeps a later unrelated chromatic diagnostic even while a preceding link is proved", () => {
    const later = score(sequence.replace("F4/4 E4/4", "F4/4 Fb4/4"));
    expect(check(later, 2, "soprano")).toEqual([]);
    expect(check(later, 3, "soprano")).toMatchObject([{
      noteIds: ["note-S-1920", "note-S-2880"], messageKey: rule + ".增",
    }]);
  });

  it.each([
    ["peer resolves in another voice", sequence.replace("C4/4 B3/4", "C4/4 D4/4")
      .replace("D3/2 E3/4", "D3/4 B3/4 E3/4"), 2],
    ["inspected voice enters one subdivision after the peer has resolved",
      sequence.replace("F#4/4 F4/4", "F#4/4. F4/8"), 2.5],
    ["only the independent pitch sounds in the wrong octave",
      sequence.replace("C4/4 B3/4", "C4/4 B2/4"), 2],
  ] as const)("leaves the written augmented unison diagnosable when %s", (_label, material, beat) => {
    expect(check(score(material), beat, "soprano", strict)).toMatchObject([{ messageKey: rule + ".增" }]);
  });

  it("respects contradictory absolute labels and a locked chord track", () => {
    const respelt = sequence.replace("F4/4 E4/4", "E#4/4 E4/4");
    const absolute = withAnnotations(respelt, false, true);
    absolute.chordTrack.regions[0].semantics = undefined;
    const lockedTrack = withAnnotations(respelt, false, true);
    lockedTrack.chordTrack.locked = true;
    for (const project of [absolute, lockedTrack]) {
      expect(check(project, 2, "soprano").every(d => d.messageKey !== structural)).toBe(true);
    }
  });

  it("does not use another part's marked ornament to establish an essential chord member", () => {
    const input = score();
    const tenor = input.satbTracks.find(track => track.voice === "tenor")!;
    tenor.notes.find(note => note.startTick === input.ppq)!.nonChordToneRole = "other";
    expect(check(input, 2, "soprano", strict)).toMatchObject([{ messageKey: rule + ".增" }]);
  });

  it("does not move evidence across an explicit phrase boundary", () => {
    const input = score();
    input.structure.phraseBoundaries.push({ id: "boundary", tick: input.ppq * 2, source: "manual", confidence: "certain" });
    expect(check(input, 2, "soprano", strict)).toMatchObject([{ messageKey: rule + ".增" }]);
  });
});
