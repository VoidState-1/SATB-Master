import type { VoiceId } from "../../../project/types";
import type { DiagnosticEvidence } from "../../runtime";
import type { RuleRequirement } from "../types";

export type FactTruth = "yes" | "no" | "unknown";
export type FactConfidence = "certain" | "probable" | "ambiguous" | "unknown";

export interface SubjectRefs {
  readonly voiceIds?: readonly VoiceId[];
  readonly noteIds?: readonly string[];
  readonly chordIds?: readonly string[];
  readonly spanIds?: readonly string[];
}

export interface FactResult {
  readonly truth: FactTruth;
  readonly confidence: FactConfidence;
  readonly reason: string;
  readonly evidence: readonly DiagnosticEvidence[];
  readonly subjectRefs: SubjectRefs;
  readonly dependencies: readonly RuleRequirement[];
}

interface FactResultOptions {
  readonly confidence?: FactConfidence;
  readonly evidence?: readonly DiagnosticEvidence[];
  readonly subjectRefs?: SubjectRefs;
  readonly dependencies?: readonly RuleRequirement[];
}

function factResult(
  truth: FactTruth,
  reason: string,
  options: FactResultOptions = {},
): FactResult {
  return {
    truth,
    confidence:
      options.confidence ?? (truth === "unknown" ? "unknown" : "certain"),
    reason,
    evidence: options.evidence ?? [],
    subjectRefs: options.subjectRefs ?? {},
    dependencies: options.dependencies ?? [],
  };
}

export function factYes(reason: string, options?: FactResultOptions) {
  return factResult("yes", reason, options);
}

export function factNo(reason: string, options?: FactResultOptions) {
  return factResult("no", reason, options);
}

export function factUnknown(reason: string, options?: FactResultOptions) {
  return factResult("unknown", reason, options);
}

export interface FactDefinition<Environment> {
  readonly id: string;
  readonly requires?: readonly RuleRequirement[];
  readonly cacheKey?: (environment: Environment) => string | undefined;
  readonly evaluate: (environment: Environment) => FactResult;
}

export function defineFact<Environment>(
  definition: FactDefinition<Environment>,
): FactDefinition<Environment> {
  if (!definition.id.trim()) throw new Error("事实 ID 不能为空");
  return Object.freeze({ ...definition });
}

export interface FactNode<Environment> {
  readonly kind: "fact";
  readonly id: string;
  readonly definition: FactDefinition<Environment>;
}

export interface AllNode<Environment> {
  readonly kind: "all";
  readonly id: string;
  readonly children: readonly PredicateNode<Environment>[];
}

export interface AnyNode<Environment> {
  readonly kind: "any";
  readonly id: string;
  readonly children: readonly PredicateNode<Environment>[];
}

export interface NotNode<Environment> {
  readonly kind: "not";
  readonly id: string;
  readonly child: PredicateNode<Environment>;
}

export type PredicateNode<Environment> =
  | FactNode<Environment>
  | AllNode<Environment>
  | AnyNode<Environment>
  | NotNode<Environment>;

export function fact<Environment>(
  definition: FactDefinition<Environment>,
): FactNode<Environment> {
  return Object.freeze({ kind: "fact", id: definition.id, definition });
}

function compositeId(
  kind: "all" | "any",
  children: readonly PredicateNode<unknown>[],
) {
  return `${kind}(${children.map((child) => child.id).join(",")})`;
}

export function all<Environment>(
  ...children: readonly PredicateNode<Environment>[]
): AllNode<Environment> {
  if (children.length === 0) throw new Error("all 至少需要一个条件");
  return Object.freeze({
    kind: "all",
    id: compositeId("all", children as readonly PredicateNode<unknown>[]),
    children: Object.freeze([...children]),
  });
}

export function any<Environment>(
  ...children: readonly PredicateNode<Environment>[]
): AnyNode<Environment> {
  if (children.length === 0) throw new Error("any 至少需要一个条件");
  return Object.freeze({
    kind: "any",
    id: compositeId("any", children as readonly PredicateNode<unknown>[]),
    children: Object.freeze([...children]),
  });
}

export function not<Environment>(
  child: PredicateNode<Environment>,
): NotNode<Environment> {
  return Object.freeze({ kind: "not", id: `not(${child.id})`, child });
}

const CONFIDENCE_ORDER: Record<FactConfidence, number> = {
  unknown: 0,
  ambiguous: 1,
  probable: 2,
  certain: 3,
};

function leastConfidence(results: readonly FactResult[]): FactConfidence {
  return results.reduce<FactConfidence>(
    (lowest, result) =>
      CONFIDENCE_ORDER[result.confidence] < CONFIDENCE_ORDER[lowest]
        ? result.confidence
        : lowest,
    "certain",
  );
}

function mergeUnique<T>(values: readonly T[], keyOf: (value: T) => string) {
  const result: T[] = [];
  const keys = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(value);
  }
  return Object.freeze(result);
}

