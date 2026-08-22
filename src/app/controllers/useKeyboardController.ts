import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  commandForKeyboardEvent,
  type ShortcutCommandId,
  type ShortcutBindings,
} from "../../shortcuts/shortcutRegistry";
import type { EditorDomain, EditorTool } from "../../features/editor";

interface HistoryKeyboardPort {
  undo(): void;
  redo(): void;
}

interface KeyboardControllerOptions {
  enabled?: boolean;
  bindings: ShortcutBindings;
  confirmation: unknown;
  settingsOpen: boolean;
  tool: EditorTool;
  editorDomain: EditorDomain;
  editorInteractionActive: boolean;
  gridTicks: number;
  projectLengthTicks: number;
  selectedNoteIds: Set<string>;
  selectedChordIds: Set<string>;
  history: HistoryKeyboardPort;
  setTool(tool: EditorTool): void;
  setPlayheadTick(tick: number): void;
  handleRunRuleTest?(): void;
  setCancelEditorRequest: Dispatch<SetStateAction<number>>;
  handleNew(): Promise<void>;
  handleOpen(): Promise<void>;
  handleSave(forceDialog?: boolean): Promise<void>;
  handlePlay(): Promise<void>;
  handleDeleteChords(ids: Set<string>): void;
  handleDeleteNotes(ids: Set<string>): void;
  selectAllInEditorDomain(): void;
  clearSelection(): void;
  copySelection(): void;
  cutSelection(): void;
  pasteSelection(): void;
  duplicateSelection(): void;
  cycleActiveVoice(direction: 1 | -1): void;
  movePlayheadByMeasure(direction: 1 | -1): void;
  changeGridResolution(direction: 1 | -1): void;
  changeTimelineZoom(direction: 1 | -1): void;
  transformSelection(
    tickDelta: number,
    pitchDelta: number,
    quantize?: boolean,
  ): void;
}

export function useKeyboardController({
  enabled = true,
  bindings,
  handleRunRuleTest,
  confirmation,
  settingsOpen,
  tool,
  editorDomain,
  editorInteractionActive,
  gridTicks,
  projectLengthTicks,
  selectedNoteIds,
  selectedChordIds,
  history,
  setTool,
  setPlayheadTick,
  setCancelEditorRequest,
  handleNew,
  handleOpen,
  handleSave,
  handlePlay,
  handleDeleteChords,
  handleDeleteNotes,
  selectAllInEditorDomain,
  clearSelection,
  copySelection,
  cutSelection,
  pasteSelection,
  duplicateSelection,
  cycleActiveVoice,
  movePlayheadByMeasure,
  changeGridResolution,
  changeTimelineZoom,
  transformSelection,
}: KeyboardControllerOptions) {
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (confirmation || settingsOpen || event.isComposing) return;
      const target =
        event.target instanceof HTMLElement ? event.target : document.body;
      if (
        target.matches('input, textarea, select, [contenteditable="true"]') ||
        target.closest('[role="dialog"]')
      )
        return;
      // Ctrl 临时切换画笔时，Tab 仍交给声部切换快捷键处理。
      const transparentToolControl =
        tool === "select" &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.code === "Tab";
      const command = commandForKeyboardEvent(event, bindings, {
        ignoreControl: transparentToolControl,
      });
      if (!command || (event.repeat && !command.allowRepeat)) return;
      if (
        (command.id === "nextVoice" || command.id === "previousVoice") &&
        target !== document.body &&
        !target.closest(".piano-roll")
      )
        return;
      event.preventDefault();

      const commandHandlers: Record<ShortcutCommandId, () => void> = {
        newProject: () => void handleNew(),
        openProject: () => void handleOpen(),
        saveProject: () => void handleSave(false),
        saveProjectAs: () => void handleSave(true),
        runRuleTest: () => handleRunRuleTest?.(),
        undo: () => history.undo(),
        redo: () => history.redo(),
        selectAll: selectAllInEditorDomain,
        clearSelection,
        copySelection,
        cutSelection,
        pasteSelection,
        duplicateSelection,
        deleteSelection: () => {
          if (editorDomain === "chords") handleDeleteChords(selectedChordIds);
          else handleDeleteNotes(selectedNoteIds);
        },
        cancelOrClear: () => {
          if (editorInteractionActive)
            setCancelEditorRequest((current) => current + 1);
          else clearSelection();
        },
        quantizeSelection: () => transformSelection(0, 0, true),
        moveSelectionLeft: () => transformSelection(-gridTicks, 0),
        moveSelectionRight: () => transformSelection(gridTicks, 0),
        pitchUp: () => {
          if (selectedChordIds.size === 0) transformSelection(0, 1);
        },
        pitchDown: () => {
          if (selectedChordIds.size === 0) transformSelection(0, -1);
        },
        octaveUp: () => {
          if (selectedChordIds.size === 0) transformSelection(0, 12);
        },
        octaveDown: () => {
          if (selectedChordIds.size === 0) transformSelection(0, -12);
        },
        selectTool: () => setTool("select"),
        pencilTool: () => setTool("pencil"),
        eraserTool: () => setTool("eraser"),
        splitTool: () => setTool("split"),
        nextVoice: () => cycleActiveVoice(1),
        previousVoice: () => cycleActiveVoice(-1),
        playPause: () => void handlePlay(),
        goToStart: () => setPlayheadTick(0),
        goToEnd: () => setPlayheadTick(projectLengthTicks),
        previousMeasure: () => movePlayheadByMeasure(-1),
        nextMeasure: () => movePlayheadByMeasure(1),
        gridCoarser: () => changeGridResolution(-1),
        gridFiner: () => changeGridResolution(1),
        zoomOut: () => changeTimelineZoom(-1),
        zoomIn: () => changeTimelineZoom(1),
      };
      commandHandlers[command.id]();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    bindings,
    changeGridResolution,
    changeTimelineZoom,
    clearSelection,
    confirmation,
    copySelection,
    cutSelection,
    cycleActiveVoice,
    duplicateSelection,
    editorDomain,
    editorInteractionActive,
    gridTicks,
    handleRunRuleTest,
    handleDeleteChords,
    handleDeleteNotes,
    handleNew,
    handleOpen,
    handlePlay,
    handleSave,
    history,
    movePlayheadByMeasure,
    pasteSelection,
    projectLengthTicks,
    selectAllInEditorDomain,
    selectedChordIds,
    selectedNoteIds,
    settingsOpen,
    setCancelEditorRequest,
    setPlayheadTick,
    setTool,
    tool,
    transformSelection,
    enabled,
  ]);
}
