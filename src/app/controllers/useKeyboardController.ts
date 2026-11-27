import { useEffect, useEffectEvent } from "react";
import type { Dispatch, SetStateAction } from "react";
import { MAC_APP_SHORTCUTS, MENU_FILE_TRANSFERS, type DesktopMenuCommand } from "../../../shared/desktop";
import { isMacOS, usesNativeMacWindow } from "../../shortcuts/keyboardPlatform";
import {
  commandForKeyboardEvent,
  keyboardEventToBinding,
  type ShortcutCommandId,
  type ShortcutBindings,
} from "../../shortcuts/shortcutRegistry";
import type { EditorDomain, EditorTool } from "../../features/editor";

const FILE_COMMANDS = new Set<ShortcutCommandId>(["newProject", "openProject", "saveProject", "saveProjectAs"]);
const NON_EDITOR_TARGET = "input, textarea, select, [contenteditable]:not([contenteditable=false])";
const DIALOG = '[role="dialog"], dialog[open]';

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
  const runCommand = useEffectEvent((id: ShortcutCommandId) => {
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
      autoBrushTool: () => setTool("auto-brush"),
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
    commandHandlers[id]();
  });

  const runForTarget = (id: ShortcutCommandId, target: Element) => {
    if (!target.closest(NON_EDITOR_TARGET)) {
      runCommand(id);
    } else if (isMacOS && FILE_COMMANDS.has(id) && target instanceof HTMLElement) {
      target.blur();
      // Let draft fields commit on blur before saving the resulting project.
      window.setTimeout(() => runCommand(id), 0);
    }
  };

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (confirmation || settingsOpen || event.defaultPrevented || event.isComposing) return;
    // SVG 音符也是 Element；否则在谱面内按键会被误判为来自 body。
    const target = event.target instanceof Element ? event.target : document.body;
    if (target.closest(DIALOG)) return;
    if (usesNativeMacWindow && MAC_APP_SHORTCUTS.has(keyboardEventToBinding(event) ?? "")) return;

    // Windows uses Ctrl+Tab while holding the pencil modifier. Cmd+Tab belongs to macOS.
    const transparentToolControl =
      !isMacOS && tool === "select" && event.ctrlKey && !event.altKey && !event.metaKey && event.code === "Tab";
    const command = commandForKeyboardEvent(event, bindings, { ignoreControl: transparentToolControl });
    if (!command || (event.repeat && !command.allowRepeat)) return;
    if (command.id === "runRuleTest" && !handleRunRuleTest) return;
    if (target.closest(NON_EDITOR_TARGET) && !(isMacOS && FILE_COMMANDS.has(command.id))) return;
    if (
      (command.id === "nextVoice" || command.id === "previousVoice") &&
      target !== document.body &&
      !target.closest(".piano-roll")
    ) return;
    event.preventDefault();
    runForTarget(command.id, target);
  });

  const handleMenu = useEffectEvent((command: DesktopMenuCommand) => {
    if (command === "settings" || confirmation || settingsOpen || document.querySelector('dialog[open], [aria-modal="true"]')) return;
    const target = document.activeElement ?? document.body;
    if (Object.hasOwn(MENU_FILE_TRANSFERS, command)) return;
    if (!target.closest(DIALOG)) runForTarget(command as ShortcutCommandId, target);
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => handleKey(event);
    window.addEventListener("keydown", onKeyDown);
    const stopMenu = usesNativeMacWindow ? window.desktop?.menu.onCommand((command) => handleMenu(command)) : undefined;
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stopMenu?.();
    };
  }, [enabled]);
}
