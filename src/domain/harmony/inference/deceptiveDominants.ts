import { chordToneSpellings, type KeyReference } from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { keyDeclarationEquals, keyEquals, pitchClassEquals } from "../../pitch";
import { diatonicMinorTarget, hasExactWrittenStack, proveLocalMinorDeceptiveDominant } from "../localDeceptiveDominant";
import { createFunctionalCandidate } from "./candidates";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

const rootDominantSeventh = {
  baseId: "D",
  definition: functionalDefinition("D"),
  form: "seventh",
  expectedInversion: 0,
  localKeyPolicy: "current-key",
} as const;

function hasNearbyMinorTonic(
  observations: readonly ChordInferenceObservation[], arrivalIndex: number, key: KeyReference,
  ppq: number, crossesPhrase: (from: number, to: number) => boolean,
) {
  const arrival = observations[arrivalIndex];
  const tones = chordToneSpellings(key.tonic, "minor");
  for (let i = arrivalIndex + 1; i < observations.length; i++) {
    const item = observations[i];
    const previous = observations[i - 1];
    if (!item.completeSatb || previous.toTick !== item.fromTick || item.key.id !== arrival.key.id ||
        crossesPhrase(previous.fromTick, item.fromTick) || item.fromTick - arrival.fromTick > 2 * ppq) break;
    // A tonic stack may begin the hypothesized local key. A different inferred key ends the search.
    if (item.localKey && !keyEquals(item.localKey, key)) break;
    const bass = item.bass?.pitch;
    if (bass && (item.activeNotes.bass?.startTick === item.fromTick) &&
        (pitchClassEquals(bass, tones[0]) || pitchClassEquals(bass, tones[2])) &&
        hasExactWrittenStack(item, tones)) return true;
  }
  return false;
}

/** Recover an otherwise missing source when a local minor target is independently supported. */
export function withDeceptiveDominants(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions, ppq: number, phraseBoundaryTicks: readonly number[],
) {
  const crossesPhrase = (from: number, through: number) =>
    phraseBoundaryTicks.some(tick => from < tick && tick <= through);
  return sets.map((existing, i) => {
    if (existing.length) return existing;
    const source = observations[i], arrival = observations[i + 1];
    if (!arrival || !keyDeclarationEquals(source.key, arrival.key) ||
        arrival.metric?.role !== "downbeat" || crossesPhrase(source.fromTick, arrival.fromTick)) return existing;

    const proof = proveLocalMinorDeceptiveDominant(source, arrival);
    if (!proof) return existing;
    const { key } = proof;
    const appliedTarget = diatonicMinorTarget(source.key, key.tonic);
    if (!appliedTarget && !hasNearbyMinorTonic(observations, i + 1, key, ppq, crossesPhrase)) return existing;

    const candidate = appliedTarget
      ? createFunctionalCandidate(source, { ...rootDominantSeventh, appliedTarget }, options)
      : createFunctionalCandidate({ ...source, key: { ...source.key, ...key }, localKey: key }, rootDominantSeventh, options);
    if (!candidate || candidate.confidence !== "high") return existing;
    // This source-only reading supplies neither cadence nor key-span evidence.
    return [{ ...candidate, evidence: [
      ...candidate.evidence.filter(evidence => appliedTarget || evidence.code !== "local-key-cadence"),
      { kind: "sequence-context" as const, code: "local-deceptive-dominant-resolution",
        details: { targetStep: key.tonic.step, targetAlter: key.tonic.alter } },
    ] }];
  });
}
