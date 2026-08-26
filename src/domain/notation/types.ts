import type {
  KeyEvent,
  ProjectDocument,
  VoiceId,
} from "../project";
import type { SpelledPitch } from "../pitch";

export type ScoreStaff = "treble" | "bass";
export type NotationDurationValue = "w" | "h" | "q" | "8" | "16" | "32" | "64";

export interface NotationDuration {
  value: NotationDurationValue;
  dots: number;
  ticks: number;
}

export interface ScoreVoiceLayout {
  voiceId: VoiceId;
  staff: ScoreStaff;
  stemDirection: "up" | "down";
}

export interface ScoreNoteEvent {
  kind: "note";
  sourceNoteId: string;
  voiceId: VoiceId;
  fromTick: number;
  toTick: number;
  pitch: SpelledPitch;
  tieFromPrevious: boolean;
  tieToNext: boolean;
  duration: NotationDuration;
}

export interface ScoreRestEvent {
  kind: "rest";
  fromTick: number;
  toTick: number;
  duration: NotationDuration;
}

export interface ScoreUnsupportedEvent {
  kind: "unsupported";
  fromTick: number;
  toTick: number;
  sourceNoteId?: string;
}

export type ScoreEvent = ScoreNoteEvent | ScoreRestEvent | ScoreUnsupportedEvent;

export interface ScoreVoice {
  voiceId: VoiceId;
  events: readonly ScoreEvent[];
  totalTicks: number;
}

export interface ScoreMeasure {
  number: number;
  fromTick: number;
  toTick: number;
  numerator: number;
  denominator: number;
  key: KeyEvent;
  keySignature?: string;
  voices: Readonly<Record<VoiceId, ScoreVoice>>;
}

export type ScorePreviewWarningCode =
  | "unsupported-rhythm"
  | "invalid-overlap"
  | "unsupported-key"
  | "omitted-auxiliary"
  | "render-error";

export interface ScorePreviewWarning {
  code: ScorePreviewWarningCode;
  message: string;
  fromTick?: number;
  toTick?: number;
  voiceId?: VoiceId;
  sourceNoteId?: string;
}

export interface ScorePreviewModel {
  revision: number;
  ppq: number;
  projectLengthTicks: number;
  measures: readonly ScoreMeasure[];
  warnings: readonly ScorePreviewWarning[];
  omittedAuxiliaryTrackCount: number;
  omittedAuxiliaryNoteCount: number;
}

export interface ScorePreviewBuildOptions {
  revision?: number;
}

export type ScorePreviewProject = Pick<
  ProjectDocument,
  | "ppq"
  | "lengthTicks"
  | "tempoEvents"
  | "meterEvents"
  | "keyEvents"
  | "satbTracks"
  | "auxiliaryTracks"
>;
