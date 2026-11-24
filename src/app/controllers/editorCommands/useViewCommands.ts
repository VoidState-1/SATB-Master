import { useCallback } from "react";
import {
  transformChordRegions,
  transformNotes,
} from "../../../domain/editing";
import { getAllPlayableTracks } from "../../../domain/project";
import { toMidi, transposeSpelledPitch } from "../../../domain/pitch";
import { buildMeasures, keyAtTick, nearestGridTick } from "../../../domain/time";
import {
  nextGridResolution,
  stepTimelineZoom,
} from "../../../features/editor";
import type { EditorCommandContext } from "./types";

export function useViewCommands(
  { project, editor, playheadTick, setPlayheadTick, commitResult }: EditorCommandContext,
  previewNote: (trackId: string, midiNote: number) => void,
) {
  const {
    activeVoice,
    setActiveVoice,
    editorDomain,
    gridTicks,
    setGridTicks,
    setPixelsPerBeat,
    selectedNoteIds,
    selectedChordIds,
  } = editor;

  const cycleActiveVoice = useCallback(
    (direction: 1 | -1) => {
      const visibleVoices = getAllPlayableTracks(project)
        .filter((track) => track.visible)
        .map((track) => track.id);
      if (visibleVoices.length === 0) return;
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
    [activeVoice, project, setActiveVoice],
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
    setGridTicks((current) => nextGridResolution(current, direction));
  }, []);

  const changeTimelineZoom = useCallback((direction: 1 | -1) => {
    setPixelsPerBeat((current) => stepTimelineZoom(current, direction));
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
          ? nearestGridTick(note.startTick, gridTicks, {
              maximum: project.lengthTicks,
            })
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
      for (const track of getAllPlayableTracks(result.project)) {
        const note = track.notes.find(
          (candidate) => candidate.id === selectedId,
        );
        if (note) {
          previewNote(track.id, toMidi(note.pitch));
          return;
        }
      }
    },
    [
      commitResult,
      editorDomain,
      gridTicks,
      previewNote,
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
