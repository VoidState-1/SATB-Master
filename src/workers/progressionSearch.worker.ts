import type { ProjectDocument } from "../domain/project";
import {
  searchProgressionCandidates,
  type ProgressionSearchOptions,
  type ProgressionSearchResult,
} from "../domain/harmony/harmonization";

export interface ProgressionSearchRequest {
  project: ProjectDocument;
  options: ProgressionSearchOptions;
}

export type ProgressionSearchResponse =
  | { result: ProgressionSearchResult }
  | { error: string };

self.addEventListener("message", (event: MessageEvent<ProgressionSearchRequest>) => {
  const { project, options } = event.data;
  let response: ProgressionSearchResponse;
  try {
    response = { result: searchProgressionCandidates(project, options) };
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
});
