import { describe, expect, it } from "vitest";

const sources = import.meta.glob("./groups/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const stateSources = import.meta.glob("./state/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function groupSources() {
  return Object.entries(sources)
    .filter(
      ([filename]) =>
        !filename.endsWith("/index.ts") && !filename.endsWith(".test.ts"),
    )
    .map(([filename, source]) => ({ filename, source }));
}

function ruleImplementationSources() {
  return [
    ...groupSources(),
    ...Object.entries(stateSources)
      .filter(([filename]) => !filename.endsWith(".test.ts"))
      .map(([filename, source]) => ({ filename, source })),
  ];
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

  it("四条倾向音规则由义务运行时管理状态，并使用普通转移函数", () => {
    const stateful = sources["./groups/stateful.ts"];
    expect(stateful).toBeDefined();
    expect(stateful.match(/defineObligationRule\s*\(/g)).toHaveLength(4);
    expect(stateful).toContain("function leadingToneTransition(");
    expect(stateful).toContain("function seventhTransition(");
    expect(stateful).toContain("function dominantNinthTransition(");
    expect(stateful).toContain("function alteredToneTransition(");
  });

  it("规则组不再依赖旧声明式 AST 或兼容定义器", () => {
    for (const { filename, source } of groupSources()) {
      expect(source, filename).not.toMatch(/from\s+["']\.\.\/declarative/);
      expect(source, filename).not.toMatch(/defineLegacyStatelessRule/);
      expect(source, filename).not.toMatch(/defineConstraintRule/);
      expect(source, filename).not.toMatch(/defineAlgorithmicRule/);
      expect(source, filename).not.toMatch(/\b(?:PredicateNode|FactStore)\b/);
      expect(source, filename).not.toMatch(/decisionTable\s*\(/);
    }
  });

  it("规则与状态层只通过领域上下文导航共享关系", () => {
    const directCollections =
      /\banalysis\.(?:slices|harmonySpans|connections|sliceTransitions|melodyTransitions|notesByVoice|noteById|chordById|sliceSpanIds)\b/;
    for (const { filename, source } of ruleImplementationSources()) {
      expect(source, filename).not.toMatch(directCollections);
      expect(source, filename).not.toMatch(/\.chords\[0\]/);
      expect(source, filename).not.toMatch(/regionIds(?:\[0\]|\.map\s*\()/);
    }
  });

  it("语义规则通过 Resolution 读取主要解释", () => {
    for (const { filename, source } of ruleImplementationSources()) {
      expect(source, filename).not.toMatch(/primaryHarmonyInterpretation\s*\(/);
    }
  });
});
