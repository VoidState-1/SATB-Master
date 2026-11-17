import type { CadenceAnnotation, ChordRegion, NonChordToneRole, ProjectDocument, VoiceId } from "../project";

export const SCORE_TEXT_VERSION = 1;
export const SCORE_VOICES = { S: "soprano", A: "alto", T: "tenor", B: "bass" } as const;
export type ScoreVoice = keyof typeof SCORE_VOICES;

export interface SourceLocation {
  line: number;
  column: number;
  voice?: ScoreVoice | "H";
  measure?: number;
}

export class ScoreTextError extends Error {
  constructor(message: string, public readonly location?: SourceLocation) {
    const context = location
      ? `第 ${location.line} 行，第 ${location.column} 列${location.voice ? `，${location.voice} 声部` : ""}${location.measure ? `，第 ${location.measure} 小节` : ""}: `
      : "";
    super(context + message);
    this.name = "ScoreTextError";
  }
}

export interface ScoreBlock {
  from: number;
  to: number;
  voices: Record<ScoreVoice, string>;
  harmony?: string;
  location?: SourceLocation;
  voiceLocations?: Partial<Record<ScoreVoice | "H", SourceLocation>>;
}

export interface ScoreTimelineEvent {
  at: string;
  key?: string;
  meter?: string;
  tempo?: number;
  location?: SourceLocation;
}

export type ScoreAnnotationKind = "chord" | "note" | "phrase" | "cadence";

/** Fields use the same spelling in the text and programmatic interfaces. */
export interface ScoreAnnotation {
  kind: ScoreAnnotationKind;
  name: string;
  fields: Record<string, string>;
  location?: SourceLocation;
}

export interface ScoreSpec {
  version: typeof SCORE_TEXT_VERSION;
  title?: string;
  key?: string;
  meter?: string;
  tempo?: number;
  events?: ScoreTimelineEvent[];
  blocks: ScoreBlock[];
  annotations?: ScoreAnnotation[];
  reference?: ScoreAnnotation[];
  /** Declares reviewed completeness; omission does not assert absence. */
  referenceComplete?: ScoreAnnotationKind[];
  metadata?: Record<string, string>;
}

export interface ResolvedNoteAnnotation {
  voice: VoiceId;
  noteId: string;
  startTick: number;
  role?: NonChordToneRole;
  velocity?: number;
  locked?: boolean;
}

export interface ResolvedPhraseAnnotation {
  name: string;
  phraseId: string;
  fromTick: number;
  toTick: number;
}

export interface ScoreAnnotationSet {
  chords: ChordRegion[];
  notes: ResolvedNoteAnnotation[];
  phrases: ResolvedPhraseAnnotation[];
  cadences: CadenceAnnotation[];
}

export interface ScoreReference extends ScoreAnnotationSet {
  format: "satb-score-reference";
  formatVersion: 1;
  projectId: string;
  ppq: number;
  lengthTicks: number;
  complete: ScoreAnnotationKind[];
  metadata: Record<string, string>;
}

export interface CompiledScore {
  project: ProjectDocument;
  annotations: ScoreAnnotationSet;
  reference: ScoreReference;
  aliases: Record<string, string>;
  sourceMap: Record<string, SourceLocation>;
}

export function fail(message: string, location?: SourceLocation): never {
  throw new ScoreTextError(message, location);
}
