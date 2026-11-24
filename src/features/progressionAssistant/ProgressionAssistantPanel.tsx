import { useState } from "react";
import { Play, RefreshCw, Square } from "lucide-react";
import type {
  HarmonizationStyle,
  ProgressionCandidate,
  ProgressionSearchMode,
  ProgressionSearchResult,
  ProgressionShortLength,
  ProgressionStepPreset,
} from "../../domain/harmony/harmonization";
import { formatSpelledPitch } from "../../domain/pitch";
import { VOICE_CONFIG, VOICE_ORDER, type ProjectDocument } from "../../domain/project";
import { tickToPosition } from "../../domain/time";
import "./progressionAssistant.css";

export interface ProgressionSelection {
  candidate: ProgressionCandidate;
  variantIndex: number;
}

export interface ProgressionAssistantPanelProps {
  project: ProjectDocument;
  result?: ProgressionSearchResult;
  status: "searching" | "ready" | "paused" | "error";
  mode: ProgressionSearchMode;
  shortLength: ProgressionShortLength;
  stepPreset: ProgressionStepPreset;
  style: HarmonizationStyle;
  writeChords: boolean;
  auditioning?: ProgressionSelection;
  onModeChange(mode: ProgressionSearchMode): void;
  onShortLengthChange(length: ProgressionShortLength): void;
  onStepPresetChange(preset: ProgressionStepPreset): void;
  onStyleChange(style: HarmonizationStyle): void;
  onWriteChordsChange(write: boolean): void;
  onRefresh(): void;
  onHoverCandidate(selection?: ProgressionSelection): void;
  onAudition(candidate: ProgressionCandidate, variantIndex: number): void;
  onStopAudition(): void;
  onApply(candidate: ProgressionCandidate, variantIndex: number, options: { writeChords: boolean }): void;
}

const shortLengths = [2, 3, 4, "bridge"] as const;

