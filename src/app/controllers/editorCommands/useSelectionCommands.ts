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

export function useSelectionCommands({
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
    getAllPlayableTracks(project).forEach((track) =>
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
      const tracks = getAllPlayableTracks(nextProject);
      const trackId = tracks.some((track) => track.id === item.voiceId)
        ? item.voiceId
        : activeVoice;
      const result = addNote(nextProject, trackId, {
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
  }, [activeVoice, history, playheadTick, project, showNotice]);

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
        getAllPlayableTracks(project)
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
    getAllPlayableTracks(project).forEach((track) =>
      track.notes.forEach((note) => {
        if (!selectedNoteIds.has(note.id)) return;
        earliest = Math.min(earliest, note.startTick);
        selected.push({ voiceId: track.id, note, offset: 0 });
      }),
    );
    if (selected.length === 0) return showNotice("没有选中的音符");
    const result = deleteNotes(project, selectedNoteIds);
    const remaining = getAllPlayableTracks(result.project).reduce(
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

    const selected = getAllPlayableTracks(project).flatMap((track) =>
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

  return {
    copySelection,
    pasteSelection,
    clearSelection,
    selectAllInEditorDomain,
    cutSelection,
    duplicateSelection,
  } as const;
}
