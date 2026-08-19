import {
  ArrowLeft,
  FileInput,
  FolderOpen,
  MoreHorizontal,
  Play,
  Save,
  SaveAll,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../components/IconButton";
import {
  HARMONY_RULE_DEFINITIONS,
  type HarmonyRuleId,
} from "../../domain/harmony";

interface RuleTestToolbarProps {
  title: string;
  dirty: boolean;
  ruleId: HarmonyRuleId;
  autoRun: boolean;
  runState: "idle" | "running" | "passed" | "failed" | "error";
  hasActual: boolean;
  onBack(): void;
  onOpen(): void;
  onSave(forceDialog: boolean): void;
  onRun(): void;
  onSetAutoRun(value: boolean): void;
  onSetRule(ruleId: HarmonyRuleId): void;
  onCreateFromProject(): void;
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => setQuery(selectedLabel), [selectedLabel]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return HARMONY_RULE_DEFINITIONS.filter((rule) =>
      `${rule.id} ${rule.label} ${rule.description}`
        .toLowerCase()
        .includes(needle),
    ).slice(0, 12);
  }, [query]);
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
          {matches.map((rule) => (
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
        disabled={props.runState === "running"}
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
          <button type="button" onClick={props.onCreateFromProject}>
            <FileInput aria-hidden="true" /> 从当前工程新建
          </button>
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
