export interface OpenedRuleTestCase {
  document: unknown;
  filePath?: string;
  displayName?: string;
}

export interface SaveRuleTestCaseRequest {
  currentPath?: string;
  forceDialog: boolean;
  json: string;
  defaultName: string;
}

export interface SavedRuleTestCase {
  filePath?: string;
}

export interface RuleTestCaseLibraryEntry {
  key: string;
  document?: unknown;
  filePath?: string;
  displayName: string;
  relativePath?: string;
  error?: string;
}

export interface RuleTestCaseLibrarySnapshot {
  directoryPath?: string;
  entries: RuleTestCaseLibraryEntry[];
}

export interface RuleTestCaseStore {
  open(): Promise<OpenedRuleTestCase | undefined>;
  save(
    request: SaveRuleTestCaseRequest,
  ): Promise<SavedRuleTestCase | undefined>;
  openDirectory(): Promise<RuleTestCaseLibrarySnapshot | undefined>;
}
