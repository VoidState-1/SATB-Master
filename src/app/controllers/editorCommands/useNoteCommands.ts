import { useCallback } from "react";
import { audioEngine } from "../../../audio/audioEngine";
import { chordDraftFromRegion } from "../../../domain/chords";
import {
  addAuxiliaryTrack,
  addNote,
  deleteAuxiliaryTrack,
  deleteNotes,
  splitNote,
  transformNotes,
  updateNote,
  updateTrack,
  type AddAuxiliaryTrackOptions,
  type TrackPatch,
} from "../../../domain/editing";
import {
  createId,
  getAllPlayableTracks,
  getMusicalTrack,
  type NoteEvent,
} from "../../../domain/project";
import {
  spellMidi,
  toMidi,
  transposeSpelledPitch,
} from "../../../domain/pitch";
import { keyAtTick } from "../../../domain/time";
import type { EditorCommandContext } from "./types";

export function useNoteCommands({
  project,
  editor,
  showNotice,
  commitResult,
}: EditorCommandContext) {
  const {
    activeVoice,
    setActiveVoice,
    setEditorDomain,
    gridTicks,
    selectedNoteIds,
    setSelectedNoteIds,
    setSelectedChordIds,
    setChordBrush,
  } = editor;

  const handlePreviewNote = useCallback(
    (trackId: string, midiNote: number) => {
      const tracks = getAllPlayableTracks(project);
      const trackIndex = tracks.findIndex((track) => track.id === trackId);
      const track = tracks[trackIndex];
      if (track) {
        void audioEngine.previewNote(midiNote, trackId, {
          trackIndex,
          program: track.program,
        });
      }
    },
    [project],
  );

  const handleAddNote = useCallback(
    (
      trackId: string,
      tick: number,
      midiNote: number,
      durationTicks = gridTicks,
    ) => {
      const id = createId("note");
      const result = addNote(project, trackId, {
        id,
        startTick: tick,
        durationTicks,
        pitch: spellMidi(midiNote, keyAtTick(project.keyEvents, tick)),
        velocity: 88,
        locked: false,
        spellingSource: "manual",
      });
      if (commitResult(result)) {
        const note = getMusicalTrack(result.project, trackId).notes.find(
          (candidate) => candidate.id === id,
        );
        if (note) setSelectedNoteIds(new Set([note.id]));
        setSelectedChordIds(new Set());
        handlePreviewNote(trackId, midiNote);
      }
    },
    [commitResult, gridTicks, handlePreviewNote, project, setSelectedChordIds, setSelectedNoteIds],
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
      for (const track of getAllPlayableTracks(project)) {
        const note = track.notes.find((candidate) => candidate.id === noteId);
        if (note) {
          handlePreviewNote(track.id, toMidi(note.pitch));
          return;
        }
      }
    },
    [handlePreviewNote, project, setEditorDomain, setSelectedChordIds, setSelectedNoteIds],
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

  const handleSplitNote = useCallback(
    (trackId: string, noteId: string, splitTick: number) => {
      commitResult(splitNote(project, trackId, noteId, splitTick));
    },
    [commitResult, project],
  );

  const handleUpdateNote = useCallback(
    (trackId: string, noteId: string, patch: Partial<NoteEvent>) => {
      const result = updateNote(project, trackId, noteId, patch);
      if (
        commitResult(result) &&
        patch.pitch !== undefined &&
        selectedNoteIds.size === 1
      ) {
        handlePreviewNote(trackId, toMidi(patch.pitch));
      }
    },
    [commitResult, handlePreviewNote, project, selectedNoteIds.size],
  );

  const handleDeleteNotes = useCallback(
    (noteIds: Set<string>) => {
      if (commitResult(deleteNotes(project, noteIds)))
        setSelectedNoteIds(new Set());
    },
    [commitResult, project],
  );

  const handleUpdateTrack = useCallback(
    (trackId: string, patch: TrackPatch) => {
      commitResult(updateTrack(project, trackId, patch));
    },
    [commitResult, project],
  );

  const handleAddAuxiliaryTrack = useCallback(
    (options?: AddAuxiliaryTrackOptions) => {
      const result = addAuxiliaryTrack(project, options);
      if (!commitResult(result) || !result.trackId) return;
      setActiveVoice(result.trackId);
      showNotice(`已添加 ${getMusicalTrack(result.project, result.trackId).name}`);
    },
    [commitResult, project, setActiveVoice, showNotice],
  );

  const handleDeleteAuxiliaryTrack = useCallback(
    (trackId: string) => {
      if (!commitResult(deleteAuxiliaryTrack(project, trackId))) return;
      const track = getMusicalTrack(project, trackId);
      const removedNoteIds = new Set(track.notes.map((note) => note.id));
      setSelectedNoteIds((current) =>
        new Set([...current].filter((id) => !removedNoteIds.has(id))),
      );
      if (activeVoice === trackId) setActiveVoice("soprano");
    },
    [activeVoice, commitResult, project, setActiveVoice, setSelectedNoteIds],
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
    handleAddAuxiliaryTrack,
    handleDeleteAuxiliaryTrack,
  } as const;
}
