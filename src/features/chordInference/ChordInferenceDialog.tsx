import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { WandSparkles, X } from "lucide-react";
import {
  inferHarmony, type ChordInferenceApplyOptions, type HarmonyInferenceResult,
} from "../../domain/harmony/inference";
import { buildMeasures, measureAtTick } from "../../domain/time";
import type { ProjectDocument } from "../../domain/project";
import { ChordInferencePreview } from "./ChordInferencePreview";
import "./chordInference.css";

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
  onApply(result: HarmonyInferenceResult, options: ChordInferenceApplyOptions): void;
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
  const [review, setReview] = useState<{
    result: HarmonyInferenceResult;
    mode: ChordInferenceApplyOptions["mode"];
    choices: ReadonlyMap<string, string>;
  }>();
  const firstControlRef = useRef<HTMLSelectElement>(null);

  const selection = useMemo(
    () => selectedRange(project, selectedNoteIds, selectedChordIds),
    [project, selectedChordIds, selectedNoteIds],
  );

  const measure = useMemo(() => {
    const lastTick = Math.max(0, project.lengthTicks - 1);
    const safePlayhead = Number.isFinite(playheadTick)
      ? Math.max(0, Math.min(lastTick, playheadTick))
      : 0;
    return measureAtTick(buildMeasures(project), safePlayhead);
  }, [playheadTick, project]);

  const range =
    rangeMode === "selection" && selection
      ? selection
      : rangeMode === "current-measure" && measure
        ? { fromTick: measure.startTick, toTick: measure.endTick }
        : { fromTick: 0, toTick: project.lengthTicks };
  const { fromTick, toTick } = range;
  const result = useMemo(() => inferHarmony(project, {
    fromTick, toTick, allowAbsoluteFallback, allowIncompleteVoicing, minConfidence,
  }), [project, fromTick, toTick, allowAbsoluteFallback, allowIncompleteVoicing, minConfidence]);
  const candidateChoices = review?.result === result && review.mode === mode ? review.choices : undefined;

  useEffect(() => {
    firstControlRef.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply(result, { mode, candidateChoices, writeNonChordToneRoles });
  };

  return (
    <div className="confirmation-backdrop" onClick={onClose}>
      <div
        className="chord-inference-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chord-inference-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chord-inference-header">
          <div className="chord-inference-header-title" id="chord-inference-title">
            <WandSparkles size={17} aria-hidden="true" />
            <span>从音符推导和弦</span>
          </div>
          <button
            type="button"
            className="chord-inference-close-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="chord-inference-body" id="chord-inference-form" onSubmit={submit}>
          {/* 推导范围 */}
          <div className="chord-inference-field">
            <span className="chord-inference-field-label">推导范围</span>
            <div className="chord-inference-range-row">
              <select
                ref={firstControlRef}
                aria-label="推导范围"
                className="chord-inference-select"
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
              <span className="chord-inference-tick-badge">
                {range.fromTick} - {range.toTick} Tick
              </span>
            </div>
          </div>

          {/* 已有和弦模式：分段卡片 */}
          <div className="chord-inference-field">
            <span className="chord-inference-field-label">已有和弦</span>
            <div className="chord-inference-tabs">
              <button
                type="button"
                className={`chord-inference-tab ${
                  mode === "fill-gaps" ? "active" : ""
                }`}
                onClick={() => setMode("fill-gaps")}
              >
                <span className="chord-inference-tab-title">仅填补空白</span>
              </button>
              <button
                type="button"
                className={`chord-inference-tab ${
                  mode === "replace-unlocked" ? "active" : ""
                }`}
                onClick={() => setMode("replace-unlocked")}
              >
                <span className="chord-inference-tab-title">替换未锁定和弦</span>
              </button>
            </div>
          </div>

          {/* 选项卡片列表 */}
          <div className="chord-inference-field">
            <span className="chord-inference-field-label">选项</span>
            <div className="chord-inference-options">
              <label className="chord-inference-option-row">
                <input
                  type="checkbox"
                  checked={allowAbsoluteFallback}
                  onChange={(event) =>
                    setAllowAbsoluteFallback(event.target.checked)
                  }
                />
                <span>允许绝对和弦回退</span>
              </label>

              <label className="chord-inference-option-row">
                <input
                  type="checkbox"
                  checked={allowIncompleteVoicing}
                  onChange={(event) =>
                    setAllowIncompleteVoicing(event.target.checked)
                  }
                />
                <span>允许有限缺音</span>
              </label>

              <label className="chord-inference-option-row">
                <input
                  type="checkbox"
                  checked={writeNonChordToneRoles}
                  onChange={(event) =>
                    setWriteNonChordToneRoles(event.target.checked)
                  }
                />
                <span>同时写入音符的非和弦音角色</span>
              </label>
            </div>
          </div>

          {/* 最低置信度 */}
          <div className="chord-inference-field">
            <span className="chord-inference-field-label">最低置信度</span>
            <div className="chord-inference-tabs three-cols">
              <button
                type="button"
                className={`chord-inference-tab ${
                  minConfidence === "high" ? "active" : ""
                }`}
                onClick={() => setMinConfidence("high")}
              >
                <span className="chord-inference-tab-title">高</span>
              </button>
              <button
                type="button"
                className={`chord-inference-tab ${
                  minConfidence === "medium" ? "active" : ""
                }`}
                onClick={() => setMinConfidence("medium")}
              >
                <span className="chord-inference-tab-title">中</span>
              </button>
              <button
                type="button"
                className={`chord-inference-tab ${
                  minConfidence === "low" ? "active" : ""
                }`}
                onClick={() => setMinConfidence("low")}
              >
                <span className="chord-inference-tab-title">低</span>
              </button>
            </div>
          </div>

          <ChordInferencePreview
            project={project}
            regions={result.chordInference.regions}
            mode={mode}
            choices={candidateChoices}
            onChoose={(regionId, candidateId) => {
              setReview(previous => {
                const choices = new Map(previous?.result === result && previous.mode === mode ? previous.choices : undefined);
                choices.set(regionId, candidateId);
                return { result, mode, choices };
              });
            }}
            onApplyRegion={(regionId, candidateId) => onApply(result, {
              mode,
              selection: new Set([regionId]),
              candidateChoices: new Map([[regionId, candidateId]]),
              writeNonChordToneRoles,
            })}
          />
        </form>
        <footer className="chord-inference-footer">
          <button type="button" className="chord-inference-btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" form="chord-inference-form" className="chord-inference-btn-primary">
            <WandSparkles size={15} aria-hidden="true" />
            <span>应用推导结果</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
