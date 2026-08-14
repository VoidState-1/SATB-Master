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

export function useChordCommands({
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

  const handleAddChord = useCallback(
    (tick: number, durationTicks: number) => {
      const chord: ChordRegion = createChordRegion(
        project,
        tick,
        durationTicks,
        chordBrush,
        createId("chord"),
      );
      const result = addChordRegion(project, chord);
      if (!commitResult(result)) return undefined;
      setSelectedChordIds(new Set([chord.id]));
      setSelectedNoteIds(new Set());
      return chord.id;
    },
    [chordBrush, commitResult, project],
  );

  const handleUpdateChord = useCallback(
    (chordId: string, patch: ChordRegionPatch) => {
      const result = updateChordRegion(project, chordId, patch);
      if (!commitResult(result)) return;
      const updated = result.project.chordTrack.regions.find(
        (region) => region.id === chordId,
      );
      if (updated?.semantics && patch.draft) {
        const draft = chordDraftFromRegion(updated);
        if (draft) setChordBrush(draft);
      }
    },
    [commitResult, project],
  );

  const handleMoveChords = useCallback(
    (chordIds: Set<string>, tickDelta: number) => {
      commitResult(
        transformChordRegions(project, chordIds, (region) => ({
          ...region,
          startTick: region.startTick + tickDelta,
        })),
      );
    },
    [commitResult, project],
  );

  const handleDeleteChords = useCallback(
    (chordIds: Set<string>) => {
      if (commitResult(deleteChordRegions(project, chordIds)))
        setSelectedChordIds(new Set());
    },
    [commitResult, project],
  );

  const handleSplitChord = useCallback(
    (chordId: string, splitTick: number) => {
      commitResult(splitChordRegion(project, chordId, splitTick));
    },
    [commitResult, project],
  );

  const handleUpdateChordBrush = useCallback((patch: Partial<ChordDraft>) => {
    setChordBrush((current) => ({ ...current, ...patch }));
  }, []);

  const handleUpdateChordTrack = useCallback(
    (
      patch: Partial<
        Pick<
          ProjectDocument["chordTrack"],
          "visible" | "locked" | "displayMode"
        >
      >,
    ) => {
      commitResult(setChordTrackState(project, patch));
    },
    [commitResult, project],
  );

  return {
    handleAddChord,
    handleUpdateChord,
    handleMoveChords,
    handleDeleteChords,
    handleSplitChord,
    handleUpdateChordBrush,
    handleUpdateChordTrack,
  } as const;
}
