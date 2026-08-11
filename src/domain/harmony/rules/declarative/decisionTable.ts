import type { RuleRequirement } from "../types";
import {
  evaluatePredicate,
  predicateRequirements,
  type FactStore,
  type PredicateEvaluation,
  type PredicateNode,
} from "./facts";

export type ObligationOutcome =
  | "continue"
  | "resolve"
  | "violate"
  | "cancel"
  | "indeterminate";

export interface DecisionRow<Environment> {
  readonly outcome: ObligationOutcome;
  readonly reason: string;
  readonly predicate: PredicateNode<Environment>;
  readonly fallback: boolean;
}

export function when<Environment>(
  outcome: ObligationOutcome,
  reason: string,
  predicate: PredicateNode<Environment>,
): DecisionRow<Environment> {
  return Object.freeze({ outcome, reason, predicate, fallback: false });
}

export function otherwiseWhen<Environment>(
  outcome: ObligationOutcome,
  reason: string,
  predicate: PredicateNode<Environment>,
): DecisionRow<Environment> {
  return Object.freeze({ outcome, reason, predicate, fallback: true });
}

export type DecisionConflictPolicy =
  | "require-exclusive"
  | { readonly precedence: readonly ObligationOutcome[] };

export interface DecisionTable<Environment> {
  readonly rows: readonly DecisionRow<Environment>[];
  readonly conflicts: DecisionConflictPolicy;
}

export function decisionTable<Environment>(input: {
  readonly rows: readonly DecisionRow<Environment>[];
  readonly conflicts?: DecisionConflictPolicy;
}): DecisionTable<Environment> {
  if (input.rows.length === 0) throw new Error("义务决策表不能为空");
  const reasons = new Set<string>();
  let fallbackCount = 0;
  for (const row of input.rows) {
    if (!row.reason.trim() || reasons.has(row.reason))
      throw new Error(`义务决策原因无效或重复：“${row.reason}”`);
    reasons.add(row.reason);
    if (row.fallback) fallbackCount += 1;
  }
  if (fallbackCount > 1) throw new Error("义务决策表最多允许一个兜底行");
  const conflicts = input.conflicts ?? "require-exclusive";
  if (conflicts !== "require-exclusive") {
    const outcomes = new Set<ObligationOutcome>();
    for (const outcome of conflicts.precedence) {
      if (outcomes.has(outcome)) throw new Error("义务决策优先级包含重复结果");
      outcomes.add(outcome);
    }
  }
  return Object.freeze({ rows: Object.freeze([...input.rows]), conflicts });
}

export interface EvaluatedDecisionRow<Environment> {
  readonly row: DecisionRow<Environment>;
  readonly evaluation: PredicateEvaluation;
}

export type DecisionEvaluation<Environment> =
  | {
      readonly status: "decided";
      readonly selected: EvaluatedDecisionRow<Environment>;
      readonly evaluated: readonly EvaluatedDecisionRow<Environment>[];
    }
  | {
      readonly status: "none" | "unknown" | "conflict";
      readonly evaluated: readonly EvaluatedDecisionRow<Environment>[];
    };

function selectByPrecedence<Environment>(
  matching: readonly EvaluatedDecisionRow<Environment>[],
  precedence: readonly ObligationOutcome[],
) {
  for (const outcome of precedence) {
    const candidates = matching.filter((item) => item.row.outcome === outcome);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return undefined;
  }
  return undefined;
}

export function evaluateDecisionTable<Environment>(
  table: DecisionTable<Environment>,
  environment: Environment,
  store: FactStore,
): DecisionEvaluation<Environment> {
  const ordinary = table.rows.filter((row) => !row.fallback);
  const evaluated = ordinary.map((row) => ({
    row,
    evaluation: evaluatePredicate(row.predicate, environment, store),
  }));
  const matching = evaluated.filter(
    (item) => item.evaluation.result.truth === "yes",
  );

  if (matching.length === 1)
    return { status: "decided", selected: matching[0], evaluated };
  if (matching.length > 1) {
    if (table.conflicts === "require-exclusive")
      return { status: "conflict", evaluated };
    const selected = selectByPrecedence(matching, table.conflicts.precedence);
    return selected
      ? { status: "decided", selected, evaluated }
      : { status: "conflict", evaluated };
  }
  if (evaluated.some((item) => item.evaluation.result.truth === "unknown"))
    return { status: "unknown", evaluated };

  const fallback = table.rows.find((row) => row.fallback);
  if (!fallback) return { status: "none", evaluated };
  const fallbackEvaluation = {
    row: fallback,
    evaluation: evaluatePredicate(fallback.predicate, environment, store),
  };
  const withFallback = [...evaluated, fallbackEvaluation];
  if (fallbackEvaluation.evaluation.result.truth === "yes")
    return {
      status: "decided",
      selected: fallbackEvaluation,
      evaluated: withFallback,
    };
  return {
    status:
      fallbackEvaluation.evaluation.result.truth === "unknown" ? "unknown" : "none",
    evaluated: withFallback,
  };
}

export function decisionTableRequirements<Environment>(
  table: DecisionTable<Environment>,
): readonly RuleRequirement[] {
  return [
    ...new Set(
      table.rows.flatMap((row) => predicateRequirements(row.predicate)),
    ),
  ];
}
