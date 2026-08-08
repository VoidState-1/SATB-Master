import { useCallback, useEffect } from "react";
import { audioEngine } from "../../audio/audioEngine";
import {
  chordDraftFromRegion,
  createChordRegion,
  defaultChordDraftAtTick,
} from "../../domain/chords";
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
} from "../../domain/editing";
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
} from "../../domain/model";
import {
  coerceKeyTonicForMode,
  parsePitchClass,
  spellMidi,
  toMidi,
  transposeSpelledPitch,
} from "../../domain/pitch";
import {
  buildMeasures,
  eventAtTick,
  formatPosition,
  keyAtTick,
  ticksPerBeat,
} from "../../domain/time";
import type {
  ClipboardNote,
  EditorState,
} from "./useEditorState";

interface ProjectHistoryEditorPort {
  commit(project: ProjectDocument): void;
}

interface EditorCommandsOptions {
  project: ProjectDocument;
  history: ProjectHistoryEditorPort;
  editor: EditorState;
  playheadTick: number;
  setPlayheadTick(value: number): void;
  showNotice(message: string): void;
}

const GRID_OPTIONS = [
  { label: "1/4", ticks: 960 },
  { label: "1/8", ticks: 480 },
  { label: "1/16", ticks: 240 },
  { label: "1/32", ticks: 120 },
];

