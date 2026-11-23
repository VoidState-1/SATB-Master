import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Sparkles, X } from "lucide-react";
import {
  autoHarmonize,
  type AutoHarmonizationApplyOptions,
  type AutoHarmonizationResult,
  type HarmonizationGivenVoice,
  type HarmonizationRange,
  type HarmonizationSolution,
  type HarmonizationStyle,
} from "../../domain/harmony/harmonization";
import type { ProjectDocument } from "../../domain/project";
import { buildMeasures, measureAtTick } from "../../domain/time";
import { logger } from "../../services/logging";
import { AutoHarmonizationPreview } from "./AutoHarmonizationPreview";
import "./autoHarmonization.css";

type RangeMode = "project" | "selection" | "current-measure";

interface AutoHarmonizationDialogProps {
  project: ProjectDocument;
  playheadTick: number;
  selectedNoteIds: ReadonlySet<string>;
  selectedChordIds: ReadonlySet<string>;
  onClose(): void;
  onApply(solution: HarmonizationSolution, options: AutoHarmonizationApplyOptions): boolean | void;
  onAudition(solution: HarmonizationSolution, signal: AbortSignal, onEnded: () => void): Promise<void>;
}

function selectionRange(
  project: ProjectDocument,
  selectedNoteIds: ReadonlySet<string>,
  selectedChordIds: ReadonlySet<string>,
): HarmonizationRange | undefined {
  const selectedItems = [
    ...project.satbTracks.flatMap(track => track.notes.filter(note => selectedNoteIds.has(note.id))),
    ...project.chordTrack.regions.filter(chord => selectedChordIds.has(chord.id)),
  ];
  let fromTick = project.lengthTicks;
  let toTick = 0;
  for (const item of selectedItems) {
    fromTick = Math.min(fromTick, item.startTick);
    toTick = Math.max(toTick, item.startTick + item.durationTicks);
  }
  toTick = Math.min(project.lengthTicks, toTick);
  return fromTick < toTick ? { fromTick, toTick } : undefined;
}

