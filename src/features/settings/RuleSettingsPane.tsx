import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Download, Link2, RotateCcw, Save, Search, Upload } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import {
  HARMONY_RULE_DEFINITIONS,
  HARMONY_RULE_GROUPS,
  HARMONY_RULE_SEVERITY_OPTIONS,
  type HarmonyRuleSeverity,
} from "../../domain/harmony";
import { BuiltinRuleDetails } from "./BuiltinRuleDetails";
import { ExternalRuleSettingsPane } from "./ExternalRuleSettingsPane";
import {
  buildExternalRuleEntries,
  isBuiltinRuleModified,
  isExternalRuleModified,
  severityLabel,
} from "./ruleSettingsModel";
import type { RuleSettingsProps } from "./types";

type RuleSourceFilter = "all" | "builtin" | "external";
type RuleSeverityFilter = "all" | HarmonyRuleSeverity;

export function RuleSettingsPane({
  searchRef,
  ...props
}: RuleSettingsProps & { searchRef?: RefObject<HTMLInputElement | null> }) {
  const internalSearchRef = useRef<HTMLInputElement>(null);
  const ruleSearchRef = searchRef ?? internalSearchRef;
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<RuleSourceFilter>("all");
  const [severityFilter, setSeverityFilter] =
    useState<RuleSeverityFilter>("all");
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const [selectedRuleKey, setSelectedRuleKey] = useState(
    `builtin:${HARMONY_RULE_DEFINITIONS[0]?.id ?? ""}`,
  );

  const externalEntries = useMemo(
    () =>
      buildExternalRuleEntries(
        props.externalRulePackages,
        props.externalRuleReferences,
        props.externalRuleFailures,
      ),
    [
      props.externalRuleFailures,
      props.externalRulePackages,
      props.externalRuleReferences,
    ],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleBuiltinRules = HARMONY_RULE_DEFINITIONS.filter((rule) => {
    if (sourceFilter === "external") return false;
    if (
      severityFilter !== "all" &&
      props.ruleSeverities[rule.id] !== severityFilter
    )
      return false;
    if (
      modifiedOnly &&
      !isBuiltinRuleModified(
        rule,
        props.ruleSeverities,
        props.ruleConfigs,
        props.ruleExceptions,
      )
    )
      return false;
    if (!normalizedQuery) return true;
    const group =
      HARMONY_RULE_GROUPS.find((candidate) => candidate.id === rule.group)
        ?.label ?? "";
    return `${rule.catalogNumber} ${rule.label} ${rule.description} ${rule.rationale} ${rule.id} ${group}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
  const visibleExternalEntries = externalEntries.filter((entry) => {
    if (sourceFilter === "builtin") return false;
    const severity =
      entry.reference?.severity ?? entry.rule?.defaultSeverity ?? "off";
    if (severityFilter !== "all" && severity !== severityFilter) return false;
    if (modifiedOnly && !isExternalRuleModified(entry)) return false;
    if (!normalizedQuery) return true;
    return `${entry.rule?.label ?? entry.reference?.ruleId ?? ""} ${entry.rule?.description ?? ""} ${entry.reference?.ruleId ?? entry.rule?.id ?? ""} ${entry.installedPackage?.manifest.packageId ?? entry.reference?.packageId ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });

  const selectedBuiltin = selectedRuleKey.startsWith("builtin:")
    ? HARMONY_RULE_DEFINITIONS.find(
        (rule) => `builtin:${rule.id}` === selectedRuleKey,
      )
    : undefined;
  const selectedExternal = selectedRuleKey.startsWith("external:")
    ? externalEntries.find((entry) => entry.key === selectedRuleKey)
    : undefined;
  const activeBuiltin =
    selectedBuiltin ??
    (!selectedExternal ? HARMONY_RULE_DEFINITIONS[0] : undefined);

  const moveRuleFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button[data-rule-key]",
      ),
    ];
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const next =
      buttons[Math.max(0, Math.min(buttons.length - 1, current + offset))];
    if (!next) return;
    event.preventDefault();
    next.focus();
    setSelectedRuleKey(next.dataset.ruleKey ?? selectedRuleKey);
  };

  return (
    <div className="rule-settings-content">
      <div className="rule-settings-toolbar">
        <label className="settings-search">
          <Search aria-hidden="true" />
          <input
            ref={ruleSearchRef}
            type="search"
            value={query}
            placeholder="搜索名称、编号、ID 或说明"
            aria-label="搜索检查规则"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          value={sourceFilter}
          aria-label="按规则来源筛选"
          onChange={(event) =>
            setSourceFilter(event.target.value as RuleSourceFilter)
          }
        >
          <option value="all">全部来源</option>
          <option value="builtin">内置</option>
          <option value="external">外置</option>
        </select>
        <select
          value={severityFilter}
          aria-label="按严重程度筛选"
          onChange={(event) =>
            setSeverityFilter(event.target.value as RuleSeverityFilter)
          }
        >
          <option value="all">全部严重程度</option>
          {HARMONY_RULE_SEVERITY_OPTIONS.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="rule-modified-filter">
          <input
            type="checkbox"
            checked={modifiedOnly}
            onChange={(event) => setModifiedOnly(event.target.checked)}
          />
          已修改
        </label>
        <div className="rule-toolbar-actions">
          <IconButton
            label="导入规则配置档案"
            icon={<Upload />}
            onClick={props.onImportRuleProfile}
          />
          <IconButton
            label="导出规则配置档案"
            icon={<Download />}
            onClick={props.onExportRuleProfile}
          />
          <IconButton
            label="设为新建工程默认"
            icon={<Save />}
            onClick={props.onSetDefaultRuleProfile}
          />
          <IconButton
            label="导入外置规则包"
            icon={<Link2 />}
            onClick={props.onImportExternalRulePackage}
          />
          <IconButton
            label="恢复全部规则默认"
            icon={<RotateCcw />}
            onClick={props.onResetAllRules}
          />
        </div>
      </div>

      {props.externalRuleLibraryError ? (
        <div className="rule-settings-error" role="alert">
          {props.externalRuleLibraryError}
        </div>
      ) : null}
      <div className="rule-settings-main">
        <div
          className="rule-groups"
          aria-label="规则目录"
          onKeyDown={moveRuleFocus}
        >
          <div className="rule-profile-summary">
            <strong>{props.profileTitle}</strong>
            <span>
              {visibleBuiltinRules.length} 条内置
              {visibleExternalEntries.length > 0
                ? ` · ${visibleExternalEntries.length} 条外置`
                : ""}
              {props.externalRuleLibraryLoading ? " · 正在读取规则库" : ""}
            </span>
          </div>
          {HARMONY_RULE_GROUPS.map((group) => {
            const rules = visibleBuiltinRules.filter(
              (rule) => rule.group === group.id,
            );
            if (rules.length === 0) return null;
            return (
              <section className="rule-group" key={group.id}>
                <h3>{group.label}</h3>
                {rules.map((rule) => {
                  const severity = props.ruleSeverities[rule.id];
                  const modified = isBuiltinRuleModified(
                    rule,
                    props.ruleSeverities,
                    props.ruleConfigs,
                    props.ruleExceptions,
                  );
                  const key = `builtin:${rule.id}`;
                  return (
                    <button
                      type="button"
                      className={`rule-row severity-${severity} ${selectedRuleKey === key ? "is-selected" : ""}`}
                      aria-label={`查看“${rule.label}”规则`}
                      data-rule-key={key}
                      key={rule.id}
                      onClick={() => setSelectedRuleKey(key)}
                    >
                      <span className="rule-copy">
                        <strong>
                          <code>{rule.catalogNumber}</code>
                          {rule.label}
                        </strong>
                        <small>{rule.description}</small>
                      </span>
                      {modified ? (
                        <span className="rule-row-status">
                          <b>已修改</b>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </section>
            );
          })}
          {visibleExternalEntries.length > 0 ? (
            <section className="rule-group external-rule-group">
              <h3>外置规则</h3>
              {visibleExternalEntries.map((entry) => {
                const severity =
                  entry.reference?.severity ??
                  entry.rule?.defaultSeverity ??
                  "off";
                return (
                  <button
                    type="button"
                    className={`rule-row severity-${severity} ${selectedRuleKey === entry.key ? "is-selected" : ""} ${entry.failure ? "has-failure" : ""}`}
                    aria-label={`查看“${entry.rule?.label ?? entry.reference?.ruleId ?? "未知规则"}”规则`}
                    data-rule-key={entry.key}
                    key={entry.key}
                    onClick={() => setSelectedRuleKey(entry.key)}
                  >
                    <span className="rule-copy">
                      <strong>
                        {entry.rule?.label ??
                          entry.reference?.ruleId ??
                          "未知规则"}
                      </strong>
                      <small>
                        {entry.installedPackage?.manifest.packageId ??
                          entry.reference?.packageId ??
                          "未知来源"}
                      </small>
                    </span>
                    {!entry.installedPackage ||
                    !entry.reference ||
                    isExternalRuleModified(entry) ? (
                      <span className="rule-row-status">
                        {!entry.installedPackage ? (
                          <b>未挂载</b>
                        ) : !entry.reference ? (
                          <b>未加入工程</b>
                        ) : null}
                        {isExternalRuleModified(entry) ? (
                          <b>已修改</b>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </section>
          ) : null}
          {visibleBuiltinRules.length === 0 &&
          visibleExternalEntries.length === 0 ? (
            <div className="settings-empty">没有匹配的检查规则</div>
          ) : null}
        </div>

        <aside className="rule-details-panel">
          {activeBuiltin ? (
            <BuiltinRuleDetails rule={activeBuiltin} {...props} />
          ) : selectedExternal ? (
            <ExternalRuleSettingsPane entry={selectedExternal} {...props} />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
