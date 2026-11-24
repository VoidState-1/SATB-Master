// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioEngine } from "../../audio/audioEngine";
import { createEmptyProject, getMusicalTrack } from "../../domain/project";
import { useProjectHistory } from "../../hooks/useProjectHistory";
import { useEditorCommands } from "./useEditorCommands";
import { useEditorState } from "./useEditorState";

describe("编辑器额外声部命令", () => {
  let root: Root;
  let state: {
    history: ReturnType<typeof useProjectHistory>;
    editor: ReturnType<typeof useEditorState>;
    commands: ReturnType<typeof useEditorCommands>;
    setPlayheadTick(tick: number): void;
  };
  const showNotice = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(audioEngine, "previewNote").mockResolvedValue();
    showNotice.mockClear();
    const initial = createEmptyProject();
    function Harness() {
      const history = useProjectHistory(initial);
      const project = history.project;
      const editor = useEditorState(initial, project);
      const [playheadTick, setPlayheadTick] = useState(0);
      const commands = useEditorCommands({
        project, history, editor, playheadTick, setPlayheadTick, showNotice,
      });
      state = { history, editor, commands, setPlayheadTick };
      return null;
    }
    root = createRoot(document.createElement("div"));
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("提交轨道和音符编辑，拒绝完全重叠并支持删除撤销与重做", () => {
    act(() => state.commands.handleAddAuxiliaryTrack({ program: 42 }));
    const id = state.editor.activeVoice;
    const ppq = state.history.project.ppq;
    expect(id).toBe(state.history.project.auxiliaryTracks[0].id);
    act(() => state.commands.handleAddNote(id, 0, 60, ppq));
    const low = state.editor.selectedNote!.note.id;
    act(() => state.commands.handleAddNote(id, 0, 64, ppq));
    const high = state.editor.selectedNote!.note.id;
    act(() => state.commands.handleAddNote(id, ppq / 2, 60, ppq));
    expect(getMusicalTrack(state.history.project, id).notes).toHaveLength(3);

    const project = state.history.project;
    act(() => state.commands.handleAddNote(id, 0, 60, ppq));
    expect(state.history.project).toBe(project);
    expect(showNotice).toHaveBeenLastCalledWith(expect.stringContaining("完全重叠"));
    expect(audioEngine.previewNote).toHaveBeenCalledTimes(3);

    act(() => state.commands.handleSelectNotes(new Set([high])));
    expect(state.editor.selectedNote?.voiceId).toBe(id);
    expect(audioEngine.previewNote).toHaveBeenLastCalledWith(64, id, {
      trackIndex: 4, program: 42,
    });
    act(() => state.commands.transformSelection(0, 1));
    expect(audioEngine.previewNote).toHaveBeenLastCalledWith(65, id, {
      trackIndex: 4, program: 42,
    });

    act(() => state.commands.handleAddNote("soprano", 0, 72, ppq));
    const soprano = state.editor.selectedNote!.note.id;
    act(() => state.commands.handleSelectNotes(new Set([soprano, low, high])));
    act(() => state.commands.handleUpdateTrack(id, { name: "弦乐", locked: true }));
    act(() => state.commands.handleDeleteAuxiliaryTrack(id));
    expect(showNotice).toHaveBeenLastCalledWith(expect.stringContaining("请先解锁"));
    expect(state.editor.activeVoice).toBe(id);
    act(() => state.commands.handleUpdateTrack(id, { locked: false }));
    act(() => state.commands.handleDeleteAuxiliaryTrack(id));
    expect(state.history.project.auxiliaryTracks).toHaveLength(0);
    expect(state.editor.activeVoice).toBe("soprano");
    expect(state.editor.selectedNoteIds).toEqual(new Set([soprano]));
    act(() => state.history.undo());
    expect(getMusicalTrack(state.history.project, id).name).toBe("弦乐");
    expect(getMusicalTrack(state.history.project, id).notes).toHaveLength(3);
    act(() => state.history.redo());
    expect(state.history.project.auxiliaryTracks).toHaveLength(0);
  });

  it("全选、剪切和粘贴额外声部音符，原轨消失后粘贴到活跃声部", () => {
    act(() => state.commands.handleAddAuxiliaryTrack());
    const id = state.editor.activeVoice;
    const ppq = state.history.project.ppq;
    act(() => state.commands.handleAddNote(id, 0, 64, ppq));
    const noteId = state.editor.selectedNote!.note.id;
    act(() => state.commands.selectAllInEditorDomain());
    expect(state.editor.selectedNoteIds).toEqual(new Set([noteId]));
    act(() => state.commands.cutSelection());
    expect(getMusicalTrack(state.history.project, id).notes).toHaveLength(0);
    act(() => state.setPlayheadTick(ppq));
    act(() => state.commands.pasteSelection());
    expect(getMusicalTrack(state.history.project, id).notes[0].startTick).toBe(ppq);
    act(() => state.commands.copySelection());
    act(() => state.commands.handleDeleteAuxiliaryTrack(id));
    act(() => state.editor.setActiveVoice("alto"));
    act(() => state.commands.pasteSelection());
    expect(getMusicalTrack(state.history.project, "alto").notes[0].startTick).toBe(ppq);
  });

  it("撤销活跃额外声部的创建后安全回退，并可重做", () => {
    act(() => state.commands.handleAddAuxiliaryTrack());
    const id = state.editor.activeVoice;
    act(() => state.history.undo());
    expect(state.editor.activeVoice).toBe("soprano");
    act(() => state.history.redo());
    expect(state.editor.activeVoice).toBe(id);
  });
});
