import type { DiagnosticSeverity } from "../types";

export const DIAGNOSTIC_SEVERITY_ORDER: Readonly<
  Record<DiagnosticSeverity, number>
> = Object.freeze({
  error: 0,
  warning: 1,
  suggestion: 2,
});

export function compareDiagnosticSeverity(
  left: DiagnosticSeverity,
  right: DiagnosticSeverity,
) {
  return DIAGNOSTIC_SEVERITY_ORDER[left] - DIAGNOSTIC_SEVERITY_ORDER[right];
}
