import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference, buildHarmonyAnalysis, inferHarmony, inferPhrases } from "../index";
import { isCurrentPhraseBoundary } from "./fingerprint";
import type { PhraseAnalysisInput } from "./types";

const score = `satb 1
key G minor
meter 3/4
bars 1..4 {
  S: | D5/4 C5/4 Bb4/4 | Bb4/2 A4/4 | D5/4 C5/4 D5/4 | G5/2. |
  A: | G4/4 F#4/4 G4/4 | D4/2 D4/4 | D4/4 F#4/2 | Bb4/2. |
  T: | Bb3/4 A3/4 Bb3/4 | Bb3/2 F#3/4 | G3/4 A3/2 | G4/2. |
  B: | G2/4 Eb3/4 D3/4 | G2/2 D3/8 C3/8 | Bb2/4 Eb3/4 D3/4 | G2/2. |
}`;

function apply(text: string) {
  const { project } = compileScoreText(text);
  return applyHarmonyInference(project, inferHarmony(project), {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
}

describe("phrase reprise after a decorated dominant", () => {
  const boundary = 5760;

  it("separates the repeated opening after a complete V and its weak seventh", () => {
    const project = apply(score);
    expect(project.structure.phraseBoundaries.map(mark => mark.tick)).toEqual([boundary]);
    expect(inferPhrases(project).template.boundaries[0]?.evidence).toContainEqual(expect.objectContaining({
      code: "soprano-opening-reprise",
    }));
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "half", form: "authentic", fromTick: 4800, toTick: boundary,
    }));
  });

  it.each([
    ["a different melodic opening", [["| D5/4 C5/4 D5/4 |", "| Bb4/4 C5/4 D5/4 |"]]],
    ["a breath in just one part", [["Bb4/2 A4/4", "Bb4/2 A4/8 r/8"]]],
    ["a renewed dominant", [
      ["| D4/4 F#4/2 |", "| F#4/4 F#4/2 |"], ["| G3/4 A3/2 |", "| A3/4 A3/2 |"],
      ["| Bb2/4 Eb3/4 D3/4 |", "| D3/4 Eb3/4 D3/4 |"],
    ]],
    ["a seventh on a whole written beat", [
      ["Bb4/2 A4/4", "Bb4/4 A4/2"], ["D4/2 D4/4", "D4/4 D4/2"],
      ["Bb3/2 F#3/4", "Bb3/4 F#3/2"], ["G2/2 D3/8 C3/8", "G2/4 D3/4 C3/4"],
    ]],
  ] as const)("does not use the reprise evidence for %s", (_name, changes) => {
    let text = score;
    for (const [before, after] of changes) {
      expect(text).toContain(before);
      text = text.replace(before, after);
    }
    const project = apply(text);
    expect(inferPhrases(project).template.boundaries.flatMap(mark => mark.evidence).map(e => e.code))
      .not.toContain("soprano-opening-reprise");
  });

  it("keeps the manually supplied division", () => {
    const { project } = compileScoreText(score);
    project.structure.phraseBoundaries = [{ tick: 2880, id: "confirmed", confidence: "certain", source: "manual" }];
    const applied = applyHarmonyInference(project, inferHarmony(project), {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
    expect(applied.structure.phraseBoundaries.map(mark => [mark.tick, mark.source])).toEqual([[2880, "manual"]]);
  });
});

const pickupScore = `satb 1
key G minor
meter 1/4
at 2:1 meter 3/4
bars 1..5 {
  S: | D5/8 C5/8 | D5/4 C5/4 Bb4/4 | Bb4/4 A4/4 D5/8 C5/8 | D5/4 C5/4 D5/4 | G5/2. |
  A: | A4/4 | G4/4 F#4/4 G4/4 | D4/4 F#4/4 A4/4 | D4/4 F#4/2 | Bb4/2. |
  T: | D4/4 | Bb3/4 A3/4 Bb3/4 | Bb3/4 D4/4 D4/4 | G3/4 A3/2 | G4/2. |
  B: | F#3/4 | G2/4 Eb3/4 D3/4 | G2/4 D3/4 F#3/4 | Bb2/4 Eb3/4 D3/4 | G2/2. |
}`;

function hasReprise(project: PhraseAnalysisInput) {
  return inferPhrases(project).template.boundaries.some(mark =>
    mark.evidence.some(item => item.code === "soprano-opening-reprise"));
}

describe("tonal and structural evidence around the reprise", () => {
  const boundary = 5760;

  it.each([5280, 5760, 6240])("invalidates a stored reprise on a real key change at %i", tick => {
    const project = apply(score);
    expect(hasReprise(project)).toBe(true);
    const saved = project.structure.phraseBoundaries[0];
    project.keyEvents.push({ id: "new-key", tick, tonic: { step: "B", alter: -1 }, mode: "major" });
    expect(hasReprise(project)).toBe(false);
    expect(isCurrentPhraseBoundary(project, saved)).toBe(false);
    expect(buildHarmonyAnalysis(project).phraseSegments.some(phrase => phrase.toTick === boundary)).toBe(false);
  });

  it("accepts an equivalent restatement of the same written key", () => {
    const project = apply(score);
    const saved = project.structure.phraseBoundaries[0];
    project.keyEvents.push({ ...project.keyEvents[0], id: "same-key", tick: boundary });
    expect(isCurrentPhraseBoundary(project, saved)).toBe(true);
    expect(hasReprise(project)).toBe(true);
  });

  it.each([5280, 5760, 6720])("rejects an explicit different local reading at %i", tick => {
    const project = apply(score);
    expect(hasReprise(project)).toBe(true);
    const chord = project.chordTrack.regions.find(item => item.startTick <= tick && tick < item.startTick + item.durationTicks)!;
    const reading = chord.semantics!.interpretations[0];
    chord.semantics = {
      ...chord.semantics!,
      interpretations: [{ ...reading, source: "manual", confidence: "certain",
        localKey: { tonic: { step: "B", alter: -1 }, mode: "major" } }],
    };
    expect(hasReprise(project)).toBe(false);
  });

  it("honors a confirmed second interpretation with a conflicting local key", () => {
    const project = apply(score);
    const chord = project.chordTrack.regions.find(item => item.startTick === boundary)!;
    const reading = chord.semantics!.interpretations[0];
    chord.semantics = { ...chord.semantics!, interpretations: [
      reading, { ...reading, id: "alternate-pivot-key", source: "confirmed", confidence: "certain",
        localKey: { tonic: { step: "B", alter: -1 }, mode: "major" } },
    ] };
    expect(hasReprise(project)).toBe(false);
  });

  it("rejects the same pitch classes and rhythm in a different octave", () => {
    const project = apply(score);
    const soprano = project.satbTracks.find(track => track.id === "soprano")!;
    for (const note of soprano.notes.filter(note => note.startTick >= boundary && note.startTick < boundary + 2 * project.ppq)) {
      note.pitch.octave += 1;
    }
    expect(hasReprise(project)).toBe(false);
  });

  it("supports the timing-only phrase interface and declines missing written pitches", () => {
    const project = apply(score);
    expect(hasReprise({ ...project, satbTracks: project.satbTracks.map(({ id, notes }) => ({
      id, notes: notes.map(({ pitch: _pitch, ...note }) => note),
    })) })).toBe(false);
  });

  it("accepts a genuine pickup reprise and rejects only repeating the downbeat material", () => {
    expect(hasReprise(apply(pickupScore))).toBe(true);
    const alteredPickup = apply(pickupScore.replace("S: | D5/8 C5/8", "S: | A5/8 C5/8"));
    expect(hasReprise(alteredPickup)).toBe(false);
    expect(buildHarmonyAnalysis(alteredPickup).cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "full", form: "authentic", toTick: alteredPickup.lengthTicks,
    }));
  });

  it.each(["manual", "accepted-candidate"] as const)(
    "keeps a crossing full cadence with source %s even when the notes reprise the pickup", source => {
      const project = apply(pickupScore);
      expect(hasReprise(project)).toBe(true);
      const tick = 6720;
      const mark = project.structure.phraseBoundaries.find(item => item.tick === tick)!;
      expect(mark).toBeDefined();
      project.chordTrack.cadenceAnnotations = [{
        id: "full", kind: "full", form: "authentic", fromTick: tick - 2 * project.ppq, toTick: tick + project.ppq,
        phraseId: "phrase-0-" + project.lengthTicks, locked: false, source, confidence: "certain",
      }];
      expect(hasReprise(project)).toBe(false);
      expect(isCurrentPhraseBoundary(project, mark)).toBe(false);
      project.chordTrack.cadenceAnnotations[0].stale = true;
      expect(hasReprise(project)).toBe(true);
    },
  );
});
