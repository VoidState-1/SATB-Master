import { useEffect } from "react";
import {
  commandForKeyboardEvent,
  type ShortcutBindings,
} from "../../shortcuts/shortcutRegistry";
import type { RuleTestWorkspaceController } from "../../app/controllers/useRuleTestWorkspace";

export function useRuleTestKeyboard(
  bindings: ShortcutBindings,
  controller: RuleTestWorkspaceController,
) {
  const {
    run,
    save,
    editor: {
      editorInteractionActive,
      setCancelEditorRequest,
      setSelectedNoteIds,
      setSelectedChordIds,
    },
  } = controller;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const target =
        event.target instanceof HTMLElement ? event.target : document.body;
      if (
        target.matches('input, textarea, select, [contenteditable="true"]') ||
        target.closest('[role="dialog"]')
      )
        return;
      const command = commandForKeyboardEvent(event, bindings);
      if (!command || (event.repeat && !command.allowRepeat)) return;
      if (
        ![
          "runRuleTest",
          "saveProject",
          "saveProjectAs",
          "cancelOrClear",
        ].includes(command.id)
      )
        return;
      event.preventDefault();
      if (command.id === "runRuleTest") void run();
      else if (command.id === "saveProject") void save(false);
      else if (command.id === "saveProjectAs") void save(true);
      else if (editorInteractionActive)
        setCancelEditorRequest((value) => value + 1);
      else {
        setSelectedNoteIds(new Set());
        setSelectedChordIds(new Set());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    bindings,
    editorInteractionActive,
    run,
    save,
    setCancelEditorRequest,
    setSelectedChordIds,
    setSelectedNoteIds,
  ]);
}
