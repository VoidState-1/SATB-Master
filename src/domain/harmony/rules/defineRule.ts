import type { HarmonyRuleContext } from "./context/createRuleContext";
import type {
  RuleDefinition,
  RuleDiagnostic,
  StatefulRuleDefinition,
  StatelessRuleDefinition,
} from "../runtime";
import type {
  HarmonyRuleDefinition,
  RuleConfig,
  RuleExceptionContext,
  RuleExceptionPolicy,
  RuleOptionDefinition,
} from "./types";
import { defaultConfigFromOptions } from "./configSchema";

export type RuleMetadataInput<Id extends string> = Omit<
  HarmonyRuleDefinition,
  | "id"
  | "configVersion"
  | "defaultConfig"
  | "options"
  | "supportedExceptionContexts"
  | "defaultExceptionPolicies"
  | "coveredRuleIds"
> & {
  readonly id: Id;
  readonly configVersion?: number;
  readonly options?: readonly RuleOptionDefinition[];
  readonly supportedExceptionContexts?: readonly RuleExceptionContext[];
  readonly defaultExceptionPolicies?: RuleExceptionPolicy;
  readonly coveredRuleIds?: readonly string[];
};

export type StatelessRuleEvaluator = (
  context: HarmonyRuleContext,
  config: RuleConfig,
) => readonly RuleDiagnostic[];

type StatelessRuleInput<Id extends string> = RuleMetadataInput<Id> & {
  readonly evaluate: StatelessRuleEvaluator;
};

type StatefulRuleInput<Id extends string> = RuleMetadataInput<Id> & {
  readonly process: StatefulRuleDefinition["process"];
  readonly finalize?: StatefulRuleDefinition["finalize"];
};

function completeMetadata<Id extends string>(
  input: RuleMetadataInput<Id>,
): HarmonyRuleDefinition & { readonly id: Id } {
  const options = input.options ?? [];
  const supportedExceptionContexts = input.supportedExceptionContexts ?? [];
  const defaultExceptionPolicies = input.defaultExceptionPolicies ?? {};
  const coveredRuleIds = input.coveredRuleIds ?? [];
  const defaultConfig = defaultConfigFromOptions(options);
  return {
    ...input,
    configVersion: input.configVersion ?? 1,
    options,
    defaultConfig,
    supportedExceptionContexts,
    defaultExceptionPolicies,
    coveredRuleIds,
  };
}

/**
 * 定义无状态规则。
 */
export function defineStatelessRule<const Id extends string>(
  input: StatelessRuleInput<Id>,
): StatelessRuleDefinition & { readonly id: Id } {
  const { evaluate, ...metadata } = input;
  return {
    ...completeMetadata(metadata),
    evaluate: (context, config) => ({
      diagnostics: evaluate(context, config),
    }),
  };
}

/**
 * 定义有状态规则。
 */
export function defineStatefulRule<const Id extends string>(
  input: StatefulRuleInput<Id>,
): StatefulRuleDefinition & { readonly id: Id } {
  const { process, finalize, ...metadata } = input;
  return {
    ...completeMetadata(metadata),
    process,
    ...(finalize ? { finalize } : {}),
  };
}

export function defineRuleGroup<const Rules extends readonly RuleDefinition[]>(
  ...rules: Rules
): Rules {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`规则组内存在重复规则“${rule.id}”`);
    ids.add(rule.id);
  }
  return rules;
}

export function defineRuleCollection<
  const Groups extends readonly (readonly RuleDefinition[])[],
>(...groups: Groups): readonly Groups[number][number][] {
  const rules = groups.flat() as Groups[number][number][];
  const ids = new Set<string>();
  const catalogNumbers = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`内置规则 ID 重复：“${rule.id}”`);
    if (catalogNumbers.has(rule.catalogNumber))
      throw new Error(`内置规则目录号重复：“${rule.catalogNumber}”`);
    ids.add(rule.id);
    catalogNumbers.add(rule.catalogNumber);

    const optionKeys = new Set<string>();
    for (const option of rule.options) {
      if (optionKeys.has(option.key))
        throw new Error(`规则“${rule.id}”包含重复配置项“${option.key}”`);
      optionKeys.add(option.key);
    }
    for (const context of Object.keys(rule.defaultExceptionPolicies)) {
      if (
        !rule.supportedExceptionContexts.includes(
          context as RuleExceptionContext,
        )
      )
        throw new Error(`规则“${rule.id}”的默认特例“${context}”未声明支持`);
    }
  }
  for (const rule of rules) {
    for (const coveredRuleId of rule.coveredRuleIds) {
      if (!ids.has(coveredRuleId))
        throw new Error(`规则“${rule.id}”覆盖了未知规则“${coveredRuleId}”`);
    }
  }
  return rules.sort((left, right) =>
    left.catalogNumber.localeCompare(right.catalogNumber, "en", {
      numeric: true,
    }),
  );
}
