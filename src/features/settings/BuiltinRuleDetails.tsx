import { RotateCcw } from "lucide-react";
import {
  HARMONY_RULE_DEFINITIONS,
  HARMONY_RULE_SEVERITY_OPTIONS,
  type HarmonyRuleSeverity,
} from "../../domain/harmony";
import { RuleExceptionFields, RuleOptionFields } from "./RuleFields";
import type { RuleSettingsProps } from "./types";

type BuiltinRuleDetailsProps = Pick<
  RuleSettingsProps,
  | "ruleHitCounts"
  | "ruleSeverities"
  | "ruleConfigs"
  | "ruleExceptions"
  | "onSetRuleSeverity"
  | "onSetRuleConfig"
  | "onSetRuleException"
  | "onResetRule"
> & {
  rule: (typeof HARMONY_RULE_DEFINITIONS)[number];
};

export function BuiltinRuleDetails({
  rule,
  ruleHitCounts,
  ruleSeverities,
  ruleConfigs,
  ruleExceptions,
  onSetRuleSeverity,
  onSetRuleConfig,
  onSetRuleException,
  onResetRule,
}: BuiltinRuleDetailsProps) {
  return (
    <>
      <header className="rule-details-header">
        <div className="rule-details-badges">
          <span className="rule-source-badge">内置规则</span>
          <span className="rule-catalog-badge">{rule.catalogNumber}</span>
          {!rule.implemented ? (
            <span className="rule-unimplemented-badge">尚未实现</span>
          ) : null}
        </div>
        <h3>{rule.label}</h3>
        <code>{rule.id}</code>
        <span className="rule-hit-count">
          当前工程命中 {ruleHitCounts[rule.id] ?? 0} 项
        </span>
      </header>
      {!rule.implemented ? (
        <div className="rule-implementation-note" role="status">
          本项已进入规则目录，但尚无可执行实现。设置会随工程保存，当前版本不会运行它。
        </div>
      ) : null}
      <section className="rule-details-section">
        <h4>判断说明</h4>
        <p>{rule.description}</p>
      </section>
      <section className="rule-details-section">
        <h4>理论依据</h4>
        <p>{rule.rationale}</p>
      </section>
      <section className="rule-details-section">
        <label className="rule-detail-field">
          <span>严重程度</span>
          <select
            value={ruleSeverities[rule.id]}
            onChange={(event) =>
              onSetRuleSeverity(
                rule.id,
                event.target.value as HarmonyRuleSeverity,
              )
            }
          >
            {HARMONY_RULE_SEVERITY_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <RuleOptionFields
        options={rule.options}
        config={ruleConfigs[rule.id] ?? rule.defaultConfig}
        onPatch={(patch) => onSetRuleConfig(rule.id, patch)}
      />
      <RuleExceptionFields
        contexts={rule.supportedExceptionContexts}
        defaults={rule.defaultExceptionPolicies}
        exceptions={ruleExceptions[rule.id] ?? {}}
        onChange={(policy) => onSetRuleException(rule.id, policy)}
      />
      <button
        type="button"
        className="command-button rule-reset-button"
        onClick={() => onResetRule(rule.id)}
      >
        <RotateCcw aria-hidden="true" />
        恢复本规则默认
      </button>
    </>
  );
}
