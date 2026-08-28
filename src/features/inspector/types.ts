import type { ChordRegionPatch } from "../../domain/editing";
import type {
  ChordDraft,
  ChordRegion,
  EditableRange,
  NoteEvent,
  ProjectDocument,
  SatbTrack,
  VoiceId,
} from "../../domain/project";
import type {
  CadenceCandidate,
} from "../../domain/harmony";
import type { CadenceAnnotationPatch } from "../../domain/editing";

export interface InspectorProps {
  project: ProjectDocument;
  activeVoice: VoiceId;
  selectedNote?: { voiceId: VoiceId; note: NoteEvent };
  selectedChord?: ChordRegion;
  selectedChordIds: Set<string>;
  selectedChordCount: number;
  developerMode: boolean;
  chordBrush: ChordDraft;
  playheadTick: number;
  cadenceCandidates?: readonly CadenceCandidate[];
  audioStatus: string;
  soundFontSize?: string;
  soundFontLoad?: { percent: number; detail: string };
  onUpdateProject(
    patch: Partial<
      Pick<ProjectDocument, "title" | "author" | "notes" | "lengthTicks">
    >,
  ): void;
  onUpdateInstructions(instructions: string): void;
  onAddEditableRange(): void;
  onUpdateEditableRange(rangeId: string, patch: Partial<EditableRange>): void;
  onDeleteEditableRange(rangeId: string): void;
  onAddPhraseBoundary(): void;
  onDeletePhraseBoundary(boundaryId: string): void;
  onUpdateNote(
    voiceId: VoiceId,
    noteId: string,
    patch: Partial<NoteEvent>,
  ): void;
  onUpdateChord(chordId: string, patch: ChordRegionPatch): void;
  onDeleteChords(chordIds: Set<string>): void;
  onAddCadenceAnnotation?(annotation: ProjectDocument["chordTrack"]["cadenceAnnotations"][number]): void;
  onUpdateCadenceAnnotation?(annotationId: string, patch: CadenceAnnotationPatch): void;
  onDeleteCadenceAnnotation?(annotationId: string): void;
  onUpdateChordBrush(patch: Partial<ChordDraft>): void;
  onUpdateChordTrack(
    patch: Partial<
      Pick<ProjectDocument["chordTrack"], "visible" | "locked" | "displayMode">
    >,
  ): void;
  onAddTimingEvent(type: "tempo" | "meter" | "key"): void;
  onUpdateTimingEvent(
    type: "tempo" | "meter" | "key",
    id: string,
    patch: Record<string, string | number>,
  ): void;
  onDeleteTimingEvent(type: "tempo" | "meter" | "key", id: string): void;
  onUpdateAudio(masterVolume: number): void;
  onUpdateTrack(voiceId: VoiceId, patch: Partial<SatbTrack>): void;
  onChooseSoundFont(): void;
  onUseDefaultSoundFont(): void;
  onOpenMidiOut?(): void;
}

export type SelectionInspectorProps = Pick<
  InspectorProps,
  | "project"
  | "selectedNote"
  | "selectedChord"
  | "selectedChordIds"
  | "selectedChordCount"
  | "developerMode"
  | "chordBrush"
  | "playheadTick"
  | "onUpdateNote"
  | "onUpdateChord"
  | "onDeleteChords"
  | "cadenceCandidates"
  | "onAddCadenceAnnotation"
  | "onUpdateCadenceAnnotation"
  | "onDeleteCadenceAnnotation"
  | "onUpdateChordBrush"
>;

export type ProjectInspectorProps = Pick<
  InspectorProps,
  | "project"
  | "onUpdateProject"
  | "onUpdateInstructions"
  | "onAddEditableRange"
  | "onUpdateEditableRange"
  | "onDeleteEditableRange"
  | "onAddPhraseBoundary"
  | "onDeletePhraseBoundary"
  | "onUpdateChordTrack"
  | "onAddTimingEvent"
  | "onUpdateTimingEvent"
  | "onDeleteTimingEvent"
>;

export type SoundInspectorProps = Pick<
  InspectorProps,
  | "project"
  | "activeVoice"
  | "audioStatus"
  | "soundFontSize"
  | "soundFontLoad"
  | "onUpdateAudio"
  | "onUpdateTrack"
  | "onChooseSoundFont"
  | "onUseDefaultSoundFont"
  | "onOpenMidiOut"
>;
