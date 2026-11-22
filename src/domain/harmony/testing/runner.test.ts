import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ } from "../../project";
import type { RuleDefinition } from "../runtime";
import { expectedDiagnosticFromActual } from "./comparator";
import { RuleTestRunner, runRuleTestCase } from "./runner";
import { testCaseFor } from "./fixtures/ruleTestCase";

describe("规则测试运行器", () => {
  it("隔离运行目标规则并比较预期与实际结果", async () => {
    const project = createEmptyProject();
    project.satbTracks[0].notes.push({
      id: "high-soprano",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "C", alter: 0, octave: 6 },
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    });
    const testCase = testCaseFor(project);

    const failed = await runRuleTestCase(testCase);
    expect(failed.status).toBe("failed");
    expect(failed.actual.diagnostics).toHaveLength(1);
    expect(failed.comparison.unexpected).toHaveLength(1);

    testCase.expected.diagnostics = [
      expectedDiagnosticFromActual(failed.actual.diagnostics[0], "range-hit"),
    ];
    const passed = await runRuleTestCase(testCase);
    expect(passed.status).toBe("passed");
    expect(passed.comparison.matches).toHaveLength(1);
  });

  it("规则抛错时返回 error 而不是把空诊断视为通过", async () => {
    const base = testCaseFor();
    const actualDefinition = {
      id: "voice.range",
      catalogNumber: "TEST.1",
      coveredRuleIds: [],
      label: "抛错规则",
      description: "测试",
      rationale: "测试",
      group: "voice",
      defaultSeverity: "warning",
      requires: [],
      dependencyScope: "project",
      configVersion: 1,
      defaultConfig: {},
      options: [],
      supportedExceptionContexts: [],
      defaultExceptionPolicies: {},
      evaluate: () => {
        throw new Error("fixture failure");
      },
    } satisfies RuleDefinition;
    const runner = new RuleTestRunner(
      new Map([[actualDefinition.id, actualDefinition]]),
    );

    const result = await runner.run(base);

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("rule-error");
  });

  it("中止运行会返回 aborted 且不会提交比较结果", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runRuleTestCase(testCaseFor(), {
      signal: controller.signal,
    });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("aborted");
    expect(result.comparison.passed).toBe(false);
  });
});
