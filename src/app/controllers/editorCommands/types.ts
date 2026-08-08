import type { ProjectDocument } from "../../../domain/model";
import type { EditorState } from "../useEditorState";

export interface EditorCommandContext {
  project: ProjectDocument;
  history: { commit(project: ProjectDocument): void };
  editor: EditorState;
  playheadTick: number;
  setPlayheadTick(value: number): void;
  showNotice(message: string): void;
  commitResult(result: { project: ProjectDocument; error?: string }): boolean;
}
