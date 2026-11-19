import type {
  CadenceAnnotation as ProjectCadenceAnnotation,
  CadenceCompletion as ProjectCadenceCompletion,
  CadenceForm as ProjectCadenceForm,
  CadenceKind as ProjectCadenceKind,
} from "../../project/types";
import type { HarmonySpan, AnalysisChord, AnalysisSlice } from "../analysis";
import type { PhraseSegment } from "../phrase";
import type { KeyReference } from "../../chordModel";

export type CadenceKind = ProjectCadenceKind;
export type CadenceForm = ProjectCadenceForm;
export type CadenceCompletion = ProjectCadenceCompletion;
export type CadenceConfidence = "certain" | "probable" | "ambiguous";

export interface CadenceEvidence {
  readonly code:
    | "phrase-boundary"
    | "dominant-to-tonic"
    | "predominant-to-dominant"
    | "predominant-to-tonic"
    | "dominant-to-alternative"
    | "ends-on-dominant"
    | "cadential64-chain"
    | "dominant-neighbor-prolongation"
    | "dominant-before-tonic-gap"
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
  readonly fromTick: number;
  readonly toTick: number;
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
  readonly key: KeyReference;
  readonly chord?: AnalysisChord;
  readonly boundarySlice?: AnalysisSlice;
  readonly family?: "tonic" | "subdominant" | "dominant";
  readonly degree?: number;
  readonly isTonic?: boolean;
  readonly isDominant?: boolean;
  readonly isSubdominant?: boolean;
  readonly isCadential64: boolean;
  readonly isStable?: boolean;
  readonly interpretationStatus: "resolved" | "ambiguous" | "unavailable";
}
