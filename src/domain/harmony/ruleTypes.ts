/**
 * 规则领域的稳定入口。
 *
 * 规则元数据来自 `rules/catalog.ts`，旧模块名暂时保留只是为了让编辑器、
 * 测试和外部调用方有一个平滑的导入位置；新增代码应直接依赖 `rules/*`。
 */
export {
  HARMONY_RULE_DEFINITIONS,
  HARMONY_RULE_DEFINITION_BY_ID,
  HARMONY_RULE_GROUPS,
  HARMONY_RULE_SEVERITY_OPTIONS,
  HARMONY_RULE_CATALOG_REVISION,
  chordDependentRuleIds,
  defaultHarmonyRuleSeverities,
} from "./rules/catalog";
export type {
  HarmonyRuleId,
  HarmonyRuleSeverities,
} from "./rules/catalog";
export {
  RULE_EXCEPTION_CONTEXTS,
  type DiagnosticSeverity,
  type HarmonyRuleGroupId,
  type HarmonyRuleSeverity,
  type RuleConfig,
  type RuleConfigValue,
  type RuleDependencyScope,
  type RuleExceptionContext,
  type RuleExceptionMode,
  type RuleExceptionPolicy,
  type RuleInstanceSettings,
  type RuleOptionDefinition,
  type RuleRequirement,
  type HarmonyRuleDefinition,
  type RuleConfigNormalizationResult,
} from "./rules/types";
import {
  HARMONY_RULE_DEFINITION_BY_ID,
  type HarmonyRuleId,
} from "./rules/catalog";
import { normalizeRuleConfig } from "./rules/configSchema";
import type { RuleConfig } from "./rules/types";

export interface LegacyRuleConfigNormalizationResult {
  config: RuleConfig;
  repairedKeys: string[];
}

/** @deprecated 使用 normalizeRuleConfig；保留此函数供尚未迁移的设置逻辑调用。 */
export function normalizeBuiltinRuleConfig(
  ruleId: HarmonyRuleId,
  input: RuleConfig | undefined,
): LegacyRuleConfigNormalizationResult {
  const definition = HARMONY_RULE_DEFINITION_BY_ID.get(ruleId);
  if (!definition) return { config: {}, repairedKeys: [] };
  const result = normalizeRuleConfig(definition, input);
  return {
    config: result.config,
    repairedKeys: result.repairs.map((repair) => repair.key),
  };
}
