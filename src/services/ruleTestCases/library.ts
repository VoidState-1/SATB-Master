import {
  parseRuleTestCase,
  type HarmonyRuleTestCase,
  type RuleTestCaseIssue,
  type RuleTestRunResult,
} from "../../domain/harmony";
import type {
  RuleTestCaseLibraryEntry,
  RuleTestCaseLibrarySnapshot,
} from "./port";

export type RuleTestLibraryStatus =
  | "idle"
  | "running"
  | "passed"
  | "failed"
  | "error"
  | "invalid";

export type RuleTestLibraryStatusFilter =
  | "all"
  | "passed"
  | "failed"
  | "idle";

export interface RuleTestCaseLibraryItem {
  key: string;
  displayName: string;
  filePath?: string;
  relativePath?: string;
  testCase?: HarmonyRuleTestCase;
  issues: RuleTestCaseIssue[];
}

export interface RuleTestCaseLibraryViewItem
  extends RuleTestCaseLibraryItem {
  status: RuleTestLibraryStatus;
  dirty?: boolean;
}

export interface RuleTestLibraryFilter {
  query: string;
  tag?: string;
  status: RuleTestLibraryStatusFilter;
}

function fileIssue(message: string): RuleTestCaseIssue {
  return { path: "$", code: "value", message };
}

function itemKey(
  directoryPath: string | undefined,
  entry: RuleTestCaseLibraryEntry,
) {
  return `${directoryPath ?? "directory"}::${entry.key}`;
}

export function buildRuleTestCaseLibraryItems(
  snapshot: RuleTestCaseLibrarySnapshot,
): RuleTestCaseLibraryItem[] {
  return snapshot.entries.map((entry) => {
    const base = {
      key: itemKey(snapshot.directoryPath, entry),
      displayName: entry.displayName,
      filePath: entry.filePath,
      relativePath: entry.relativePath,
    };
    if (entry.error)
      return { ...base, issues: [fileIssue(entry.error)] };
    if (entry.document === undefined)
      return { ...base, issues: [fileIssue("规则测试用例没有可读取的内容")] };
    const parsed = parseRuleTestCase(entry.document);
    return {
      ...base,
      testCase: parsed.testCase,
      issues: parsed.issues,
    };
  });
}

export function createRecentRuleTestCaseItem(options: {
  testCase: HarmonyRuleTestCase;
  filePath?: string;
  displayName?: string;
}): RuleTestCaseLibraryItem {
  const displayName = options.displayName ?? options.testCase.title;
  return {
    key: options.filePath ?? `case::${options.testCase.id}::${displayName}`,
    displayName,
    filePath: options.filePath,
    testCase: structuredClone(options.testCase),
    issues: [],
  };
}

export function addRecentRuleTestCaseItem(
  items: readonly RuleTestCaseLibraryItem[],
  item: RuleTestCaseLibraryItem,
  limit = 8,
) {
  const identity = item.filePath ?? item.key;
  return [
    item,
    ...items.filter((candidate) =>
      (candidate.filePath ?? candidate.key) !== identity,
    ),
  ].slice(0, limit);
}

export function ruleTestLibraryStatus(
  item: RuleTestCaseLibraryItem,
  result?: RuleTestRunResult,
  running = false,
): RuleTestLibraryStatus {
  if (!item.testCase || item.issues.length > 0) return "invalid";
  if (running) return "running";
  return result?.status ?? "idle";
}

export function filterRuleTestCaseLibraryItems(
  items: readonly RuleTestCaseLibraryViewItem[],
  filter: RuleTestLibraryFilter,
) {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    const testCase = item.testCase;
    const text = testCase
      ? `${testCase.title} ${testCase.target.ruleId} ${testCase.tags.join(" ")}`.toLowerCase()
      : `${item.displayName} ${item.issues.map((issue) => issue.message).join(" ")}`.toLowerCase();
    if (query && !text.includes(query)) return false;
    if (filter.tag && !testCase?.tags.includes(filter.tag)) return false;
    if (filter.status === "passed" && item.status !== "passed") return false;
    if (
      filter.status === "failed" &&
      !["failed", "error", "invalid"].includes(item.status)
    )
      return false;
    if (filter.status === "idle" && item.status !== "idle") return false;
    return true;
  });
}

export function collectRuleTestLibraryTags(
  items: readonly RuleTestCaseLibraryItem[],
) {
  return [
    ...new Set(items.flatMap((item) => item.testCase?.tags ?? [])),
  ].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export interface RuleTestLibraryRunner {
  run(
    testCase: HarmonyRuleTestCase,
    options: { signal?: AbortSignal },
  ): Promise<RuleTestRunResult>;
}

export interface RuleTestLibraryBatchResult {
  status: "completed" | "cancelled";
  results: Record<string, RuleTestRunResult>;
  passed: number;
  failed: number;
}

export async function runRuleTestLibraryBatch(
  items: readonly RuleTestCaseLibraryItem[],
  runner: RuleTestLibraryRunner,
  options: {
    signal?: AbortSignal;
    onStart?(key: string): void;
    onResult?(key: string, result: RuleTestRunResult): void;
  } = {},
): Promise<RuleTestLibraryBatchResult> {
  const results: Record<string, RuleTestRunResult> = {};
  let passed = 0;
  let failed = 0;
  const runnable = items.filter(
    (item) => item.testCase && item.issues.length === 0,
  );
  for (const item of runnable) {
    if (options.signal?.aborted) break;
    options.onStart?.(item.key);
    const result = await runner.run(item.testCase!, {
      signal: options.signal,
    });
    if (options.signal?.aborted || result.error?.code === "aborted") break;
    results[item.key] = result;
    options.onResult?.(item.key, result);
    if (result.status === "passed") passed += 1;
    else failed += 1;
  }
  return {
    status: options.signal?.aborted ? "cancelled" : "completed",
    results,
    passed,
    failed,
  };
}
