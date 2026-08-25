import type { VoiceId } from "../../../project/types";
import type {
  AnalysisChord,
  AnalysisNote,
  AnalysisSlice,
  HarmonySpan,
} from "../../analysis";
import type { CadenceCandidate } from "../../cadence";
import type { CadenceAnnotation } from "../../../project/types";
import type { PhraseSegment } from "../../phrase";
import type { HarmonyConnectionAssessment } from "../connector";

export interface NoteView {
  readonly note: AnalysisNote;
  readonly voiceId: VoiceId;
}

export interface SpanView {
  readonly span: HarmonySpan;
  readonly slices: readonly AnalysisSlice[];
  readonly firstSlice: AnalysisSlice;
  readonly lastSlice: AnalysisSlice;
  readonly chords: readonly AnalysisChord[];
}

export interface ConnectionView {
  readonly connection: HarmonyConnectionAssessment;
  readonly source: SpanView;
  readonly target: SpanView;
  readonly sourceBoundary: AnalysisSlice;
  readonly targetBoundary: AnalysisSlice;
}

export interface SpanNeighborhood {
  readonly current: SpanView;
  readonly previous?: SpanView;
  readonly next?: SpanView;
  readonly incoming?: ConnectionView;
  readonly outgoing?: ConnectionView;
}

export interface CadenceView {
  readonly id: string;
  readonly fromTick: number;
  readonly toTick: number;
  readonly phraseId: string;
  readonly kind: CadenceCandidate["kind"];
  readonly form?: CadenceCandidate["form"];
  readonly completion?: CadenceCandidate["completion"];
  readonly confidence: CadenceCandidate["confidence"];
  readonly source: "candidate" | "manual" | "accepted-candidate";
  readonly candidate?: CadenceCandidate;
  readonly annotation?: CadenceAnnotation;
  readonly phrase?: PhraseSegment;
  readonly spans: readonly SpanView[];
  readonly chords: readonly AnalysisChord[];
  readonly evidence: readonly CadenceCandidate["evidence"][number][];
}

export interface NoteNeighborhood {
  readonly current: NoteView;
  /** 同一声部中前一个起奏音符。 */
  readonly previous?: NoteView;
  /** 同一声部中后一个起奏音符。 */
  readonly next?: NoteView;
  readonly attackSlice: AnalysisSlice;
  readonly span?: SpanView;
}
