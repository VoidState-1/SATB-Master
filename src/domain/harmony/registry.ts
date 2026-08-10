import type { ProjectDocument } from "../project/types";
import {
  RuleScheduler,
  runRulesSynchronously,
  type HarmonyCheckResult,
  type RuleConfig,
} from "./runtime";
import {
  defaultHarmonyRuleSeverities,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
} from "./rules/catalog";
import type { RuleExceptionPolicy } from "./rules/types";
import { BUILTIN_HARMONY_RULES } from "./rules/groups";

export { BUILTIN_HARMONY_RULES };

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
