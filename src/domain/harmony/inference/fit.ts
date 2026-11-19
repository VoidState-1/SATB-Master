import {
  chordVoicingPolicy,
  chordIdentityToneSpellingForDegree,
  chordIdentityToneSpellings,
  type ChordIdentity,
  type ChordToneDegree,
} from "../../chordModel";
import {
  normalizePitchClassNumber,
  pitchClassEquals,
  pitchClassValue,
  stepIndex,
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
  /** 在不放宽其他构成音的前提下，允许指定音级省略。 */
  readonly allowedOmittedChordDegrees?: readonly ChordToneDegree[];
  readonly allowNonChordToneCandidates?: boolean;
}

/** 第一阶段只把一个缺失和弦音视为可接受的不完整织体。 */
const MAX_INFERRED_OMISSIONS = 1;

/** Recognize a literal competing chord even when the local functional
 * catalogue does not offer a candidate with this root and quality. */
export function hasCompleteWrittenTertianChord(observation: ChordInferenceObservation) {
  const pitches = observation.soundingPitchClasses;
  if ((pitches.length !== 3 && pitches.length !== 4) || observationNotes(observation).some(
    ({ note }) => !pitches.some(pitch => pitchClassEquals(pitch, note.pitch)),
  )) return false;
  return pitches.some(root => {
    let current = root;
    for (let degree = 1; degree < pitches.length; degree++) {
      const nextStep = (stepIndex(current.step) + 2) % 7;
      const next = pitches.find(pitch => stepIndex(pitch.step) === nextStep);
      if (!next) return false;
      const third = normalizePitchClassNumber(pitchClassValue(next) - pitchClassValue(current));
      if (third !== 3 && third !== 4) return false;
      current = next;
    }
    return true;
  });
}

function chordDegrees(identity: ChordIdentity): readonly ChordToneDegree[] {
  if (identity.structure.kind !== "tertian") return [];
  return chordVoicingPolicy(identity).requiredDegrees;
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

/**
 * 四声部中“根音三次 + 三音一次”的根位主和弦省五音写法。
 * 这是一个明确的教学型配置，不要求前一个观察区间已经被识别为 D。
 */
export function isCanonicalTonicFifthOmission(
  observation: ChordInferenceObservation,
  identity: ChordIdentity,
) {
  if (
    !observation.completeSatb ||
    identity.structure.kind !== "tertian" ||
    (identity.structure.quality !== "major" &&
      identity.structure.quality !== "minor") ||
    identity.structure.extensions.length > 0 ||
    identity.structure.alterations.length > 0
  )
    return false;

  const root = chordIdentityToneSpellingForDegree(identity, 1);
  const third = chordIdentityToneSpellingForDegree(identity, 3);
  const fifth = chordIdentityToneSpellingForDegree(identity, 5);
  const notes = observationNotes(observation);
  if (!root || !third || !fifth || notes.length !== 4) return false;
  if (!observation.bass || !sameSoundingPitch(observation.bass.pitch, root))
    return false;

  const rootCount = notes.filter(({ note }) =>
    sameSoundingPitch(note.pitch, root),
  ).length;
  const thirdCount = notes.filter(({ note }) =>
    sameSoundingPitch(note.pitch, third),
  ).length;
  const fifthCount = notes.filter(({ note }) =>
    sameSoundingPitch(note.pitch, fifth),
  ).length;
  const onlyRootAndThird = notes.every(({ note }) =>
    sameSoundingPitch(note.pitch, root) || sameSoundingPitch(note.pitch, third),
  );

  return rootCount === 3 && thirdCount === 1 && fifthCount === 0 && onlyRootAndThird;
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
    identity.structure.kind === "augmented-sixth" &&
    tones.some((tone) =>
      !notes.some(({ note }) => matchingToneIndex([tone], note.pitch)),
    )
  )
    // These variants require their complete pitch structure, including the
    // augmented sixth; tertian degree-omission policies do not apply.
    hardRejected = "missing-augmented-sixth-tone";
  else if (
    nonChordToneNoteIds.length > 0 &&
    !declaredExtra &&
    !options.allowNonChordToneCandidates
  )
    hardRejected = "unexplained-extra-tone";
  else if (omittedChordDegrees.length > MAX_INFERRED_OMISSIONS)
    hardRejected = "too-many-omitted-chord-tones";
  else if (
    omittedChordDegrees.length > 0 &&
    !options.allowIncompleteVoicing &&
    !omittedChordDegrees.every((degree) =>
      options.allowedOmittedChordDegrees?.includes(degree),
    )
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
