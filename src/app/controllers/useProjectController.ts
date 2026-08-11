import { useCallback } from "react";
import { defaultChordDraftAtTick } from "../../domain/chords";
import { createEmptyProject, type ProjectDocument } from "../../domain/project";
import { useProjectHistory } from "../../hooks/useProjectHistory";
import { useEditorState } from "./useEditorState";

export function createProjectWithRuleProfileTemplate(
  loadRuleProfile: () => ProjectDocument["ruleProfile"] | undefined,
) {
  const project = createEmptyProject();
  const template = loadRuleProfile();
  if (template) project.ruleProfile = template;
  return project;
}

export function useProjectController(initialProject: ProjectDocument) {
  const history = useProjectHistory(initialProject);
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
