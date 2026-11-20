import { primaryHarmonyInterpretation } from "../../chordModel";
import { keyDeclarationEquals, pitchClassEquals, scaleDegreePitchClass } from "../../pitch";
import { verifyPreparedSuspensionVoicing, type PreparationSupport } from "../preparedSuspensionVoicing";
import { fitPreparedSuspension } from "./candidates";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];

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
 * prepared 4–3, or extend the actual resolution triad across a single 9–8. */
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
      preparationAt: (previousIndex, singleNinth) => {
        const previous = observations[previousIndex];
        if (!keyDeclarationEquals(previous.key, middle.key) ||
            phraseBoundaryTicks.some(tick => previous.fromTick < tick && tick <= middle.fromTick)) return "blocked";
        if (singleNinth) return sets[previousIndex].some(isExact) &&
          !Object.values(previous.activeNotes).some(note => note?.nonChordToneRole) ? "confirmed" : "blocked";
        return dominantPreparation(sets[previousIndex], previous);
      },
    });
    if (!voicing ||
        phraseBoundaryTicks.some(tick => voicing.fromTick < tick && tick <= voicing.toTick) ||
        observations.slice(index + 1, voicing.resolutionIndex + 1).some(part =>
          !keyDeclarationEquals(part.key, middle.key))) return existing;

    const resolution = observations[voicing.resolutionIndex];
    const markedVoice = [middle, resolution].some(part => voicing.singleNinth
      ? Object.values(part.activeNotes).some(note => note?.nonChordToneRole)
      : voicing.motions.some(({ voiceId }) => part.activeNotes[voiceId]?.nonChordToneRole));
    if (markedVoice) return existing;
    const exactRootPosition = sets[voicing.resolutionIndex].filter(candidate =>
      isExact(candidate) && pitchClassEquals(candidate.identity.root, bass.pitch) &&
      pitchClassEquals(candidate.identity.bass, bass.pitch),
    );
    if (!voicing.singleNinth) {
      const tonic = exactRootPosition.find(candidate => candidate.functionalBaseId === "T" || candidate.functionalBaseId === "t");
      const fitted = tonic && fitPreparedSuspension(tonic, middle, voicing.motions);
      return fitted ? [fitted] : existing;
    }
    const anchors = exactRootPosition.filter(({ identity: { structure } }) =>
      structure.kind === "tertian" && (structure.quality === "major" || structure.quality === "minor") &&
      !structure.extensions.length && !structure.alterations.length,
    );
    return anchors.flatMap(anchor => {
      const candidate = fitPreparedSuspension(anchor, middle, voicing.motions);
      return candidate ? [candidate] : [];
    });
  });
}