export function useEditorCommands({
  project,
  history,
  editor,
  playheadTick,
  setPlayheadTick,
  showNotice,
}: EditorCommandsOptions) {
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

  const commitResult = useCallback(
    (result: { project: ProjectDocument; error?: string }) => {
      if (result.error) {
        showNotice(result.error);
        return false;
      }
      if (result.project !== project) history.commit(result.project);
      return true;
    },
    [history, project, showNotice],
  );

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

  const handleUpdateChordBrush = useCallback(
    (patch: Partial<ChordDraft>) => {
      setChordBrush((current) => ({ ...current, ...patch }));
    },
    [],
  );

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

  const copySelection = useCallback(() => {
    if (editorDomain === "chords") {
      const selected = project.chordTrack.regions.filter((region) =>
        selectedChordIds.has(region.id),
      );
      if (selected.length === 0) return showNotice("没有选中的和弦");
      const earliest = Math.min(...selected.map((region) => region.startTick));
      clipboardRef.current = {
        kind: "chords",
        items: selected.map((region) => ({
          region,
          offset: region.startTick - earliest,
        })),
      };
      showNotice(`已复制 ${selected.length} 个和弦区域`);
      return;
    }
    const selected: ClipboardNote[] = [];
    let earliest = Number.POSITIVE_INFINITY;
    project.satbTracks.forEach((track) =>
      track.notes.forEach((note) => {
        if (selectedNoteIds.has(note.id)) {
          earliest = Math.min(earliest, note.startTick);
          selected.push({ voiceId: track.id, note, offset: 0 });
        }
      }),
    );
    if (selected.length === 0) return showNotice("没有选中的音符");
    clipboardRef.current = {
      kind: "notes",
      items: selected.map((item) => ({
        ...item,
        offset: item.note.startTick - earliest,
      })),
    };
    showNotice(`已复制 ${selected.length} 个音符`);
  }, [editorDomain, project, selectedChordIds, selectedNoteIds, showNotice]);

  const pasteSelection = useCallback(() => {
    const payload = clipboardRef.current;
    if (!payload) return showNotice("编辑器剪贴板为空");
    if (payload.kind === "chords") {
      let nextProject = project;
      const newIds = new Set<string>();
      for (const item of payload.items) {
        const id = createId("chord");
        const result = addChordRegion(nextProject, {
          ...item.region,
          id,
          startTick: playheadTick + item.offset,
          locked: false,
        });
        if (result.error) return showNotice(`粘贴失败：${result.error}`);
        nextProject = result.project;
        newIds.add(id);
      }
      history.commit(nextProject);
      setEditorDomain("chords");
      setSelectedChordIds(newIds);
      setSelectedNoteIds(new Set());
      return;
    }
    let nextProject = project;
    const newIds = new Set<string>();
    for (const item of payload.items) {
      const id = createId("note");
      const result = addNote(nextProject, item.voiceId, {
        ...item.note,
        id,
        startTick: playheadTick + item.offset,
        locked: false,
      });
      if (result.error) return showNotice(`粘贴失败：${result.error}`);
      nextProject = result.project;
      newIds.add(id);
    }
    history.commit(nextProject);
    setEditorDomain("notes");
    setSelectedNoteIds(newIds);
    setSelectedChordIds(new Set());
  }, [history, playheadTick, project, showNotice]);

  const clearSelection = useCallback(() => {
    setSelectedNoteIds(new Set());
    setSelectedChordIds(new Set());
  }, []);

  const selectAllInEditorDomain = useCallback(() => {
    if (editorDomain === "chords") {
      setSelectedChordIds(
        new Set(project.chordTrack.regions.map((region) => region.id)),
      );
      setSelectedNoteIds(new Set());
      return;
    }
    setSelectedNoteIds(
      new Set(
        project.satbTracks
          .filter((track) => track.visible)
          .flatMap((track) => track.notes.map((note) => note.id)),
      ),
    );
    setSelectedChordIds(new Set());
  }, [editorDomain, project]);

  const cutSelection = useCallback(() => {
    if (editorDomain === "chords") {
      const selected = project.chordTrack.regions.filter((region) =>
        selectedChordIds.has(region.id),
      );
      if (selected.length === 0) return showNotice("没有选中的和弦");
      const result = deleteChordRegions(project, selectedChordIds);
      const remaining = result.project.chordTrack.regions.filter((region) =>
        selectedChordIds.has(region.id),
      ).length;
      if (result.error || remaining > 0)
        return showNotice(result.error ?? "选区包含锁定和弦，无法整体剪切");
      const earliest = Math.min(...selected.map((region) => region.startTick));
      clipboardRef.current = {
        kind: "chords",
        items: selected.map((region) => ({
          region,
          offset: region.startTick - earliest,
        })),
      };
      history.commit(result.project);
      clearSelection();
      showNotice(`已剪切 ${selected.length} 个和弦区域`);
      return;
    }

    const selected: ClipboardNote[] = [];
    let earliest = Number.POSITIVE_INFINITY;
    project.satbTracks.forEach((track) =>
      track.notes.forEach((note) => {
        if (!selectedNoteIds.has(note.id)) return;
        earliest = Math.min(earliest, note.startTick);
        selected.push({ voiceId: track.id, note, offset: 0 });
      }),
    );
    if (selected.length === 0) return showNotice("没有选中的音符");
    const result = deleteNotes(project, selectedNoteIds);
    const remaining = result.project.satbTracks.reduce(
      (count, track) =>
        count +
        track.notes.filter((note) => selectedNoteIds.has(note.id)).length,
      0,
    );
    if (result.error || remaining > 0)
      return showNotice(result.error ?? "选区包含锁定音符，无法整体剪切");
    clipboardRef.current = {
      kind: "notes",
      items: selected.map((item) => ({
        ...item,
        offset: item.note.startTick - earliest,
      })),
    };
    history.commit(result.project);
    clearSelection();
    showNotice(`已剪切 ${selected.length} 个音符`);
  }, [
    clearSelection,
    editorDomain,
    history,
    project,
    selectedChordIds,
    selectedNoteIds,
    showNotice,
  ]);

  const duplicateSelection = useCallback(() => {
    if (editorDomain === "chords") {
      const selected = project.chordTrack.regions.filter((region) =>
        selectedChordIds.has(region.id),
      );
      if (selected.length === 0) return showNotice("没有选中的和弦");
      const earliest = Math.min(...selected.map((region) => region.startTick));
      const latestEnd = Math.max(
        ...selected.map((region) => region.startTick + region.durationTicks),
      );
      const offset = latestEnd - earliest;
      let nextProject = project;
      const newIds = new Set<string>();
      for (const region of selected) {
        const id = createId("chord");
        const result = addChordRegion(nextProject, {
          ...region,
          id,
          startTick: region.startTick + offset,
          locked: false,
        });
        if (result.error) return showNotice(`重复失败：${result.error}`);
        nextProject = result.project;
        newIds.add(id);
      }
      history.commit(nextProject);
      setEditorDomain("chords");
      setSelectedChordIds(newIds);
      setSelectedNoteIds(new Set());
      return;
    }

    const selected = project.satbTracks.flatMap((track) =>
      track.notes
        .filter((note) => selectedNoteIds.has(note.id))
        .map((note) => ({ voiceId: track.id, note })),
    );
    if (selected.length === 0) return showNotice("没有选中的音符");
    const earliest = Math.min(...selected.map((item) => item.note.startTick));
    const latestEnd = Math.max(
      ...selected.map((item) => item.note.startTick + item.note.durationTicks),
    );
    const offset = latestEnd - earliest;
    let nextProject = project;
    const newIds = new Set<string>();
    for (const item of selected) {
      const id = createId("note");
      const result = addNote(nextProject, item.voiceId, {
        ...item.note,
        id,
        startTick: item.note.startTick + offset,
        locked: false,
      });
      if (result.error) return showNotice(`重复失败：${result.error}`);
      nextProject = result.project;
      newIds.add(id);
    }
    history.commit(nextProject);
    setEditorDomain("notes");
    setSelectedNoteIds(newIds);
    setSelectedChordIds(new Set());
  }, [
    editorDomain,
    history,
    project,
    selectedChordIds,
    selectedNoteIds,
    showNotice,
  ]);

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

  useEffect(() => {
    const updateModifier = (key: string, pressed: boolean) => {
      if (key === "Control")
        setToolModifiers((current) =>
          current.control === pressed
            ? current
            : { ...current, control: pressed },
        );
      if (key === "Alt")
        setToolModifiers((current) =>
          current.alt === pressed ? current : { ...current, alt: pressed },
        );
    };
    const handleKeyDown = (event: KeyboardEvent) =>
      updateModifier(event.key, true);
    const handleKeyUp = (event: KeyboardEvent) =>
      updateModifier(event.key, false);
    const clearModifiers = () => {
      setToolModifiers({ control: false, alt: false });
      if (editorInteractionActive)
        setCancelEditorRequest((current) => current + 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearModifiers);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearModifiers);
    };
  }, [editorInteractionActive]);

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
    handleUpdateProject,
    handleUpdateInstructions,
    handleAddEditableRange,
    handleUpdateEditableRange,
    handleDeleteEditableRange,
    handleAddChord,
    handleUpdateChord,
    handleMoveChords,
    handleDeleteChords,
    handleSplitChord,
    handleUpdateChordBrush,
    handleUpdateChordTrack,
    handleAddTimingEvent,
    handleUpdateTimingEvent,
    handleDeleteTimingEvent,
    copySelection,
    pasteSelection,
    clearSelection,
    selectAllInEditorDomain,
    cutSelection,
    duplicateSelection,
    cycleActiveVoice,
    movePlayheadByMeasure,
    changeGridResolution,
    changeTimelineZoom,
    transformSelection,
  } as const;
}