function CandidateCard({ candidate, panel }: {
  candidate: ProgressionCandidate;
  panel: ProgressionAssistantPanelProps;
}) {
  const [variantIndex, setVariantIndex] = useState(0);
  const variant = candidate.variants[variantIndex];
  const steps = variant.steps;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const { errorCount, warningCount } = variant.diagnosticSummary;
  const playing = panel.auditioning?.candidate === candidate;
  const preview = (index = variantIndex) => panel.onHoverCandidate({ candidate, variantIndex: index });
  const pitchPath = (voice: "soprano" | "bass") => {
    const from = formatSpelledPitch(first.notes[voice]);
    const to = formatSpelledPitch(last.notes[voice]);
    return from === to ? from : `${from} → ${to}`;
  };

  return (
    <article
      className="progression-card"
      aria-label={candidate.headline}
      tabIndex={0}
      onMouseEnter={() => preview()}
      onFocus={() => preview()}
    >
      <div className="progression-card-title">
        <strong>{candidate.headline}</strong>
        {candidate.tag && <span className="progression-tag">{candidate.tag}</span>}
      </div>
      <div className="progression-card-details">
        <span className={`progression-badge ${errorCount ? "is-error" : "is-clear"}`}>{errorCount} 错误</span>
        {warningCount > 0 && <span className="progression-badge is-warning">{warningCount} 警告</span>}
        <span className="progression-pitches">
          {steps.length === 1 ? VOICE_ORDER.map(voice => (
            <span key={voice}>{VOICE_CONFIG[voice].shortName}:{formatSpelledPitch(first.notes[voice])}</span>
          )) : <><span>{steps.length} 步</span><span>S:{pitchPath("soprano")}</span><span>B:{pitchPath("bass")}</span></>}
        </span>
      </div>
      <div className="progression-card-actions">
        {candidate.variants.length > 1 && (
          <div className="progression-variants" role="group" aria-label="排列变体">
            {candidate.variants.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={index === variantIndex}
                onClick={() => {
                  setVariantIndex(index);
                  preview(index);
                  if (playing && panel.auditioning?.variantIndex !== index) panel.onAudition(candidate, index);
                }}
              >{item.label}</button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="progression-audition"
          aria-pressed={playing}
          onClick={() => {
            if (playing) panel.onStopAudition();
            else {
              preview();
              panel.onAudition(candidate, variantIndex);
            }
          }}
        >{playing ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}{playing ? "停止" : "试听"}</button>
        <button type="button" className="progression-apply"
          onClick={() => panel.onApply(candidate, variantIndex, { writeChords: panel.writeChords })}>
          采纳
        </button>
      </div>
    </article>
  );
}

export function ProgressionAssistantPanel(props: ProgressionAssistantPanelProps) {
  const { project, result, status, mode, shortLength, stepPreset, style, writeChords } = props;
  const slot = result?.slot;
  const position = slot && tickToPosition(project, slot.fromTick);
  const warnings = result?.warnings ?? [];
  const statusText = status === "searching" ? "正在搜索和声连接…"
    : status === "paused" ? "播放结束后继续搜索"
    : status === "error" ? "搜索失败，请刷新重试"
    : !slot ? "光标右侧暂无空位" : "";
  return (
    <div className="progression-assistant" role="tabpanel" id="bottom-progression-panel" aria-labelledby="bottom-progression-tab">
      <div className="progression-toolbar">
        <div className="progression-target" role="status">
          {slot && position ? (
            <>
              <strong>第 {position.measure} 小节第 {position.beat} 拍{position.tick > 0 && ` +${position.tick} tick`}</strong>
              <span className="progression-tag">{slot.kind === "empty" ? "全空" : "半空"}</span>
              {slot.leftAnchor?.chordLabel && <span>衔接 {slot.leftAnchor.chordLabel}</span>}
              {VOICE_ORDER.map(voice => {
                const pitch = slot.fixedVoices[voice];
                if (!pitch) return null;
                const name = voice === "soprano" ? "高音" : VOICE_CONFIG[voice].name;
                return <span key={voice}>{name}固定 {formatSpelledPitch(pitch)}</span>;
              })}
            </>
          ) : statusText}
        </div>
        <div className="progression-segments" role="group" aria-label="连接模式">
          <button type="button" aria-pressed={mode === "single"} onClick={() => props.onModeChange("single")}>单和弦</button>
          <button type="button" aria-pressed={mode === "short"} onClick={() => props.onModeChange("short")}>短连接</button>
        </div>
        {mode === "short" && (
          <div className="progression-segments" role="group" aria-label="短连接步数">
            {shortLengths.map(length => (
              <button
                key={length}
                type="button"
                aria-pressed={shortLength === length}
                className={length === "bridge" && slot?.rightAnchor ? "can-bridge" : undefined}
                title={length === "bridge" && slot?.rightAnchor ? "连接至右侧锚点" : undefined}
                onClick={() => props.onShortLengthChange(length)}
              >{length === "bridge" ? "桥接" : `${length} 拍`}</button>
            ))}
          </div>
        )}
        <label className="progression-field">
          步长
          <select aria-label="全空位默认步长" value={stepPreset}
            onChange={event => props.onStepPresetChange(event.target.value as ProgressionStepPreset)}>
            <option value="beat">1 拍</option>
            <option value="half-bar">2 拍</option>
            <option value="grid">跟随网格</option>
          </select>
        </label>
        <label className="progression-field">
          风格
          <select aria-label="风格预设" value={style}
            onChange={event => props.onStyleChange(event.target.value as HarmonizationStyle)}>
            <option value="classic-basic">平稳保守</option>
            <option value="textbook-standard">标准教材</option>
            <option value="expressive-secondary">丰富色彩</option>
          </select>
        </label>
        <label className="progression-field" title={project.chordTrack.locked ? "和弦轨已锁定" : undefined}>
          <input type="checkbox" checked={writeChords} disabled={project.chordTrack.locked}
            onChange={event => props.onWriteChordsChange(event.target.checked)} />
          同步写和弦轨
        </label>
        <button type="button" className="progression-refresh" aria-label="刷新和声连接" title="刷新和声连接"
          disabled={status === "paused"} onClick={props.onRefresh}>
          <RefreshCw aria-hidden="true" />
        </button>
      </div>
      {warnings.length > 0 && <p className="progression-warning" role="status">{warnings.join(" ")}</p>}
      {result && result.candidates.length > 0 && (
        <div
          className="progression-candidates"
          role="group"
          aria-label="候选和声连接"
          onMouseLeave={() => props.onHoverCandidate(undefined)}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) props.onHoverCandidate(undefined);
          }}
        >
          {result.candidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate} panel={props} />)}
        </div>
      )}
    </div>
  );
}
