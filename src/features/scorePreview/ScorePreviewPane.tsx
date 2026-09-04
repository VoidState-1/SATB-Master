import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildScorePreviewModel } from "../../domain/notation";
import type {
  ScorePreviewModel,
  ScorePreviewWarning,
} from "../../domain/notation";
import type { ProjectDocument } from "../../domain/project";
import {
  loadVexFlow,
  renderScorePreview,
  type ScoreNoteSelection,
  type ScoreRenderedNoteRef,
} from "./vexflowRenderer";

export type ScoreHighlightMode = "none" | "monochrome" | "color";

export const SCALE_STEPS = [0.75, 0.9, 1, 1.15, 1.3, 1.5] as const;
export const HIGHLIGHT_MODE_STORAGE_KEY = "satb-score-preview-highlight-mode";

export function getInitialHighlightMode(): ScoreHighlightMode {
  if (typeof window === "undefined") return "color";
  const stored = window.localStorage.getItem(HIGHLIGHT_MODE_STORAGE_KEY);
  if (stored === "none" || stored === "monochrome" || stored === "color") {
    return stored;
  }
  return "color";
}

export function nextScale(value: number, direction: -1 | 1) {
  const index = SCALE_STEPS.findIndex(
    (candidate) => Math.abs(candidate - value) < 0.001,
  );
  const safeIndex = index < 0 ? 2 : index;
  return SCALE_STEPS[
    Math.max(0, Math.min(SCALE_STEPS.length - 1, safeIndex + direction))
  ];
}

export interface ScorePreviewPaneProps {
  project: ProjectDocument;
  revision: number;
  playheadTick: number;
  isPlaying?: boolean;
  selectedNoteIds?: ReadonlySet<string>;
  scale?: number;
  followPlayhead?: boolean;
  highlightMode?: ScoreHighlightMode;
  onSelectNote?(selection: ScoreNoteSelection): void;
  onModelInfoChange?(info: {
    measureCount: number;
    revision: number;
    warnings: readonly ScorePreviewWarning[];
  }): void;
}

