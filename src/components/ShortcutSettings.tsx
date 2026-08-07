import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Bug,
  Download,
  Keyboard,
  Link2,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  externalRuleReferenceKey,
  normalizeExternalRuleConfig,
  type ExternalRuleFailure,
  type ExternalRuleManifestRule,
  type InstalledExternalRulePackage,
} from "../domain/externalRules";
import type { RuleProfile } from "../domain/model";
import {
  HARMONY_RULE_DEFINITIONS,
  HARMONY_RULE_GROUPS,
  HARMONY_RULE_SEVERITY_OPTIONS,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
  type HarmonyRuleSeverity,
  type RuleConfig,
  type RuleExceptionContext,
  type RuleExceptionPolicy,
  type RuleOptionDefinition,
} from "../domain/harmonyRules";
import {
  SHORTCUT_DEFINITIONS,
  SHORTCUT_GROUPS,
  formatShortcutBinding,
  keyboardEventToBinding,
  type ShortcutBindings,
  type ShortcutCommandId,
} from "../shortcuts/shortcutRegistry";
import { IconButton } from "./IconButton";

interface ShortcutSettingsProps {
  bindings: ShortcutBindings;
  onSetBinding(commandId: ShortcutCommandId, binding: string): void;
  onClearBinding(commandId: ShortcutCommandId): void;
  onResetBinding(commandId: ShortcutCommandId): void;
  onResetAll(): void;
  profileTitle: string;
  ruleHitCounts: Record<string, number>;
  ruleSeverities: HarmonyRuleSeverities;
  ruleConfigs: Partial<Record<HarmonyRuleId, RuleConfig>>;
  ruleExceptions: Partial<Record<HarmonyRuleId, RuleExceptionPolicy>>;
  onSetRuleSeverity(ruleId: HarmonyRuleId, severity: HarmonyRuleSeverity): void;
  onSetRuleConfig(ruleId: HarmonyRuleId, patch: RuleConfig): void;
  onSetRuleException(
    ruleId: HarmonyRuleId,
    policy: RuleExceptionPolicy | undefined,
  ): void;
  onResetRule(ruleId: HarmonyRuleId): void;
  onResetAllRules(): void;
  onImportRuleProfile(): void;
  onExportRuleProfile(): void;
  onSetDefaultRuleProfile(): void;
  externalRulePackages: InstalledExternalRulePackage[];
  externalRuleReferences: RuleProfile["external"];
  externalRuleFailures: ExternalRuleFailure[];
  externalRuleLibraryLoading: boolean;
  externalRuleLibraryError?: string;
  onImportExternalRulePackage(): void;
  onMountExternalRulePackage(
    installedPackage: InstalledExternalRulePackage,
  ): void;
  onRemoveExternalRulePackage(
    installedPackage: InstalledExternalRulePackage,
  ): void;
  onSetExternalRuleEnabled(
    reference: RuleProfile["external"][number],
    enabled: boolean,
  ): void;
  onSetExternalRuleSeverity(
    reference: RuleProfile["external"][number],
    severity: HarmonyRuleSeverity,
  ): void;
  onSetExternalRuleConfig(
    reference: RuleProfile["external"][number],
    patch: RuleConfig,
  ): void;
  onSetExternalRuleException(
    reference: RuleProfile["external"][number],
    policy: RuleExceptionPolicy | undefined,
  ): void;
  onResetExternalRule(reference: RuleProfile["external"][number]): void;
  developerMode: boolean;
  onSetDeveloperMode(enabled: boolean): void;
  onClose(): void;
}

type RuleSourceFilter = "all" | "builtin" | "external";
type RuleSeverityFilter = "all" | HarmonyRuleSeverity;

interface ExternalRuleEntry {
  key: string;
  installedPackage?: InstalledExternalRulePackage;
  rule?: ExternalRuleManifestRule;
  reference?: RuleProfile["external"][number];
  failure?: ExternalRuleFailure;
}

const EXCEPTION_CONTEXT_LABELS: Record<RuleExceptionContext, string> = {
  "same-harmony": "同和弦转换",
  arpeggiation: "分解和弦式进行",
  "voice-exchange": "声部交换",
  "inner-voices": "包含内声部",
  "bass-step-up": "低音上行级进",
  sequence: "模进",
  "pedal-point": "持续低音",
  "nonchord-tone": "已确认非和弦音",
  cadence: "终止语境",
  modulation: "转调语境",
  "ambiguous-semantics": "语义存在歧义",
  "insufficient-context": "上下文不足",
};