export function AutoHarmonizationDialog({
  project, playheadTick, selectedNoteIds, selectedChordIds, onClose, onApply, onAudition,
}: AutoHarmonizationDialogProps) {
  const titleId = useId();
  const formId = useId();
  const countId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const givenVoiceRef = useRef<HTMLSelectElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const audition = useRef<AbortController | undefined>(undefined);

  const sopranoNotes = project.satbTracks.find(track => track.id === "soprano")?.notes ?? [];
  const bassNotes = project.satbTracks.find(track => track.id === "bass")?.notes ?? [];
  const [givenVoice, setGivenVoice] = useState<HarmonizationGivenVoice>(
    sopranoNotes.length || !bassNotes.length ? "soprano" : "bass",
  );
  const [rangeMode, setRangeMode] = useState<RangeMode>("project");
  const [style, setStyle] = useState<HarmonizationStyle>("textbook-standard");
  const [respectLockedConstraints, setRespectLockedConstraints] = useState(true);
  const [allowPassingAndNeighborMelodies, setAllowPassingAndNeighborMelodies] = useState(false);
  const [writeChords, setWriteChords] = useState(true);
  const [writePhrasesAndCadences, setWritePhrasesAndCadences] = useState(true);
  const [review, setReview] = useState<AutoHarmonizationResult>();
  const [selectedId, setSelectedId] = useState<string>();
  const [playingId, setPlayingId] = useState<string>();
  const [message, setMessage] = useState<string>();

  const selection = useMemo(
    () => selectionRange(project, selectedNoteIds, selectedChordIds),
    [project, selectedNoteIds, selectedChordIds],
  );
  const measure = useMemo(() => {
    const tick = Number.isFinite(playheadTick)
      ? Math.max(0, Math.min(project.lengthTicks - 1, playheadTick))
      : 0;
    return measureAtTick(buildMeasures(project), tick);
  }, [project, playheadTick]);
  const range = (rangeMode === "selection" && selection) ||
    (rangeMode === "current-measure" && measure && { fromTick: measure.startTick, toTick: measure.endTick }) ||
    { fromTick: 0, toTick: project.lengthTicks };
  const givenNotes = givenVoice === "soprano" ? sopranoNotes : bassNotes;
  const hasGivenNotes = givenNotes.some(note =>
    note.startTick < range.toTick && range.fromTick < note.startTick + note.durationTicks,
  );
  const emptyMessage = !sopranoNotes.length && !bassNotes.length
    ? "高音轨和低音轨都没有音符。请先录入高音或低音题。"
    : "此范围内没有给定声部的音符。请选择其他声部或调整范围。";
  const selected = review?.solutions.find(solution => solution.id === selectedId);
  const reviewing = review !== undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      audition.current?.abort();
      dialog?.close();
    };
  }, []);

  useEffect(() => {
    if (reviewing) reviewHeadingRef.current?.focus();
    else givenVoiceRef.current?.focus();
  }, [reviewing]);

  function stopAudition() {
    audition.current?.abort();
    audition.current = undefined;
    setPlayingId(undefined);
  }

  function close() {
    stopAudition();
    dialogRef.current?.close();
    onClose();
  }

  function generate(event: FormEvent) {
    event.preventDefault();
    if (!hasGivenNotes) return;
    setMessage(undefined);
    const context = { ...range, givenVoice, style };
    logger.recordBreadcrumb("harmonization", "生成自动和声", context);
    try {
      const result = logger.span("harmonization", "生成自动和声", () => autoHarmonize(project, {
        ...context, respectLockedConstraints, allowPassingAndNeighborMelodies,
      }), context, {
        code: "HARMONIZATION_FAILED",
        summarize: ({ solutions }) => {
          const best = solutions[0];
          return {
            solutionCount: solutions.length,
            bestErrors: best?.diagnosticSummary.errorCount,
            bestWarnings: best?.diagnosticSummary.warningCount,
            relaxedLevel: best?.relaxedLevel,
          };
        },
      });
      setSelectedId(result.solutions[0]?.id);
      setReview(result);
    } catch {
      setMessage("生成和声方案失败，请调整参数后重试。");
    }
  }

  function choose(solution: HarmonizationSolution) {
    if (selectedId === solution.id) return;
    stopAudition();
    setMessage(undefined);
    setSelectedId(solution.id);
  }

  async function toggleAudition(solution: HarmonizationSolution) {
    if (playingId === solution.id) {
      stopAudition();
      return;
    }
    choose(solution);
    setMessage(undefined);
    const request = new AbortController();
    audition.current = request;
    setPlayingId(solution.id);
    try {
      await onAudition(solution, request.signal, () => {
        if (request.signal.aborted) return;
        audition.current = undefined;
        setPlayingId(undefined);
      });
    } catch {
      if (request.signal.aborted) return;
      stopAudition();
      setMessage("试听失败，请重试。");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="auto-harmonization-dialog"
      data-reviewing={reviewing}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={event => {
        event.preventDefault();
        close();
      }}
    >
      <header className="auto-harmonization-header">
        <h2 id={titleId}><Sparkles size={16} aria-hidden="true" />自动和声</h2>
        <button type="button" className="auto-harmonization-close" aria-label="关闭自动和声" onClick={close}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {review ? (
        <div className="auto-harmonization-body">
          <AutoHarmonizationPreview
            result={review}
            headingRef={reviewHeadingRef}
            selectedId={selectedId}
            playingId={playingId}
            onChoose={choose}
            onAudition={solution => void toggleAudition(solution)}
          />
          {message && <p className="auto-harmonization-message" role="alert">{message}</p>}
        </div>
      ) : (
        <form id={formId} className="auto-harmonization-body" onSubmit={generate}>
          <div className="auto-harmonization-fields">
            <label>
              给定声部
              <select
                ref={givenVoiceRef}
                aria-describedby={countId}
                value={givenVoice}
                onChange={event => setGivenVoice(event.target.value as HarmonizationGivenVoice)}
              >
                <option value="soprano">高音题（Soprano）</option>
                <option value="bass">低音题（Bass）</option>
              </select>
            </label>
            <label>
              作用范围
              <select value={rangeMode} onChange={event => setRangeMode(event.target.value as RangeMode)}>
                <option value="project">全曲</option>
                {selection && <option value="selection">选中区域</option>}
                {measure && <option value="current-measure">当前小节（第 {measure.number} 小节）</option>}
              </select>
            </label>
            <label>
              风格预设
              <select value={style} onChange={event => setStyle(event.target.value as HarmonizationStyle)}>
                <option value="classic-basic">平稳保守</option>
                <option value="textbook-standard">标准教材</option>
                <option value="expressive-secondary">丰富色彩</option>
              </select>
            </label>
            <p id={countId} className="auto-harmonization-track-count">
              S 轨 {sopranoNotes.length} 个音符 · B 轨 {bassNotes.length} 个音符
            </p>
          </div>

          <fieldset className="auto-harmonization-options">
            <legend>生成选项</legend>
            <label>
              <input type="checkbox" checked={respectLockedConstraints} onChange={event => setRespectLockedConstraints(event.target.checked)} />
              保留并围绕已锁定的和弦与音符生成
            </label>
            <label>
              <input type="checkbox" checked={allowPassingAndNeighborMelodies} onChange={event => setAllowPassingAndNeighborMelodies(event.target.checked)} />
              识别弱拍经过音与辅助音
            </label>
          </fieldset>

          <fieldset className="auto-harmonization-options">
            <legend>写回选项</legend>
            <label>
              <input type="checkbox" checked={writeChords} onChange={event => setWriteChords(event.target.checked)} />
              同步写入和弦轨
            </label>
            <label>
              <input type="checkbox" checked={writePhrasesAndCadences} onChange={event => setWritePhrasesAndCadences(event.target.checked)} />
              同步写入乐句与终止式
            </label>
          </fieldset>
          {!hasGivenNotes && <p className="auto-harmonization-message" role="status">{emptyMessage}</p>}
          {message && <p className="auto-harmonization-message" role="alert">{message}</p>}
        </form>
      )}

      <footer className="auto-harmonization-footer">
        {review ? (
          <>
            <button type="button" className="auto-harmonization-button" title="返回调整参数" onClick={() => {
              stopAudition();
              setMessage(undefined);
              setReview(undefined);
            }}>返回修改</button>
            <button type="button" className="auto-harmonization-button primary" disabled={!selected} onClick={() => {
              if (!selected) return;
              stopAudition();
              if (onApply(selected, { writeChords, writePhrasesAndCadences, respectLockedConstraints }) === false) {
                setMessage("应用自动和声失败，请重试。");
                return;
              }
              dialogRef.current?.close();
            }}>应用所选方案</button>
          </>
        ) : (
          <>
            <button type="button" className="auto-harmonization-button" onClick={close}>取消</button>
            <button type="submit" className="auto-harmonization-button primary" form={formId} disabled={!hasGivenNotes}>
              <Sparkles size={15} aria-hidden="true" />生成和声方案
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}

