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

export interface RuleTestCaseStore {
  open(): Promise<OpenedRuleTestCase | undefined>;
  save(
    request: SaveRuleTestCaseRequest,
  ): Promise<SavedRuleTestCase | undefined>;
}
