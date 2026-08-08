import type { ChordRegionPatch } from "../../domain/editing";
import type { HarmonyDiagnostic } from "../../domain/harmony";
import type {
  ChordDraft,
  NoteEvent,
  ProjectDocument,
  VoiceId,
} from "../../domain/model";

export type EditorTool = "select" | "pencil" | "eraser" | "split";
export type EditorDomain = "notes" | "chords";

export interface PianoRollProps {
  project: ProjectDocument;
  activeVoice: VoiceId;
  tool: EditorTool;
  gridTicks: number;
  pixelsPerBeat: number;
  selectedNoteIds: Set<string>;
  selectedChordIds: Set<string>;
  chordBrush: ChordDraft;
  diagnostics: HarmonyDiagnostic[];
  playheadTick: number;
  loopEnabled: boolean;
  loopStartTick: number;
  loopEndTick: number;
  cancelRequest: number;
  onSetPlayhead(tick: number): void;
  onSetPixelsPerBeat(value: number): void;
  onSetActiveVoice(voiceId: VoiceId): void;
  onSetEditorDomain(domain: EditorDomain): void;
  onInteractionActiveChange(active: boolean): void;
  onSelectNotes(noteIds: Set<string>): void;
  onPreviewNote(voiceId: VoiceId, midiNote: number): void;
  onSelectChords(chordIds: Set<string>): void;
  onAddNote(
    voiceId: VoiceId,
    tick: number,
    midiNote: number,
    durationTicks?: number,
  ): void;
  onUpdateNote(
    voiceId: VoiceId,
    noteId: string,
    patch: Partial<NoteEvent>,
  ): void;
  onMoveNotes(
    noteIds: Set<string>,
    tickDelta: number,
    pitchDelta: number,
  ): void;
  onDeleteNotes(noteIds: Set<string>): void;
  onSplitNote(voiceId: VoiceId, noteId: string, splitTick: number): void;
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
