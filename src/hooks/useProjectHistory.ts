import type { ProjectDocument } from "../domain/project";
import { useDocumentHistory } from "./useDocumentHistory";

export function useProjectHistory(initialProject: ProjectDocument) {
  const history = useDocumentHistory(initialProject);

  return {
    ...history,
    project: history.document,
  };
}
