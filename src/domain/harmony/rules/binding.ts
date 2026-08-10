import type { HarmonyAnalysis } from "../analysis";
import type {
  RuleConfig,
  RuleDefinition,
  RuleDiagnostic,
  StatefulRuleDefinition,
} from "../runtime";
import type { HarmonyRuleId } from "./catalog";
import { evaluation } from "./helpers/core";
import type { HarmonyRuleDefinition } from "./types";

export type StatelessRuleEvaluator = (
  analysis: HarmonyAnalysis,
  config: RuleConfig,
) => RuleDiagnostic[];

export type RuleBinding =
  | {
      readonly kind: "stateless";
      readonly evaluate: StatelessRuleEvaluator;
    }
  | {
      readonly kind: "stateful";
      readonly process: StatefulRuleDefinition["process"];
      readonly finalize?: StatefulRuleDefinition["finalize"];
    };

export type RuleBindingGroup = Readonly<
  Partial<Record<HarmonyRuleId, RuleBinding>>
>;

type CatalogRuleDefinition = HarmonyRuleDefinition & {
  readonly id: HarmonyRuleId;
};

export function statelessRule(
  evaluate: StatelessRuleEvaluator,
): RuleBinding {
  return { kind: "stateless", evaluate };
}

export function statefulRule(
  process: StatefulRuleDefinition["process"],
  finalize?: StatefulRuleDefinition["finalize"],
): RuleBinding {
  return { kind: "stateful", process, finalize };
}

export function defineRuleBindings<
  const T extends RuleBindingGroup,
>(bindings: T): T {
  return bindings;
}

export function mergeRuleBindings(
  ...groups: readonly RuleBindingGroup[]
): ReadonlyMap<HarmonyRuleId, RuleBinding> {
  const merged = new Map<HarmonyRuleId, RuleBinding>();
  groups.forEach((group) => {
    (Object.entries(group) as [HarmonyRuleId, RuleBinding][]).forEach(
      ([ruleId, binding]) => {
        if (merged.has(ruleId))
          throw new Error(`规则“${ruleId}”存在重复实现绑定`);
        merged.set(ruleId, binding);
      },
    );
  });
  return merged;
}

export function bindRuleDefinitions(
  definitions: readonly CatalogRuleDefinition[],
  bindings: ReadonlyMap<HarmonyRuleId, RuleBinding>,
): readonly RuleDefinition[] {
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );

  bindings.forEach((_binding, ruleId) => {
    const definition = definitionsById.get(ruleId);
    if (!definition)
      throw new Error(`规则实现绑定引用了未知目录项“${ruleId}”`);
    if (!definition.implemented)
      throw new Error(`未实现规则“${ruleId}”不应注册运行时绑定`);
  });

  return definitions
    .filter((definition) => definition.implemented)
    .map((definition) => {
      const binding = bindings.get(definition.id);
      if (!binding)
        throw new Error(`已实现规则“${definition.id}”缺少运行时绑定`);
      if (binding.kind === "stateful") {
        return {
          ...definition,
          process: binding.process,
          ...(binding.finalize ? { finalize: binding.finalize } : {}),
        } satisfies RuleDefinition;
      }
      return {
        ...definition,
        evaluate: ({ analysis }, config) =>
          evaluation(binding.evaluate(analysis, config)),
      } satisfies RuleDefinition;
    });
}
