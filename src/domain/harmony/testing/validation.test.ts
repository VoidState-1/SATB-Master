import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../project";
import { serializeRuleTestCase } from "./canonicalize";
import { testCaseFor } from "./fixtures";
import { parseRuleTestCase } from "./validation";

describe("规则测试用例解析", () => {
  it("解析合法用例并补齐规则默认配置", () => {
    const source = testCaseFor();
    source.execution.config = {};

    const parsed = parseRuleTestCase(source);

    expect(parsed.issues).toEqual([]);
    expect(parsed.testCase?.execution.config).toHaveProperty("soprano");
  });

  it("拒绝未知规则、无效配置和不支持的特例", () => {
    const source = testCaseFor() as unknown as Record<string, unknown>;
    source.target = { source: "builtin", ruleId: "missing.rule" };
    source.execution = {
      mode: "isolated",
      severity: "warning",
      config: { soprano: "invalid" },
      exceptions: { syncopation: "ignore" },
    };

    const parsed = parseRuleTestCase(source);

    expect(parsed.testCase).toBeUndefined();
    expect(parsed.issues.map((item) => item.code)).toContain("unknown-rule");
  });

  it("拒绝重复预期 ID、越界范围与失效对象引用", () => {
    const source = testCaseFor(createEmptyProject());
    source.expected.diagnostics = [
      {
        id: "same-id",
        ruleId: "voice.range",
        messageKey: "voice.range",
        tick: source.project.lengthTicks + 1,
        noteIds: ["missing-note"],
      },
      {
        id: "same-id",
        ruleId: "voice.range",
        messageKey: "voice.range",
        tick: 0,
      },
    ];

    const parsed = parseRuleTestCase(source);

    expect(parsed.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["duplicate", "value", "missing-reference"]),
    );
  });

  it("canonical 序列化稳定且不写入普通工程元数据", () => {
    const source = testCaseFor();
    source.tags = ["zeta", "alpha"];
    source.expected.diagnostics = [
      {
        id: "z-diagnostic",
        ruleId: "voice.range",
        messageKey: "voice.range",
        tick: 0,
      },
      {
        id: "a-diagnostic",
        ruleId: "voice.range",
        messageKey: "voice.range",
        tick: 0,
      },
    ];

    const first = serializeRuleTestCase(source);
    const parsed = parseRuleTestCase(JSON.parse(first));
    const second = serializeRuleTestCase(parsed.testCase!);

    expect(second).toBe(first);
    expect(first).not.toContain('"ruleProfile"');
    expect(first.indexOf("a-diagnostic")).toBeLessThan(
      first.indexOf("z-diagnostic"),
    );
  });
});
