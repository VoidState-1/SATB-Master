import type { ProjectDocument } from "../project/types";
import { resolveBuiltinRuleProfile } from "../ruleProfile";
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
  ruleSeverities?: HarmonyRuleSeverities,
  configs?: Partial<Record<HarmonyRuleId, RuleConfig>>,
  exceptions?: Partial<Record<HarmonyRuleId, RuleExceptionPolicy>>,
): HarmonyCheckResult {
  // An explicit override is a standalone rule run. Otherwise use the saved project profile.
  const profile = !ruleSeverities && !configs && !exceptions ? resolveBuiltinRuleProfile(project) : undefined;
  return runRulesSynchronously(
    BUILTIN_HARMONY_RULES,
    project,
    ruleSeverities ?? profile?.severities ?? defaultHarmonyRuleSeverities(),
    0,
    configs ?? profile?.configs,
    exceptions ?? profile?.exceptions,
  );
}
