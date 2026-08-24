import {
  chordIdentityToneSpellingForDegree,
  chordIdentityToneSpellings,
  isSeventhStructure,
  type ChordIdentity,
  type ChordToneDegree,
} from "../../chordModel";
import {
  pitchClassEquals,
  pitchClassValue,
  type SpelledPitchClass,
} from "../../pitch";
import type { NonChordToneRole } from "../../project";
import { observationNotes } from "./observations";
import type {
  ChordFitAssessment,
  ChordInferenceObservation,
} from "./types";

export interface ChordFitOptions {
  readonly allowIncompleteVoicing?: boolean;
  readonly allowNonChordToneCandidates?: boolean;
}

function chordDegrees(identity: ChordIdentity): readonly ChordToneDegree[] {
  if (identity.structure.kind !== "tertian") return [];
  const degrees: ChordToneDegree[] = [1, 3, 5];
  if (isSeventhStructure(identity.structure)) degrees.push(7);
  for (const extension of identity.structure.extensions) {
    if (extension !== 6 && !degrees.includes(extension as ChordToneDegree))
      degrees.push(extension as ChordToneDegree);
  }
  return degrees;
}

function sameSoundingPitch(left: SpelledPitchClass, right: SpelledPitchClass) {
  return pitchClassValue(left) === pitchClassValue(right);
}

function matchingToneIndex(
  tones: readonly ReturnType<typeof chordIdentityToneSpellings>[number][],
  pitch: SpelledPitchClass,
) {
  const exact = tones.findIndex((tone) => pitchClassEquals(tone, pitch));
  if (exact >= 0) return { index: exact, exact: true };
  const sounding = tones.findIndex((tone) => sameSoundingPitch(tone, pitch));
  return sounding >= 0 ? { index: sounding, exact: false } : undefined;
}

function distinctMatchedToneCount(
  tones: readonly ReturnType<typeof chordIdentityToneSpellings>[number][],
  notes: ReturnType<typeof observationNotes>,
) {
  const matched = new Set<number>();
  for (const { note } of notes) {
    const match = matchingToneIndex(tones, note.pitch);
    if (match) matched.add(pitchClassValue(tones[match.index]));
  }
  return matched.size;
}

function uniqueExtraPitchClasses(
  notes: ReturnType<typeof observationNotes>,
  tones: readonly ReturnType<typeof chordIdentityToneSpellings>[number][],
) {
  const seen = new Set<number>();
  const extras = notes.flatMap(({ note }) => {
    if (matchingToneIndex(tones, note.pitch)) return [];
    const value = pitchClassValue(note.pitch);
    if (seen.has(value)) return [];
    seen.add(value);
    return [{ step: note.pitch.step, alter: note.pitch.alter }];
  });
  return Object.freeze(extras);
}

function assignmentsFor(
  notes: ReturnType<typeof observationNotes>,
  nonChordToneNoteIds: readonly string[],
) {
  const selected = new Set(nonChordToneNoteIds);
  return Object.freeze(
    Object.fromEntries(
      notes.flatMap(({ note }) => {
        const role = note.nonChordToneRole as NonChordToneRole | undefined;
        return role && selected.has(note.id) ? [[note.id, role]] : [];
      }),
    ) as Record<string, NonChordToneRole>,
  );
}

export function fitChordObservation(
  observation: ChordInferenceObservation,
  identity: ChordIdentity,
  options: ChordFitOptions = {},
): ChordFitAssessment {
  const notes = observationNotes(observation);
  const tones = chordIdentityToneSpellings(identity);
  const chordToneNoteIds: string[] = [];
  const nonChordToneNoteIds: string[] = [];
  const spellingMatches: string[] = [];

  for (const { note } of notes) {
    const match = matchingToneIndex(tones, note.pitch);
    if (!match) {
      nonChordToneNoteIds.push(note.id);
    } else {
      chordToneNoteIds.push(note.id);
      if (match.exact) spellingMatches.push(note.id);
    }
  }

  const omittedChordDegrees = chordDegrees(identity).filter((degree) => {
    const tone = chordIdentityToneSpellingForDegree(identity, degree);
    return tone && !notes.some(({ note }) => matchingToneIndex([tone], note.pitch));
  });
  const bassMatchesInversion =
    !observation.bass ||
    sameSoundingPitch(observation.bass.pitch, identity.bass);
  const spellingConsistent =
    chordToneNoteIds.length === 0 || spellingMatches.length === chordToneNoteIds.length;
  const declaredExtra = nonChordToneNoteIds.every((id) =>
    notes.some(({ note }) => note.id === id && note.nonChordToneRole),
  );
  let hardRejected: string | undefined;
  if (notes.length === 0) hardRejected = "no-active-notes";
  else if (!bassMatchesInversion) hardRejected = "bass-mismatch";
  else if (
    nonChordToneNoteIds.length > 0 &&
    !declaredExtra &&
    !options.allowNonChordToneCandidates
  )
    hardRejected = "unexplained-extra-tone";
  else if (
    omittedChordDegrees.length > 0 &&
    !options.allowIncompleteVoicing
  )
    hardRejected = "omitted-chord-tone";

  return {
    matchedNoteIds: Object.freeze(notes.map(({ note }) => note.id)),
    chordToneNoteIds: Object.freeze(chordToneNoteIds),
    nonChordToneNoteIds: Object.freeze(nonChordToneNoteIds),
    nonChordToneAssignments: assignmentsFor(notes, nonChordToneNoteIds),
    omittedChordDegrees: Object.freeze(omittedChordDegrees),
    extraPitchClasses: uniqueExtraPitchClasses(notes, tones),
    bassMatchesInversion,
    spellingConsistent,
    ...(hardRejected ? { hardRejected } : {}),
  };
}

export function fitRatio(
  observation: ChordInferenceObservation,
  identity: ChordIdentity,
  fit: ChordFitAssessment,
) {
  const tones = chordIdentityToneSpellings(identity);
  const matched = distinctMatchedToneCount(tones, observationNotes(observation));
  return tones.length === 0 ? 0 : matched / tones.length;
}
