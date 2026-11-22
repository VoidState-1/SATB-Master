import { describe, expect, it } from "vitest";
import { HARMONY_RULE_DEFINITIONS } from "./catalog";
import { defineRuleCollection } from "./defineRule";
import { VOICE_RULES } from "./groups/voice";

describe("内置规则对象集合", () => {
  it("包含 70 个完整规则对象并保持目录顺序", () => {
    expect(HARMONY_RULE_DEFINITIONS).toHaveLength(70);
    expect(HARMONY_RULE_DEFINITIONS).toContainEqual(expect.objectContaining({
      id: "resolution.altered-dominant-fifth", catalogNumber: "E.6",
    }));
    expect(HARMONY_RULE_DEFINITIONS[0].catalogNumber).toBe("A.1");
    expect(HARMONY_RULE_DEFINITIONS.at(-1)?.catalogNumber).toBe("K.4");
    expect(
      HARMONY_RULE_DEFINITIONS.every(
        (rule) => "evaluate" in rule || "process" in rule,
      ),
    ).toBe(true);
  });

  it("拒绝不同规则组重复声明同一个规则 ID", () => {
    expect(() => defineRuleCollection(VOICE_RULES, VOICE_RULES)).toThrow(
      "内置规则 ID 重复",
    );
  });
});

describe("规则引擎修正基线", () => {
  it("固定当前规则目录及实施数量", () => {
    expect(HARMONY_RULE_DEFINITIONS).toHaveLength(70);
    expect(
      HARMONY_RULE_DEFINITIONS.every(
        (definition) => "evaluate" in definition || "process" in definition,
      ),
    ).toBe(true);
    expect(new Set(HARMONY_RULE_DEFINITIONS.map(({ id }) => id)).size).toBe(70);
  });
});

describe("完整规则目录首版实现", () => {
  it("70 条目录规则均有可执行实现", () => {
    expect(HARMONY_RULE_DEFINITIONS).toHaveLength(70);
    expect(
      HARMONY_RULE_DEFINITIONS.every(
        (item) => "evaluate" in item || "process" in item,
      ),
    ).toBe(true);
  });
});
