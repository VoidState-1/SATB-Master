import type {
  PhraseBoundary as ProjectPhraseBoundary,
  PhraseConfidence as ProjectPhraseConfidence,
} from "../../project/types";

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
  readonly score: number;
  readonly confidence: Exclude<PhraseConfidence, "certain">;
  readonly evidence: readonly PhraseEvidence[];
}

export interface PhraseAnalysis {
  readonly boundaries: readonly PhraseBoundary[];
  readonly candidates: readonly PhraseBoundaryCandidate[];
  readonly segments: readonly PhraseSegment[];
}

export interface PhraseAnalysisInput {
  readonly lengthTicks: number;
  readonly ppq?: number;
  readonly structure?: {
    readonly phraseBoundaries?: readonly PhraseBoundary[];
  };
  readonly satbTracks?: readonly {
    readonly notes: readonly {
      readonly startTick: number;
      readonly durationTicks: number;
    }[];
  }[];
  readonly chordRegions?: readonly {
    readonly startTick: number;
    readonly durationTicks: number;
  }[];
}
