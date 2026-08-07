import { Link2, LoaderCircle, Trash2, Unplug } from "lucide-react";
import {
  externalRuleReferenceKey,
  type ExternalRuleFailure,
  type InstalledExternalRulePackage,
} from "../domain/externalRules";
import type { RuleProfile } from "../domain/model";
import {
  HARMONY_RULE_SEVERITY_OPTIONS,
  type HarmonyRuleSeverity,
} from "../domain/harmonyRules";
import { IconButton } from "./IconButton";

interface ExternalRuleSettingsProps {
  packages: InstalledExternalRulePackage[];
  references: RuleProfile["external"];
  failures: ExternalRuleFailure[];
  loading: boolean;
  error?: string;
  query: string;
  onMount(installedPackage: InstalledExternalRulePackage): void;
  onRemove(installedPackage: InstalledExternalRulePackage): void;
  onSetEnabled(
    reference: RuleProfile["external"][number],
    enabled: boolean,
  ): void;
  onSetSeverity(
    reference: RuleProfile["external"][number],
    severity: HarmonyRuleSeverity,
  ): void;
}

function matchesQuery(query: string, values: Array<string | undefined>) {
  if (!query) return true;
  return values
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

function sourceName(sourcePath?: string) {
  return sourcePath?.split(/[\\/]/).at(-1) ?? "本机私有副本";
}

export function ExternalRuleSettings({
  packages,
  references,
  failures,
  loading,
  error,
  query,
  onMount,
  onRemove,
  onSetEnabled,
  onSetSeverity,
}: ExternalRuleSettingsProps) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const installedKeys = new Set(
    packages.flatMap((installedPackage) =>
      installedPackage.manifest.rules.map((rule) =>
        externalRuleReferenceKey({
          packageId: installedPackage.manifest.packageId,
          version: installedPackage.manifest.version,
          contentHash: installedPackage.contentHash,
          ruleId: rule.id,
        }),
      ),
    ),
  );
  const missingReferences = references.filter(
    (reference) => !installedKeys.has(externalRuleReferenceKey(reference)),
  );
  const visibleMissingReferences = missingReferences.filter((reference) =>
    matchesQuery(normalizedQuery, [
      reference.packageId,
      reference.version,
      reference.ruleId,
      reference.contentHash,
    ]),
  );
  let visiblePackageCount = 0;

  return (
    <section className="external-rule-library" aria-label="外置规则库">
      <header className="external-rule-library-header">
        <div>
          <h3>外置规则</h3>
          <small>
            脚本在独立 QuickJS Worker 中运行，不具有文件、网络或界面权限。
          </small>
        </div>
        <span className="external-rule-library-status">
          {loading ? (
            <>
              <LoaderCircle className="is-spinning" aria-hidden="true" />
              正在读取
            </>
          ) : (
            `${packages.length} 个本机规则包`
          )}
        </span>
      </header>

      {error ? (
        <div className="external-rule-library-error" role="alert">
          {error}
        </div>
      ) : null}

      {packages.map((installedPackage) => {
        const packageMatches = matchesQuery(normalizedQuery, [
          installedPackage.manifest.packageId,
          installedPackage.manifest.version,
          installedPackage.contentHash,
          installedPackage.sourcePath,
        ]);
        const visibleRules = installedPackage.manifest.rules.filter(
          (rule) =>
            packageMatches ||
            matchesQuery(normalizedQuery, [
              rule.id,
              rule.label,
              rule.description,
              rule.group,
            ]),
        );
        if (visibleRules.length === 0) return null;
        visiblePackageCount += 1;
        const referencesByRule = new Map(
          references
            .filter(
              (reference) =>
                reference.packageId === installedPackage.manifest.packageId &&
                reference.version === installedPackage.manifest.version &&
                reference.contentHash === installedPackage.contentHash,
            )
            .map((reference) => [reference.ruleId, reference]),
        );
        const fullyMounted = installedPackage.manifest.rules.every((rule) =>
          referencesByRule.has(rule.id),
        );

        return (
          <section
            className="external-rule-package"
            key={installedPackage.contentHash}
          >
            <header>
              <div className="external-rule-package-copy">
                <strong>
                  {installedPackage.manifest.packageId}
                  <span>v{installedPackage.manifest.version}</span>
                </strong>
                <small title={installedPackage.sourcePath}>
                  {sourceName(installedPackage.sourcePath)} · SHA-256{" "}
                  {installedPackage.contentHash.slice(0, 12)}…
                </small>
              </div>
              <button
                type="button"
                className="external-rule-mount-button"
                disabled={fullyMounted}
                onClick={() => onMount(installedPackage)}
              >
                <Link2 aria-hidden="true" />
                {fullyMounted ? "已挂载" : "挂载到工程"}
              </button>
              <IconButton
                label={`移除规则包“${installedPackage.manifest.packageId}”的本机副本`}
                icon={<Trash2 />}
                onClick={() => onRemove(installedPackage)}
              />
            </header>

            {visibleRules.map((rule) => {
              const reference = referencesByRule.get(rule.id);
              const failure = failures.find(
                (item) =>
                  item.packageId === installedPackage.manifest.packageId &&
                  item.version === installedPackage.manifest.version &&
                  item.contentHash === installedPackage.contentHash &&
                  item.ruleId === rule.id,
              );
              return (
                <div
                  className={`external-rule-row ${failure ? "has-failure" : ""}`}
                  key={rule.id}
                >
                  <label className="external-rule-enabled">
                    <input
                      type="checkbox"
                      checked={reference?.enabled ?? false}
                      disabled={!reference}
                      aria-label={`启用外置规则“${rule.label}”`}
                      onChange={(event) =>
                        reference &&
                        onSetEnabled(reference, event.target.checked)
                      }
                    />
                  </label>
                  <div className="external-rule-copy">
                    <strong>{rule.label}</strong>
                    <small>{rule.description}</small>
                    <code>
                      {rule.id} · {rule.dependencyScope}
                    </code>
                    {failure ? (
                      <span
                        className="external-rule-failure"
                        title={failure.message}
                      >
                        {failure.message}
                      </span>
                    ) : null}
                  </div>
                  <select
                    value={reference?.severity ?? rule.defaultSeverity}
                    disabled={!reference}
                    aria-label={`设置外置规则“${rule.label}”严重程度`}
                    onChange={(event) =>
                      reference &&
                      onSetSeverity(
                        reference,
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
                </div>
              );
            })}
          </section>
        );
      })}

      {visibleMissingReferences.length > 0 ? (
        <section className="external-rule-package is-missing">
          <header>
            <Unplug aria-hidden="true" />
            <div className="external-rule-package-copy">
              <strong>未挂载的工程规则</strong>
              <small>重新导入完全匹配的版本与摘要后即可恢复执行。</small>
            </div>
          </header>
          {visibleMissingReferences.map((reference) => {
            const failure = failures.find(
              (item) =>
                item.packageId === reference.packageId &&
                item.version === reference.version &&
                item.contentHash === reference.contentHash &&
                item.ruleId === reference.ruleId,
            );
            return (
              <div
                className="external-rule-row has-failure"
                key={externalRuleReferenceKey(reference)}
              >
                <label className="external-rule-enabled">
                  <input
                    type="checkbox"
                    checked={reference.enabled}
                    aria-label={`启用缺失的外置规则“${reference.ruleId}”`}
                    onChange={(event) =>
                      onSetEnabled(reference, event.target.checked)
                    }
                  />
                </label>
                <div className="external-rule-copy">
                  <strong>{reference.ruleId}</strong>
                  <small>
                    {reference.packageId} v{reference.version} ·{" "}
                    {reference.contentHash.slice(0, 12)}…
                  </small>
                  <span className="external-rule-failure">
                    {failure?.message ?? "本机没有匹配的规则包副本"}
                  </span>
                </div>
                <select
                  value={reference.severity}
                  aria-label={`设置缺失外置规则“${reference.ruleId}”严重程度`}
                  onChange={(event) =>
                    onSetSeverity(
                      reference,
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
              </div>
            );
          })}
        </section>
      ) : null}

      {!loading &&
      visiblePackageCount === 0 &&
      visibleMissingReferences.length === 0 ? (
        <div className="external-rule-empty">
          {normalizedQuery
            ? "没有匹配的外置规则"
            : "尚未安装外置规则包。导入后会复制到应用私有规则库。"}
        </div>
      ) : null}
    </section>
  );
}
