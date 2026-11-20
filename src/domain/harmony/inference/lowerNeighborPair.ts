import { chordIdentityEquals, chordIdentityToneSpellings } from "../../chordModel";
import { pitchClassEquals, pitchClassValue } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { writtenLowerNeighborPair, type LowerNeighborFrame } from "../writtenLowerNeighborPair";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];

function exact(candidate: ChordInferenceCandidate) {
  const { fit } = candidate;
  return fit.spellingConsistent && !fit.nonChordToneNoteIds.length && !fit.omittedChordDegrees.length;
}

function frame(observation: ChordInferenceObservation): LowerNeighborFrame {
  return {
    tick: observation.fromTick, endTick: observation.toTick, notes: observation.activeNotes,
    completeSatb: observation.completeSatb, key: observation.key, metric: observation.metric,
  };
}

export function withWrittenLowerNeighborPairs(
  observations: readonly ChordInferenceObservation[], sets: readonly CandidateSet[],
  options: ChordInferenceOptions, boundaries: readonly number[],
) {
  const withheldStarts = new Set<number>();
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) {
    return { candidateSets: sets, withheldStarts };
  }
  const candidateSets = sets.map((existing, index) => {
    if (index < 3 || index + 1 >= sets.length || existing.length !== 1) return existing;
    const [rival] = existing;
    const { identity, fit } = rival;
    if (fit.spellingConsistent || fit.omittedChordDegrees.length || fit.nonChordToneNoteIds.length ||
        identity.structure.kind !== "tertian" || identity.structure.quality !== "minor7" ||
        identity.structure.extensions.length || identity.structure.alterations.length) return existing;
    const [preparation, departure, upper, lower, arrival] = observations.slice(index - 3, index + 2);
    const [dominants, departures, , , arrivals] = sets.slice(index - 3, index + 2).map(set => set.filter(exact));
    if (dominants.length !== 1 || departures.length !== 1 || arrivals.length !== 1) return existing;
    const [dominant] = dominants, [anchor] = departures, [returning] = arrivals;
    if (dominant.functionalBaseId !== "DD" || anchor.functionalBaseId !== "DDVII" ||
        returning.functionalBaseId !== anchor.functionalBaseId ||
        !chordIdentityEquals(anchor.identity, returning.identity) ||
        JSON.stringify(anchor.semantics) !== JSON.stringify(returning.semantics)) return existing;
    const noteIds = writtenLowerNeighborPair(dominant.identity, anchor.identity,
      [frame(preparation), frame(departure), frame(upper), frame(lower), frame(arrival)], boundaries);
    if (!noteIds) return existing;
    const tones = chordIdentityToneSpellings(identity);
    if (!pitchClassEquals(identity.bass, lower.activeNotes.bass!.pitch) ||
        !VOICE_ORDER.every(voice => {
          const note = lower.activeNotes[voice]!;
          const matching = tones.find(tone => pitchClassValue(tone) === pitchClassValue(note.pitch));
          return matching && pitchClassEquals(matching, note.pitch) !== noteIds.includes(note.id);
        })) return existing;
    // Withdraw only the unsupported respelling and retain its own region boundary.
    withheldStarts.add(lower.fromTick);
    return [];
  });
  return { candidateSets, withheldStarts };
}
