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

export function useProjectCommands({
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

  const handleUpdateProject = useCallback(
    (
      patch: Partial<
        Pick<ProjectDocument, "title" | "author" | "notes" | "lengthTicks">
      >,
    ) => {
      if (patch.lengthTicks !== undefined) {
        const latestEvent = Math.max(
          ...getAllPlayableTracks(project).flatMap((track) =>
            track.notes.map((note) => note.startTick + note.durationTicks),
          ),
          ...project.chordTrack.regions.map(
            (chord) => chord.startTick + chord.durationTicks,
          ),
          0,
        );
        if (patch.lengthTicks < latestEvent) {
          showNotice("工程长度不能短于现有音符或和弦");
          return;
        }
      }
      history.commit(
        replaceProject(project, (draft) => Object.assign(draft, patch)),
      );
    },
    [history, project, showNotice],
  );

  const handleUpdateInstructions = useCallback(
    (instructions: string) => {
      history.commit(
        replaceProject(project, (draft) => {
          draft.exercise.instructions = instructions;
        }),
      );
    },
    [history, project],
  );

  const handleAddEditableRange = useCallback(() => {
    const measure = buildMeasures(project).find(
      (item) => playheadTick >= item.startTick && playheadTick < item.endTick,
    );
    const range: EditableRange = {
      id: createId("range"),
      voiceIds: [activeVoice],
      fromTick: measure?.startTick ?? playheadTick,
      toTick:
        measure?.endTick ??
        Math.min(project.lengthTicks, playheadTick + project.ppq * 4),
      editable: false,
    };
    history.commit(
      replaceProject(project, (draft) => {
        draft.exercise.editableRanges.push(range);
      }),
    );
  }, [activeVoice, history, playheadTick, project]);

  const handleUpdateEditableRange = useCallback(
    (rangeId: string, patch: Partial<EditableRange>) => {
      const current = project.exercise.editableRanges.find(
        (range) => range.id === rangeId,
      );
      if (!current) return;
      const updated = { ...current, ...patch, editable: false };
      if (updated.voiceIds.length === 0)
        return showNotice("锁定区间至少要包含一个声部");
      if (
        !Number.isFinite(updated.fromTick) ||
        !Number.isFinite(updated.toTick) ||
        updated.fromTick < 0 ||
        updated.toTick <= updated.fromTick ||
        updated.toTick > project.lengthTicks
      ) {
        return showNotice("锁定区间的时间范围无效");
      }
      history.commit(
        replaceProject(project, (draft) => {
          draft.exercise.editableRanges = draft.exercise.editableRanges.map(
            (range) => (range.id === rangeId ? updated : range),
          );
        }),
      );
    },
    [history, project, showNotice],
  );

  const handleDeleteEditableRange = useCallback(
    (rangeId: string) => {
      history.commit(
        replaceProject(project, (draft) => {
          draft.exercise.editableRanges = draft.exercise.editableRanges.filter(
            (range) => range.id !== rangeId,
          );
        }),
      );
    },
    [history, project],
  );

  return {
    handleUpdateProject,
    handleUpdateInstructions,
    handleAddEditableRange,
    handleUpdateEditableRange,
    handleDeleteEditableRange,
  } as const;
}
