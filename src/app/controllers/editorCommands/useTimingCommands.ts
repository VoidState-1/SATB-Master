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

export function useTimingCommands({
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

  const timingTick = useCallback(
    (type: "tempo" | "meter" | "key") => {
      if (type === "tempo")
        return Math.round(playheadTick / gridTicks) * gridTicks;
      return (
        buildMeasures(project).find(
          (measure) =>
            playheadTick >= measure.startTick && playheadTick < measure.endTick,
        )?.startTick ?? 0
      );
    },
    [gridTicks, playheadTick, project],
  );

  const handleAddTimingEvent = useCallback(
    (type: "tempo" | "meter" | "key", requestedTick?: number) => {
      const tick =
        requestedTick === undefined
          ? timingTick(type)
          : Math.max(
              0,
              Math.min(project.lengthTicks, Math.round(requestedTick)),
            );
      if (requestedTick !== undefined && type !== "tempo") {
        const measure = buildMeasures(project).find(
          (candidate) =>
            tick >= candidate.startTick && tick < candidate.endTick,
        );
        if (measure?.startTick !== tick)
          return showNotice("拍号和调号变化只能添加在小节起点");
      }
      if (
        type === "key" &&
        project.chordTrack.regions.some(
          (region) =>
            region.startTick < tick &&
            region.startTick + region.durationTicks > tick,
        )
      )
        return showNotice("调性变化不能插入和弦区域内部，请先切分和弦");
      const source =
        type === "tempo"
          ? project.tempoEvents
          : type === "meter"
            ? project.meterEvents
            : project.keyEvents;
      if (source.some((event) => event.tick === tick))
        return showNotice("该位置已经存在同类变化事件");
      history.commit(
        replaceProject(project, (draft) => {
          if (type === "tempo") {
            const current = eventAtTick(project.tempoEvents, tick);
            draft.tempoEvents.push({
              id: createId("tempo"),
              tick,
              bpm: current.bpm,
            });
            draft.tempoEvents.sort((a, b) => a.tick - b.tick);
          } else if (type === "meter") {
            const current = eventAtTick(project.meterEvents, tick);
            draft.meterEvents.push({
              id: createId("meter"),
              tick,
              numerator: current.numerator,
              denominator: current.denominator,
            });
            draft.meterEvents.sort((a, b) => a.tick - b.tick);
          } else {
            const current = eventAtTick(project.keyEvents, tick);
            draft.keyEvents.push({
              id: createId("key"),
              tick,
              tonic: current.tonic,
              mode: current.mode,
            });
            draft.keyEvents.sort((a, b) => a.tick - b.tick);
          }
        }),
      );
    },
    [history, project, showNotice, timingTick],
  );

  const handleUpdateTimingEvent = useCallback(
    (
      type: "tempo" | "meter" | "key",
      id: string,
      patch: Record<string, string | number>,
    ) => {
      history.commit(
        replaceProject(project, (draft) => {
          if (type === "tempo") {
            draft.tempoEvents = draft.tempoEvents.map((event) =>
              event.id === id
                ? {
                    ...event,
                    bpm: Math.max(20, Math.min(300, Number(patch.bpm))),
                  }
                : event,
            );
          } else if (type === "meter") {
            const denominator = [2, 4, 8, 16].includes(
              Number(patch.denominator),
            )
              ? (Number(patch.denominator) as 2 | 4 | 8 | 16)
              : 4;
            draft.meterEvents = draft.meterEvents.map((event) =>
              event.id === id
                ? {
                    ...event,
                    numerator: Math.max(
                      1,
                      Math.min(12, Number(patch.numerator)),
                    ),
                    denominator,
                  }
                : event,
            );
          } else {
            draft.keyEvents = draft.keyEvents.map((event) =>
              event.id === id
                ? (() => {
                    const mode =
                      patch.mode === undefined
                        ? event.mode
                        : patch.mode === "minor"
                          ? "minor"
                          : "major";
                    return {
                      ...event,
                      tonic: coerceKeyTonicForMode(
                        parsePitchClass(String(patch.tonic)) ?? event.tonic,
                        mode,
                      ),
                      mode,
                    };
                  })()
                : event,
            );
            reconcileChordIdentities(draft);
          }
        }),
      );
    },
    [history, project],
  );

  const handleDeleteTimingEvent = useCallback(
    (type: "tempo" | "meter" | "key", id: string) => {
      const source =
        type === "tempo"
          ? project.tempoEvents
          : type === "meter"
            ? project.meterEvents
            : project.keyEvents;
      if (source.find((event) => event.id === id)?.tick === 0)
        return showNotice("起始事件不能删除");
      history.commit(
        replaceProject(project, (draft) => {
          if (type === "tempo")
            draft.tempoEvents = draft.tempoEvents.filter(
              (event) => event.id !== id,
            );
          if (type === "meter")
            draft.meterEvents = draft.meterEvents.filter(
              (event) => event.id !== id,
            );
          if (type === "key")
            draft.keyEvents = draft.keyEvents.filter(
              (event) => event.id !== id,
            );
          if (type === "key") reconcileChordIdentities(draft);
        }),
      );
    },
    [history, project, showNotice],
  );

  return {
    handleAddTimingEvent,
    handleUpdateTimingEvent,
    handleDeleteTimingEvent,
  } as const;
}