function mergeSubjectRefs(results: readonly FactResult[]): SubjectRefs {
  const voiceIds = mergeUnique(
    results.flatMap((result) => result.subjectRefs.voiceIds ?? []),
    String,
  );
  const noteIds = mergeUnique(
    results.flatMap((result) => result.subjectRefs.noteIds ?? []),
    String,
  );
  const chordIds = mergeUnique(
    results.flatMap((result) => result.subjectRefs.chordIds ?? []),
    String,
  );
  const spanIds = mergeUnique(
    results.flatMap((result) => result.subjectRefs.spanIds ?? []),
    String,
  );
  return {
    ...(voiceIds.length > 0 ? { voiceIds } : {}),
    ...(noteIds.length > 0 ? { noteIds } : {}),
    ...(chordIds.length > 0 ? { chordIds } : {}),
    ...(spanIds.length > 0 ? { spanIds } : {}),
  };
}

function combineResults(
  truth: FactTruth,
  reason: string,
  results: readonly FactResult[],
): FactResult {
  return {
    truth,
    confidence: leastConfidence(results),
    reason,
    evidence: mergeUnique(
      results.flatMap((result) => result.evidence),
      (item) => `${item.kind}:${item.id ?? ""}:${item.label}:${item.value}`,
    ),
    subjectRefs: mergeSubjectRefs(results),
    dependencies: mergeUnique(
      results.flatMap((result) => result.dependencies),
      String,
    ),
  };
}

export interface FactStoreStats {
  readonly evaluations: number;
  readonly cacheHits: number;
}

export class FactStore {
  private readonly cache = new Map<string, FactResult>();
  private evaluationCount = 0;
  private cacheHitCount = 0;

  evaluate<Environment>(
    definition: FactDefinition<Environment>,
    environment: Environment,
  ) {
    const localKey = definition.cacheKey?.(environment);
    const cacheKey =
      localKey === undefined ? undefined : `${definition.id}:${localKey}`;
    if (cacheKey !== undefined) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.cacheHitCount += 1;
        return cached;
      }
    }

    this.evaluationCount += 1;
    const raw = definition.evaluate(environment);
    const normalized: FactResult = {
      ...raw,
      dependencies: mergeUnique(
        [...(definition.requires ?? []), ...raw.dependencies],
        String,
      ),
    };
    if (cacheKey !== undefined) this.cache.set(cacheKey, normalized);
    return normalized;
  }

  stats(): FactStoreStats {
    return {
      evaluations: this.evaluationCount,
      cacheHits: this.cacheHitCount,
    };
  }
}

export interface PredicateTrace {
  readonly nodeId: string;
  readonly kind: PredicateNode<unknown>["kind"];
  readonly truth: FactTruth;
  readonly reason: string;
  readonly children: readonly PredicateTrace[];
}

export interface PredicateEvaluation {
  readonly result: FactResult;
  readonly trace: PredicateTrace;
}

export function evaluatePredicate<Environment>(
  node: PredicateNode<Environment>,
  environment: Environment,
  store: FactStore,
): PredicateEvaluation {
  if (node.kind === "fact") {
    const result = store.evaluate(node.definition, environment);
    return {
      result,
      trace: {
        nodeId: node.id,
        kind: node.kind,
        truth: result.truth,
        reason: result.reason,
        children: [],
      },
    };
  }

  if (node.kind === "not") {
    const child = evaluatePredicate(node.child, environment, store);
    const truth: FactTruth =
      child.result.truth === "yes"
        ? "no"
        : child.result.truth === "no"
          ? "yes"
          : "unknown";
    const result: FactResult = { ...child.result, truth, reason: node.id };
    return {
      result,
      trace: {
        nodeId: node.id,
        kind: node.kind,
        truth,
        reason: result.reason,
        children: [child.trace],
      },
    };
  }

  const children = node.children.map((child) =>
    evaluatePredicate(child, environment, store),
  );
  const truths = children.map((child) => child.result.truth);
  const truth: FactTruth =
    node.kind === "all"
      ? truths.includes("no")
        ? "no"
        : truths.includes("unknown")
          ? "unknown"
          : "yes"
      : truths.includes("yes")
        ? "yes"
        : truths.includes("unknown")
          ? "unknown"
          : "no";
  const result = combineResults(
    truth,
    node.id,
    children.map((child) => child.result),
  );
  return {
    result,
    trace: {
      nodeId: node.id,
      kind: node.kind,
      truth,
      reason: result.reason,
      children: children.map((child) => child.trace),
    },
  };
}

export function predicateRequirements<Environment>(
  node: PredicateNode<Environment>,
): readonly RuleRequirement[] {
  if (node.kind === "fact") return node.definition.requires ?? [];
  if (node.kind === "not") return predicateRequirements(node.child);
  return mergeUnique(node.children.flatMap(predicateRequirements), String);
}
