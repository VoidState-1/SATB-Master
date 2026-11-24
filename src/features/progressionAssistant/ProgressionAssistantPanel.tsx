import { useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Play,
  RefreshCw,
  Square,
  XCircle,
} from "lucide-react";
import type {
  HarmonizationStyle,
  ProgressionCandidate,
  ProgressionSearchMode,
  ProgressionSearchResult,
  ProgressionShortLength,
  ProgressionStepPreset,
} from "../../domain/harmony/harmonization";
import { formatSpelledPitch } from "../../domain/pitch";
import {
  VOICE_CONFIG,
  VOICE_ORDER,
  type ProjectDocument,
  type VoiceId,
} from "../../domain/project";
import { tickToPosition } from "../../domain/time";
import {
  assessProgressionRecommendation,
  categoriesForMode,
  computeBatchScoreStats,
  groupProgressionCandidates,
  type BatchScoreStats,
  type ProgressionCategoryId,
  type ProgressionCategoryMeta,
} from "./progressionPresentation";
import "./progressionAssistant.css";

export interface ProgressionSelection {
  candidate: ProgressionCandidate;
  variantIndex: number;
}

export interface ProgressionAssistantPanelProps {
  project: ProjectDocument;
  result?: ProgressionSearchResult;
  status: "searching" | "ready" | "paused" | "error";
  isRefreshing?: boolean;
  hideTargetSummary?: boolean;
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
  onApply(
    candidate: ProgressionCandidate,
    variantIndex: number,
    options: { writeChords: boolean },
  ): void;
}

const shortLengths = [2, 3, 4, "bridge"] as const;

const VOICE_VAR: Record<VoiceId, string> = {
  soprano: "var(--voice-s)",
  alto: "var(--voice-a)",
  tenor: "var(--voice-t)",
  bass: "var(--voice-b)",
};

function getProgressionStatusText(
  status: ProgressionAssistantPanelProps["status"],
  hasSlot: boolean,
) {
  if (status === "searching") return "正在搜索和声连接…";
  if (status === "paused") return "播放结束后继续搜索";
  if (status === "error") return "搜索失败，请刷新重试";
  return hasSlot ? "" : "光标右侧暂无空位";
}

export function ProgressionContextSummary({
  project,
  result,
  status,
  compact = false,
}: {
  project: ProjectDocument;
  result?: ProgressionSearchResult;
  status: ProgressionAssistantPanelProps["status"];
  compact?: boolean;
}) {
  const slot = result?.slot;
  const position = slot && tickToPosition(project, slot.fromTick);
  const statusText = getProgressionStatusText(status, Boolean(slot));

  return (
    <div
      className={`progression-target ${compact ? "is-compact" : ""}`}
      role="status"
    >
      {slot && position ? (
        <>
          <strong>
            第 {position.measure} 小节第 {position.beat} 拍
            {position.tick > 0 && ` +${position.tick} tick`}
          </strong>
          <span className="progression-tag">
            {slot.kind === "empty" ? "全空" : "半空"}
          </span>
          {slot.leftAnchor?.chordLabel && (
            <span className="progression-anchor-chip">
              衔接 {slot.leftAnchor.chordLabel}
            </span>
          )}
          {VOICE_ORDER.map((voice) => {
            const pitch = slot.fixedVoices[voice];
            if (!pitch) return null;
            const name =
              voice === "soprano" ? "高音" : VOICE_CONFIG[voice].name;
            return (
              <span
                key={voice}
                className="progression-fixed-voice"
                style={{ "--v-color": VOICE_VAR[voice] } as CSSProperties}
              >
                <i aria-hidden="true" />
                {name}固定 {formatSpelledPitch(pitch)}
              </span>
            );
          })}
        </>
      ) : (
        <span className="progression-target-status">{statusText}</span>
      )}
    </div>
  );
}

