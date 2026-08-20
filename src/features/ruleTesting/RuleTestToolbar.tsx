import {
  ArrowLeft,
  Copy,
  FilePlus2,
  FolderOpen,
  MoreHorizontal,
  Play,
  Save,
  SaveAll,
  Square,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../components/IconButton";
import {
  HARMONY_RULE_GROUPS,
  HARMONY_RULE_DEFINITIONS,
  type HarmonyRuleId,
  type HarmonyRuleGroupId,
} from "../../domain/harmony";

interface RuleTestToolbarProps {
  title: string;
  dirty: boolean;
  ruleId: HarmonyRuleId;
  autoRun: boolean;
  runState: "idle" | "running" | "passed" | "failed" | "error";
  batchRunState: "idle" | "running" | "completed" | "cancelled";
  hasLibrary: boolean;
  hasActual: boolean;
  onBack(): void;
  onOpen(): void;
  onOpenDirectory(): void;
  onSave(forceDialog: boolean): void;
  onRun(): void;
  onSetAutoRun(value: boolean): void;
  onSetRule(ruleId: HarmonyRuleId): void;
  onCreateFromProject(): void;
  onClone(): void;
  onRunLibrary(): void;
  onCancelLibrary(): void;
  onAcceptAll(): void;
  onNormalize(): void;
}

function RuleSearch({
  ruleId,
  onSelect,
}: {
  ruleId: HarmonyRuleId;
  onSelect(ruleId: HarmonyRuleId): void;
}) {
  const selected = HARMONY_RULE_DEFINITIONS.find((item) => item.id === ruleId)!;
  const selectedLabel = `${selected.id} · ${selected.label}`;
  const [query, setQuery] = useState(selectedLabel);
  const [groupId, setGroupId] = useState<"all" | HarmonyRuleGroupId>("all");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => setQuery(selectedLabel), [selectedLabel]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return HARMONY_RULE_DEFINITIONS.filter((rule) =>
      (groupId === "all" || rule.group === groupId) &&
      `${rule.id} ${rule.label} ${rule.description} ${
        HARMONY_RULE_GROUPS.find((group) => group.id === rule.group)?.label ??
        ""
      }`
        .toLowerCase()
        .includes(needle),
    );
  }, [groupId, query]);
  const groupedMatches = useMemo(
    () =>
      HARMONY_RULE_GROUPS.map((group) => ({
        ...group,
        rules: matches.filter((rule) => rule.group === group.id),
      })).filter((group) => group.rules.length > 0),
    [matches],
  );
  return (
    <div
      ref={rootRef}
      className="rule-test-rule-search"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input
        aria-label="搜索目标规则"
        value={query}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches[0]) {
            onSelect(matches[0].id);
            setOpen(false);
          }
          if (event.key === "Escape") {
            setQuery(selectedLabel);
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div className="rule-test-rule-menu" role="listbox">
          <div className="rule-test-rule-filter">
            <label htmlFor="rule-test-rule-group">分类</label>
            <select
              id="rule-test-rule-group"
              aria-label="按规则分类筛选"
              value={groupId}
              onChange={(event) =>
                setGroupId(
                  event.target.value as "all" | HarmonyRuleGroupId,
                )
              }
              onMouseDown={(event) => event.stopPropagation()}
            >
              <option value="all">
                全部规则（{HARMONY_RULE_DEFINITIONS.length}）
              </option>
              {HARMONY_RULE_GROUPS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}（
                  {HARMONY_RULE_DEFINITIONS.filter(
                    (rule) => rule.group === group.id,
                  ).length}
                  ）
                </option>
              ))}
            </select>
            <span>{matches.length} 条</span>
          </div>
          {groupedMatches.map((group) => (
            <section className="rule-test-rule-group" key={group.id}>
              <h4>
                {group.label}
                <span>{group.rules.length}</span>
              </h4>
              {group.rules.map((rule) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={rule.id === ruleId}
                  key={rule.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(rule.id);
                    setQuery(`${rule.id} · ${rule.label}`);
                    setOpen(false);
                  }}
                >
                  <strong>{rule.label}</strong>
                  <small>{rule.id}</small>
                </button>
              ))}
            </section>
          ))}
          {matches.length === 0 ? (
            <div className="rule-test-rule-empty">没有匹配的规则</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RuleTestToolbar(props: RuleTestToolbarProps) {
  return (
    <div className="main-toolbar rule-test-toolbar">
      <div className="toolbar-group">
        <IconButton label="返回普通工程" icon={<ArrowLeft />} onClick={props.onBack} />
        <IconButton
          label="新建规则用例"
          icon={<FilePlus2 />}
          onClick={props.onCreateFromProject}
        />
        <IconButton label="打开规则用例" icon={<FolderOpen />} onClick={props.onOpen} />
        <IconButton label="保存规则用例" icon={<Save />} onClick={() => props.onSave(false)} />
        <IconButton label="规则用例另存为" icon={<SaveAll />} onClick={() => props.onSave(true)} />
      </div>
      <div className="rule-test-current-title">
        <strong>{props.title}</strong>
        {props.dirty ? <span>*</span> : null}
      </div>
      <RuleSearch ruleId={props.ruleId} onSelect={props.onSetRule} />
      <label className="rule-test-auto-run">
        <input
          type="checkbox"
          checked={props.autoRun}
          onChange={(event) => props.onSetAutoRun(event.target.checked)}
        />
        <span>自动运行</span>
      </label>
      <button
        type="button"
        className="command-button rule-test-run-button"
        disabled={
          props.runState === "running" || props.batchRunState === "running"
        }
        onClick={props.onRun}
      >
        <Play aria-hidden="true" />
        {props.runState === "running" ? "运行中" : "运行"}
      </button>
      <span className={`rule-test-toolbar-status ${props.runState}`}>
        {props.runState === "passed"
          ? "通过"
          : props.runState === "failed"
            ? "失败"
            : props.runState === "error"
              ? "错误"
              : props.runState === "running"
                ? "检查中"
                : "未运行"}
      </span>
      <details className="rule-test-more">
        <summary aria-label="更多规则测试操作" title="更多规则测试操作">
          <MoreHorizontal aria-hidden="true" />
        </summary>
        <div className="rule-test-more-menu">
          <button type="button" onClick={props.onOpenDirectory}>
            <FolderOpen aria-hidden="true" /> 打开用例目录
          </button>
          <button type="button" onClick={props.onClone}>
            <Copy aria-hidden="true" /> 复制当前用例
          </button>
          {props.batchRunState === "running" ? (
            <button type="button" onClick={props.onCancelLibrary}>
              <Square aria-hidden="true" /> 取消批量运行
            </button>
          ) : (
            <button
              type="button"
              disabled={!props.hasLibrary}
              onClick={props.onRunLibrary}
            >
              <Play aria-hidden="true" /> 批量运行目录
            </button>
          )}
          <button type="button" disabled={!props.hasActual} onClick={props.onAcceptAll}>
            <WandSparkles aria-hidden="true" /> 接受全部实际结果
          </button>
          <button type="button" onClick={props.onNormalize}>
            <WandSparkles aria-hidden="true" /> 规范化用例
          </button>
        </div>
      </details>
    </div>
  );
}
