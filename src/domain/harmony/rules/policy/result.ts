import type {
  HarmonyCheckResult,
  HarmonyDiagnostic,
  SkippedRule,
} from "../../runtime";
import type { AnalysisInvalidationRange } from "../../analysis";
import type { DiagnosticSeverity } from "../types";
import { compareDiagnosticSeverity } from "./severity";

export type ApplicabilityPolicy =
  | "strict"
  | "downgraded"
  | "skip"
  | "deferred";

export function severityAfterApplicability(
  severity: DiagnosticSeverity,
  policy: ApplicabilityPolicy,
): DiagnosticSeverity | undefined {
  if (policy === "skip" || policy === "deferred") return undefined;
  if (policy !== "downgraded") return severity;
  return severity === "error" ? "warning" : "suggestion";
}

export function compareHarmonyDiagnostics(
  left: HarmonyDiagnostic,
  right: HarmonyDiagnostic,
) {
  return (
    left.tick - right.tick ||
    compareDiagnosticSeverity(left.severity, right.severity) ||
    left.ruleId.localeCompare(right.ruleId)
  );
}

export function uniqueSkippedRules(source: readonly SkippedRule[]) {
  return [
    new Map(
      source.map((item) => [
        `${item.ruleId}:${item.reason}:${item.partial}`,
        item,
      ]),
    ).values(),
  ].flatMap((values) => [...values]);
}

export function skippedRulesForFailures(
  failures: readonly { ruleId: string; message: string }[],
) {
  return failures.map((failure) => ({
    ruleId: failure.ruleId,
    reason: "rule-error" as const,
    message: `外置规则“${failure.ruleId}”未执行：${failure.message}`,
    partial: false,
  }));
}

export function completeHarmonyResult(options: {
  readonly diagnostics: readonly HarmonyDiagnostic[];
  readonly skippedRules: readonly SkippedRule[];
  readonly revision: number;
  readonly superseded: boolean;
  readonly invalidationRanges?: readonly AnalysisInvalidationRange[];
  readonly arbitrate?: (
    source: readonly HarmonyDiagnostic[],
  ) => readonly HarmonyDiagnostic[];
}): HarmonyCheckResult {
  const skippedRules = uniqueSkippedRules(options.skippedRules);
  const diagnostics = options.superseded
    ? []
    : [...(options.arbitrate?.(options.diagnostics) ?? options.diagnostics)].sort(
        compareHarmonyDiagnostics,
      );
  return {
    diagnostics,
    skippedRules,
    skippedRuleIds: [...new Set(skippedRules.map((item) => item.ruleId))],
    revision: options.revision,
    superseded: options.superseded,
    invalidationRanges: options.invalidationRanges ?? [],
  };
}

export function mergeHarmonyResults(
  builtin: HarmonyCheckResult,
  external: Pick<
    HarmonyCheckResult,
    "diagnostics" | "skippedRules" | "revision" | "superseded"
  >,
): HarmonyCheckResult {
  const superseded =
    builtin.superseded ||
    external.superseded ||
    builtin.revision !== external.revision;
  return completeHarmonyResult({
    diagnostics: superseded
      ? []
      : [...builtin.diagnostics, ...external.diagnostics],
    skippedRules: [...builtin.skippedRules, ...external.skippedRules],
    revision: builtin.revision,
    superseded,
    invalidationRanges: builtin.invalidationRanges,
  });
}
