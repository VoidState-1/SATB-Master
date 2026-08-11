import {
  defineStatelessRule,
  type RuleMetadataInput,
  type StatelessRuleEvaluator,
} from "../defineRule";

export type AlgorithmicRuleInput<Id extends string> = RuleMetadataInput<Id> & {
  readonly evaluate: StatelessRuleEvaluator;
};

/**
 * 声明无法由稳定事实组合清晰表达的全局搜索或专用算法规则。
 * 该入口保留具名 evaluator，同时让算法逃生口能够与局部约束明确区分。
 */
export function defineAlgorithmicRule<const Id extends string>(
  input: AlgorithmicRuleInput<Id>,
) {
  return defineStatelessRule(input);
}
