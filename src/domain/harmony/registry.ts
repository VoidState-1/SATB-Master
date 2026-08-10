import type { ProjectDocument } from "../project";
import {
  RuleScheduler,
  runRulesSynchronously,
  type HarmonyCheckResult,
  type RuleConfig,
} from "./runtime";
import {
  HARMONY_RULE_DEFINITIONS,
  defaultHarmonyRuleSeverities,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
  type RuleExceptionPolicy,
} from "./ruleTypes";
import { bindRuleDefinitions } from "./rules/binding";
import { BUILTIN_RULE_BINDINGS } from "./rules/groups";

export const BUILTIN_HARMONY_RULES = bindRuleDefinitions(
  HARMONY_RULE_DEFINITIONS,
  BUILTIN_RULE_BINDINGS,
);

export function createHarmonyRuleScheduler() {
  return new RuleScheduler(BUILTIN_HARMONY_RULES);
}

export function checkHarmony(
  project: ProjectDocument,
  ruleSeverities: HarmonyRuleSeverities = defaultHarmonyRuleSeverities(),
  configs: Partial<Record<HarmonyRuleId, RuleConfig>> = {},
  exceptions: Partial<Record<HarmonyRuleId, RuleExceptionPolicy>> = {},
): HarmonyCheckResult {
  return runRulesSynchronously(
    BUILTIN_HARMONY_RULES,
    project,
    ruleSeverities,
    0,
    configs,
    exceptions,
  );
}
