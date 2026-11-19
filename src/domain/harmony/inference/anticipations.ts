import { chordIdentityToneSpellingForDegree } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval } from "../../pitch";
import { compareMetricStrength } from "../../rhythm/metric";
import { candidateComparator, fitAnticipation } from "./candidates";
import { hasCompleteWrittenTertianChord } from "./fit";
import { observationNotes } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

function sameKey(left: ChordInferenceObservation, right: ChordInferenceObservation) {
  return left.key.id === right.key.id && left.key.mode === right.key.mode &&
    pitchClassEquals(left.key.tonic, right.key.tonic);
}

function exactFit(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && candidate.fit.bassMatchesInversion &&
    !candidate.fit.omittedChordDegrees.length && !candidate.fit.nonChordToneNoteIds.length;
}

function anchorFit(candidate: ChordInferenceCandidate) {
  return candidate.semantics && candidate.identity.structure.kind === "tertian" &&
    !candidate.identity.structure.extensions.length && exactFit(candidate);
}

/** Spasobin §42.1, 3–5: one voice steps early to the next chord; two
 * may move in parallel thirds/sixths or in contrary motion. */
function anticipatedNotes(
  before: ChordInferenceObservation,
  middle: ChordInferenceObservation,
  after: ChordInferenceObservation,
) {
  const moving = [];
  for (const { voiceId, note } of observationNotes(middle)) {
    const previous = before.activeNotes[voiceId]!;
    const next = after.activeNotes[voiceId]!;
    const entry = writtenInterval(previous.pitch, note.pitch);
    if (!entry.diatonicSteps && !entry.semitones) continue;
    if (!isWrittenStep(entry) || Math.sign(entry.semitones) !== entry.diatonicSteps ||
        note.startTick !== middle.fromTick || next.startTick !== after.fromTick ||
        !spelledPitchEquals(next.pitch, note.pitch) ||
        (note.nonChordToneRole && note.nonChordToneRole !== "anticipation")) return;
    moving.push({ note, previous, next, entry });
  }
  if (!moving.length || moving.length > 2) return;
  if (moving.length === 2) {
    const [upper, lower] = moving;
    const intervalClass = Math.abs(writtenInterval(lower.note.pitch, upper.note.pitch).diatonicSteps) % 7;
    if (upper.entry.diatonicSteps === lower.entry.diatonicSteps && intervalClass !== 2 && intervalClass !== 5) return;
  }
  return moving;
}

function hasAddedSixthReading(
  anchor: ChordInferenceCandidate,
  middle: ChordInferenceObservation,
  motion: NonNullable<ReturnType<typeof anticipatedNotes>>[number],
) {
  const { identity } = anchor;
  if (!middle.bass || !pitchClassEquals(middle.bass.pitch, identity.root)) return false;
  const seventh = chordIdentityToneSpellingForDegree(identity, 7);
  if (!seventh || !pitchClassEquals(motion.previous.pitch, seventh)) return false;
  const sixth = scaleDegreePitchClass({ tonic: identity.root, mode: "major" }, 6);
  // A fully voiced triad with an added sixth is a viable reading of this
  // slice, even when there is no template for it in the current key.
  return middle.soundingPitchClasses.length === 4 && pitchClassEquals(motion.note.pitch, sixth);
}

/** Carry the previous chord through a brief anticipation when both written
 * anchors support it and the intervening slice has no exact reading. */
export function withAnticipations(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  ppq: number,
  phraseBoundaryTicks: readonly number[],
) {
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) return sets;
  return sets.map((existing, index) => {
    const before = observations[index - 1];
    const middle = observations[index];
    const after = observations[index + 1];
    if (!before?.completeSatb || !middle.completeSatb || !after?.completeSatb ||
        existing.some(exactFit) || !sameKey(before, middle) || !sameKey(middle, after) ||
        phraseBoundaryTicks.some(tick => before.fromTick < tick && tick <= after.fromTick) ||
        compareMetricStrength(middle.metric, before.metric) !== "weaker" ||
        compareMetricStrength(middle.metric, after.metric) !== "weaker") return existing;

    const duration = middle.toTick - middle.fromTick;
    if (duration > ppq / 2 || duration > before.toTick - before.fromTick ||
        duration > after.toTick - after.fromTick) return existing;
    const moving = anticipatedNotes(before, middle, after);
    if (!moving || !sets[index + 1].some(candidate => anchorFit(candidate) &&
      moving.every(({ next }) => candidate.fit.chordToneNoteIds.includes(next.id)))) return existing;

    const noteIds = moving.map(({ note }) => note.id);
    const contextual = sets[index - 1].flatMap(anchor => {
      if (!anchorFit(anchor) || (moving.length === 1 && hasAddedSixthReading(anchor, middle, moving[0]))) return [];
      const candidate = fitAnticipation(anchor, middle, noteIds);
      return candidate ? [candidate] : [];
    });
    // A complete written chord can compete even when the key's functional
    // templates offer no candidate. In that case leave the existing decision
    // in place instead of automatically turning its notes into anticipations.
    if (!contextual.length || hasCompleteWrittenTertianChord(middle)) return existing;
    return [...existing, ...contextual].sort(candidateComparator);
  });
}
