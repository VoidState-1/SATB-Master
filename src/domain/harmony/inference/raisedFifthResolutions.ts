import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { keyEquals } from "../../pitch";
import { resolvesRaisedFifthToDoubledThird } from "../raisedFifthResolution";
import { candidateComparator, createFunctionalCandidate } from "./candidates";
import { writtenFrame } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, FunctionalChordTemplate } from "./types";

const raisedDominant: FunctionalChordTemplate = {
  baseId: "D",
  definition: functionalDefinition("D"),
  form: "seventh",
  localKeyPolicy: "current-key",
  expectedInversion: 0,
  alterations: [{ degree: 5, alter: 1, tendency: "up" }],
};
const rootTonic: FunctionalChordTemplate = {
  baseId: "T",
  definition: functionalDefinition("T"),
  form: "triad",
  localKeyPolicy: "current-key",
  expectedInversion: 0,
};

function withResolutionEvidence(set: readonly ChordInferenceCandidate[], candidate: ChordInferenceCandidate) {
  return [...set.filter(existing => existing.id !== candidate.id), {
    ...candidate,
    evidence: [...candidate.evidence, { kind: "sequence-context" as const, code: "raised-fifth-to-doubled-third" }],
  }].sort(candidateComparator);
}

/** Spasobin §46.4 proves the altered dominant and its incomplete tonic together. */
export function withRaisedFifthResolutions(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  manualPhraseTicks: readonly number[],
  meetsMinimumConfidence: (candidate: ChordInferenceCandidate) => boolean,
) {
  const result = sets.slice();
  for (let index = 0; index + 1 < observations.length; index++) {
    const source = observations[index], landing = observations[index + 1];
    if (source.key.mode !== "major" || !keyEquals(source.key, landing.key) ||
        manualPhraseTicks.some(tick => source.fromTick < tick && tick <= landing.fromTick) ||
        !resolvesRaisedFifthToDoubledThird(writtenFrame(source), writtenFrame(landing), source.key.tonic)) continue;

    const dominant = createFunctionalCandidate(source, raisedDominant, {});
    const tonic = createFunctionalCandidate(landing, rootTonic, { allowedOmittedChordDegrees: [5] });
    if (!dominant || !tonic || !meetsMinimumConfidence(dominant) || !meetsMinimumConfidence(tonic)) continue;
    result[index] = withResolutionEvidence(result[index], dominant);
    result[index + 1] = withResolutionEvidence(result[index + 1], tonic);
  }
  return result;
}
