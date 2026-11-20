
import type { CadenceAnnotation } from "../../project/types";
import type { CadenceCandidate } from "./types";

export function observedCadenceLandingTick(candidate: CadenceCandidate) {
  return candidate.observedLandingTick ?? candidate.unharmonizedLandingTick;
}

export function matchingObservedCadence(annotation: CadenceAnnotation, candidates: readonly CadenceCandidate[]) {
  if (annotation.observedLandingTick === undefined || annotation.source !== "accepted-candidate") return;
  return candidates.find(candidate =>
    candidate.confidence !== "ambiguous" && observedCadenceLandingTick(candidate) === annotation.observedLandingTick &&
    candidate.fromTick === annotation.fromTick && candidate.toTick === annotation.toTick &&
    candidate.phraseId === annotation.phraseId && candidate.kind === annotation.kind &&
    candidate.form === annotation.form && candidate.completion === annotation.completion,
  );
}

export function reviewObservedCadenceAnnotation(
  annotation: CadenceAnnotation, candidates: readonly CadenceCandidate[],
): CadenceAnnotation {
  if (annotation.observedLandingTick === undefined) return annotation;
  const stale = !matchingObservedCadence(annotation, candidates);
  return annotation.stale === stale ? annotation : { ...annotation, stale };
}

export function annotationFromCadenceCandidate(candidate: CadenceCandidate, id: string): CadenceAnnotation {
  const { phraseId, fromTick, toTick, kind, form, completion } = candidate;
  const observedLandingTick = observedCadenceLandingTick(candidate);
  return { id, phraseId, fromTick, toTick, kind, form, completion,
    ...(observedLandingTick !== undefined && { observedLandingTick }),
    source: "accepted-candidate", confidence: candidate.confidence === "certain" ? "certain" : "probable", locked: false,
  };
}
