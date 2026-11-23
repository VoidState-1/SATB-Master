import { describe, expect, it } from "vitest";
import { primaryHarmonyInterpretation } from "../../../chordModel";
import { formatSpelledPitch, pitchClassEquals, toMidi, writtenInterval } from "../../../pitch";
import { getSatbTrack, PPQ, validateProject, VOICE_CONFIG, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { autoHarmonize, applyAutoHarmonization, checkHarmony } from "../../index";
import { buildMelodyGrid } from "../melodyGrid";
import { buildVocabulary } from "../vocabulary";
import type { HarmonizationGivenVoice, HarmonizationSolution, HarmonizationStyle } from "../types";

function exercise(key: string, givenVoice: HarmonizationGivenVoice, bars: string): ProjectDocument {
  const measures = bars.split("|").length - 2;
  return compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..${measures} {
S: ${givenVoice === "soprano" ? bars : "empty"}
A: empty
T: empty
B: ${givenVoice === "bass" ? bars : "empty"}
}
`).project;
}

const eightBars = "| E4/4 G4/4 A4/4 G4/4 | F4/2 E4/2 | E4/4 F4/4 G4/2 | G4/2 C5/4 B4/4 | C5/4 G4/4 A4/4 G4/4 | F4/2 E4/2 | F4/2 C5/4 B4/4 | C5/1 |";

function assertClean(solution: HarmonizationSolution) {
  expect(solution).toBeDefined();
  expect(validateProject(solution.project)).toBe(true);
  expect(checkHarmony(solution.project).diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  expect(solution.diagnosticSummary.errorCount).toBe(0);
  for (const track of solution.project.satbTracks) {
    expect(track.notes.length).toBeGreaterThan(0);
    expect(track.notes.every(note => {
      const midi = toMidi(note.pitch);
      const { min, max } = VOICE_CONFIG[track.voice];
      return midi >= min && midi <= max;
    })).toBe(true);
  }
}

describe("automatic harmonization", () => {
  it.each([
    ["C major", "soprano", "| E4/4 G4/4 F4/4 B4/4 | C5/1 |"],
    ["A minor", "soprano", "| C5/4 A4/4 B4/4 G#4/4 | A4/1 |"],
    ["C major", "bass", "| C3/4 E3/4 F3/4 G2/4 | C3/1 |"],
    ["A minor", "bass", "| A2/4 C3/4 D3/4 E2/4 | A2/1 |"],
  ] as const)("harmonizes %s with a given %s", (key, givenVoice, bars) => {
    const source = exercise(key, givenVoice, bars);
    const snapshot = structuredClone(source);
    const result = autoHarmonize(source);
    expect(result.givenVoice).toBe(givenVoice);
    expect(result.style).toBe("textbook-standard");
    expect(result.solutions.length).toBeGreaterThan(0);
    expect(result.solutions.length).toBeLessThanOrEqual(3);
    const solution = result.solutions[0];
    assertClean(solution);
    expect(getSatbTrack(solution.project, givenVoice).notes).toEqual(getSatbTrack(source, givenVoice).notes);
    expect(source).toEqual(snapshot);
    if (key === "A minor") {
      expect(solution.project.satbTracks.flatMap(track => track.notes).some(note =>
        note.pitch.step === "G" && note.pitch.alter === 1)).toBe(true);
    }
  });

  it("plans two phrases and realizes a half cadence and a K46–V7–I perfect authentic cadence", () => {
    const source = exercise("C major", "soprano", eightBars);
    const result = autoHarmonize(source, { maxSolutions: 5 });
    const solution = result.solutions[0];
    assertClean(solution);
    expect(solution.phraseBoundaries.map(boundary => boundary.tick)).toEqual([16 * PPQ]);
    expect(solution.cadences.map(({ kind, form, completion }) => [kind, form, completion])).toEqual([
      ["half", "authentic", undefined], ["full", "authentic", "perfect"],
    ]);
    const ending = solution.chords.slice(-3);
    expect(ending[0].semantics?.cadenceRole).toBe("cadential64");
    expect(ending[1].identity.structure).toMatchObject({ quality: "dominant7" });
    expect(ending[2].identity.root).toEqual({ step: "C", alter: 0 });
    // Guard against algorithmic blow-up even under heavy parallel Vitest CPU load.
    expect(result.elapsedMs).toBeLessThan(1500);
  });

  it("preserves manual phrase boundaries and uses them instead of the regular plan", () => {
    const source = exercise("C major", "soprano", eightBars);
    source.structure.phraseBoundaries = [
      { id: "manual", tick: 12 * PPQ, source: "manual", confidence: "certain" },
    ];
    const grid = buildMelodyGrid(source, {});
    expect(grid.phraseBoundaries).toEqual(source.structure.phraseBoundaries);
    expect(grid.slices.some(slice => slice.cadence?.zone === "medial-cadence")).toBe(true);
    expect(autoHarmonize(source, { maxSolutions: 1 }).solutions[0].phraseBoundaries)
      .toEqual(source.structure.phraseBoundaries);
  });

  it("respects locked notes and regions when enabled and freely replaces them when disabled", () => {
    const source = exercise("C major", "soprano", "| F4/4 E4/4 B4/4 C5/4 | C5/1 |");
    const subdominant = buildVocabulary(source.keyEvents[0], "classic-basic")
      .find(chord => chord.degree === 4 && chord.inversion === 0)!;
    const chord = { id: "chord-anchor", startTick: 0, durationTicks: PPQ, identity: subdominant.identity,
      semantics: subdominant.semantics, locked: true };
    const note = { ...getSatbTrack(source, "soprano").notes[0], id: "note-anchor",
      pitch: { step: "C" as const, alter: 0 as const, octave: 4 }, locked: true };
    source.chordTrack.regions = [chord];
    getSatbTrack(source, "alto").notes = [note];

    const strict = autoHarmonize(source, { respectLockedConstraints: true }).solutions[0];
    const free = autoHarmonize(source, { respectLockedConstraints: false }).solutions[0];
    expect(strict.chords[0]).toEqual(chord);
    expect(getSatbTrack(strict.project, "alto").notes[0]).toEqual(note);
    expect(free.chords.some(item => item.id === chord.id)).toBe(false);
    expect(getSatbTrack(free.project, "alto").notes.some(item => item.id === note.id)).toBe(false);

    const preserved = applyAutoHarmonization(source, free);
    const replaced = applyAutoHarmonization(source, free, { respectLockedConstraints: false });
    expect(preserved.chordTrack.regions[0]).toEqual(chord);
    expect(getSatbTrack(preserved, "alto").notes[0]).toEqual(note);
    expect(replaced.chordTrack.regions.some(item => item.id === chord.id)).toBe(false);
    expect(getSatbTrack(replaced, "alto").notes.some(item => item.id === note.id)).toBe(false);
    expect(validateProject(preserved) && validateProject(replaced)).toBe(true);
  });

  it("generates a half-open selection and preserves the portions of existing notes outside it", () => {
    const source = exercise("C major", "soprano", "| E4/4 G4/4 B4/4 C5/4 | C5/1 |");
    const note = { ...getSatbTrack(source, "soprano").notes[0], id: "original-alto",
      startTick: 0, durationTicks: 8 * PPQ };
    getSatbTrack(source, "alto").notes = [note];
    const range = { fromTick: PPQ, toTick: 4 * PPQ };
    const { solutions, range: actualRange } = autoHarmonize(source, range);
    expect(actualRange).toEqual(range);
    const solution = solutions[0];
    expect(solution.chords.every(chord => chord.startTick >= range.fromTick &&
      chord.startTick + chord.durationTicks <= range.toTick)).toBe(true);
    const applied = applyAutoHarmonization(source, solution, { writeChords: false, writePhrasesAndCadences: false });
    const alto = getSatbTrack(applied, "alto").notes;
    expect(alto[0]).toEqual({ ...note, durationTicks: PPQ });
    expect(alto.at(-1)).toMatchObject({ startTick: 4 * PPQ, durationTicks: 4 * PPQ, pitch: note.pitch });
    expect(applied.chordTrack).toEqual(source.chordTrack);
    expect(applied.structure).toEqual(source.structure);
    expect(validateProject(applied)).toBe(true);
  });

  it.each([
    ["passing", "| C4/8 D4/8 E4/4 G4/4 C5/4 |"],
    ["neighbor", "| E4/8 F4/8 E4/4 G4/4 C5/4 |"],
  ])("carries the same chord through a weak %s subdivision when requested", (role, bars) => {
    const source = exercise("C major", "soprano", bars);
    const withoutOrnaments = buildMelodyGrid(source, {});
    expect(withoutOrnaments.slices.every(slice => !slice.ornament)).toBe(true);
    const selected = autoHarmonize(source, { allowPassingAndNeighborMelodies: true }).solutions[0];
    assertClean(selected);
    expect(getSatbTrack(selected.project, "soprano").notes[1].nonChordToneRole).toBe(role);
    expect(selected.chords[0]).toMatchObject({ startTick: 0 });
    expect(selected.chords[0].durationTicks).toBeGreaterThan(PPQ);
    expect(getSatbTrack(applyAutoHarmonization(source, selected), "soprano").notes[1].nonChordToneRole).toBe(role);
  });

  it.each([
    ["soprano", "| E4/4 D4/4 F#4/4 G4/4 | E4/1 |"],
    ["bass", "| C3/4 E3/4 F#3/4 G3/4 | C3/1 |"],
  ] as const)("harmonizes an explicit secondary leading tone in the %s", (voice, bars) => {
    const source = exercise("C major", voice, bars);
    for (const style of ["textbook-standard", "expressive-secondary"] as const) {
      const { solutions } = autoHarmonize(source, { style });
      const solution = solutions[0];
      assertClean(solution);
      const secondary = solution.chords.find(chord => chord.startTick <= 2 * PPQ &&
        chord.startTick + chord.durationTicks > 2 * PPQ);
      const applied = secondary?.semantics && primaryHarmonyInterpretation(secondary.semantics).appliedTarget;
      expect(applied?.degree).toBe(5);
      expect(secondary?.identity.structure).toMatchObject({ quality: expect.stringMatching(/^(major|dominant7|diminished7)$/) });
      const arrival = solution.chords.find(chord => chord.startTick === 3 * PPQ);
      expect(arrival?.identity.root).toEqual({ step: "G", alter: 0 });
      const given = getSatbTrack(solution.project, voice).notes;
      expect(given).toEqual(getSatbTrack(source, voice).notes);
      expect(writtenInterval(given[2].pitch, given[3].pitch)).toMatchObject({ diatonicSteps: 1, semitones: 1 });
      for (const rule of ["function.applied-dominant-target", "function.double-dominant-target",
        "chord.doubled-altered-tendency-tone"]) {
        expect(checkHarmony(solution.project).diagnostics.some(diagnostic => diagnostic.ruleId === rule)).toBe(false);
      }
    }
  });

  it("resolves a secondary dominant through K46 before completing the cadence", () => {
    const source = exercise("C major", "bass", "| C3/4 F#3/4 G3/4 G3/4 | C3/1 |");
    const solution = autoHarmonize(source).solutions[0];
    assertClean(solution);
    const [secondary, cadential, dominant] = solution.chords.filter(chord =>
      chord.startTick >= PPQ && chord.startTick < 4 * PPQ);
    expect(primaryHarmonyInterpretation(secondary.semantics!).appliedTarget?.degree).toBe(5);
    expect(cadential.semantics?.cadenceRole).toBe("cadential64");
    expect(dominant.identity.root).toEqual({ step: "G", alter: 0 });
    expect(solution.diagnosticSummary.diagnostics.filter(item =>
      item.ruleId === "function.applied-dominant-target" || item.ruleId === "function.double-dominant-target")).toEqual([]);
  });

  it("does not end a selection on an unresolved applied chord", () => {
    const source = exercise("C major", "soprano", "| C4/4 E4/4 F#4/4 G4/4 |");
    const solution = autoHarmonize(source, { toTick: 3 * PPQ }).solutions[0];
    expect(solution.relaxedLevel).toBe(2);
    expect(validateProject(solution.project)).toBe(true);
    const last = solution.chords.at(-1);
    expect(last?.startTick).toBe(2 * PPQ);
    expect(last?.semantics && primaryHarmonyInterpretation(last.semantics).appliedTarget).toBeUndefined();
    expect(getSatbTrack(solution.project, "soprano").notes).toEqual(getSatbTrack(source, "soprano").notes);
  });

  it("offers a root-position deceptive progression when the fixed bass lands on scale degree six", () => {
    const source = exercise("C major", "bass", "| C3/2 F3/4 G3/4 | A3/1 |");
    const result = autoHarmonize(source, { style: "expressive-secondary" });
    const solution = result.solutions.find(candidate => candidate.label === "阻碍进行" ||
      candidate.description.includes("由属和弦转入六级"));
    expect(solution).toBeDefined();
    assertClean(solution!);
    expect(solution!.chords.at(-1)?.identity.root).toEqual({ step: "A", alter: 0 });
    const approach = solution!.chords.find(chord => chord.startTick === 3 * PPQ);
    expect(approach?.identity.root).toEqual({ step: "G", alter: 0 });
  });

  it.each([
    ["soprano", "passing", "| C4/4 D4/4 E4/2 | F4/2 B4/2 | C5/1 |"],
    ["soprano", "neighbor", "| E4/4 F4/4 E4/2 | F4/2 B4/2 | C5/1 |"],
    ["bass", "passing", "| C3/4 D3/4 E3/2 | F3/2 G2/2 | C3/1 |"],
    ["bass", "neighbor", "| C3/4 D3/4 C3/2 | F3/2 G2/2 | C3/1 |"],
  ] as const)("keeps the other three parts stationary through a weak-beat %s %s", (voice, role, bars) => {
    const source = exercise("C major", voice, bars);
    expect(buildMelodyGrid(source, { allowPassingAndNeighborMelodies: true }).slices[1].ornament).toBe(role);
    const solution = autoHarmonize(source, { allowPassingAndNeighborMelodies: true }).solutions[0];
    assertClean(solution);
    for (const rule of ["nonchord.passing-tone", "nonchord.neighbor-tone", "chord.inversion-bass",
      "voice-leading.parallel-fifths", "voice-leading.parallel-octaves"]) {
      expect(solution.diagnosticSummary.diagnostics.some(diagnostic => diagnostic.ruleId === rule)).toBe(false);
    }
    const given = getSatbTrack(solution.project, voice).notes;
    expect(given[1]).toEqual({ ...getSatbTrack(source, voice).notes[1], nonChordToneRole: role });
    expect(solution.chords.find(chord => chord.startTick === 0)?.durationTicks).toBeGreaterThanOrEqual(2 * PPQ);
    for (const track of solution.project.satbTracks) {
      if (track.id === voice) continue;
      expect(track.notes[0].durationTicks).toBeGreaterThanOrEqual(2 * PPQ);
    }
    expect(getSatbTrack(applyAutoHarmonization(source, solution), voice).notes).toEqual(given);
  });

  it("uses three distinct harmonic palettes on the same given melody", () => {
    const source = exercise("C major", "soprano", eightBars);
    const styles: HarmonizationStyle[] = ["classic-basic", "textbook-standard", "expressive-secondary"];
    const [classic, textbook, expressive] = styles.map(style => autoHarmonize(source, { style }).solutions);
    for (const solutions of [classic, textbook, expressive]) {
      expect(solutions).toHaveLength(3);
      for (const solution of solutions) {
        assertClean(solution);
        expect(solution.label).toMatch(/[\u4e00-\u9fff]/u);
        expect(solution.description).toMatch(/[\u4e00-\u9fff]/u);
      }
    }
    const classicalChords = buildVocabulary(source.keyEvents[0], "classic-basic");
    const isClassical = (region: HarmonizationSolution["chords"][number]) =>
      classicalChords.some(chord => pitchClassEquals(chord.identity.root, region.identity.root) &&
        pitchClassEquals(chord.identity.bass, region.identity.bass) &&
        JSON.stringify(chord.identity.structure) === JSON.stringify(region.identity.structure) &&
        chord.role === region.semantics?.cadenceRole);
    expect(classic[0].chords.every(isClassical)).toBe(true);
    expect(textbook.some(solution => solution.chords.some(chord => !isClassical(chord)))).toBe(true);
    const containsApplied = (solution: HarmonizationSolution) => solution.chords.some(chord =>
      chord.semantics && primaryHarmonyInterpretation(chord.semantics).appliedTarget);
    expect(textbook.some(containsApplied)).toBe(false);
    expect(expressive.some(containsApplied)).toBe(true);
    const progressions = expressive.map(solution => solution.chords.map(chord => [chord.startTick, chord.identity, chord.semantics?.cadenceRole]));
    expect(new Set(progressions.map(progression => JSON.stringify(progression))).size).toBe(3);
  });

  it.each([
    ["C major", [2, 4, 5, 6]],
    ["A minor", [3, 4, 5, 6]],
  ] as const)("includes the required secondary and leading-tone sevenths in %s", (key, targets) => {
    const { keyEvents: [event] } = exercise(key, "soprano", "| E4/1 |");
    const vocabulary = buildVocabulary(event, "expressive-secondary");
    for (const target of targets) {
      const dominants = vocabulary.filter(chord => chord.targetDegree === target && chord.degree === 5);
      expect(dominants.map(chord => chord.inversion)).toEqual([0, 1, 2, 0, 1, 2, 3]);
    }
    const diminishedSevenths = vocabulary.filter(chord => chord.identity.structure.kind === "tertian" &&
      chord.identity.structure.quality === "diminished7");
    expect(diminishedSevenths.some(chord => chord.degree === 7 && !chord.applied)).toBe(true);
    if (event.mode === "major") expect(diminishedSevenths.some(chord => chord.targetDegree === 5)).toBe(true);
  });

  it("handles extreme fixed pitches and leaps with a valid level-two solution and actual diagnostics", () => {
    const source = exercise("C major", "bass", "| C2/2 C5/2 |");
    const high = getSatbTrack(source, "bass").notes[1];
    const locked = { ...high, id: "locked-tenor", pitch: { step: "C" as const, alter: 0 as const, octave: 3 }, locked: true };
    getSatbTrack(source, "tenor").notes = [locked];
    const solution = autoHarmonize(source, { maxSolutions: 1 }).solutions[0];
    expect(solution.relaxedLevel).toBe(2);
    expect(validateProject(solution.project)).toBe(true);
    expect(getSatbTrack(solution.project, "bass").notes.map(note => formatSpelledPitch(note.pitch))).toEqual(["C2", "C5"]);
    expect(getSatbTrack(solution.project, "tenor").notes.at(-1)).toEqual(locked);
    expect(solution.diagnosticSummary.errorCount).toBeGreaterThan(0);
    expect(solution.warnings.length).toBeGreaterThan(0);
  });

  it("returns an empty result for a selection without given notes", () => {
    const source = exercise("C major", "soprano", "| r/2 C5/2 |");
    const result = autoHarmonize(source, { fromTick: 0, toTick: PPQ });
    expect(result.solutions).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
