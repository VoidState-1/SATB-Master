import { chordToneSpellings, primaryHarmonyInterpretation, type ChordIdentity } from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import {
  isWrittenStep, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass,
  spelledPitchEquals, toMidi, writtenInterval, type SpelledPitchClass,
} from "../../pitch";
import { createFunctionalCandidate } from "./candidates";
import { fitChordObservation } from "./fit";
import { identityForFunctionalTemplate } from "./functionalTemplates";
import type { LocalKeyContext } from "./localKeys";
import { observationNotes } from "./observations";
import type {
  ChordFitAssessment, ChordInferenceCandidate, ChordInferenceEvidence,
  ChordInferenceObservation, ChordInferenceOptions, FunctionalChordTemplate,
} from "./types";

const appliedDegrees = [2, 3, 4, 6, 7] as const;

function exactFit(fit: ChordFitAssessment) {
  return fit.spellingConsistent && fit.bassMatchesInversion && !fit.hardRejected &&
    fit.omittedChordDegrees.length === 0 && fit.nonChordToneNoteIds.length === 0;
}

function soundingBass(observation: ChordInferenceObservation) {
  const bass = observation.bass;
  if (observation.completeSatb && bass && observationNotes(observation).every(
    ({ note }) => toMidi(note.pitch) >= toMidi(bass.pitch) && !note.nonChordToneRole,
  )) return bass.pitch;
}

function resolvesTone(
  source: ChordInferenceObservation,
  target: ChordInferenceObservation,
  from: SpelledPitchClass,
  to: SpelledPitchClass,
  direction: -1 | 0 | 1,
) {
  return observationNotes(source).some(({ voiceId, note }) => {
    const next = target.activeNotes[voiceId];
    if (!next || !pitchClassEquals(note.pitch, from) || !pitchClassEquals(next.pitch, to)) return false;
    if (direction === 0) return spelledPitchEquals(note.pitch, next.pitch);
    if (next.startTick !== target.fromTick) return false;
    const interval = writtenInterval(note.pitch, next.pitch);
    return interval.diatonicSteps === direction &&
      (direction === 1 ? interval.semitones === 1 : isWrittenStep(interval));
  });
}

function destinationEvidence(
  observations: readonly ChordInferenceObservation[],
  source: ChordInferenceObservation,
  pivot: ChordInferenceObservation,
  context: LocalKeyContext,
  phraseBoundaries: readonly number[],
  targetDegree: number,
): ChordInferenceEvidence | undefined {
  const { key, dominantIndex, tonicIndex } = context;
  const dominant = observations[dominantIndex], tonic = observations[tonicIndex];
  if (!dominant || !tonic || dominantIndex <= pivot.index ||
      dominant.toTick !== tonic.fromTick || dominant.key.id !== source.key.id ||
      tonic.key.id !== source.key.id || !soundingBass(dominant) || !soundingBass(tonic) ||
      phraseBoundaries.some(tick => source.fromTick < tick && tick < tonic.toTick) ||
      !resolvesTone(dominant, tonic, leadingTonePitchClass(key), key.tonic, 1)) return;

  return {
    kind: "sequence-context",
    code: "dominant-to-neapolitan-pivot",
    noteIds: [...new Set([dominant, tonic].flatMap(item => observationNotes(item).map(({ note }) => note.id)))],
    details: {
      target: targetDegree, pivotTick: pivot.fromTick, destinationDominantTick: dominant.fromTick,
      destinationTonicTick: tonic.fromTick, destinationTonicEndTick: tonic.toTick,
    },
  };
}

/** Spasobin §§53.4 and 15.2: a written D43–T or D2–T6 tonicizes the triad
 * that is subsequently heard as flat II in the same phrase's closing key. */
export function withNeapolitanPivotDominants(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  localKeys: ReadonlyMap<number, LocalKeyContext>,
  phraseBoundaries: readonly number[],
): readonly (readonly ChordInferenceCandidate[])[] {
  return sets.map((existing, i) => {
    if (existing.length) return existing;
    const source = observations[i], pivot = observations[i + 1];
    if (!pivot || source.toTick !== pivot.fromTick || source.key.id !== pivot.key.id ||
        pivot.metric?.role !== "downbeat" || source.soundingPitchClasses.length !== 4) return existing;
    const bass = soundingBass(source), pivotBass = soundingBass(pivot);
    const destination = localKeys.get(pivot.index);
    if (!bass || !pivotBass || !destination || pitchClassEquals(source.key.tonic, destination.key.tonic)) return existing;

    const root = scaleDegreePitchClass(destination.key, 2, -1);
    const localTarget = appliedDegrees.find(degree => pitchClassEquals(scaleDegreePitchClass(source.key, degree), root));
    if (!localTarget) return existing;
    const triad = chordToneSpellings(root, "major");
    const tonicization = { tonic: root, mode: "major" } as const;
    const dominant = scaleDegreePitchClass(tonicization, 5);
    const tones = chordToneSpellings(dominant, "dominant7");
    const inversion = ([2, 3] as const).find(index => pitchClassEquals(bass, tones[index]));
    if (inversion === undefined || !pitchClassEquals(pivotBass, triad[inversion === 2 ? 0 : 1])) return existing;

    const pivotIdentity: ChordIdentity = {
      root,
      bass: { step: pivotBass.step, alter: pivotBass.alter },
      structure: { kind: "tertian", quality: "major", extensions: [], alterations: [] },
    };
    if (!exactFit(fitChordObservation(pivot, pivotIdentity)) ||
        !resolvesTone(source, pivot, tones[0], triad[2], 0) ||
        !resolvesTone(source, pivot, tones[1], triad[0], 1) ||
        !resolvesTone(source, pivot, tones[2], triad[0], -1) ||
        !resolvesTone(source, pivot, tones[3], triad[1], -1)) return existing;
    const evidence = destinationEvidence(observations, source, pivot, destination, phraseBoundaries, localTarget);
    if (!evidence) return existing;

    const template: FunctionalChordTemplate = {
      baseId: "D", definition: functionalDefinition("D"), form: "seventh",
      expectedInversion: inversion, localKeyPolicy: "current-key",
    };
    const candidate = createFunctionalCandidate(source, { ...template, appliedTarget: localTarget }, options);
    if (!candidate?.semantics || candidate.confidence !== "high" || !exactFit(candidate.fit)) return existing;

    // Keep the brief tonicization as a possible reading of this chord only.
    // The applied reading remains primary, with no new local-key span.
    const tonicized = identityForFunctionalTemplate(template, { ...source.key, ...tonicization }, tonicization);
    const alternative = primaryHarmonyInterpretation(tonicized.semantics);
    return [{
      ...candidate,
      semantics: { ...candidate.semantics, alternatives: [{ ...alternative, confidence: "ambiguous" }] },
      evidence: [...candidate.evidence, evidence],
    }];
  });
}
