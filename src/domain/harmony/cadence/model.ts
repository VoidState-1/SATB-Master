import type {
  CadenceAnnotation as ProjectCadenceAnnotation,
  CadenceCompletion as ProjectCadenceCompletion,
  CadenceForm as ProjectCadenceForm,
  CadenceKind as ProjectCadenceKind,
} from "../../project/types";
import type { HarmonySpan, AnalysisChord, AnalysisSlice } from "../analysis";
import type { KeyReference } from "../../chordModel";
import type { StructuralVoicing } from "../facts/writtenVoicing";

export type CadenceKind = ProjectCadenceKind;
export type CadenceForm = ProjectCadenceForm;
export type CadenceCompletion = ProjectCadenceCompletion;
export type CadenceConfidence = "certain" | "probable" | "ambiguous";

export interface CadenceEvidence {
  readonly code:
    | "phrase-boundary"
    | "dominant-to-tonic"
    | "written-structural-arrival"
    | "predominant-to-dominant"
    | "predominant-to-tonic"
    | "dorian-plagal-ending"
    | "dominant-to-alternative"
    | "written-deceptive-clausula"
    | "ends-on-dominant"
    | "cadential64-chain"
    | "dominant-neighbor-prolongation"
    | "dominant-before-tonic-gap"
    | "detached-dominant-to-tonic"
    | "detached-sparse-tonic"
    | "octave-tonic-ending"
    | "detached-deceptive-reprise"
    | "tonic-bass-suspension"
    | "staged-tonic-arrival"
    | "closing-tonic-decoration"
    | "closing-tonic-pedal"
    | "closing-tonic-revoicing"
    | "articulated-interior-ending"
    | "bass-formula"
    | "metric-support"
    | "soprano-tonic"
    | "stable-ending"
    | "ambiguous-semantics";
  readonly value: string;
  readonly refs?: readonly string[];
}

export interface CadenceCandidate {
  readonly id: string;
  readonly phraseId: string;
  /** Start of the witnessed cadential preparation, which can precede the last connection. */
  readonly fromTick: number;
  /** Structural arrival, distinct from the following release and any notated phrase break. */
  readonly landingTick: number;
  /** Exclusive end of the ending sonority or its independently verified extension. */
  readonly toTick: number;
  /** Actual cadence arrival when no chord span is present at the landing. */
  readonly unharmonizedLandingTick?: number;
  /** Observed onset when the range alone cannot identify the arrival. */
  readonly observedLandingTick?: number;
  readonly kind: CadenceKind;
  readonly form?: CadenceForm;
  readonly completion?: CadenceCompletion;
  readonly confidence: CadenceConfidence;
  readonly score: number;
  readonly spanIds: readonly string[];
  readonly chordIds: readonly string[];
  readonly evidence: readonly CadenceEvidence[];
  readonly alternatives?: readonly CadenceCandidate[];
}

export type CadenceAnnotation = ProjectCadenceAnnotation;

export interface CadenceSpanFacts {
  readonly span: HarmonySpan;
  /** End of the last sounding slice, excluding silence covered by a chord label. */
  readonly releaseTick?: number;
  readonly key: KeyReference;
  readonly writtenKey: KeyReference;
  readonly hardBoundaryBefore: boolean;
  readonly chord?: AnalysisChord;
  readonly boundarySlice?: AnalysisSlice;
  readonly structuralArrival?: StructuralVoicing;
  readonly family?: "tonic" | "subdominant" | "dominant";
  readonly degree?: number;
  readonly isTonic?: boolean;
  readonly isDominant?: boolean;
  readonly isSubdominant?: boolean;
  readonly isCadential64: boolean;
  readonly isStable?: boolean;
  readonly interpretationStatus: "resolved" | "ambiguous" | "unavailable";
}

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

export { clipHarmonySpan, sliceWithinSpan } from "../facts/span";
