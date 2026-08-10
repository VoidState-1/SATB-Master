import { describe, expect, it } from "vitest";
import { HARMONY_RULE_DEFINITIONS } from "./catalog";
import { defineRuleCollection } from "./defineRule";
import { VOICE_RULES } from "./groups/voice";

describe("内置规则对象集合", () => {
  it("包含 81 个完整规则对象并保持目录顺序", () => {
    expect(HARMONY_RULE_DEFINITIONS).toHaveLength(81);
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
