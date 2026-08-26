import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Music2, X, ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { buildScorePreviewModel } from "../../domain/notation";
import type { ScorePreviewWarning } from "../../domain/notation";
import type { ProjectDocument } from "../../domain/project";
import {
  loadVexFlow,
  renderScorePreview,
  type ScoreNoteSelection,
} from "./vexflowRenderer";

export interface ScorePreviewDialogProps {
  project: ProjectDocument;
  revision: number;
  playheadTick: number;
  onClose(): void;
  onSelectNote?(selection: ScoreNoteSelection): void;
}

const SCALE_STEPS = [0.75, 0.9, 1, 1.15, 1.3, 1.5] as const;

function nextScale(value: number, direction: -1 | 1) {
  const index = SCALE_STEPS.findIndex((candidate) => Math.abs(candidate - value) < 0.001);
  const safeIndex = index < 0 ? 2 : index;
  return SCALE_STEPS[Math.max(0, Math.min(SCALE_STEPS.length - 1, safeIndex + direction))];
}

export function ScorePreviewDialog({
  project,
  revision,
  playheadTick,
  onClose,
  onSelectNote,
}: ScorePreviewDialogProps) {
  const [scale, setScale] = useState(1);
  const [followPlayhead, setFollowPlayhead] = useState(false);
  const [renderWarnings, setRenderWarnings] = useState<readonly ScorePreviewWarning[]>(
    [],
  );
  const [renderState, setRenderState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const surfaceRef = useRef<HTMLDivElement>(null);
  const model = useMemo(
    () => buildScorePreviewModel(project, { revision }),
    [project, revision],
  );
  const handleNoteClick = useCallback(
    (selection: ScoreNoteSelection) => onSelectNote?.(selection),
    [onSelectNote],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let active = true;
    let cleanup: (() => void) | undefined;
    setRenderState("loading");
    setRenderWarnings([]);
    surface.replaceChildren();
    void loadVexFlow()
      .then((vexflow) => {
        if (!active) return;
        const rendered = renderScorePreview(
          surface,
          model,
          {
            scale,
            onNoteClick: onSelectNote ? handleNoteClick : undefined,
          },
          vexflow,
        );
        if (!active) {
          rendered.cleanup();
          return;
        }
        cleanup = rendered.cleanup;
        setRenderWarnings(rendered.warnings);
        setRenderState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        surface.replaceChildren();
        setRenderWarnings([
          {
            code: "render-error",
            message:
              "乐谱预览不可用：" +
              (error instanceof Error ? error.message : "VexFlow 加载失败"),
          },
        ]);
        setRenderState("error");
      });
    return () => {
      active = false;
      cleanup?.();
    };
  }, [handleNoteClick, model, onSelectNote, scale]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const systems = [...surface.querySelectorAll<HTMLElement>(".score-preview-system")];
    let active: HTMLElement | undefined;
    systems.forEach((system) => {
      const fromTick = Number(system.dataset.fromTick);
      const toTick = Number(system.dataset.toTick);
      const isActive =
        Number.isFinite(fromTick) &&
        Number.isFinite(toTick) &&
        playheadTick >= fromTick &&
        playheadTick < toTick;
      system.dataset.active = isActive ? "true" : "false";
      if (isActive) active = system;
    });
    if (followPlayhead && active) {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [followPlayhead, playheadTick, model, scale]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const warnings = [...model.warnings, ...renderWarnings];

  return createPortal(
    <div
      className="score-preview-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="score-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-preview-title"
      >
        <header className="score-preview-header">
          <div className="score-preview-title">
            <Music2 aria-hidden="true" />
            <div>
              <h2 id="score-preview-title">五线谱预览</h2>
              <p>只读钢琴大谱表 · S/A 高音谱表 · T/B 低音谱表</p>
            </div>
          </div>
          <IconButton label="关闭五线谱预览" icon={<X />} onClick={onClose} />
        </header>

        <div className="score-preview-toolbar">
          <span className="score-preview-meta">
            {model.measures.length} 小节 · revision {model.revision}
          </span>
          <div className="score-preview-actions">
            <IconButton
              label="缩小谱面"
              icon={<ZoomOut />}
              disabled={scale <= SCALE_STEPS[0]}
              onClick={() => setScale((value) => nextScale(value, -1))}
            />
            <span className="score-preview-scale">{Math.round(scale * 100)}%</span>
            <IconButton
              label="放大谱面"
              icon={<ZoomIn />}
              disabled={scale >= SCALE_STEPS.at(-1)!}
              onClick={() => setScale((value) => nextScale(value, 1))}
            />
            <label className="score-preview-follow">
              <input
                type="checkbox"
                checked={followPlayhead}
                onChange={(event) => setFollowPlayhead(event.target.checked)}
              />
              <span>跟随播放头</span>
            </label>
          </div>
        </div>

        {warnings.length > 0 ? (
          <div className="score-preview-warning" role="status">
            <strong>预览提示 {warnings.length}</strong>
            <span>{warnings.slice(0, 3).map((item) => item.message).join("；")}</span>
            {warnings.length > 3 ? <span>其余提示已省略</span> : null}
          </div>
        ) : null}

        <div
          className="score-preview-scroll"
          aria-label="五线谱只读预览"
          onContextMenu={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
        >
          {renderState === "loading" ? (
            <div className="score-preview-loading" role="status">
              正在加载乐谱引擎…
            </div>
          ) : null}
          <div ref={surfaceRef} className="score-preview-surface" />
        </div>
      </section>
    </div>,
    document.body,
  );
}
