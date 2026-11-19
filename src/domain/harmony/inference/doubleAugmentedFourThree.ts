import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { pitchClassEquals } from "../../pitch";
import { resolvesDoubleAugmentedFourThree } from "../doubleAugmentedFourThree";
import { candidateComparator, createFunctionalCandidate } from "./candidates";
import type { ChordInferenceCandidate, ChordInferenceObservation, FunctionalChordTemplate } from "./types";

const doubleAugmentedFourThree: FunctionalChordTemplate = {
  baseId: "DD++43",
  definition: functionalDefinition("DD++43"),
  form: "triad",
  localKeyPolicy: "current-key",
  expectedInversion: 0,
};

export function withDoubleAugmentedFourThree(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  manualPhraseTicks: readonly number[],
  meetsMinimumConfidence: (candidate: ChordInferenceCandidate) => boolean,
) {
  return sets.map((existing, index) => {
    const before = observations[index];
    const after = observations[index + 1];
    if (!after || before.toTick !== after.fromTick || before.key.id !== after.key.id ||
        before.key.mode !== after.key.mode || !pitchClassEquals(before.key.tonic, after.key.tonic) ||
        manualPhraseTicks.some(tick => before.fromTick < tick && tick <= after.fromTick) ||
        !resolvesDoubleAugmentedFourThree(before.activeNotes, after.activeNotes, before.key)) return existing;

    const candidate = createFunctionalCandidate(before, doubleAugmentedFourThree, {});
    if (!candidate?.fit.spellingConsistent || !meetsMinimumConfidence(candidate)) return existing;
    return [...existing.filter(item => item.functionalBaseId !== "Ger+6"), candidate].sort(candidateComparator);
  });
}
