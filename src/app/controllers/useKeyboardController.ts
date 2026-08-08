import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  commandForKeyboardEvent,
  type ShortcutBindings,
} from "../../shortcuts/shortcutRegistry";
import type { EditorDomain, EditorTool } from "../../features/editor";

interface HistoryKeyboardPort {
  undo(): void;
  redo(): void;
}

interface KeyboardControllerOptions {
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
  bindings,
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

      switch (command.id) {
        case "newProject":
          void handleNew();
          break;
        case "openProject":
          void handleOpen();
          break;
        case "saveProject":
          void handleSave(false);
          break;
        case "saveProjectAs":
          void handleSave(true);
          break;
        case "undo":
          history.undo();
          break;
        case "redo":
          history.redo();
          break;
        case "selectAll":
          selectAllInEditorDomain();
          break;
        case "clearSelection":
          clearSelection();
          break;
        case "copySelection":
          copySelection();
          break;
        case "cutSelection":
          cutSelection();
          break;
        case "pasteSelection":
          pasteSelection();
          break;
        case "duplicateSelection":
          duplicateSelection();
          break;
        case "deleteSelection":
          if (editorDomain === "chords") handleDeleteChords(selectedChordIds);
          else handleDeleteNotes(selectedNoteIds);
          break;
        case "cancelOrClear":
          if (editorInteractionActive)
            setCancelEditorRequest((current) => current + 1);
          else clearSelection();
          break;
        case "quantizeSelection":
          transformSelection(0, 0, true);
          break;
        case "moveSelectionLeft":
          transformSelection(-gridTicks, 0);
          break;
        case "moveSelectionRight":
          transformSelection(gridTicks, 0);
          break;
        case "pitchUp":
          if (selectedChordIds.size === 0) transformSelection(0, 1);
          break;
        case "pitchDown":
          if (selectedChordIds.size === 0) transformSelection(0, -1);
          break;
        case "octaveUp":
          if (selectedChordIds.size === 0) transformSelection(0, 12);
          break;
        case "octaveDown":
          if (selectedChordIds.size === 0) transformSelection(0, -12);
          break;
        case "selectTool":
          setTool("select");
          break;
        case "pencilTool":
          setTool("pencil");
          break;
        case "eraserTool":
          setTool("eraser");
          break;
        case "splitTool":
          setTool("split");
          break;
        case "nextVoice":
          cycleActiveVoice(1);
          break;
        case "previousVoice":
          cycleActiveVoice(-1);
          break;
        case "playPause":
          void handlePlay();
          break;
        case "goToStart":
          setPlayheadTick(0);
          break;
        case "goToEnd":
          setPlayheadTick(projectLengthTicks);
          break;
        case "previousMeasure":
          movePlayheadByMeasure(-1);
          break;
        case "nextMeasure":
          movePlayheadByMeasure(1);
          break;
        case "gridCoarser":
          changeGridResolution(-1);
          break;
        case "gridFiner":
          changeGridResolution(1);
          break;
        case "zoomOut":
          changeTimelineZoom(-1);
          break;
        case "zoomIn":
          changeTimelineZoom(1);
          break;
      }
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
  ]);
}