function sameBindings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((binding, index) => binding === right[index])
  );
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function severityLabel(severity: HarmonyRuleSeverity) {
  return (
    HARMONY_RULE_SEVERITY_OPTIONS.find((option) => option.value === severity)
      ?.label ?? severity
  );
}

function sourceName(sourcePath?: string) {
  return sourcePath?.split(/[\\/]/).at(-1) ?? "本机私有副本";
}

function NumberEditor({
  value,
  min,
  max,
  step,
  disabled,
  label,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  label: string;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (
      !Number.isFinite(next) ||
      (min !== undefined && next < min) ||
      (max !== undefined && next > max)
    ) {
      setDraft(String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function RuleOptionFields({
  options,
  config,
  disabled,
  onPatch,
}: {
  options: readonly RuleOptionDefinition[];
  config: RuleConfig;
  disabled?: boolean;
  onPatch(patch: RuleConfig): void;
}) {
  if (options.length === 0) return null;
  return (
    <section className="rule-details-section">
      <h4>参数</h4>
      <div className="rule-option-list">
        {options.map((option) => {
          const value = config[option.key] ?? option.defaultValue;
          return (
            <label className="rule-option-field" key={option.key}>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {option.kind === "boolean" ? (
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={disabled}
                  onChange={(event) =>
                    onPatch({ [option.key]: event.target.checked })
                  }
                />
              ) : option.kind === "number" ||
                option.kind === "integer" ||
                option.kind === "pitch" ? (
                <span className="rule-number-control">
                  <NumberEditor
                    value={Number(value)}
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    disabled={disabled}
                    label={option.label}
                    onCommit={(next) => onPatch({ [option.key]: next })}
                  />
                  {option.unit ? <small>{option.unit}</small> : null}
                </span>
              ) : option.kind === "enum" ? (
                <select
                  value={String(value)}
                  disabled={disabled}
                  onChange={(event) =>
                    onPatch({ [option.key]: event.target.value })
                  }
                >
                  {option.values.map((candidate) => (
                    <option value={candidate.value} key={candidate.value}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              ) : option.kind === "duration" ? (
                <span className="rule-duration-control">
                  <NumberEditor
                    value={
                      typeof value === "object" && "value" in value
                        ? value.value
                        : option.defaultValue.value
                    }
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    disabled={disabled}
                    label={option.label}
                    onCommit={(next) => {
                      const unit =
                        typeof value === "object" && "unit" in value
                          ? value.unit
                          : option.defaultValue.unit;
                      onPatch({ [option.key]: { value: next, unit } });
                    }}
                  />
                  <select
                    value={
                      typeof value === "object" && "unit" in value
                        ? value.unit
                        : option.defaultValue.unit
                    }
                    disabled={disabled}
                    aria-label={`${option.label}单位`}
                    onChange={(event) => {
                      const nextValue =
                        typeof value === "object" && "value" in value
                          ? value.value
                          : option.defaultValue.value;
                      onPatch({
                        [option.key]: {
                          value: nextValue,
                          unit: event.target.value as
                            | "ticks"
                            | "beats"
                            | "measures",
                        },
                      });
                    }}
                  >
                    <option value="beats">拍</option>
                    <option value="measures">小节</option>
                    <option value="ticks">Tick</option>
                  </select>
                </span>
              ) : (
                <span className="rule-range-control">
                  {(() => {
                    const range: { minMidi: number; maxMidi: number } =
                      typeof value === "object" && "minMidi" in value
                        ? (value as { minMidi: number; maxMidi: number })
                        : (option.defaultValue as {
                            minMidi: number;
                            maxMidi: number;
                          });
                    return (
                      <>
                        <NumberEditor
                          value={range.minMidi}
                          min={0}
                          max={range.maxMidi}
                          step={1}
                          disabled={disabled}
                          label={`${option.label}下界`}
                          onCommit={(next) =>
                            onPatch({
                              [option.key]: {
                                minMidi: next,
                                maxMidi: range.maxMidi,
                              },
                            })
                          }
                        />
                        <span>至</span>
                        <NumberEditor
                          value={range.maxMidi}
                          min={range.minMidi}
                          max={127}
                          step={1}
                          disabled={disabled}
                          label={`${option.label}上界`}
                          onCommit={(next) =>
                            onPatch({
                              [option.key]: {
                                minMidi: range.minMidi,
                                maxMidi: next,
                              },
                            })
                          }
                        />
                      </>
                    );
                  })()}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}

function RuleExceptionFields({
  contexts,
  defaults,
  exceptions,
  disabled,
  onChange,
}: {
  contexts: readonly RuleExceptionContext[];
  defaults: RuleExceptionPolicy;
  exceptions: RuleExceptionPolicy;
  disabled?: boolean;
  onChange(policy: RuleExceptionPolicy | undefined): void;
}) {
  if (contexts.length === 0) return null;
  return (
    <section className="rule-details-section">
      <h4>特例策略</h4>
      {contexts.map((context) => (
        <label className="rule-detail-field" key={context}>
          <span>{EXCEPTION_CONTEXT_LABELS[context]}</span>
          <select
            value={exceptions[context] ?? "default"}
            disabled={disabled}
            aria-label={`${EXCEPTION_CONTEXT_LABELS[context]}处理方式`}
            onChange={(event) => {
              const current = { ...exceptions };
              const mode = event.target.value;
              if (mode === "default") delete current[context];
              else
                current[context] = mode as NonNullable<
                  RuleExceptionPolicy[typeof context]
                >;
              onChange(Object.keys(current).length > 0 ? current : undefined);
            }}
          >
            <option value="default">
              规则默认（
              {defaults[context] === "exempt"
                ? "豁免"
                : defaults[context] === "downgrade"
                  ? "降一级"
                  : "严格检查"}
              ）
            </option>
            <option value="exempt">豁免</option>
            <option value="downgrade">降一级</option>
            <option value="strict">严格检查</option>
          </select>
        </label>
      ))}
    </section>
  );
}

export function ShortcutSettings(props: ShortcutSettingsProps) {
  const {
    bindings,
    onSetBinding,
    onClearBinding,
    onResetBinding,
    onResetAll,
    profileTitle,
    ruleHitCounts,
    ruleSeverities,
    ruleConfigs,
    ruleExceptions,
    onSetRuleSeverity,
    onSetRuleConfig,
    onSetRuleException,
    onResetRule,
    onResetAllRules,
    onImportRuleProfile,
    onExportRuleProfile,
    onSetDefaultRuleProfile,
    externalRulePackages,
    externalRuleReferences,
    externalRuleFailures,
    externalRuleLibraryLoading,
    externalRuleLibraryError,
    onImportExternalRulePackage,
    onMountExternalRulePackage,
    onRemoveExternalRulePackage,
    onSetExternalRuleEnabled,
    onSetExternalRuleSeverity,
    onSetExternalRuleConfig,
    onSetExternalRuleException,
    onResetExternalRule,
    developerMode,
    onSetDeveloperMode,
    onClose,
  } = props;
  const shortcutSearchRef = useRef<HTMLInputElement>(null);
  const ruleSearchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [activeTab, setActiveTab] = useState<
    "shortcuts" | "rules" | "developer"
  >("shortcuts");
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [ruleQuery, setRuleQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<RuleSourceFilter>("all");
  const [severityFilter, setSeverityFilter] =
    useState<RuleSeverityFilter>("all");
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const [capturing, setCapturing] = useState<ShortcutCommandId>();
  const [captureError, setCaptureError] = useState<string>();
  const [selectedRuleKey, setSelectedRuleKey] = useState(
    `builtin:${HARMONY_RULE_DEFINITIONS[0].id}`,
  );

  useEffect(() => {
    if (activeTab === "shortcuts") shortcutSearchRef.current?.focus();
    if (activeTab === "rules") ruleSearchRef.current?.focus();
  }, [activeTab]);

  useEffect(() => {
    if (!capturing) return;
    const handleCapture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const binding = keyboardEventToBinding(event);
      if (!binding) return;
      if (binding === "Escape") {
        setCapturing(undefined);
        setCaptureError(undefined);
        return;
      }
      const conflict = SHORTCUT_DEFINITIONS.find(
        (definition) =>
          definition.id !== capturing &&
          bindings[definition.id].includes(binding),
      );
      if (conflict) {
        setCaptureError(
          `“${formatShortcutBinding(binding)}”已用于“${conflict.label}”`,
        );
        return;
      }
      onSetBinding(capturing, binding);
      setCapturing(undefined);
      setCaptureError(undefined);
    };
    window.addEventListener("keydown", handleCapture, true);
    return () => window.removeEventListener("keydown", handleCapture, true);
  }, [bindings, capturing, onSetBinding]);

  const normalizedShortcutQuery = shortcutQuery.trim().toLocaleLowerCase();
  const filteredDefinitions = useMemo(
    () =>
      SHORTCUT_DEFINITIONS.filter((definition) => {
        if (!normalizedShortcutQuery) return true;
        const bindingText = bindings[definition.id]
          .map(formatShortcutBinding)
          .join(" ");
        return `${definition.label} ${bindingText}`
          .toLocaleLowerCase()
          .includes(normalizedShortcutQuery);
      }),
    [bindings, normalizedShortcutQuery],
  );

  const externalEntries = useMemo(() => {
    const entries: ExternalRuleEntry[] = [];
    const installedKeys = new Set<string>();
    externalRulePackages.forEach((installedPackage) => {
      installedPackage.manifest.rules.forEach((rule) => {
        const key = externalRuleReferenceKey({
          packageId: installedPackage.manifest.packageId,
          version: installedPackage.manifest.version,
          contentHash: installedPackage.contentHash,
          ruleId: rule.id,
        });
        installedKeys.add(key);
        entries.push({
          key: `external:${key}`,
          installedPackage,
          rule,
          reference: externalRuleReferences.find(
            (reference) => externalRuleReferenceKey(reference) === key,
          ),
          failure: externalRuleFailures.find(
            (failure) =>
              failure.packageId === installedPackage.manifest.packageId &&
              failure.version === installedPackage.manifest.version &&
              failure.contentHash === installedPackage.contentHash &&
              failure.ruleId === rule.id,
          ),
        });
      });
    });
    externalRuleReferences.forEach((reference) => {
      const key = externalRuleReferenceKey(reference);
      if (installedKeys.has(key)) return;
      entries.push({
        key: `external:${key}`,
        reference,
        failure: externalRuleFailures.find(
          (failure) =>
            failure.packageId === reference.packageId &&
            failure.version === reference.version &&
            failure.contentHash === reference.contentHash &&
            failure.ruleId === reference.ruleId,
        ),
      });
    });
    return entries;
  }, [
    externalRuleFailures,
    externalRulePackages,
    externalRuleReferences,
  ]);

  const builtinModified = (rule: (typeof HARMONY_RULE_DEFINITIONS)[number]) =>
    ruleSeverities[rule.id] !== rule.defaultSeverity ||
    !sameValue(ruleConfigs[rule.id] ?? {}, rule.defaultConfig) ||
    !sameValue(ruleExceptions[rule.id] ?? {}, rule.defaultExceptionPolicies);
  const externalModified = (entry: ExternalRuleEntry) => {
    if (!entry.reference) return false;
    if (!entry.rule) return true;
    const defaults = normalizeExternalRuleConfig(entry.rule, undefined).config;
    return (
      !entry.reference.enabled ||
      entry.reference.severity !== entry.rule.defaultSeverity ||
      !sameValue(entry.reference.config, defaults) ||
      Object.keys(entry.reference.exceptions).length > 0
    );
  };

  const normalizedRuleQuery = ruleQuery.trim().toLocaleLowerCase();
  const visibleBuiltinRules = HARMONY_RULE_DEFINITIONS.filter((rule) => {
    if (sourceFilter === "external") return false;
    if (
      severityFilter !== "all" &&
      ruleSeverities[rule.id] !== severityFilter
    )
      return false;
    if (modifiedOnly && !builtinModified(rule)) return false;
    if (!normalizedRuleQuery) return true;
    const group =
      HARMONY_RULE_GROUPS.find((candidate) => candidate.id === rule.group)
        ?.label ?? "";
    return `${rule.catalogNumber} ${rule.label} ${rule.description} ${rule.rationale} ${rule.id} ${group}`
      .toLocaleLowerCase()
      .includes(normalizedRuleQuery);
  });
  const visibleExternalEntries = externalEntries.filter((entry) => {
    if (sourceFilter === "builtin") return false;
    const severity =
      entry.reference?.severity ?? entry.rule?.defaultSeverity ?? "off";
    if (severityFilter !== "all" && severity !== severityFilter) return false;
    if (modifiedOnly && !externalModified(entry)) return false;
    if (!normalizedRuleQuery) return true;
    return `${entry.rule?.label ?? entry.reference?.ruleId ?? ""} ${entry.rule?.description ?? ""} ${entry.reference?.ruleId ?? entry.rule?.id ?? ""} ${entry.installedPackage?.manifest.packageId ?? entry.reference?.packageId ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedRuleQuery);
  });

  const selectedBuiltin = selectedRuleKey.startsWith("builtin:")
    ? HARMONY_RULE_DEFINITIONS.find(
        (rule) => `builtin:${rule.id}` === selectedRuleKey,
      )
    : undefined;
  const selectedExternal = selectedRuleKey.startsWith("external:")
    ? externalEntries.find((entry) => entry.key === selectedRuleKey)
    : undefined;
  const fallbackBuiltin = HARMONY_RULE_DEFINITIONS[0];
  const activeBuiltin = selectedBuiltin ??
    (!selectedExternal ? fallbackBuiltin : undefined);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const moveRuleFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button[data-rule-key]",
      ),
    ];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, current + offset))];
    if (!next) return;
    event.preventDefault();
    next.focus();
    setSelectedRuleKey(next.dataset.ruleKey ?? selectedRuleKey);
  };

  return createPortal(
    <div
      className="settings-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="settings-header">
          <Settings2 aria-hidden="true" />
          <h2 id="settings-title">设置</h2>
          <IconButton label="关闭设置" icon={<X />} onClick={onClose} />
        </header>

        <div className="settings-layout">
          <nav className="settings-tabs" aria-label="设置分类">
            <button
              type="button"
              className={activeTab === "shortcuts" ? "is-active" : ""}
              aria-current={activeTab === "shortcuts" ? "page" : undefined}
              onClick={() => setActiveTab("shortcuts")}
            >
              <Keyboard aria-hidden="true" />
              <span>快捷键</span>
            </button>
            <button
              type="button"
              className={activeTab === "rules" ? "is-active" : ""}
              aria-current={activeTab === "rules" ? "page" : undefined}
              onClick={() => setActiveTab("rules")}
            >
              <ShieldCheck aria-hidden="true" />
              <span>检查规则</span>
            </button>
            <button
              type="button"
              className={activeTab === "developer" ? "is-active" : ""}
              aria-current={activeTab === "developer" ? "page" : undefined}
              onClick={() => setActiveTab("developer")}
            >
              <Bug aria-hidden="true" />
              <span>开发者</span>
            </button>
          </nav>

          {activeTab === "shortcuts" ? (
            <div className="shortcut-settings-content">
              <div className="shortcut-settings-toolbar">
                <label className="settings-search">
                  <Search aria-hidden="true" />
                  <input
                    ref={shortcutSearchRef}
                    type="search"
                    value={shortcutQuery}
                    placeholder="搜索命令或按键"
                    aria-label="搜索快捷键"
                    onChange={(event) => setShortcutQuery(event.target.value)}
                  />
                </label>
                <button type="button" className="command-button" onClick={onResetAll}>
                  <RotateCcw aria-hidden="true" />
                  恢复默认
                </button>
              </div>
              {captureError ? (
                <div className="shortcut-capture-error" role="alert">
                  {captureError}
                </div>
              ) : null}
              <div className="shortcut-groups">
                {SHORTCUT_GROUPS.map((group) => {
                  const definitions = filteredDefinitions.filter(
                    (definition) => definition.group === group.id,
                  );
                  if (definitions.length === 0) return null;
                  return (
                    <section className="shortcut-group" key={group.id}>
                      <h3>{group.label}</h3>
                      {definitions.map((definition) => {
                        const commandBindings = bindings[definition.id];
                        const isCapturing = capturing === definition.id;
                        const isDefault = sameBindings(
                          commandBindings,
                          definition.defaultBindings,
                        );
                        return (
                          <div className="shortcut-row" key={definition.id}>
                            <span>{definition.label}</span>
                            <button
                              type="button"
                              className={`shortcut-binding ${isCapturing ? "is-capturing" : ""}`}
                              aria-pressed={isCapturing}
                              onClick={() => {
                                setCapturing(isCapturing ? undefined : definition.id);
                                setCaptureError(undefined);
                              }}
                            >
                              {isCapturing ? (
                                <span>等待输入</span>
                              ) : commandBindings.length > 0 ? (
                                commandBindings.map((binding) => (
                                  <kbd key={binding}>{formatShortcutBinding(binding)}</kbd>
                                ))
                              ) : (
                                <span className="shortcut-unassigned">未设置</span>
                              )}
                            </button>
                            <IconButton
                              label={`清除“${definition.label}”快捷键`}
                              icon={<X />}
                              disabled={commandBindings.length === 0}
                              onClick={() => onClearBinding(definition.id)}
                            />
                            <IconButton
                              label={`恢复“${definition.label}”默认快捷键`}
                              icon={<RotateCcw />}
                              disabled={isDefault}
                              onClick={() => onResetBinding(definition.id)}
                            />
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
                {filteredDefinitions.length === 0 ? (
                  <div className="settings-empty">没有匹配的命令</div>
                ) : null}
              </div>
            </div>
          ) : activeTab === "rules" ? (
            <div className="rule-settings-content">
              <div className="rule-settings-toolbar">
                <label className="settings-search">
                  <Search aria-hidden="true" />
                  <input
                    ref={ruleSearchRef}
                    type="search"
                    value={ruleQuery}
                    placeholder="搜索名称、编号、ID 或说明"
                    aria-label="搜索检查规则"
                    onChange={(event) => setRuleQuery(event.target.value)}
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
                    onClick={onImportRuleProfile}
                  />
                  <IconButton
                    label="导出规则配置档案"
                    icon={<Download />}
                    onClick={onExportRuleProfile}
                  />
                  <IconButton
                    label="设为新建工程默认"
                    icon={<Save />}
                    onClick={onSetDefaultRuleProfile}
                  />
                  <IconButton
                    label="导入外置规则包"
                    icon={<Link2 />}
                    onClick={onImportExternalRulePackage}
                  />
                  <IconButton
                    label="恢复全部规则默认"
                    icon={<RotateCcw />}
                    onClick={onResetAllRules}
                  />
                </div>
              </div>

              {externalRuleLibraryError ? (
                <div className="rule-settings-error" role="alert">
                  {externalRuleLibraryError}
                </div>
              ) : null}
              <div className="rule-settings-main">
                <div
                  className="rule-groups"
                  aria-label="规则目录"
                  onKeyDown={moveRuleFocus}
                >
                  <div className="rule-profile-summary">
                    <strong>{profileTitle}</strong>
                    <span>
                      {visibleBuiltinRules.length} 条内置
                      {visibleExternalEntries.length > 0
                        ? ` · ${visibleExternalEntries.length} 条外置`
                        : ""}
                      {externalRuleLibraryLoading ? " · 正在读取规则库" : ""}
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
                          const severity = ruleSeverities[rule.id];
                          const modified = builtinModified(rule);
                          const key = `builtin:${rule.id}`;
                          return (
                            <button
                              type="button"
                              className={`rule-row severity-${severity} ${selectedRuleKey === key ? "is-selected" : ""} ${!rule.implemented ? "is-unimplemented" : ""}`}
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
                              <span className="rule-row-status">
                                {!rule.implemented ? "尚未实现" : severityLabel(severity)}
                                {modified ? <b>已修改</b> : null}
                              </span>
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
                        const label =
                          entry.rule?.label ?? entry.reference?.ruleId ?? "未知规则";
                        const packageId =
                          entry.installedPackage?.manifest.packageId ??
                          entry.reference?.packageId ??
                          "未知来源";
                        return (
                          <button
                            type="button"
                            className={`rule-row severity-${severity} ${selectedRuleKey === entry.key ? "is-selected" : ""} ${entry.failure ? "has-failure" : ""}`}
                            data-rule-key={entry.key}
                            key={entry.key}
                            onClick={() => setSelectedRuleKey(entry.key)}
                          >
                            <span className="rule-copy">
                              <strong>{label}</strong>
                              <small>{packageId}</small>
                            </span>
                            <span className="rule-row-status">
                              {!entry.installedPackage
                                ? "未挂载"
                                : !entry.reference
                                  ? "未加入工程"
                                  : severityLabel(severity)}
                              {externalModified(entry) ? <b>已修改</b> : null}
                            </span>
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
                    <>
                      <header className="rule-details-header">
                        <div className="rule-details-badges">
                          <span className="rule-source-badge">内置规则</span>
                          <span className="rule-catalog-badge">
                            {activeBuiltin.catalogNumber}
                          </span>
                          {!activeBuiltin.implemented ? (
                            <span className="rule-unimplemented-badge">尚未实现</span>
                          ) : null}
                        </div>
                        <h3>{activeBuiltin.label}</h3>
                        <code>{activeBuiltin.id}</code>
                        <span className="rule-hit-count">
                          当前工程命中 {ruleHitCounts[activeBuiltin.id] ?? 0} 项
                        </span>
                      </header>
                      {!activeBuiltin.implemented ? (
                        <div className="rule-implementation-note" role="status">
                          本项已进入规则目录，但尚无可执行实现。当前版本不会运行或保存针对它的修改。
                        </div>
                      ) : null}
                      <section className="rule-details-section">
                        <h4>判断说明</h4>
                        <p>{activeBuiltin.description}</p>
                      </section>
                      <section className="rule-details-section">
                        <h4>理论依据</h4>
                        <p>{activeBuiltin.rationale}</p>
                      </section>
                      <section className="rule-details-section">
                        <label className="rule-detail-field">
                          <span>严重程度</span>
                          <select
                            value={ruleSeverities[activeBuiltin.id]}
                            disabled={!activeBuiltin.implemented}
                            onChange={(event) =>
                              onSetRuleSeverity(
                                activeBuiltin.id,
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
                        options={activeBuiltin.options}
                        config={ruleConfigs[activeBuiltin.id] ?? activeBuiltin.defaultConfig}
                        disabled={!activeBuiltin.implemented}
                        onPatch={(patch) => onSetRuleConfig(activeBuiltin.id, patch)}
                      />
                      <RuleExceptionFields
                        contexts={activeBuiltin.supportedExceptionContexts}
                        defaults={activeBuiltin.defaultExceptionPolicies}
                        exceptions={ruleExceptions[activeBuiltin.id] ?? {}}
                        disabled={!activeBuiltin.implemented}
                        onChange={(policy) =>
                          onSetRuleException(activeBuiltin.id, policy)
                        }
                      />
                      <button
                        type="button"
                        className="command-button rule-reset-button"
                        disabled={!activeBuiltin.implemented}
                        onClick={() => onResetRule(activeBuiltin.id)}
                      >
                        <RotateCcw aria-hidden="true" />
                        恢复本规则默认
                      </button>
                    </>
                  ) : selectedExternal ? (
                    <>
                      <header className="rule-details-header">
                        <div className="rule-details-badges">
                          <span className="rule-source-badge">外置规则</span>
                          {!selectedExternal.installedPackage ? (
                            <span className="rule-unimplemented-badge">未挂载</span>
                          ) : null}
                        </div>
                        <h3>
                          {selectedExternal.rule?.label ??
                            selectedExternal.reference?.ruleId}
                        </h3>
                        <code>
                          {selectedExternal.rule?.id ??
                            selectedExternal.reference?.ruleId}
                        </code>
                        <span className="rule-hit-count">
                          当前工程命中{" "}
                          {ruleHitCounts[
                            selectedExternal.rule?.id ??
                              selectedExternal.reference?.ruleId ??
                              ""
                          ] ?? 0}{" "}
                          项
                        </span>
                      </header>
                      <section className="rule-details-section external-rule-source">
                        <h4>来源</h4>
                        <dl>
                          <div>
                            <dt>包</dt>
                            <dd>
                              {selectedExternal.installedPackage?.manifest.packageId ??
                                selectedExternal.reference?.packageId}
                            </dd>
                          </div>
                          <div>
                            <dt>版本</dt>
                            <dd>
                              {selectedExternal.installedPackage?.manifest.version ??
                                selectedExternal.reference?.version}
                            </dd>
                          </div>
                          <div>
                            <dt>摘要</dt>
                            <dd>
                              {(selectedExternal.installedPackage?.contentHash ??
                                selectedExternal.reference?.contentHash ??
                                "")
                                .slice(0, 16)}
                              …
                            </dd>
                          </div>
                          {selectedExternal.installedPackage ? (
                            <div>
                              <dt>本机文件</dt>
                              <dd>
                                {sourceName(
                                  selectedExternal.installedPackage.sourcePath,
                                )}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      </section>
                      <section className="rule-details-section">
                        <h4>判断说明</h4>
                        <p>
                          {selectedExternal.rule?.description ??
                            "本机没有与工程引用完全匹配的规则包，配置会保留但不会执行。"}
                        </p>
                      </section>
                      {selectedExternal.failure ? (
                        <div className="rule-implementation-note is-error" role="alert">
                          {selectedExternal.failure.message}
                        </div>
                      ) : null}
                      {selectedExternal.reference ? (
                        <section className="rule-details-section">
                          <label className="rule-detail-field">
                            <span>在当前工程中启用</span>
                            <input
                              type="checkbox"
                              checked={selectedExternal.reference.enabled}
                              onChange={(event) =>
                                onSetExternalRuleEnabled(
                                  selectedExternal.reference!,
                                  event.target.checked,
                                )
                              }
                            />
                          </label>
                          <label className="rule-detail-field">
                            <span>严重程度</span>
                            <select
                              value={selectedExternal.reference.severity}
                              onChange={(event) =>
                                onSetExternalRuleSeverity(
                                  selectedExternal.reference!,
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
                      {selectedExternal.rule && selectedExternal.reference ? (
                        <>
                          <RuleOptionFields
                            options={selectedExternal.rule.options}
                            config={selectedExternal.reference.config}
                            onPatch={(patch) =>
                              onSetExternalRuleConfig(
                                selectedExternal.reference!,
                                patch,
                              )
                            }
                          />
                          <RuleExceptionFields
                            contexts={
                              selectedExternal.rule.supportedExceptionContexts
                            }
                            defaults={
                              selectedExternal.rule.defaultExceptionPolicies
                            }
                            exceptions={selectedExternal.reference.exceptions}
                            onChange={(policy) =>
                              onSetExternalRuleException(
                                selectedExternal.reference!,
                                policy,
                              )
                            }
                          />
                        </>
                      ) : null}
                      <div className="rule-detail-actions">
                        {selectedExternal.installedPackage &&
                        !selectedExternal.reference ? (
                          <button
                            type="button"
                            className="command-button"
                            onClick={() =>
                              onMountExternalRulePackage(
                                selectedExternal.installedPackage!,
                              )
                            }
                          >
                            <Link2 aria-hidden="true" />
                            挂载到工程
                          </button>
                        ) : null}
                        {selectedExternal.reference && selectedExternal.rule ? (
                          <button
                            type="button"
                            className="command-button"
                            onClick={() =>
                              onResetExternalRule(selectedExternal.reference!)
                            }
                          >
                            <RotateCcw aria-hidden="true" />
                            恢复本规则默认
                          </button>
                        ) : null}
                        {selectedExternal.installedPackage ? (
                          <button
                            type="button"
                            className="command-button danger-button"
                            onClick={() =>
                              onRemoveExternalRulePackage(
                                selectedExternal.installedPackage!,
                              )
                            }
                          >
                            <Trash2 aria-hidden="true" />
                            移除本机副本
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </aside>
              </div>
            </div>
          ) : (
            <div className="developer-settings-content">
              <section className="developer-settings-section">
                <header>
                  <Bug aria-hidden="true" />
                  <div>
                    <h3>开发者模式</h3>
                    <p>在右侧属性面板中显示当前选中音符或和弦事件的完整数据模型字段。</p>
                  </div>
                  <label className="developer-mode-toggle">
                    <input
                      type="checkbox"
                      checked={developerMode}
                      aria-label="启用开发者模式"
                      onChange={(event) => onSetDeveloperMode(event.target.checked)}
                    />
                    <span>{developerMode ? "已启用" : "未启用"}</span>
                  </label>
                </header>
                <div className="developer-settings-note">
                  <strong>调试视图为只读</strong>
                  <p>
                    可选字段即使尚未设置也会列出；数组和嵌套对象会展开，并可复制事件的原始
                    JSON。此开关只保存在本机，不写入工程文件。
                  </p>
                </div>
              </section>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
