import type {
  CadenceAnnotation,
  ChordRegion,
  KeyEvent,
  MeterEvent,
  NonChordToneRole,
  PhraseBoundary as ProjectPhraseBoundary,
  PhraseConfidence as ProjectPhraseConfidence,
} from "../../project/types";
import type { SpelledPitch } from "../../pitch";

export type PhraseBoundarySource = ProjectPhraseBoundary["source"];
export type PhraseConfidence = ProjectPhraseConfidence;
export type PhraseBoundary = ProjectPhraseBoundary;

export interface PhraseEvidence {
  readonly code:
    | "manual-boundary"
    | "project-start"
    | "project-end"
    | "all-voices-end"
    | "silence-after-target"
    | "long-note-release"
    | "stable-harmony"
    | "cadential-connection"
    | "metric-support"
    | "new-material"
    | "continuous-following-harmony"
    | "soprano-opening-reprise"
    | "regular-template-target"
    | "regular-template-boundary"
    | "semantic-ambiguity";
  readonly value: string;
  readonly refs?: readonly string[];
}

export interface PhraseSegment {
  readonly id: string;
  readonly fromTick: number;
  readonly toTick: number;
  readonly startBoundary?: PhraseBoundary;
  readonly endBoundary?: PhraseBoundary;
  readonly source: "manual" | "inferred" | "mixed";
  readonly confidence: PhraseConfidence;
  readonly evidence: readonly PhraseEvidence[];
}

export interface PhraseBoundaryCandidate {
  readonly tick: number;
  readonly targetRatio: PhraseTargetRatio;
  readonly distanceToTarget: number;
  readonly support: PhraseSupport;
  readonly score: number;
  readonly confidence: Exclude<PhraseConfidence, "certain">;
  readonly evidence: readonly PhraseEvidence[];
}

export type PhraseTargetRatio = "half" | "third" | "two-thirds";
export type PhraseSupport = "strong" | "moderate" | "weak";
export type PhraseStructureTemplate =
  | {
      readonly kind: "single";
      readonly boundaries: readonly [];
    }
  | {
      readonly kind: "duple";
      readonly boundaries: readonly [PhraseBoundaryCandidate];
    }
  | {
      readonly kind: "triple";
      readonly boundaries: readonly [
        PhraseBoundaryCandidate,
        PhraseBoundaryCandidate,
      ];
    };

export interface PhraseAnalysis {
  readonly boundaries: readonly PhraseBoundary[];
  readonly candidates: readonly PhraseBoundaryCandidate[];
  readonly segments: readonly PhraseSegment[];
  readonly template: PhraseStructureTemplate;
}

export interface PhraseAnalysisOptions {
  /** 实时分析只读取工程中已保存的边界，推导流程才开启候选扫描。 */
  readonly generateCandidates?: boolean;
  /** 将高置信度的自动边界合并为本次分析使用的结构边界。 */
  readonly includeInferredBoundaries?: boolean;
  /** 重建自动边界时保留人工边界，丢弃上一次推导生成的边界。 */
  readonly replaceInferredBoundaries?: boolean;
}

export interface PhraseAnalysisInput {
  readonly lengthTicks: number;
  readonly ppq?: number;
  readonly meterEvents?: readonly MeterEvent[];
  readonly keyEvents?: readonly KeyEvent[];
  readonly structure?: {
    readonly phraseBoundaries?: readonly PhraseBoundary[];
  };
  readonly satbTracks?: readonly {
    readonly id?: string;
    readonly notes: readonly {
      readonly id?: string;
      readonly startTick: number;
      readonly durationTicks: number;
      readonly pitch?: SpelledPitch;
      readonly nonChordToneRole?: NonChordToneRole;
    }[];
  }[];
  readonly chordRegions?: readonly ChordRegion[];
  readonly chordTrack?: {
    readonly regions: readonly ChordRegion[];
    readonly cadenceAnnotations?: readonly Pick<CadenceAnnotation,
      "kind" | "stale" | "fromTick" | "toTick">[];
  };
}
