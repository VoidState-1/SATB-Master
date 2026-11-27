import type { SpelledPitch } from "../../domain/pitch";
import type { ChordRegionPatch } from "../../domain/editing";
import type { HarmonyDiagnostic } from "../../domain/harmony";
import type { CadenceCandidate } from "../../domain/harmony";
import type {
  ChordDraft,
  NoteEvent,
  ProjectDocument,
  VoiceId,
} from "../../domain/project";

export type EditorTool = "select" | "pencil" | "auto-brush" | "eraser" | "split";
export type EditorDomain = "notes" | "chords";

export interface ProgressionPreview {
  readonly slotRange: { readonly fromTick: number; readonly toTick: number };
  readonly ghostNotes?: readonly {
    readonly id: string;
    readonly voice: VoiceId;
    readonly startTick: number;
    readonly durationTicks: number;
    readonly pitch: SpelledPitch;
  }[];
  readonly ghostChords?: readonly {
    readonly fromTick: number;
    readonly toTick: number;
    readonly label: string;
  }[];
}

export interface PianoRollProps {
  readonly progressionPreview?: ProgressionPreview;
  project: ProjectDocument;
  activeVoice: string;
  tool: EditorTool;
  gridTicks: number;
  pixelsPerBeat: number;
  selectedNoteIds: Set<string>;
  selectedChordIds: Set<string>;
  chordBrush: ChordDraft;
  diagnostics: HarmonyDiagnostic[];
  missingExpectedNoteIds?: ReadonlySet<string>;
  missingExpectedChordIds?: ReadonlySet<string>;
  cadenceCandidates?: readonly CadenceCandidate[];
  playheadTick: number;
  isPlaying?: boolean;
  followPlayhead?: boolean;
  /** Keep a shared review cursor in view and allow single-click seeking on notes and ruler. */
  seekOnClick?: boolean;
  onDisengageFollow?(): void;
  loopEnabled: boolean;
  loopStartTick: number;
  loopEndTick: number;
  cancelRequest: number;
  scaleGuideEnabled?: boolean;
  /** 显式定位请求; 调用方保持对象稳定, 不随每次音符编辑重新定位。 */
  focusRange?: { fromTick: number; toTick: number; noteIds?: ReadonlySet<string>; requestKey?: number };
  onSetPlayhead(tick: number): void;
  onScrubPlayhead?(tick: number): void;
  onSetPixelsPerBeat(value: number): void;
  onSetActiveVoice(voiceId: string): void;
  onSetEditorDomain(domain: EditorDomain): void;
  onInteractionActiveChange(active: boolean): void;
  onSelectNotes(noteIds: Set<string>): void;
  onPreviewNote(voiceId: string, midiNote: number): void;
  onSelectChords(chordIds: Set<string>): void;
  onAddNote(
    voiceId: string,
    tick: number,
    midiNote: number,
    durationTicks?: number,
  ): void;
  onAutoBrushNote?(tick: number, midiNote: number, durationTicks?: number): void;
  onUpdateNote(
    voiceId: string,
    noteId: string,
    patch: Partial<NoteEvent>,
  ): void;
  onMoveNotes(
    noteIds: Set<string>,
    tickDelta: number,
    pitchDelta: number,
  ): void;
  onDeleteNotes(noteIds: Set<string>): void;
  onSplitNote(voiceId: string, noteId: string, splitTick: number): void;
  onAddChord(tick: number, durationTicks: number): string | undefined;
  onUpdateChord(chordId: string, patch: ChordRegionPatch): void;
  onMoveChords(chordIds: Set<string>, tickDelta: number): void;
  onDeleteChords(chordIds: Set<string>): void;
  onSplitChord(chordId: string, splitTick: number): void;
  onAddTimingEvent(type: "tempo" | "meter" | "key", tick: number): void;
  onUpdateTimingEvent(
    type: "tempo" | "meter" | "key",
    id: string,
    patch: Record<string, string | number>,
  ): void;
  onDeleteTimingEvent(type: "tempo" | "meter" | "key", id: string): void;
  onSetLoopBoundary(boundary: "start" | "end", tick: number): void;
}
