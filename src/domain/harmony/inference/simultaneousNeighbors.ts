import { chordIdentityEquals, chordIdentityInversion, primaryHarmonyInterpretation } from "../../chordModel";
import { pitchClassEquals, toMidi } from "../../pitch";
import { supportsPairedNeighborMotion, writtenNeighborsOverHeldBass } from "../writtenNeighbors";
import { fitSimultaneousNeighbors } from "./candidates";
import { observationNotes, writtenFrame } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];
type Observation = ChordInferenceObservation;

function literal(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && candidate.fit.omittedChordDegrees.length === 0 &&
    candidate.fit.nonChordToneNoteIds.length === 0;
}

function supportedAnchor(candidate: ChordInferenceCandidate) {
  const { identity, functionalBaseId, semantics } = candidate;
  if (!semantics || primaryHarmonyInterpretation(semantics).appliedTarget || identity.structure.kind !== "tertian" || identity.structure.extensions.length ||
      identity.structure.alterations.length || !literal(candidate)) return false;
  if (functionalBaseId === "D") return chordIdentityInversion(identity) === 0 &&
    (identity.structure.quality === "major" || identity.structure.quality === "dominant7");
  return (functionalBaseId === "K46" || functionalBaseId === "T" || functionalBaseId === "t") &&
    chordIdentityInversion(identity) === 2;
}

function orderedVoicing(observation: Observation) {
  const pitches = observationNotes(observation).map(({ note }) => toMidi(note.pitch));
  return pitches.every((pitch, i) => i === 0 || pitches[i - 1] > pitch);
}

function supportsPairedMotion(left: Observation, middle: Observation, ids: readonly string[]) {
  const [higher, lower] = observationNotes(middle).filter(({ note }) => ids.includes(note.id));
  if (!higher || !lower) return false;
  const previousHigher = left.activeNotes[higher.voiceId], previousLower = left.activeNotes[lower.voiceId];
  if (!previousHigher || !previousLower) return false;
  return supportsPairedNeighborMotion(previousLower.pitch, previousHigher.pitch, lower.note.pitch, higher.note.pitch);
}

/** Spasobin §§40.1, 40.4–5: two upper neighbors may decorate one held
 * harmony. A six-four still needs independent cadential confirmation. */
export function simultaneousNeighborCandidates(
  observations: readonly Observation[],
  sets: readonly CandidateSet[],
  options: ChordInferenceOptions,
  ppq: number,
  boundaries: readonly number[],
): readonly CandidateSet[] {
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) return [];
  return sets.map((existing, index) => {
    if (existing.length || index === 0 || index + 1 === observations.length) return [];
    const [left, middle, right] = observations.slice(index - 1, index + 2);
    if (middle.metric?.confidence !== "certain" || middle.metric.level >= 2 ||
        middle.toTick - middle.fromTick > ppq ||
        left.toTick !== middle.fromTick || middle.toTick !== right.fromTick ||
        boundaries.some(tick => left.fromTick < tick && tick <= right.fromTick) ||
        ![left, middle, right].every(item => item.completeSatb && orderedVoicing(item) &&
          item.key.id === left.key.id && item.key.mode === left.key.mode &&
          pitchClassEquals(item.key.tonic, left.key.tonic))) return [];

    return sets[index - 1].flatMap(anchor => {
      if (!supportedAnchor(anchor) || !sets[index + 1].some(next => literal(next) &&
          next.functionalBaseId === anchor.functionalBaseId &&
          JSON.stringify(next.semantics) === JSON.stringify(anchor.semantics) &&
          chordIdentityEquals(next.identity, anchor.identity))) return [];
      const notes = writtenNeighborsOverHeldBass(anchor.identity, writtenFrame(left), writtenFrame(middle), writtenFrame(right));
      if (notes?.length !== 2 || !supportsPairedMotion(left, middle, notes)) return [];
      const candidate = fitSimultaneousNeighbors(anchor, middle, notes);
      return candidate ? [candidate] : [];
    });
  });
}
