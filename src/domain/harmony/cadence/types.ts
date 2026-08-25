import type {
  CadenceAnnotation as ProjectCadenceAnnotation,
} from "../../project/types";
import type { HarmonySpan, AnalysisChord, AnalysisSlice } from "../analysis";
import type { PhraseSegment } from "../phrase";

export type CadenceKind =
  | "full"
  | "half"
  | "supplementary"
  | "deceptive";

export type CadenceForm = "authentic" | "plagal";
export type CadenceCompletion = "perfect" | "imperfect";
export type CadenceConfidence = "certain" | "probable" | "ambiguous";

export interface CadenceEvidence {
  readonly code:
    | "phrase-boundary"
    | "dominant-to-tonic"
    | "predominant-to-tonic"
    | "dominant-to-alternative"
    | "ends-on-dominant"
    | "cadential64-chain"
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

export interface CadenceAnnotation {
  readonly id: ProjectCadenceAnnotation["id"];
  readonly phraseId: ProjectCadenceAnnotation["phraseId"];
  readonly fromTick: ProjectCadenceAnnotation["fromTick"];
  readonly toTick: ProjectCadenceAnnotation["toTick"];
  readonly kind: ProjectCadenceAnnotation["kind"];
  readonly form?: ProjectCadenceAnnotation["form"];
  readonly completion?: ProjectCadenceAnnotation["completion"];
  readonly source: ProjectCadenceAnnotation["source"];
  readonly confidence: ProjectCadenceAnnotation["confidence"];
  readonly locked: ProjectCadenceAnnotation["locked"];
}

export interface CadenceSpanFacts {
  readonly span: HarmonySpan;
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
