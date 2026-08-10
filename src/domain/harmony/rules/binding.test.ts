import { describe, expect, it } from "vitest";
import {
  bindRuleDefinitions,
  mergeRuleBindings,
  statelessRule,
} from "./binding";
import { HARMONY_RULE_DEFINITIONS } from "./catalog";
import { BUILTIN_RULE_BINDINGS } from "./groups";

describe("内置规则实现绑定", () => {
  it("与已实现目录项一一对应，并保持目录顺序", () => {
    const expectedIds = HARMONY_RULE_DEFINITIONS.filter(
      (definition) => definition.implemented,
    ).map((definition) => definition.id);
    const rules = bindRuleDefinitions(
      HARMONY_RULE_DEFINITIONS,
      BUILTIN_RULE_BINDINGS,
    );

    expect(BUILTIN_RULE_BINDINGS.size).toBe(expectedIds.length);
    expect(rules.map((rule) => rule.id)).toEqual(expectedIds);
  });

  it("拒绝不同规则组重复绑定同一目录项", () => {
    const binding = statelessRule(() => []);

    expect(() =>
      mergeRuleBindings(
        { "voice.range": binding },
        { "voice.range": binding },
      ),
    ).toThrow("存在重复实现绑定");
  });

  it("拒绝已实现但没有运行时绑定的目录项", () => {
    const incompleteBindings = new Map(BUILTIN_RULE_BINDINGS);
    incompleteBindings.delete("voice.range");

    expect(() =>
      bindRuleDefinitions(HARMONY_RULE_DEFINITIONS, incompleteBindings),
    ).toThrow("缺少运行时绑定");
  });
});
