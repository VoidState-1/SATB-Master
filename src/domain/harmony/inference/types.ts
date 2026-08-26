import type {
  ChordIdentity,
  ChordToneDegree,
  HarmonySemantics,
} from "../../chordModel";
import type { AnalysisKey, AnalysisNote } from "../analysis";
import type {
  FunctionalBaseDefinition,
  FunctionalBaseId,
  FunctionalChordForm,
} from "../../functionalHarmonyCatalog";
import type { MetricPosition } from "../../rhythm/metric";
import type {
  NonChordToneRole,
  ProjectDocument,
  VoiceId,
} from "../../project";
import type { SpelledPitchClass } from "../../pitch";

export type ChordInferenceConfidence = "high" | "medium" | "low";

export type ChordInferenceRegionStatus =
  | "resolved"
  | "ambiguous"
  | "unclassified"
  | "blocked";

export type ChordInferenceEvidenceKind =
  | "functional-template"
  | "tone-match"
  | "bass-match"
  | "spelling-match"
  | "metric-context"
  | "sequence-context"
  | "declared-nonchord-tone"
  | "inferred-nonchord-tone"
  | "omitted-tone"
  | "extra-tone"
  | "hard-rejection";

export interface ChordInferenceEvidence {
  readonly kind: ChordInferenceEvidenceKind;
  readonly code: string;
  readonly noteIds?: readonly string[];
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface ChordInferenceObservation {
  readonly index: number;
  readonly fromTick: number;
  readonly toTick: number;
  readonly activeNotes: Readonly<Partial<Record<VoiceId, AnalysisNote>>>;
  readonly attackVoiceIds: readonly VoiceId[];
  readonly soundingPitchClasses: readonly SpelledPitchClass[];
  readonly bass?: AnalysisNote;
  readonly key: AnalysisKey;
  readonly metric?: MetricPosition;
  readonly completeSatb: boolean;
}

export interface ChordFitAssessment {
  readonly matchedNoteIds: readonly string[];
  readonly chordToneNoteIds: readonly string[];
  readonly nonChordToneNoteIds: readonly string[];
  readonly nonChordToneAssignments: Readonly<
    Record<string, NonChordToneRole>
  >;
  readonly omittedChordDegrees: readonly ChordToneDegree[];
  readonly extraPitchClasses: readonly SpelledPitchClass[];
  readonly bassMatchesInversion: boolean;
  readonly spellingConsistent: boolean;
  readonly hardRejected?: string;
}

export interface ChordInferenceScore {
  readonly functionalTier: 0 | 1 | 2 | 3 | 4;
  readonly toneFit: number;
  readonly bassFit: number;
  readonly spellingFit: number;
  readonly metricFit: number;
  readonly contextFit: number;
  readonly nonChordTonePenalty: number;
  readonly complexityPenalty: number;
  readonly total: number;
}

export interface FunctionalChordTemplate {
  readonly baseId: FunctionalBaseId;
  readonly definition: FunctionalBaseDefinition;
  readonly form: FunctionalChordForm;
  readonly localKeyPolicy: "current-key";
  readonly expectedInversion: 0 | 1 | 2 | 3;
}

export interface ChordInferenceCandidate {
  readonly id: string;
  readonly observationIndex: number;
  readonly identity: ChordIdentity;
  /** Absolute fallback candidates intentionally have no functional semantics. */
  readonly semantics?: HarmonySemantics;
  readonly functionalBaseId?: FunctionalBaseId;
  readonly fit: ChordFitAssessment;
  readonly score: ChordInferenceScore;
  readonly confidence: ChordInferenceConfidence;
  readonly evidence: readonly ChordInferenceEvidence[];
}

export interface ChordInferenceRegion {
  readonly id: string;
  readonly fromTick: number;
  readonly toTick: number;
  readonly status: ChordInferenceRegionStatus;
  readonly selected?: ChordInferenceCandidate;
  readonly alternatives: readonly ChordInferenceCandidate[];
  readonly observationIndices: readonly number[];
}

export interface ChordInferenceWarning {
  readonly code:
    | "invalid-range"
    | "unclassified"
    | "ambiguous"
    | "locked-chord"
    | "locked-note"
    | "overlap"
    | "key-boundary"
    | "low-confidence";
  readonly fromTick?: number;
  readonly toTick?: number;
  readonly message: string;
  readonly noteIds?: readonly string[];
}

export interface ChordInferenceResult {
  readonly sourceRevision: number;
  readonly range: { readonly fromTick: number; readonly toTick: number };
  readonly regions: readonly ChordInferenceRegion[];
  readonly unresolvedObservationIndices: readonly number[];
  readonly warnings: readonly ChordInferenceWarning[];
}

export interface ChordInferenceOptions {
  readonly fromTick?: number;
  readonly toTick?: number;
  readonly allowAbsoluteFallback?: boolean;
  readonly allowIncompleteVoicing?: boolean;
  readonly allowNonChordToneCandidates?: boolean;
  readonly minConfidence?: ChordInferenceConfidence;
}

export interface ChordInferenceApplyOptions {
  readonly mode: "fill-gaps" | "replace-unlocked";
  readonly selection?: ReadonlySet<string>;
  readonly writeNonChordToneRoles?: boolean;
}

export interface ChordInferenceApplyResult {
  readonly project: ProjectDocument;
  readonly skipped: readonly ChordInferenceWarning[];
  readonly appliedRegionCount: number;
  readonly writtenNonChordToneRoleCount: number;
}

/** 一次完整和声推导：和弦推导是第一阶段，乐句结构在应用后生成。 */
export interface HarmonyInferenceResult {
  readonly chordInference: ChordInferenceResult;
}

export type HarmonyInferenceApplyOptions = ChordInferenceApplyOptions;

export interface HarmonyInferenceApplyResult extends ChordInferenceApplyResult {
  readonly appliedPhraseBoundaryCount: number;
}

export interface ChordInferenceSource {
  readonly project: ProjectDocument;
}
