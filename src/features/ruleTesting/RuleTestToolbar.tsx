import {
  ArrowLeft,
  BellRing,
  Clipboard,
  Copy,
  Download,
  Eraser,
  FileAudio,
  FilePlus2,
  FolderOpen,
  Magnet,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Redo2,
  Repeat2,
  RotateCcw,
  Save,
  SaveAll,
  Scissors,
  SkipBack,
  Square,
  Trash2,
  Undo2,
  Volume2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
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
  isPlaying: boolean;
  metronomeEnabled: boolean;
  audioState: string;
  audioMessage: string;
  audioLevel: number;
  soundFontProgress?: { completedBytes: number; totalBytes: number };
  loopEnabled: boolean;
  loopStartLabel: string;
  loopEndLabel: string;
  gridTicks: number;
  gridOptions: readonly { ticks: number; label: string }[];
  pixelsPerBeat: number;
  effectiveTool: "select" | "pencil" | "eraser" | "split";
  canUndo: boolean;
  canRedo: boolean;
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
  onExportMidi(): void;
  onUndo(): void;
  onRedo(): void;
  onCopy(): void;
  onPaste(): void;
  onDelete(): void;
  onSetTool(tool: "select" | "pencil" | "eraser" | "split"): void;
  onGoToStart(): void;
  onPlay(): void;
  onStop(): void;
  onToggleLoop(): void;
  onSetLoopBoundary(boundary: "start" | "end"): void;
  onToggleMetronome(): void;
  onSetGridTicks(value: number): void;
  onZoomOut(): void;
  onZoomIn(): void;
  onChooseSoundFont(): void;
  onUseDefaultSoundFont(): void;
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
  const soundFontPercent = props.soundFontProgress &&
    props.soundFontProgress.totalBytes > 0
    ? Math.round(
        (props.soundFontProgress.completedBytes /
          props.soundFontProgress.totalBytes) *
          100,
      )
    : undefined;
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
        <IconButton label="导出 MIDI" icon={<Download />} onClick={props.onExportMidi} />
      </div>
      <div className="toolbar-group">
        <IconButton label="撤销" icon={<Undo2 />} disabled={!props.canUndo} onClick={props.onUndo} />
        <IconButton label="重做" icon={<Redo2 />} disabled={!props.canRedo} onClick={props.onRedo} />
        <IconButton label="复制选中事件" icon={<Copy />} onClick={props.onCopy} />
        <IconButton label="粘贴事件" icon={<Clipboard />} onClick={props.onPaste} />
        <IconButton label="删除选中事件" icon={<Trash2 />} onClick={props.onDelete} />
      </div>
      <div className="toolbar-group tool-selector">
        <IconButton label="选择工具" icon={<MousePointer2 />} active={props.effectiveTool === "select"} onClick={() => props.onSetTool("select")} />
        <IconButton label="铅笔工具" icon={<Pencil />} active={props.effectiveTool === "pencil"} onClick={() => props.onSetTool("pencil")} />
        <IconButton label="擦除工具" icon={<Eraser />} active={props.effectiveTool === "eraser"} onClick={() => props.onSetTool("eraser")} />
        <IconButton label="切分工具" icon={<Scissors />} active={props.effectiveTool === "split"} onClick={() => props.onSetTool("split")} />
      </div>
      <div className="transport-group">
        <IconButton label="回到开头" icon={<SkipBack />} onClick={props.onGoToStart} />
        <IconButton label={props.isPlaying ? "暂停" : "播放"} icon={props.isPlaying ? <Pause /> : <Play />} active={props.isPlaying} onClick={props.onPlay} />
        <IconButton label="停止" icon={<Square />} onClick={props.onStop} />
        <IconButton label="循环播放" icon={<Repeat2 />} active={props.loopEnabled} onClick={props.onToggleLoop} />
        <button type="button" className="loop-boundary" title="将循环起点设为播放头" onClick={() => props.onSetLoopBoundary("start")}>起 {props.loopStartLabel}</button>
        <button type="button" className="loop-boundary" title="将循环终点设为播放头" onClick={() => props.onSetLoopBoundary("end")}>止 {props.loopEndLabel}</button>
        <IconButton label="节拍器" icon={<BellRing />} active={props.metronomeEnabled} onClick={props.onToggleMetronome} />
        <span className={"output-meter " + (props.audioLevel >= 0.98 ? "is-clipping" : "")} role="meter" aria-label="测试工作台输出电平" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(props.audioLevel.toFixed(4))}>
          <i style={{ width: String(Math.max(2, props.audioLevel * 100)) + "%" }} />
        </span>
      </div>
      <div className="toolbar-group toolbar-right">
        <div className="grid-control" title="编辑吸附网格">
          <Magnet aria-hidden="true" />
          <select aria-label="时值对齐" value={props.gridTicks} onChange={(event) => props.onSetGridTicks(Number(event.target.value))}>
            {props.gridOptions.map((option) => <option key={option.ticks} value={option.ticks}>{option.label}</option>)}
          </select>
        </div>
        <IconButton label="缩小时间轴" icon={<ZoomOut />} onClick={props.onZoomOut} />
        <span className="zoom-value">{props.pixelsPerBeat}</span>
        <IconButton label="放大时间轴" icon={<ZoomIn />} onClick={props.onZoomIn} />
        <IconButton label="选择本地 SoundFont" icon={<FileAudio />} onClick={props.onChooseSoundFont} />
        <IconButton label="恢复默认音色" icon={<RotateCcw />} onClick={props.onUseDefaultSoundFont} />
        <span className={"engine-status " + props.audioState} title={props.audioMessage}>
          <Volume2 aria-hidden="true" />
          {soundFontPercent === undefined ? props.audioMessage : props.audioMessage + " " + soundFontPercent + "%"}
        </span>
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
