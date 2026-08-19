import { describe, expect, it } from "vitest";
import type {
  DiagnosticMismatch,
  ExpectedDiagnostic,
  RuleTestRunResult,
} from "./model";
import { runRuleTestCase } from "./runner";
import { parseRuleTestCase } from "./validation";

interface RuleCaseMatcherContext {
  relativePath: string;
  ruleId: string;
}

declare module "vitest" {
  interface Assertion<T = any> {
    toPassRuleTestCase(context: RuleCaseMatcherContext): T;
  }

  interface AsymmetricMatchersContaining {
    toPassRuleTestCase(context: RuleCaseMatcherContext): unknown;
  }
}

function expectationLabel(expectation: ExpectedDiagnostic) {
  return `${expectation.id}: ${expectation.messageKey} @ ${expectation.tick}`;
}

function mismatchLabel(mismatch: DiagnosticMismatch) {
  const fields = mismatch.differences
    .map(
      ({ field, expected, actual }) =>
        `${field}: ${JSON.stringify(expected)} -> ${JSON.stringify(actual)}`,
    )
    .join(", ");
  return `${expectationLabel(mismatch.expected)} (${fields})`;
}

function failureDetails(result: RuleTestRunResult) {
  if (result.status === "error")
    return [`execution error: ${result.error?.code ?? "unknown"}: ${result.error?.message ?? ""}`];

  const { missing, unexpected, mismatched, skipMismatches } =
    result.comparison;
  return [
    ...missing.map((item) => `missing: ${expectationLabel(item)}`),
    ...unexpected.map(
      (item) =>
        `unexpected: ${item.messageKey} @ ${item.tick} notes=${JSON.stringify(item.noteIds)} chords=${JSON.stringify(item.chordIds)}`,
    ),
    ...mismatched.map((item) => `mismatched: ${mismatchLabel(item)}`),
    ...skipMismatches.map((item) =>
      item.kind === "missing"
        ? `missing skip: ${item.expected?.reason} partial=${item.expected?.partial}`
        : `unexpected skip: ${item.actual?.reason} partial=${item.actual?.partial}`,
    ),
  ];
}

expect.extend({
  toPassRuleTestCase(
    received: RuleTestRunResult,
    context: RuleCaseMatcherContext,
  ) {
    const pass = received.status === "passed";
    return {
      pass,
      message: () =>
        [
          `规则用例失败：${context.relativePath}`,
          `目标规则：${context.ruleId}`,
          ...failureDetails(received),
        ].join("\n"),
    };
  },
});

const ruleCaseDocuments = import.meta.glob(
  "../../../../RuleCases/**/*.satb-rule-case.json",
  {
    eager: true,
    import: "default",
  },
) as Record<string, unknown>;

function relativeCasePath(modulePath: string) {
  return modulePath.replace(/^.*\/RuleCases\//, "RuleCases/");
}

describe("规则用例库", () => {
  const entries = Object.entries(ruleCaseDocuments).sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  );

  it("至少包含一个可发现的规则用例", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const [modulePath, document] of entries) {
    const relativePath = relativeCasePath(modulePath);
    it(relativePath, async () => {
      const parsed = parseRuleTestCase(document);
      expect(parsed.issues, `${relativePath} 解析失败`).toEqual([]);
      const testCase = parsed.testCase!;
      const result = await runRuleTestCase(testCase);
      expect(result).toPassRuleTestCase({
        relativePath,
        ruleId: testCase.target.ruleId,
      });
    });
  }
});
