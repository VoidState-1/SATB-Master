import { describe, expect, it } from "vitest";
import type { HarmonyCheckResult, HarmonyDiagnostic } from "../runtime";
import { compareRuleTestResult } from "./comparator";
import type { ExpectedDiagnostic, RuleTestExpectationSet } from "./model";

function diagnostic(
  overrides: Partial<HarmonyDiagnostic> = {},
): HarmonyDiagnostic {
  return {
    id: "actual-1",
    ruleId: "voice.range",
    source: "builtin",
    severity: "warning",
    tick: 0,
    endTick: 960,
    voiceIds: ["soprano"],
    noteIds: ["note-1"],
    chordIds: [],
    title: "展示标题",
    message: "展示文案",
    messageKey: "voice.range",
    params: { midi: 84, maximum: 81 },
    evidence: [],
    confidence: 1,
    ...overrides,
  };
}

function expectation(
  overrides: Partial<ExpectedDiagnostic> = {},
): ExpectedDiagnostic {
  return {
    id: "expected-1",
    ruleId: "voice.range",
    messageKey: "voice.range",
    tick: 0,
    endTick: 960,
    voiceIds: ["soprano"],
    noteIds: ["note-1"],
    chordIds: [],
    params: { midi: 84 },
    ...overrides,
  };
}

function result(
  diagnostics: HarmonyDiagnostic[],
  skippedRules: HarmonyCheckResult["skippedRules"] = [],
): HarmonyCheckResult {
  return {
    diagnostics,
    skippedRules,
    skippedRuleIds: [...new Set(skippedRules.map((skip) => skip.ruleId))],
    revision: 1,
    superseded: false,
    invalidationRanges: [],
  };
}

function expected(
  diagnostics: ExpectedDiagnostic[],
  overrides: Partial<RuleTestExpectationSet> = {},
): RuleTestExpectationSet {
  return {
    diagnostics,
    allowUnexpectedDiagnostics: false,
    skips: [],
    ...overrides,
  };
}

describe("规则测试诊断比较", () => {
  it("按稳定语义匹配并忽略展示文案、数组顺序和额外参数", () => {
    const comparison = compareRuleTestResult(
      expected([
        expectation({
          voiceIds: ["soprano"],
          noteIds: ["note-1"],
        }),
      ]),
      result([
        diagnostic({
          title: "改写后的标题",
          message: "改写后的文案",
          params: { midi: 84, maximum: 82, minimum: 60 },
        }),
      ]),
    );

    expect(comparison.passed).toBe(true);
    expect(comparison.matches).toHaveLength(1);
  });

  it("将同语义但位置或对象不同的结果归类为 mismatched", () => {
    const comparison = compareRuleTestResult(
      expected([expectation()]),
      result([diagnostic({ tick: 960, noteIds: ["note-2"] })]),
    );

    expect(comparison.passed).toBe(false);
    expect(comparison.missing).toEqual([]);
    expect(comparison.unexpected).toEqual([]);
    expect(comparison.mismatched[0].differences.map((item) => item.field)).toEqual([
      "tick",
      "noteIds",
    ]);
  });

  it("优先匹配字段更具体的期望且不重复消费实际诊断", () => {
    const general = expectation({ id: "general", noteIds: undefined });
    const specific = expectation({ id: "specific", noteIds: ["note-1"] });
    const comparison = compareRuleTestResult(
      expected([general, specific]),
      result([
        diagnostic({ id: "specific-actual", noteIds: ["note-1"] }),
        diagnostic({ id: "general-actual", noteIds: ["note-2"] }),
      ]),
    );

    expect(comparison.passed).toBe(true);
    expect(
      comparison.matches.find((match) => match.expected.id === "specific")
        ?.actual.id,
    ).toBe("specific-actual");
  });

  it("分别报告 missing、unexpected 和 skip 差异", () => {
    const comparison = compareRuleTestResult(
      expected([expectation()], {
        skips: [{ reason: "no-chords", partial: false }],
      }),
      result(
        [diagnostic({ ruleId: "voice.crossing" })],
        [
          {
            ruleId: "voice.range",
            reason: "insufficient-context",
            message: "上下文不足",
            partial: true,
          },
        ],
      ),
    );

    expect(comparison.missing).toHaveLength(1);
    expect(comparison.unexpected).toHaveLength(1);
    expect(comparison.skipMismatches).toHaveLength(2);
  });

  it("允许额外诊断时仍保留 unexpected 供界面查看", () => {
    const comparison = compareRuleTestResult(
      expected([], { allowUnexpectedDiagnostics: true }),
      result([diagnostic()]),
    );

    expect(comparison.passed).toBe(true);
    expect(comparison.unexpected).toHaveLength(1);
  });
});
