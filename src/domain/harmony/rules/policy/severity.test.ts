import { describe, expect, it } from "vitest";
import {
  compareDiagnosticSeverity,
  DIAGNOSTIC_SEVERITY_ORDER,
} from "./severity";

describe("诊断严重程度政策", () => {
  it("错误、警告、建议按固定优先级排序", () => {
    expect(DIAGNOSTIC_SEVERITY_ORDER).toEqual({
      error: 0,
      warning: 1,
      suggestion: 2,
    });
    expect(compareDiagnosticSeverity("error", "warning")).toBeLessThan(0);
    expect(compareDiagnosticSeverity("suggestion", "warning")).toBeGreaterThan(
      0,
    );
  });
});
