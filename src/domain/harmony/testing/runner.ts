import type { ProjectDocument } from "../../project";
import {
  RuleScheduler,
  type HarmonyCheckResult,
  type RuleDefinition,
} from "../runtime";
import { HARMONY_RULE_DEFINITION_BY_ID } from "../rules/catalog";
import { compareRuleTestResult } from "./comparator";
import type {
  HarmonyRuleTestCase,
  RuleTestComparison,
  RuleTestExecutionError,
  RuleTestRunResult,
} from "./model";
import { materializeRuleTestProject } from "./projectFixture";

function emptyResult(revision: number): HarmonyCheckResult {
  return {
    diagnostics: [],
    skippedRules: [],
    skippedRuleIds: [],
    revision,
    superseded: false,
    invalidationRanges: [],
  };
}

function emptyComparison(): RuleTestComparison {
  return {
    passed: false,
    matches: [],
    missing: [],
    unexpected: [],
    mismatched: [],
    skipMismatches: [],
  };
}

function executionFailure(
  revision: number,
  startedAt: number,
  error: RuleTestExecutionError,
  actual = emptyResult(revision),
): RuleTestRunResult {
  return {
    status: "error",
    actual,
    comparison: emptyComparison(),
    durationMs: Date.now() - startedAt,
    error,
  };
}

export class RuleTestRunner {
  private revision = 0;
  private readonly schedulers = new Map<string, RuleScheduler>();

  constructor(
    private readonly definitions: ReadonlyMap<string, RuleDefinition> =
      HARMONY_RULE_DEFINITION_BY_ID,
  ) {}

  cancel() {
    this.schedulers.forEach((scheduler) => scheduler.cancel());
  }

  async run(
    testCase: HarmonyRuleTestCase,
    options: { signal?: AbortSignal; project?: ProjectDocument } = {},
  ): Promise<RuleTestRunResult> {
    const startedAt = Date.now();
    const revision = ++this.revision;
    const definition = this.definitions.get(testCase.target.ruleId);
    if (!definition)
      return executionFailure(revision, startedAt, {
        code: "unknown-rule",
        message: `未知规则：${testCase.target.ruleId}`,
      });

    let project: ProjectDocument;
    try {
      project =
        options.project ??
        materializeRuleTestProject(testCase.project, testCase.title);
    } catch (error) {
      return executionFailure(revision, startedAt, {
        code: "invalid-project",
        message: error instanceof Error ? error.message : "规则测试工程输入无效",
      });
    }

    const scheduler =
      this.schedulers.get(definition.id) ?? new RuleScheduler([definition]);
    this.schedulers.set(definition.id, scheduler);
    const actual = await scheduler.run({
      project,
      severities: { [definition.id]: testCase.execution.severity },
      revision,
      signal: options.signal,
      configs: { [definition.id]: testCase.execution.config },
      exceptions: { [definition.id]: testCase.execution.exceptions },
    });
    if (actual.superseded || options.signal?.aborted)
      return executionFailure(
        revision,
        startedAt,
        { code: "aborted", message: "规则测试运行已取消" },
        actual,
      );
    if (actual.skippedRules.some((skip) => skip.reason === "rule-error"))
      return executionFailure(
        revision,
        startedAt,
        { code: "rule-error", message: `规则“${definition.label}”执行失败` },
        actual,
      );

    const comparison = compareRuleTestResult(testCase.expected, actual);
    return {
      status: comparison.passed ? "passed" : "failed",
      actual,
      comparison,
      durationMs: Date.now() - startedAt,
    };
  }
}

export function runRuleTestCase(
  testCase: HarmonyRuleTestCase,
  options?: { signal?: AbortSignal; project?: ProjectDocument },
) {
  return new RuleTestRunner().run(testCase, options);
}
