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
});
