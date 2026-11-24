import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Music2, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { ProjectDocument } from "../../domain/project";
import type { ScoreNoteSelection } from "./vexflowRenderer";
import {
  getInitialHighlightMode,
  HIGHLIGHT_MODE_STORAGE_KEY,
  nextScale,
  SCALE_STEPS,
  ScorePreviewPane,
  type ScoreHighlightMode,
} from "./ScorePreviewPane";
import { ScorePreviewToolbar } from "./ScorePreviewToolbar";

export type { ScoreHighlightMode } from "./ScorePreviewPane";

export interface ScorePreviewDialogProps {
  project: ProjectDocument;
  revision: number;
  playheadTick: number;
  isPlaying?: boolean;
  selectedNoteIds?: ReadonlySet<string>;
  onClose(): void;
  onSelectNote?(selection: ScoreNoteSelection): void;
  onToggleAuxiliaryTrack?(trackId: string, show: boolean): void;
  onSetAllAuxiliaryTracks?(show: boolean): void;
}

export function ScorePreviewDialog({
  project,
  revision,
  playheadTick,
  isPlaying = false,
  selectedNoteIds,
  onClose,
  onSelectNote,
  onToggleAuxiliaryTrack,
  onSetAllAuxiliaryTracks,
}: ScorePreviewDialogProps) {
  const [scale, setScale] = useState(1);
  const [followPlayhead, setFollowPlayhead] = useState(false);
  const [highlightMode, setHighlightModeState] = useState<ScoreHighlightMode>(
    getInitialHighlightMode,
  );
  const [modelInfo, setModelInfo] = useState<{
    measureCount: number;
    revision: number;
  }>({
    measureCount: 0,
    revision,
  });

  const setHighlightMode = useCallback((mode: ScoreHighlightMode) => {
    setHighlightModeState(mode);
    try {
      window.localStorage.setItem(HIGHLIGHT_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  }, []);

  const canZoomIn = scale < SCALE_STEPS[SCALE_STEPS.length - 1];
  const canZoomOut = scale > SCALE_STEPS[0];
  const shownAuxiliaryCount = project.auxiliaryTracks.filter((track) => track.showInScorePreview).length;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
              <p>
                只读钢琴大谱表 · S/A 高音谱表 · T/B 低音谱表
                {shownAuxiliaryCount > 0 ? ` · 含 ${shownAuxiliaryCount} 条额外声部` : ""}
              </p>
            </div>
          </div>
          <IconButton label="关闭五线谱预览" icon={<X />} onClick={onClose} />
        </header>

        <ScorePreviewToolbar
          scale={scale}
          canZoomIn={canZoomIn}
          canZoomOut={canZoomOut}
          onZoomIn={() => setScale((v) => nextScale(v, 1))}
          onZoomOut={() => setScale((v) => nextScale(v, -1))}
          followPlayhead={followPlayhead}
          onFollowPlayheadChange={setFollowPlayhead}
          highlightMode={highlightMode}
          onHighlightModeChange={setHighlightMode}
          measureCount={modelInfo.measureCount}
          revision={modelInfo.revision}
          auxiliaryTracks={project.auxiliaryTracks}
          onToggleAuxiliaryTrack={onToggleAuxiliaryTrack}
          onSetAllAuxiliaryTracks={onSetAllAuxiliaryTracks}
        />

        <ScorePreviewPane
          project={project}
          revision={revision}
          playheadTick={playheadTick}
          isPlaying={isPlaying}
          selectedNoteIds={selectedNoteIds}
          scale={scale}
          followPlayhead={followPlayhead}
          highlightMode={highlightMode}
          onSelectNote={onSelectNote}
          onModelInfoChange={setModelInfo}
        />
      </section>
    </div>,
    document.body,
  );
}