export function ScorePreviewPane({
  project,
  revision,
  playheadTick,
  isPlaying = false,
  selectedNoteIds,
  scale = 1,
  followPlayhead = false,
  highlightMode = "color",
  onSelectNote,
  onModelInfoChange,
}: ScorePreviewPaneProps) {
  const [renderWarnings, setRenderWarnings] = useState<
    readonly ScorePreviewWarning[]
  >([]);
  const [renderState, setRenderState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [containerWidth, setContainerWidth] = useState<number | undefined>();

  const scrollRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const noteClickRef = useRef(onSelectNote);
  noteClickRef.current = onSelectNote;
  const noteRefsRef = useRef<
    Array<ScoreRenderedNoteRef & { isActive?: boolean; isSelected?: boolean }>
  >([]);

  const model = useMemo(
    () => buildScorePreviewModel(project, { revision }),
    [project, revision],
  );

  const handleNoteClick = useCallback(
    (selection: ScoreNoteSelection) => noteClickRef.current?.(selection),
    [],
  );
  const hasNoteClick = onSelectNote !== undefined;

  // 通知外部模型元信息与警告
  useEffect(() => {
    const combinedWarnings = [...model.warnings, ...renderWarnings];
    onModelInfoChange?.({
      measureCount: model.measures.length,
      revision: model.revision,
      warnings: combinedWarnings,
    });
  }, [model, renderWarnings, onModelInfoChange]);

  // 监听容器宽度自适应排版系统
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    if (scrollEl.clientWidth > 0) {
      setContainerWidth(Math.round(scrollEl.clientWidth));
    }
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = Math.round(scrollEl.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        if (width > 0 && Math.abs(width - lastWidth) >= 20) {
          lastWidth = width;
          setContainerWidth(width);
        }
      }
    });
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, []);

  // 渲染五线谱
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
            availableWidth: containerWidth,
            onNoteClick: hasNoteClick ? handleNoteClick : undefined,
          },
          vexflow,
        );
        if (!active) {
          rendered.cleanup();
          return;
        }
        cleanup = rendered.cleanup;
        const noteRefs: Array<
          ScoreRenderedNoteRef & { isActive?: boolean; isSelected?: boolean }
        > = rendered.noteElementRefs.map((item) => ({
          ...item,
          isActive: undefined,
          isSelected: undefined,
        }));
        noteRefsRef.current = noteRefs;

        // 初始化发音高亮状态
        for (let i = 0; i < noteRefs.length; i++) {
          const item = noteRefs[i];
          const isSounding =
            isPlaying &&
            highlightMode !== "none" &&
            playheadTick >= item.fromTick &&
            playheadTick < item.toTick;
          item.isActive = isSounding;
          item.element.dataset.active = isSounding ? "true" : "false";
          item.element.classList.toggle("is-active", isSounding);

          const isSelected = Boolean(
            selectedNoteIds?.has(item.sourceNoteId),
          );
          item.isSelected = isSelected;
          item.element.dataset.selected = isSelected ? "true" : "false";
          item.element.classList.toggle("is-selected", isSelected);
        }
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
      noteRefsRef.current = [];
      cleanup?.();
    };
  }, [
    handleNoteClick,
    hasNoteClick,
    model,
    scale,
    containerWidth,
  ]);

  // 更新发音高亮与跟随走带（无需重新渲染 VexFlow）
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const systems = [
      ...surface.querySelectorAll<HTMLElement>(".score-preview-system"),
    ];
    let activeSystem: HTMLElement | undefined;
    systems.forEach((system) => {
      const fromTick = Number(system.dataset.fromTick);
      const toTick = Number(system.dataset.toTick);
      const isActive =
        isPlaying &&
        Number.isFinite(fromTick) &&
        Number.isFinite(toTick) &&
        playheadTick >= fromTick &&
        playheadTick < toTick;
      system.dataset.active = isActive ? "true" : "false";
      if (isActive) activeSystem = system;
    });

    if (followPlayhead && activeSystem) {
      activeSystem.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    const noteRefs = noteRefsRef.current;
    if (noteRefs.length > 0) {
      for (let i = 0; i < noteRefs.length; i++) {
        const item = noteRefs[i];
        const isSounding =
          isPlaying &&
          highlightMode !== "none" &&
          playheadTick >= item.fromTick &&
          playheadTick < item.toTick;
        if (item.isActive !== isSounding) {
          item.isActive = isSounding;
          item.element.dataset.active = isSounding ? "true" : "false";
          item.element.classList.toggle("is-active", isSounding);
        }
      }
    } else {
      const noteEls = surface.querySelectorAll<SVGElement>(".score-note");
      noteEls.forEach((el) => {
        const fromTick = Number(el.dataset.fromTick);
        const toTick = Number(el.dataset.toTick);
        const isSounding =
          isPlaying &&
          highlightMode !== "none" &&
          Number.isFinite(fromTick) &&
          Number.isFinite(toTick) &&
          playheadTick >= fromTick &&
          playheadTick < toTick;
        el.dataset.active = isSounding ? "true" : "false";
        el.classList.toggle("is-active", isSounding);
      });
    }
  }, [
    followPlayhead,
    playheadTick,
    isPlaying,
    highlightMode,
    model,
    scale,
    renderState,
  ]);

  // 更新选中音符状态（与上方 MIDI 钢琴卷帘选择状态同步）
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const noteRefs = noteRefsRef.current;
    if (noteRefs.length > 0) {
      for (let i = 0; i < noteRefs.length; i++) {
        const item = noteRefs[i];
        const isSelected = Boolean(selectedNoteIds?.has(item.sourceNoteId));
        if (item.isSelected !== isSelected) {
          item.isSelected = isSelected;
          item.element.dataset.selected = isSelected ? "true" : "false";
          item.element.classList.toggle("is-selected", isSelected);
        }
      }
    } else {
      const noteEls = surface.querySelectorAll<SVGElement>(".score-note");
      noteEls.forEach((el) => {
        const sourceNoteId = el.dataset.sourceNoteId;
        const isSelected = Boolean(
          sourceNoteId && selectedNoteIds?.has(sourceNoteId),
        );
        el.dataset.selected = isSelected ? "true" : "false";
        el.classList.toggle("is-selected", isSelected);
      });
    }
  }, [selectedNoteIds]);

  const combinedWarnings = [...model.warnings, ...renderWarnings];

  return (
    <div className="score-preview-pane">
      {combinedWarnings.length > 0 ? (
        <div className="score-preview-warning" role="status">
          <strong>预览提示 {combinedWarnings.length}</strong>
          <span>
            {combinedWarnings
              .slice(0, 3)
              .map((item) => item.message)
              .join("；")}
          </span>
          {combinedWarnings.length > 3 ? (
            <span>其余提示已省略</span>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
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
        <div
          ref={surfaceRef}
          className="score-preview-surface"
          data-highlight-mode={highlightMode}
        />
      </div>
    </div>
  );
}
