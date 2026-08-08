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

export function useViewCommands({
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

  const cycleActiveVoice = useCallback(
    (direction: 1 | -1) => {
      const visibleVoices = project.satbTracks
        .filter((track) => track.visible)
        .map((track) => track.id);
      if (visibleVoices.length <= 1) return;
      const currentIndex = visibleVoices.indexOf(activeVoice);
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : visibleVoices.length - 1
          : (currentIndex + direction + visibleVoices.length) %
            visibleVoices.length;
      setActiveVoice(visibleVoices[nextIndex]);
    },
    [activeVoice, project.satbTracks],
  );

  const movePlayheadByMeasure = useCallback(
    (direction: 1 | -1) => {
      const measures = buildMeasures(project);
      if (measures.length === 0) return;
      const containingIndex = measures.findIndex(
        (measure) => playheadTick < measure.endTick,
      );
      // 工程末尾位于最后小节的右边界，不属于任何小节；导航时仍应将它归入最后小节。
      const nextIndex =
        containingIndex < 0
          ? measures.length - 1
          : Math.max(
              0,
              Math.min(measures.length - 1, containingIndex + direction),
            );
      setPlayheadTick(measures[nextIndex]?.startTick ?? 0);
    },
    [playheadTick, project],
  );

  const changeGridResolution = useCallback((direction: 1 | -1) => {
    setGridTicks((current) => {
      const currentIndex = GRID_OPTIONS.findIndex(
        (option) => option.ticks === current,
      );
      const nextIndex = Math.max(
        0,
        Math.min(GRID_OPTIONS.length - 1, currentIndex + direction),
      );
      return GRID_OPTIONS[nextIndex]?.ticks ?? current;
    });
  }, []);

  const changeTimelineZoom = useCallback((direction: 1 | -1) => {
    setPixelsPerBeat((current) =>
      Math.max(42, Math.min(140, current + direction * 10)),
    );
  }, []);

  const transformSelection = useCallback(
    (tickDelta: number, pitchDelta: number, quantize = false) => {
      if (editorDomain === "chords") {
        commitResult(
          transformChordRegions(project, selectedChordIds, (region) => ({
            ...region,
            startTick: quantize
              ? Math.floor(region.startTick / gridTicks) * gridTicks
              : region.startTick + tickDelta,
          })),
        );
        return;
      }
      const result = transformNotes(project, selectedNoteIds, (note) => {
        const startTick = quantize
          ? Math.round(note.startTick / gridTicks) * gridTicks
          : note.startTick + tickDelta;
        const currentMidi = toMidi(note.pitch);
        const nextMidi = Math.max(0, Math.min(127, currentMidi + pitchDelta));
        return {
          ...note,
          startTick,
          pitch: transposeSpelledPitch(
            note.pitch,
            nextMidi - currentMidi,
            keyAtTick(project.keyEvents, startTick),
          ),
        };
      });
      if (!commitResult(result) || selectedNoteIds.size !== 1) return;
      const selectedId = selectedNoteIds.values().next().value;
      for (const track of result.project.satbTracks) {
        const note = track.notes.find(
          (candidate) => candidate.id === selectedId,
        );
        if (note) {
          void audioEngine.previewNote(toMidi(note.pitch), track.id);
          return;
        }
      }
    },
    [
      commitResult,
      editorDomain,
      gridTicks,
      project,
      selectedChordIds,
      selectedNoteIds,
    ],
  );

  return {
    cycleActiveVoice,
    movePlayheadByMeasure,
    changeGridResolution,
    changeTimelineZoom,
    transformSelection,
  } as const;
}
const GRID_OPTIONS = [
  { label: "1/4", ticks: 960 },
  { label: "1/8", ticks: 480 },
  { label: "1/16", ticks: 240 },
  { label: "1/32", ticks: 120 },
];

