import {
  ArrowLeft,
  BellRing,
  Clipboard,
  Copy,
  Eraser,
  FolderOpen,
  Magnet,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Redo2,
  Repeat2,
  Scissors,
  SkipBack,
  Square,
  Trash2,
  Undo2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { IconButton } from "../../components/IconButton";

interface RuleTestToolbarProps {
  autoRun: boolean;
  runState: "idle" | "running" | "passed" | "failed" | "error";
  batchRunState: "idle" | "running" | "completed" | "cancelled";
  hasLibrary: boolean;
  hasActual: boolean;
  isPlaying: boolean;
  metronomeEnabled: boolean;
  audioLevel: number;
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
  onOpenDirectory(): void;
  onRun(): void;
  onSetAutoRun(value: boolean): void;
  onClone(): void;
  onRunLibrary(): void;
  onCancelLibrary(): void;
  onAcceptAll(): void;
  onNormalize(): void;
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
  onChangeGrid(ticks: number): void;
  onZoomOut(): void;
  onZoomIn(): void;
}

export function RuleTestToolbar(props: RuleTestToolbarProps) {
  return (
    <div className="main-toolbar rule-test-toolbar">
      <div className="toolbar-group">
        <IconButton
          label="返回普通工程"
          icon={<ArrowLeft />}
          onClick={props.onBack}
        />
      </div>

      <div className="toolbar-group">
        <IconButton
          label="撤销"
          icon={<Undo2 />}
          disabled={!props.canUndo}
          onClick={props.onUndo}
        />
        <IconButton
          label="重做"
          icon={<Redo2 />}
          disabled={!props.canRedo}
          onClick={props.onRedo}
        />
        <IconButton
          label="复制选中事件"
          icon={<Copy />}
          onClick={props.onCopy}
        />
        <IconButton
          label="粘贴事件"
          icon={<Clipboard />}
          onClick={props.onPaste}
        />
        <IconButton
          label="删除选中事件"
          icon={<Trash2 />}
          onClick={props.onDelete}
        />
      </div>

      <div className="toolbar-group tool-selector">
        <IconButton
          label="选择工具"
          icon={<MousePointer2 />}
          active={props.effectiveTool === "select"}
          onClick={() => props.onSetTool("select")}
        />
        <IconButton
          label="铅笔工具"
          icon={<Pencil />}
          active={props.effectiveTool === "pencil"}
          onClick={() => props.onSetTool("pencil")}
        />
        <IconButton
          label="擦除工具"
          icon={<Eraser />}
          active={props.effectiveTool === "eraser"}
          onClick={() => props.onSetTool("eraser")}
        />
        <IconButton
          label="切分工具"
          icon={<Scissors />}
          active={props.effectiveTool === "split"}
          onClick={() => props.onSetTool("split")}
        />
      </div>

      <div className="transport-group">
        <IconButton
          label="回到开头"
          icon={<SkipBack />}
          onClick={props.onGoToStart}
        />
        <IconButton
          label={props.isPlaying ? "暂停" : "播放"}
          icon={props.isPlaying ? <Pause /> : <Play />}
          active={props.isPlaying}
          onClick={props.onPlay}
        />
        <IconButton label="停止" icon={<Square />} onClick={props.onStop} />
        <IconButton
          label="循环播放"
          icon={<Repeat2 />}
          active={props.loopEnabled}
          onClick={props.onToggleLoop}
        />
        <button
          type="button"
          className="loop-boundary"
          title="将循环起点设为播放头"
          onClick={() => props.onSetLoopBoundary("start")}
        >
          起 {props.loopStartLabel}
        </button>
        <button
          type="button"
          className="loop-boundary"
          title="将循环终点设为播放头"
          onClick={() => props.onSetLoopBoundary("end")}
        >
          止 {props.loopEndLabel}
        </button>
        <IconButton
          label="节拍器"
          icon={<BellRing />}
          active={props.metronomeEnabled}
          onClick={props.onToggleMetronome}
        />
        <span
          className={
            "output-meter " + (props.audioLevel >= 0.98 ? "is-clipping" : "")
          }
          role="meter"
          aria-label="测试工作台输出电平"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(props.audioLevel.toFixed(4))}
        >
          <i
            style={{
              width: String(Math.max(2, props.audioLevel * 100)) + "%",
            }}
          />
        </span>
      </div>

      <div className="toolbar-group toolbar-right">
        <div className="grid-control" title="编辑吸附网格">
          <Magnet aria-hidden="true" />
          <select
            aria-label="时值对齐"
            value={props.gridTicks}
            onChange={(event) =>
              props.onChangeGrid(Number(event.target.value))
            }
          >
            {props.gridOptions.map((option) => (
              <option key={option.ticks} value={option.ticks}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <IconButton
          label="缩小时间轴"
          icon={<ZoomOut />}
          onClick={props.onZoomOut}
        />
        <span className="zoom-value">{props.pixelsPerBeat}</span>
        <IconButton
          label="放大时间轴"
          icon={<ZoomIn />}
          onClick={props.onZoomIn}
        />
      </div>

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
          <button
            type="button"
            disabled={!props.hasActual}
            onClick={props.onAcceptAll}
          >
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