function CandidateRow({
  candidate,
  category,
  stats,
  panel,
}: {
  candidate: ProgressionCandidate;
  category: ProgressionCategoryMeta;
  stats: BatchScoreStats;
  panel: ProgressionAssistantPanelProps;
}) {
  const [variantIndex, setVariantIndex] = useState(0);
  const safeIndex = Math.min(variantIndex, candidate.variants.length - 1);
  const variant = candidate.variants[safeIndex];
  const steps = variant.steps;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const { errorCount, warningCount } = variant.diagnosticSummary;
  const recommendation = assessProgressionRecommendation(
    candidate,
    variant,
    stats,
  );
  const playing = panel.auditioning?.candidate === candidate;
  const preview = (index = safeIndex) =>
    panel.onHoverCandidate({ candidate, variantIndex: index });
  const pitchPath = (voice: "soprano" | "bass") => {
    const from = formatSpelledPitch(first.notes[voice]);
    const to = formatSpelledPitch(last.notes[voice]);
    return from === to ? from : `${from} → ${to}`;
  };
  const showRoleTag =
    Boolean(candidate.tag) && candidate.tag !== "平稳连接";

  const handleRowDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (panel.isRefreshing) return;
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    preview();
    panel.onAudition(candidate, safeIndex);
  };

  return (
    <article
      className="progression-card progression-row"
      data-tier={recommendation.tier}
      data-playing={playing ? "true" : undefined}
      aria-label={`${candidate.headline}（${recommendation.label}）`}
      title="双击试听该方案"
      tabIndex={0}
      onMouseEnter={() => preview()}
      onFocus={() => preview()}
      onDoubleClick={handleRowDoubleClick}
    >
      <div
        className="progression-cell progression-rec-cell"
        title={recommendation.tooltip}
      >
        <span
          className={`progression-signal is-${recommendation.tier}`}
          aria-label={`建议度：${recommendation.label}`}
        >
          <i className={recommendation.bars >= 1 ? "is-lit" : undefined} />
          <i className={recommendation.bars >= 2 ? "is-lit" : undefined} />
          <i className={recommendation.bars >= 3 ? "is-lit" : undefined} />
        </span>
        <span className={`progression-tier-label is-${recommendation.tier}`}>
          {recommendation.label}
        </span>
      </div>

      <div className="progression-cell progression-card-title">
        <span
          className={`progression-fn-badge is-${category.id}`}
          title={category.label}
        >
          {category.shortBadge}
        </span>
        <strong>{candidate.headline}</strong>
        {showRoleTag && (
          <span className="progression-role-chip">{candidate.tag}</span>
        )}
      </div>

      <div className="progression-cell progression-check-cell">
        <span
          className={`progression-badge ${errorCount ? "is-error" : "is-clear"}`}
          title={
            errorCount
              ? `${errorCount} 项和声检查错误`
              : "通过和声错误检查"
          }
        >
          {errorCount ? (
            <XCircle aria-hidden="true" />
          ) : (
            <CheckCircle2 aria-hidden="true" />
          )}
          <span>{errorCount} 错误</span>
        </span>
        {warningCount > 0 && (
          <span
            className="progression-badge is-warning"
            title={`${warningCount} 项警告`}
          >
            <AlertTriangle aria-hidden="true" />
            <span>{warningCount} 警告</span>
          </span>
        )}
      </div>

      <div className="progression-cell progression-pitches">
        {steps.length === 1 ? (
          VOICE_ORDER.map((voice) => (
            <span
              key={voice}
              className="progression-voice-chip"
              style={{ "--v-color": VOICE_VAR[voice] } as CSSProperties}
            >
              <i aria-hidden="true" />
              <em>{VOICE_CONFIG[voice].shortName}:</em>
              {formatSpelledPitch(first.notes[voice])}
            </span>
          ))
        ) : (
          <>
            <span className="progression-step-chip">{steps.length} 步</span>
            <span
              className="progression-voice-chip"
              style={{ "--v-color": VOICE_VAR.soprano } as CSSProperties}
            >
              <i aria-hidden="true" />
              <em>S:</em>
              {pitchPath("soprano")}
            </span>
            <span
              className="progression-voice-chip"
              style={{ "--v-color": VOICE_VAR.bass } as CSSProperties}
            >
              <i aria-hidden="true" />
              <em>B:</em>
              {pitchPath("bass")}
            </span>
          </>
        )}
      </div>

      <div className="progression-cell progression-variants-cell">
        {candidate.variants.length > 1 ? (
          <div className="progression-variants" role="group" aria-label="排列变体">
            {candidate.variants.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={index === safeIndex}
                onClick={() => {
                  setVariantIndex(index);
                  preview(index);
                  if (playing && panel.auditioning?.variantIndex !== index) {
                    panel.onAudition(candidate, index);
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="progression-single-variant">{variant.label}</span>
        )}
      </div>

      <div className="progression-cell progression-card-actions">
        <button
          type="button"
          className="progression-audition"
          aria-pressed={playing}
          disabled={panel.isRefreshing}
          onClick={() => {
            if (playing) panel.onStopAudition();
            else {
              preview();
              panel.onAudition(candidate, safeIndex);
            }
          }}
        >
          {playing ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
          {playing ? "停止" : "试听"}
        </button>
        <button
          type="button"
          className="progression-apply"
          disabled={panel.isRefreshing}
          onClick={() =>
            panel.onApply(candidate, safeIndex, {
              writeChords: panel.writeChords,
            })
          }
        >
          采纳
        </button>
      </div>
    </article>
  );
}

export function ProgressionAssistantPanel(props: ProgressionAssistantPanelProps) {
  const {
    project,
    result,
    status,
    isRefreshing = false,
    hideTargetSummary = false,
    mode,
    shortLength,
    stepPreset,
    style,
    writeChords,
  } = props;
  const [selectedCategory, setSelectedCategory] = useState<
    ProgressionCategoryId | "all"
  >("all");
  const slot = result?.slot;
  const warnings = result?.warnings ?? [];
  const candidates = result?.candidates ?? [];

  // During a cross-mode refresh (e.g. single -> short), keep classifying old candidates
  // by their own mode so they stay readable while the new mode's category tabs appear immediately.
  const isModeMismatch =
    candidates.length > 0 && candidates[0]!.mode !== mode;

  const groups = useMemo(
    () =>
      groupProgressionCandidates(
        candidates,
        isModeMismatch ? candidates[0]!.mode : mode,
      ),
    [candidates, isModeMismatch, mode],
  );
  const stats = useMemo(() => computeBatchScoreStats(candidates), [candidates]);

  const modeCategories = useMemo(() => categoriesForMode(mode), [mode]);
  const countsByCategory = useMemo(() => {
    const counts = new Map<ProgressionCategoryId, number>();
    if (!isModeMismatch) {
      for (const group of groups) {
        counts.set(group.meta.id, group.candidates.length);
      }
    }
    return counts;
  }, [groups, isModeMismatch]);

  const activeCategory: ProgressionCategoryId | "all" =
    !isModeMismatch &&
    selectedCategory !== "all" &&
    groups.some((group) => group.meta.id === selectedCategory)
      ? selectedCategory
      : "all";

  const visibleGroups =
    activeCategory === "all"
      ? groups
      : groups.filter((group) => group.meta.id === activeCategory);

  const statusText = getProgressionStatusText(status, Boolean(slot));
  const isBusy = status === "searching" || isRefreshing;

  return (
    <div
      className="progression-assistant"
      role="tabpanel"
      id="bottom-progression-panel"
      aria-labelledby="bottom-progression-tab"
    >
      <div className="progression-toolbar">
        {!hideTargetSummary && (
          <ProgressionContextSummary
            project={project}
            result={result}
            status={status}
          />
        )}
        {candidates.length > 0 && (
          <div
            className="progression-category-filters"
            role="group"
            aria-label="按属性筛选"
          >
            <button
              type="button"
              aria-pressed={activeCategory === "all"}
              onClick={() => setSelectedCategory("all")}
            >
              全部{" "}
              <em>{isModeMismatch ? "…" : candidates.length}</em>
            </button>
            {modeCategories.map((category) => {
              const count = countsByCategory.get(category.id) ?? 0;
              const emptyWhenReady = !isModeMismatch && count === 0;
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={activeCategory === category.id}
                  disabled={emptyWhenReady || isModeMismatch}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <span className={`progression-fn-dot is-${category.id}`} />
                  {category.label}
                  {!isModeMismatch && <em>{count}</em>}
                </button>
              );
            })}
          </div>
        )}
        <div className="progression-controls">
          <div className="progression-segments" role="group" aria-label="连接模式">
            <button
              type="button"
              aria-pressed={mode === "single"}
              onClick={() => props.onModeChange("single")}
            >
              单和弦
            </button>
            <button
              type="button"
              aria-pressed={mode === "short"}
              onClick={() => props.onModeChange("short")}
            >
              短连接
            </button>
          </div>
          {mode === "short" && (
            <div className="progression-segments" role="group" aria-label="短连接步数">
              {shortLengths.map((length) => (
                <button
                  key={length}
                  type="button"
                  aria-pressed={shortLength === length}
                  className={
                    length === "bridge" && slot?.rightAnchor
                      ? "can-bridge"
                      : undefined
                  }
                  title={
                    length === "bridge" && slot?.rightAnchor
                      ? "连接至右侧锚点"
                      : undefined
                  }
                  onClick={() => props.onShortLengthChange(length)}
                >
                  {length === "bridge" ? "桥接" : `${length} 拍`}
                </button>
              ))}
            </div>
          )}
          <label className="progression-field">
            步长
            <select
              aria-label="全空位默认步长"
              value={stepPreset}
              onChange={(event) =>
                props.onStepPresetChange(
                  event.target.value as ProgressionStepPreset,
                )
              }
            >
              <option value="beat">1 拍</option>
              <option value="half-bar">2 拍</option>
              <option value="grid">跟随网格</option>
            </select>
          </label>
          <label className="progression-field">
            风格
            <select
              aria-label="风格预设"
              value={style}
              onChange={(event) =>
                props.onStyleChange(event.target.value as HarmonizationStyle)
              }
            >
              <option value="classic-basic">平稳保守</option>
              <option value="textbook-standard">标准教材</option>
              <option value="expressive-secondary">丰富色彩</option>
            </select>
          </label>
          <label
            className="progression-field"
            title={project.chordTrack.locked ? "和弦轨已锁定" : undefined}
          >
            <input
              type="checkbox"
              checked={writeChords}
              disabled={project.chordTrack.locked}
              onChange={(event) =>
                props.onWriteChordsChange(event.target.checked)
              }
            />
            同步写和弦轨
          </label>
          <button
            type="button"
            className="progression-refresh"
            aria-label="刷新和声连接"
            title="刷新和声连接"
            disabled={status === "paused"}
            onClick={props.onRefresh}
          >
            <RefreshCw
              aria-hidden="true"
              className={isBusy ? "is-spinning" : undefined}
            />
          </button>
        </div>
        {isBusy && (
          <span className="progression-progress-rail" aria-hidden="true" />
        )}
      </div>

      {warnings.length > 0 && (
        <p className="progression-warning" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>{warnings.join(" ")}</span>
        </p>
      )}

      {candidates.length > 0 ? (
        <div
          className="progression-body"
          data-refreshing={isRefreshing ? "true" : undefined}
        >
          <div
            className="progression-table-scroll"
            role="group"
            aria-label="候选和声连接"
            onMouseLeave={() => props.onHoverCandidate(undefined)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                props.onHoverCandidate(undefined);
              }
            }}
          >
            {visibleGroups.map((group) => (
              <section
                key={group.meta.id}
                className="progression-group"
                aria-label={group.meta.label}
              >
                {activeCategory === "all" && groups.length > 1 && (
                  <header className="progression-group-header">
                    <span
                      className={`progression-fn-badge is-${group.meta.id}`}
                    >
                      {group.meta.shortBadge}
                    </span>
                    <span>{group.meta.label}</span>
                    <em>{group.candidates.length}</em>
                  </header>
                )}
                {group.candidates.map((candidate) => (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    category={group.meta}
                    stats={stats}
                    panel={props}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      ) : (
        statusText && (
          <div className="progression-empty-state" role="status">
            <span>{statusText}</span>
          </div>
        )
      )}
    </div>
  );
}
