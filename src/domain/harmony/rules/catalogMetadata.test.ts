import { describe, expect, it } from "vitest";
import {
  HARMONY_RULE_DEFINITIONS,
  chordDependentRuleIds,
  defaultHarmonyRuleSeverities,
} from "./catalog";

describe("和声检查规则目录", () => {
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

  it("从规则对象推导需要和弦标注的规则", () => {
    const ids = chordDependentRuleIds();
    expect(ids.length).toBeGreaterThan(40);
    expect(ids).toContain("chord.unclassified-nonchord-tone");
    expect(ids).toContain("tonality.pivot-reinterpretation");
    expect(
      ids.every((id) =>
        HARMONY_RULE_DEFINITIONS.find(
          (rule) => rule.id === id,
        )?.requires.includes("chords"),
      ),
    ).toBe(true);
  });
});
