import { useId, type Ref } from "react";
import { CircleCheck, Play, Square } from "lucide-react";
import { cadenceKindLabels } from "../../components/cadenceRanges";
import { formatChordIdentity } from "../../domain/chords";
import type { AutoHarmonizationResult, HarmonizationSolution } from "../../domain/harmony/harmonization";
import { keyAtTick } from "../../domain/time";

interface AutoHarmonizationPreviewProps {
  result: AutoHarmonizationResult;
  headingRef: Ref<HTMLHeadingElement>;
  selectedId?: string;
  playingId?: string;
  onChoose(solution: HarmonizationSolution): void;
  onAudition(solution: HarmonizationSolution): void;
}

function SolutionSummary({ solution }: { solution: HarmonizationSolution }) {
  const { project, range, diagnosticSummary, relaxedLevel } = solution;
  const { errorCount, warningCount } = diagnosticSummary;
  const chords = solution.chords
    .filter(chord => chord.startTick < range.toTick && range.fromTick < chord.startTick + chord.durationTicks)
    .map(chord => {
      const key = keyAtTick(project.keyEvents, chord.startTick);
      const { roman, functional, absolute } = formatChordIdentity(chord.identity, chord.semantics, key.mode);
      return roman !== "?" ? roman : functional !== "?" ? functional : absolute;
    });
  const cadences = solution.cadences
    .filter(cadence => !cadence.stale && range.fromTick <= cadence.fromTick && cadence.toTick <= range.toTick)
    .map(cadence => cadenceKindLabels[cadence.kind]);
  const warnings = solution.warnings.length
    ? solution.warnings
    : relaxedLevel > 0 ? ["已放宽部分配声限制，建议复核。"] : [];

  return (
    <>
      <p className="auto-harmonization-description">{solution.description}</p>
      <span className="auto-harmonization-diagnostics" data-clean={errorCount === 0}>
        {errorCount === 0 && <CircleCheck size={13} aria-hidden="true" />}
        {errorCount} 错误 · {warningCount} 警告
      </span>
      <dl className="auto-harmonization-summary">
        <dt>和弦</dt><dd>{chords.length ? chords.join(" → ") : "无和弦区段"}</dd>
        <dt>终止式</dt><dd>{cadences.length ? cadences.join(" · ") : "未检测到终止式"}</dd>
      </dl>
      {warnings.length > 0 && (
        <ul className="auto-harmonization-warnings">
          {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      )}
    </>
  );
}

export function AutoHarmonizationPreview({
  result, headingRef, selectedId, playingId, onChoose, onAudition,
}: AutoHarmonizationPreviewProps) {
  const groupName = useId();
  const headingId = useId();
  const solutions = result.solutions.slice(0, 3);
  return (
    <>
      <div className="auto-harmonization-review-heading">
        <h3 ref={headingRef} tabIndex={-1} id={headingId}>候选方案</h3>
        <span>{solutions.length} 套 · 生成耗时 {Math.round(result.elapsedMs)} ms</span>
      </div>
      {solutions.length ? (
        <div className="auto-harmonization-candidates" role="radiogroup" aria-labelledby={headingId}>
          {solutions.map((solution, index) => {
            const playing = playingId === solution.id;
            const label = `方案 ${index + 1} · ${solution.label}`;
            return (
              <article
                key={solution.id}
                className="auto-harmonization-candidate"
                data-selected={selectedId === solution.id}
                data-playing={playing}
              >
                <div className="auto-harmonization-candidate-header">
                  <label>
                    <input
                      type="radio"
                      name={groupName}
                      checked={selectedId === solution.id}
                      onChange={() => onChoose(solution)}
                    />
                    <strong>{label}</strong>
                  </label>
                  <button
                    type="button"
                    className="auto-harmonization-button audition"
                    aria-label={playing ? `停止试听${label}` : `试听${label}`}
                    onClick={() => onAudition(solution)}
                  >
                    {playing ? <Square size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
                    {playing ? "停止" : "试听"}
                  </button>
                </div>
                <SolutionSummary solution={solution} />
              </article>
            );
          })}
        </div>
      ) : (
        <p className="auto-harmonization-message" role="status">
          {result.warnings.join(" ") || "未能生成和声方案，请返回调整参数。"}
        </p>
      )}
    </>
  );
}

