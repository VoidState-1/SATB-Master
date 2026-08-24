import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { WandSparkles, X } from "lucide-react";
import { buildMeasures, measureAtTick } from "../../domain/time";
import type { ProjectDocument } from "../../domain/project";

export type ChordInferenceRangeMode =
  | "selection"
  | "current-measure"
  | "project";

export interface ChordInferenceDialogOptions {
  project: ProjectDocument;
  playheadTick: number;
  selectedNoteIds: ReadonlySet<string>;
  selectedChordIds: ReadonlySet<string>;
  onClose(): void;
  onApply(options: {
    rangeMode: ChordInferenceRangeMode;
    fromTick: number;
    toTick: number;
    mode: "fill-gaps" | "replace-unlocked";
    allowAbsoluteFallback: boolean;
    allowIncompleteVoicing: boolean;
    minConfidence: "high" | "medium" | "low";
    writeNonChordToneRoles: boolean;
  }): void;
}

function selectedRange(
  project: ProjectDocument,
  selectedNoteIds: ReadonlySet<string>,
  selectedChordIds: ReadonlySet<string>,
) {
  const notes = project.satbTracks.flatMap((track) =>
    track.notes.filter((note) => selectedNoteIds.has(note.id)),
  );
  const chords = project.chordTrack.regions.filter((region) =>
    selectedChordIds.has(region.id),
  );
  const starts = [
    ...notes.map((note) => note.startTick),
    ...chords.map((region) => region.startTick),
  ];
  const ends = [
    ...notes.map((note) => note.startTick + note.durationTicks),
    ...chords.map((region) => region.startTick + region.durationTicks),
  ];
  if (starts.length === 0 || ends.length === 0) return undefined;
  return {
    fromTick: Math.min(...starts),
    toTick: Math.min(project.lengthTicks, Math.max(...ends)),
  };
}

export function ChordInferenceDialog({
  project,
  playheadTick,
  selectedNoteIds,
  selectedChordIds,
  onClose,
  onApply,
}: ChordInferenceDialogOptions) {
  const [rangeMode, setRangeMode] = useState<ChordInferenceRangeMode>(
    selectedRange(project, selectedNoteIds, selectedChordIds)
      ? "selection"
      : "current-measure",
  );
  const [mode, setMode] = useState<"fill-gaps" | "replace-unlocked">("fill-gaps");
  const [allowAbsoluteFallback, setAllowAbsoluteFallback] = useState(false);
  const [allowIncompleteVoicing, setAllowIncompleteVoicing] = useState(false);
  const [minConfidence, setMinConfidence] = useState<"high" | "medium" | "low">(
    "medium",
  );
  const [writeNonChordToneRoles, setWriteNonChordToneRoles] = useState(false);
  const firstControlRef = useRef<HTMLSelectElement>(null);
  const selection = useMemo(
    () => selectedRange(project, selectedNoteIds, selectedChordIds),
    [project, selectedChordIds, selectedNoteIds],
  );
  const measure = useMemo(
    () => measureAtTick(buildMeasures(project), playheadTick),
    [playheadTick, project],
  );
  const range =
    rangeMode === "selection" && selection
      ? selection
      : rangeMode === "current-measure" && measure
        ? { fromTick: measure.startTick, toTick: measure.endTick }
        : { fromTick: 0, toTick: project.lengthTicks };

  useEffect(() => {
    firstControlRef.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply({
      rangeMode,
      ...range,
      mode,
      allowAbsoluteFallback,
      allowIncompleteVoicing,
      minConfidence,
      writeNonChordToneRoles,
    });
  };

  return (
    <div className="confirmation-backdrop" onClick={onClose}>
      <section
        className="confirmation-dialog chord-inference-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chord-inference-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chord-inference-header">
          <div>
            <h2 id="chord-inference-title">
              <WandSparkles aria-hidden="true" />
              从音符推导和弦
            </h2>
            <p>优先使用当前调性的功能和声解释，完成后直接写入和弦轨。</p>
          </div>
          <button
            type="button"
            className="dialog-close-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <form className="chord-inference-form" onSubmit={submit}>
          <label className="chord-inference-field">
            <span>推导范围</span>
            <select
              ref={firstControlRef}
              value={rangeMode}
              onChange={(event) =>
                setRangeMode(event.target.value as ChordInferenceRangeMode)
              }
            >
              <option value="selection" disabled={!selection}>
                当前选择{selection ? "" : "（尚未选择音符或和弦）"}
              </option>
              <option value="current-measure">当前小节</option>
              <option value="project">整个工程</option>
            </select>
            <small>
              {range.fromTick} - {range.toTick} Tick
            </small>
          </label>

          <fieldset>
            <legend>已有和弦</legend>
            <label className="chord-inference-option">
              <input
                type="radio"
                name="chord-inference-mode"
                checked={mode === "fill-gaps"}
                onChange={() => setMode("fill-gaps")}
              />
              <span>
                <strong>仅填补空白</strong>
                <small>保留已有和弦，不覆盖手动结果。</small>
              </span>
            </label>
            <label className="chord-inference-option">
              <input
                type="radio"
                name="chord-inference-mode"
                checked={mode === "replace-unlocked"}
                onChange={() => setMode("replace-unlocked")}
              />
              <span>
                <strong>替换未锁定和弦</strong>
                <small>锁定和弦始终保留，重叠区域会被报告。</small>
              </span>
            </label>
          </fieldset>

          <fieldset>
            <legend>推导策略</legend>
            <label className="chord-inference-check">
              <input
                type="checkbox"
                checked={allowAbsoluteFallback}
                onChange={(event) => setAllowAbsoluteFallback(event.target.checked)}
              />
              <span>
                <strong>允许绝对和弦回退</strong>
                <small>功能目录无法解释时，允许生成明确标记的普通结构。</small>
              </span>
            </label>
            <label className="chord-inference-check">
              <input
                type="checkbox"
                checked={allowIncompleteVoicing}
                onChange={(event) => setAllowIncompleteVoicing(event.target.checked)}
              />
              <span>
                <strong>允许有限缺音</strong>
                <small>允许缺少一个和弦音，但不会忽略无法解释的额外音。</small>
              </span>
            </label>
            <label className="chord-inference-field compact">
              <span>最低置信度</span>
              <select
                value={minConfidence}
                onChange={(event) =>
                  setMinConfidence(event.target.value as typeof minConfidence)
                }
              >
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>音符标记</legend>
            <label className="chord-inference-check">
              <input
                type="checkbox"
                checked={writeNonChordToneRoles}
                onChange={(event) => setWriteNonChordToneRoles(event.target.checked)}
              />
              <span>
                <strong>同时写入音符的非和弦音角色</strong>
                <small>推导阶段只读；应用时仅写入有足够证据的角色，锁定音符不会修改。</small>
              </span>
            </label>
          </fieldset>

          <div className="confirmation-actions">
            <button type="button" className="command-button secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="command-button primary">
              <WandSparkles aria-hidden="true" />
              应用推导结果
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
