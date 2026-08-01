import { describe, expect, it } from "vitest";
import {
  HARMONY_RULE_DEFINITIONS,
  chordDependentRuleIds,
  defaultHarmonyRuleSeverities,
} from "./harmonyRules";

describe("和声检查规则注册表", () => {
  it("不包含重复 ID，且每条规则都有默认严重度", () => {
    const ids = HARMONY_RULE_DEFINITIONS.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(defaultHarmonyRuleSeverities()).sort()).toEqual(
      [...ids].sort(),
    );
    expect(
      HARMONY_RULE_DEFINITIONS.every(
        (rule) => rule.requires.length > 0 && Boolean(rule.dependencyScope),
      ),
    ).toBe(true);
  });

  it("从注册表推导需要和弦标注的规则", () => {
    expect(chordDependentRuleIds()).toEqual([
      "chord-membership",
      "chord-completeness",
      "chord-inversion",
      "leading-tone-doubling",
      "chord-seventh-resolution",
      "chord-seventh-doubling",
      "functional-retrogression",
      "secondary-dominant-resolution",
      "cadential64-resolution",
    ]);
  });
});
