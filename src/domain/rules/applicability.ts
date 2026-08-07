import type { HarmonyAnalysis } from "../harmonyAnalysis";
import type { RuleDiagnostic } from "../harmonyRuntime";
import type {
  HarmonyRuleDefinition,
  RuleDependencyScope,
  RuleExceptionContext,
  RuleExceptionPolicy,
} from "./types";

export interface RuleApplicability {
  ruleId: string;
  scope: RuleDependencyScope;
  targetIds: readonly string[];
  policy: "strict" | "deferred" | "downgraded" | "skip";
  reasonCode?: string;
  confidence: "certain" | "probable" | "ambiguous" | "unknown";
  contexts: readonly RuleExceptionContext[];
}

function confidenceOf(value: number): RuleApplicability["confidence"] {
  if (value >= 0.95) return "certain";
  if (value >= 0.7) return "probable";
  if (value > 0) return "ambiguous";
  return "unknown";
}

function targetIdsOf(diagnostic: RuleDiagnostic) {
  return [
    ...diagnostic.noteIds.map((id) => `note:${id}`),
    ...diagnostic.chordIds.map((id) => `chord:${id}`),
    ...diagnostic.voiceIds.map((id) => `voice:${id}`),
  ].sort();
}

/** 将规则声明、工程配置和本次证据上的上下文统一折叠为单一执行策略。 */
export function planRuleApplicability(
  definition: Pick<
    HarmonyRuleDefinition,
    | "id"
    | "dependencyScope"
    | "supportedExceptionContexts"
    | "defaultExceptionPolicies"
  >,
  diagnostic: RuleDiagnostic,
  _analysis: HarmonyAnalysis,
  overrides: RuleExceptionPolicy = {},
): RuleApplicability {
  const supported = new Set(definition.supportedExceptionContexts);
  const contexts = [
    ...new Set(
      (diagnostic.exceptionContexts ?? []).filter((context) =>
        supported.has(context),
      ),
    ),
  ];
  const effective = {
    ...definition.defaultExceptionPolicies,
    ...overrides,
  };
  const modes = contexts.map((context) => effective[context] ?? "strict");
  const ambiguous = contexts.includes("ambiguous-semantics");
  const insufficient = contexts.includes("insufficient-context");
  const policy: RuleApplicability["policy"] = modes.includes("exempt")
    ? "skip"
    : insufficient || (ambiguous && diagnostic.confidence <= 0)
      ? "deferred"
      : modes.includes("downgrade")
        ? "downgraded"
        : "strict";
  return Object.freeze({
    ruleId: definition.id,
    scope: definition.dependencyScope,
    targetIds: Object.freeze(targetIdsOf(diagnostic)),
    policy,
    reasonCode:
      policy === "strict"
        ? undefined
        : contexts.find((context) =>
            policy === "downgraded"
              ? effective[context] === "downgrade"
              : policy === "skip"
                ? effective[context] === "exempt"
                : context === "insufficient-context" ||
                  context === "ambiguous-semantics",
          ),
    confidence: confidenceOf(diagnostic.confidence),
    contexts: Object.freeze(contexts),
  });
}
