import { useCallback } from "react";
import { defaultChordDraftAtTick } from "../../domain/chords";
import { createEmptyProject, type ProjectDocument } from "../../domain/project";
import { useProjectHistory } from "../../hooks/useProjectHistory";
import { logger } from "../../services/logging";
import { useEditorState } from "./useEditorState";

export function useProjectController(initialProject: ProjectDocument) {
  const documentHistory = useProjectHistory(initialProject);
  const { canUndo, canRedo, undo, redo } = documentHistory;
  const undoWithBreadcrumb = useCallback(() => {
    if (canUndo) logger.recordBreadcrumb("editor", "撤销");
    undo();
  }, [canUndo, undo]);
  const redoWithBreadcrumb = useCallback(() => {
    if (canRedo) logger.recordBreadcrumb("editor", "重做");
    redo();
  }, [canRedo, redo]);
  const history = { ...documentHistory, undo: undoWithBreadcrumb, redo: redoWithBreadcrumb };
  const project = history.project;
  const editor = useEditorState(initialProject, project);

  const resetWorkspace = useCallback(
    (nextProject: ProjectDocument, setPlayheadTick: (tick: number) => void) => {
      editor.setSelectedNoteIds(new Set());
      editor.setSelectedChordIds(new Set());
      editor.setChordBrush(defaultChordDraftAtTick(nextProject, 0));
      setPlayheadTick(0);
    },
    [
      editor.setChordBrush,
      editor.setSelectedChordIds,
      editor.setSelectedNoteIds,
    ],
  );

  return { history, project, editor, resetWorkspace } as const;
}
