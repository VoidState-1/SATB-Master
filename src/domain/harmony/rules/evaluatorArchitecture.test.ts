import { describe, expect, it } from "vitest";

const sources = import.meta.glob("./groups/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function groupSources() {
  return Object.entries(sources)
    .filter(([filename]) => !filename.endsWith("/index.ts"))
    .map(([filename, source]) => ({ filename, source }));
}

describe("规则 evaluator 架构", () => {
  it("规则对象直接引用具名 evaluator", () => {
    for (const { filename, source } of groupSources()) {
      expect(source, filename).not.toMatch(/evaluate:\s*\(/);
    }
  });

  it("规则算法不按 ruleId 选择行为", () => {
    for (const { filename, source } of groupSources()) {
      expect(source, filename).not.toMatch(/\bruleId\s*(?:===|!==)/);
      expect(source, filename).not.toMatch(/switch\s*\(\s*ruleId\s*\)/);
    }
  });

  it("四条倾向音规则由声明式义务运行时管理状态", () => {
    const stateful = sources["./groups/stateful.ts"];
    expect(stateful).toBeDefined();
    expect(stateful.match(/defineObligationRule\s*\(/g)).toHaveLength(4);
    expect(stateful).not.toMatch(/function\s+leadingToneStateStep\s*\(/);
    expect(stateful).not.toMatch(/function\s+seventhStateStep\s*\(/);
    expect(stateful).not.toMatch(/function\s+dominantNinthStateStep\s*\(/);
    expect(stateful).not.toMatch(/function\s+alteredToneStateStep\s*\(/);
  });

  it("局部约束与算法逃生口使用不同定义器", () => {
    const voice = sources["./groups/voice.ts"];
    expect(voice).toContain("defineConstraintRule({");
    expect(voice).toContain("defineAlgorithmicRule({");
  });
});
