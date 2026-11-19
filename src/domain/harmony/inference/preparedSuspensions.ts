import { primaryHarmonyInterpretation } from "../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass } from "../../pitch";
import { verifyPreparedSuspensionVoicing, type PreparationSupport } from "../preparedSuspensionVoicing";
import { fitPreparedSuspension } from "./candidates";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];

function sameKey(left: ChordInferenceObservation, right: ChordInferenceObservation) {
  return left.key.id === right.key.id && left.key.mode === right.key.mode &&
    pitchClassEquals(left.key.tonic, right.key.tonic);
}

function isExact(candidate: ChordInferenceCandidate) {
  return candidate.fit.bassMatchesInversion && candidate.fit.spellingConsistent &&
    !candidate.fit.omittedChordDegrees.length && !candidate.fit.nonChordToneNoteIds.length;
}

function dominantPreparation(sets: CandidateSet, observation: ChordInferenceObservation): PreparationSupport {
  const exact = sets.filter(isExact);
  if (!exact.length) return "surface";
  const dominant = scaleDegreePitchClass(observation.key, 5);
  return exact.some(candidate =>
    candidate.functionalBaseId === "D" && candidate.semantics &&
    !primaryHarmonyInterpretation(candidate.semantics).appliedTarget &&
    pitchClassEquals(candidate.identity.root, dominant),
  ) ? "confirmed" : "blocked";
}

/** Spasobin §36.2–4, §37.1–2. Restore a root-position tonic obscured by a
 * prepared 4–3, optionally accompanied by a prepared 9–8 in another voice. */
export function withPreparedSuspensions(
  observations: readonly ChordInferenceObservation[],
  sets: readonly CandidateSet[],
  options: ChordInferenceOptions,
  ppq: number,
  phraseBoundaryTicks: readonly number[],
) {
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) return sets;
  const slices = observations.map(({ fromTick, toTick, activeNotes }) => ({ fromTick, toTick, notes: activeNotes }));
  const metrics = new Map(observations.map(({ fromTick, metric }) => [fromTick, metric]));
  return sets.map((existing, index) => {
    const middle = observations[index];
    const bass = middle.bass;
    if (existing.length || !bass) return existing;

    const voicing = verifyPreparedSuspensionVoicing({
      slices, onsetIndex: index, key: middle.key, beatTicks: ppq,
      metricAt: tick => metrics.get(tick),
      preparationAt: previousIndex => {
        const previous = observations[previousIndex];
        if (!sameKey(previous, middle) ||
            phraseBoundaryTicks.some(tick => previous.fromTick < tick && tick <= middle.fromTick)) return "blocked";
        return dominantPreparation(sets[previousIndex], previous);
      },
    });
    if (!voicing ||
        phraseBoundaryTicks.some(tick => voicing.fromTick < tick && tick <= voicing.toTick) ||
        observations.slice(index + 1, voicing.resolutionIndex + 1).some(part => !sameKey(middle, part))) return existing;

    const resolution = observations[voicing.resolutionIndex];
    if (voicing.motions.some(({ voiceId }) =>
      middle.activeNotes[voiceId]?.nonChordToneRole || resolution.activeNotes[voiceId]?.nonChordToneRole,
    )) return existing;

    const tonic = sets[voicing.resolutionIndex].find(candidate =>
      isExact(candidate) && (candidate.functionalBaseId === "T" || candidate.functionalBaseId === "t") &&
      pitchClassEquals(candidate.identity.root, bass.pitch) && pitchClassEquals(candidate.identity.bass, bass.pitch),
    );
    if (!tonic) return existing;
    const candidate = fitPreparedSuspension(tonic, middle, voicing.motions);
    return candidate ? [candidate] : existing;
  });
}
