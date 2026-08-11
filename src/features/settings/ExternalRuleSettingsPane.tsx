import { Link2, RotateCcw, Trash2 } from "lucide-react";
import {
  HARMONY_RULE_SEVERITY_OPTIONS,
  type HarmonyRuleSeverity,
} from "../../domain/harmony";
import { RuleExceptionFields, RuleOptionFields } from "./RuleFields";
import { sourceName, type ExternalRuleEntry } from "./ruleSettingsModel";
import type { RuleSettingsProps } from "./types";

type ExternalRuleSettingsPaneProps = Pick<
  RuleSettingsProps,
  | "ruleHitCounts"
  | "onMountExternalRulePackage"
  | "onRemoveExternalRulePackage"
  | "onSetExternalRuleEnabled"
  | "onSetExternalRuleSeverity"
  | "onSetExternalRuleConfig"
  | "onSetExternalRuleException"
  | "onResetExternalRule"
> & {
  entry: ExternalRuleEntry;
};

export function ExternalRuleSettingsPane({
  entry,
  ruleHitCounts,
  onMountExternalRulePackage,
  onRemoveExternalRulePackage,
  onSetExternalRuleEnabled,
  onSetExternalRuleSeverity,
  onSetExternalRuleConfig,
  onSetExternalRuleException,
  onResetExternalRule,
}: ExternalRuleSettingsPaneProps) {
  const ruleId = entry.rule?.id ?? entry.reference?.ruleId ?? "";
  return (
    <>
      <header className="rule-details-header">
        <div className="rule-details-badges">
          <span className="rule-source-badge">外置规则</span>
          {!entry.installedPackage ? (
            <span className="rule-unimplemented-badge">未挂载</span>
          ) : null}
        </div>
        <h3>{entry.rule?.label ?? entry.reference?.ruleId}</h3>
        <code>{ruleId}</code>
        <span className="rule-hit-count">
          当前工程命中 {ruleHitCounts[ruleId] ?? 0} 项
        </span>
      </header>
      <section className="rule-details-section external-rule-source">
        <h4>来源</h4>
        <dl>
          <div>
            <dt>包</dt>
            <dd>
              {entry.installedPackage?.manifest.packageId ??
                entry.reference?.packageId}
            </dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>
              {entry.installedPackage?.manifest.version ??
                entry.reference?.version}
            </dd>
          </div>
          <div>
            <dt>摘要</dt>
            <dd>
              {(
                entry.installedPackage?.contentHash ??
                entry.reference?.contentHash ??
                ""
              ).slice(0, 16)}
              …
            </dd>
          </div>
          {entry.installedPackage ? (
            <div>
              <dt>本机文件</dt>
              <dd>{sourceName(entry.installedPackage.sourcePath)}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <section className="rule-details-section">
        <h4>判断说明</h4>
        <p>
          {entry.rule?.description ??
            "本机没有与工程引用完全匹配的规则包，配置会保留但不会执行。"}
        </p>
      </section>
      {entry.failure ? (
        <div className="rule-implementation-note is-error" role="alert">
          {entry.failure.message}
        </div>
      ) : null}
      {entry.reference ? (
        <section className="rule-details-section">
          <label className="rule-detail-field">
            <span>在当前工程中启用</span>
            <input
              type="checkbox"
              checked={entry.reference.enabled}
              aria-label={`启用外置规则“${entry.rule?.label ?? ruleId}”`}
              onChange={(event) =>
                onSetExternalRuleEnabled(entry.reference!, event.target.checked)
              }
            />
          </label>
          <label className="rule-detail-field">
            <span>严重程度</span>
            <select
              value={entry.reference.severity}
              aria-label={`设置外置规则“${entry.rule?.label ?? ruleId}”严重程度`}
              onChange={(event) =>
                onSetExternalRuleSeverity(
                  entry.reference!,
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
      ) : null}
      {entry.rule && entry.reference ? (
        <>
          <RuleOptionFields
            options={entry.rule.options}
            config={entry.reference.config}
            onPatch={(patch) =>
              onSetExternalRuleConfig(entry.reference!, patch)
            }
          />
          <RuleExceptionFields
            contexts={entry.rule.supportedExceptionContexts}
            defaults={entry.rule.defaultExceptionPolicies}
            exceptions={entry.reference.exceptions}
            onChange={(policy) =>
              onSetExternalRuleException(entry.reference!, policy)
            }
          />
        </>
      ) : null}
      <div className="rule-detail-actions">
        {entry.installedPackage && !entry.reference ? (
          <button
            type="button"
            className="command-button external-rule-mount-button"
            aria-label={`挂载外置规则包“${entry.installedPackage.manifest.packageId}”`}
            onClick={() => onMountExternalRulePackage(entry.installedPackage!)}
          >
            <Link2 aria-hidden="true" />
            挂载到工程
          </button>
        ) : null}
        {entry.reference && entry.rule ? (
          <button
            type="button"
            className="command-button"
            aria-label={`恢复外置规则“${entry.rule.label}”默认设置`}
            onClick={() => onResetExternalRule(entry.reference!)}
          >
            <RotateCcw aria-hidden="true" />
            恢复本规则默认
          </button>
        ) : null}
        {entry.installedPackage ? (
          <button
            type="button"
            className="command-button danger-button"
            aria-label={`移除规则包“${entry.installedPackage.manifest.packageId}”的本机副本`}
            onClick={() => onRemoveExternalRulePackage(entry.installedPackage!)}
          >
            <Trash2 aria-hidden="true" />
            移除本机副本
          </button>
        ) : null}
      </div>
    </>
  );
}
