import type { HarmonyAnalysis } from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { RuleConfig, RuleRequirement } from "../types";
import {
  defineStatelessRule,
  type RuleMetadataInput,
} from "../defineRule";
import {
  evaluatePredicate,
  FactStore,
  predicateRequirements,
  type PredicateEvaluation,
  type PredicateNode,
} from "./facts";

export interface ConstraintCandidateProvider<Candidate> {
  readonly id: string;
  readonly requires: readonly RuleRequirement[];
  readonly select: (
    analysis: HarmonyAnalysis,
    config: RuleConfig,
  ) => readonly Candidate[];
  readonly keyOf: (candidate: Candidate) => string;
}

export function defineCandidateProvider<Candidate>(
  provider: ConstraintCandidateProvider<Candidate>,
) {
  if (!provider.id.trim()) throw new Error("约束候选提供器 ID 不能为空");
  return Object.freeze({ ...provider });
}

export interface ConstraintEnvironment<Candidate> {
  readonly analysis: HarmonyAnalysis;
  readonly config: RuleConfig;
  readonly candidate: Candidate;
}

type UnknownPolicy = "ignore" | "violate";

export interface ConstraintRuleInput<Id extends string, Candidate>
  extends RuleMetadataInput<Id> {
  readonly forEach: ConstraintCandidateProvider<Candidate>;
  readonly assert: PredicateNode<ConstraintEnvironment<Candidate>>;
  readonly unknownPolicy?: UnknownPolicy;
  readonly report: (
    environment: ConstraintEnvironment<Candidate>,
    assertion: PredicateEvaluation,
  ) => RuleDiagnostic | undefined;
}

function assertRequirements(
  ruleId: string,
  declared: readonly RuleRequirement[],
  required: readonly RuleRequirement[],
) {
  for (const requirement of required) {
    if (!declared.includes(requirement))
      throw new Error(`规则“${ruleId}”的声明式事实依赖未声明：“${requirement}”`);
  }
}

export function defineConstraintRule<const Id extends string, Candidate>(
  input: ConstraintRuleInput<Id, Candidate>,
) {
  const {
    forEach,
    assert,
    unknownPolicy = "ignore",
    report,
    ...metadata
  } = input;
  assertRequirements(
    metadata.id,
    metadata.requires,
    [...forEach.requires, ...predicateRequirements(assert)],
  );

  return defineStatelessRule({
    ...metadata,
    evaluate(analysis, config) {
      const diagnostics: RuleDiagnostic[] = [];
      const store = new FactStore();
      const candidateKeys = new Set<string>();
      for (const candidate of forEach.select(analysis, config)) {
        const candidateKey = forEach.keyOf(candidate);
        if (candidateKeys.has(candidateKey))
          throw new Error(
            `候选提供器“${forEach.id}”产生重复候选：“${candidateKey}”`,
          );
        candidateKeys.add(candidateKey);
        const environment = { analysis, config, candidate };
        const assertion = evaluatePredicate(assert, environment, store);
        if (
          assertion.result.truth === "yes" ||
          (assertion.result.truth === "unknown" && unknownPolicy === "ignore")
        )
          continue;
        const item = report(environment, assertion);
        if (item) diagnostics.push(item);
      }
      return diagnostics;
    },
  });
}
