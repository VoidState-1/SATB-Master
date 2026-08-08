import { useCallback } from "react";
import { audioEngine } from "../../../audio/audioEngine";
import {
  chordDraftFromRegion,
  createChordRegion,
  defaultChordDraftAtTick,
} from "../../../domain/chords";
import {
  addChordRegion,
  addNote,
  deleteChordRegions,
  deleteNotes,
  replaceProject,
  setChordTrackState,
  splitChordRegion,
  splitNote,
  transformChordRegions,
  transformNotes,
  updateChordRegion,
  updateNote,
  type ChordRegionPatch,
} from "../../../domain/editing";
import {
  createId,
  getAllPlayableTracks,
  getTrack,
  reconcileChordIdentities,
  type ChordDraft,
  type ChordRegion,
  type EditableRange,
  type NoteEvent,
  type ProjectDocument,
  type SatbTrack,
  type VoiceId,
} from "../../../domain/project";
import {
  coerceKeyTonicForMode,
  parsePitchClass,
  spellMidi,
  toMidi,
  transposeSpelledPitch,
} from "../../../domain/pitch";
import {
  buildMeasures,
  eventAtTick,
  formatPosition,
  keyAtTick,
  ticksPerBeat,
} from "../../../domain/time";
import type { ClipboardNote } from "../useEditorState";
import type { EditorCommandContext } from "./types";

const editorState = (editor: EditorCommandContext["editor"]) => editor;

export function useNoteCommands({
  project,
  history,
  editor,
  playheadTick,
  setPlayheadTick,
  showNotice,
  commitResult,
}: EditorCommandContext) {
  const {
    activeVoice,
    setActiveVoice,
    tool,
    setTool,
    editorDomain,
    setEditorDomain,
    setToolModifiers,
    editorInteractionActive,
    setCancelEditorRequest,
    gridTicks,
    setGridTicks,
    setPixelsPerBeat,
    selectedNoteIds,
    setSelectedNoteIds,
    selectedChordIds,
    setSelectedChordIds,
    chordBrush,
    setChordBrush,
    clipboardRef,
  } = editor;

  const handleAddNote = useCallback(
    (
      voiceId: VoiceId,
      tick: number,
      midiNote: number,
      durationTicks = gridTicks,
    ) => {
      const result = addNote(project, voiceId, {
        id: createId("note"),
        startTick: tick,
        durationTicks,
        pitch: spellMidi(midiNote, keyAtTick(project.keyEvents, tick)),
        velocity: 88,
        locked: false,
        spellingSource: "manual",
      });
      if (commitResult(result)) {
        const note = getTrack(result.project, voiceId).notes.find(
          (candidate) =>
            candidate.startTick === tick &&
            toMidi(candidate.pitch) === midiNote,
        );
        if (note) setSelectedNoteIds(new Set([note.id]));
        setSelectedChordIds(new Set());
        void audioEngine.previewNote(midiNote, voiceId);
      }
    },
    [commitResult, gridTicks, project],
  );

  const handleMoveNotes = useCallback(
    (noteIds: Set<string>, tickDelta: number, pitchDelta: number) => {
      commitResult(
        transformNotes(project, noteIds, (note) => {
          const startTick = note.startTick + tickDelta;
          return {
            ...note,
            startTick,
            pitch: transposeSpelledPitch(
              note.pitch,
              pitchDelta,
              keyAtTick(project.keyEvents, startTick),
            ),
          };
        }),
      );
    },
    [commitResult, project],
  );

  const handleSelectNotes = useCallback(
    (noteIds: Set<string>) => {
      setSelectedNoteIds(noteIds);
      if (noteIds.size > 0) {
        setEditorDomain("notes");
        setSelectedChordIds(new Set());
      }
      if (noteIds.size !== 1) return;
      const noteId = noteIds.values().next().value;
      for (const track of project.satbTracks) {
        const note = track.notes.find((candidate) => candidate.id === noteId);
        if (note) {
          void audioEngine.previewNote(toMidi(note.pitch), track.id);
          return;
        }
      }
    },
    [project],
  );

  const handleSelectChords = useCallback(
    (chordIds: Set<string>) => {
      setSelectedChordIds(chordIds);
      if (chordIds.size > 0) {
        setEditorDomain("chords");
        setSelectedNoteIds(new Set());
      }
      if (chordIds.size !== 1) return;
      const chord = project.chordTrack.regions.find(
        (candidate) => candidate.id === chordIds.values().next().value,
      );
      const draft = chord ? chordDraftFromRegion(chord) : undefined;
      if (draft) setChordBrush(draft);
    },
    [project.chordTrack.regions],
  );

  const handlePreviewNote = useCallback(
    (voiceId: VoiceId, midiNote: number) => {
      void audioEngine.previewNote(midiNote, voiceId);
    },
    [],
  );

  const handleSplitNote = useCallback(
    (voiceId: VoiceId, noteId: string, splitTick: number) => {
      commitResult(splitNote(project, voiceId, noteId, splitTick));
    },
    [commitResult, project],
  );

  const handleUpdateNote = useCallback(
    (voiceId: VoiceId, noteId: string, patch: Partial<NoteEvent>) => {
      const result = updateNote(project, voiceId, noteId, patch);
      if (
        commitResult(result) &&
        patch.pitch !== undefined &&
        selectedNoteIds.size === 1
      ) {
        void audioEngine.previewNote(toMidi(patch.pitch), voiceId);
      }
    },
    [commitResult, project, selectedNoteIds.size],
  );

  const handleDeleteNotes = useCallback(
    (noteIds: Set<string>) => {
      if (commitResult(deleteNotes(project, noteIds)))
        setSelectedNoteIds(new Set());
    },
    [commitResult, project],
  );

  const handleUpdateTrack = useCallback(
    (voiceId: VoiceId, patch: Partial<SatbTrack>) => {
      history.commit(
        replaceProject(project, (draft) =>
          Object.assign(getTrack(draft, voiceId), patch),
        ),
      );
    },
    [history, project],
  );

  return {
    handleAddNote,
    handleMoveNotes,
    handleSelectNotes,
    handleSelectChords,
    handlePreviewNote,
    handleSplitNote,
    handleUpdateNote,
    handleDeleteNotes,
    handleUpdateTrack,
  } as const;
}

