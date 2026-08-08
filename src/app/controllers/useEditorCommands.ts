import { useCallback, useEffect } from "react";
import type { ProjectDocument } from "../../domain/model";
import type { EditorState } from "./useEditorState";
import { useChordCommands } from "./editorCommands/useChordCommands";
import { useNoteCommands } from "./editorCommands/useNoteCommands";
import { useProjectCommands } from "./editorCommands/useProjectCommands";
import { useSelectionCommands } from "./editorCommands/useSelectionCommands";
import { useTimingCommands } from "./editorCommands/useTimingCommands";
import { useViewCommands } from "./editorCommands/useViewCommands";
import type { EditorCommandContext } from "./editorCommands/types";

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

export function useEditorCommands({
  project,
  history,
  editor,
  playheadTick,
  setPlayheadTick,
  showNotice,
}: EditorCommandsOptions) {
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

  const context: EditorCommandContext = {
    project,
    history,
    editor,
    playheadTick,
    setPlayheadTick,
    showNotice,
    commitResult,
  };
  const noteCommands = useNoteCommands(context);
  const projectCommands = useProjectCommands(context);
  const chordCommands = useChordCommands(context);
  const timingCommands = useTimingCommands(context);
  const selectionCommands = useSelectionCommands(context);
  const viewCommands = useViewCommands(context);

  const {
    setToolModifiers,
    editorInteractionActive,
    setCancelEditorRequest,
  } = editor;
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
  }, [editorInteractionActive, setCancelEditorRequest, setToolModifiers]);

  return {
    ...noteCommands,
    ...projectCommands,
    ...chordCommands,
    ...timingCommands,
    ...selectionCommands,
    ...viewCommands,
  } as const;
}
