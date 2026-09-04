import type { ReactNode } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { ScoreHighlightMode } from "./ScorePreviewPane";

export interface ScorePreviewToolbarProps {
  scale: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  followPlayhead: boolean;
  onFollowPlayheadChange(follow: boolean): void;
  highlightMode: ScoreHighlightMode;
  onHighlightModeChange(mode: ScoreHighlightMode): void;
  measureCount?: number;
  revision?: number;
  extra?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function ScorePreviewToolbar({
  scale,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  followPlayhead,
  onFollowPlayheadChange,
  highlightMode,
  onHighlightModeChange,
  measureCount,
  revision,
  extra,
  className = "",
  compact = false,
}: ScorePreviewToolbarProps) {
  return (
    <div className={`score-preview-toolbar ${compact ? "compact" : ""} ${className}`}>
      {measureCount !== undefined && revision !== undefined ? (
        <span className="score-preview-meta">
          {measureCount} 小节 · rev {revision}
        </span>
      ) : null}
      <div className="score-preview-actions">
        <IconButton
          label="缩小谱面"
          icon={<ZoomOut />}
          disabled={!canZoomOut}
          onClick={onZoomOut}
        />
        <span className="score-preview-scale">{Math.round(scale * 100)}%</span>
        <IconButton
          label="放大谱面"
          icon={<ZoomIn />}
          disabled={!canZoomIn}
          onClick={onZoomIn}
        />
        <label className="score-preview-follow">
          <input
            type="checkbox"
            checked={followPlayhead}
            onChange={(event) => onFollowPlayheadChange(event.target.checked)}
          />
          <span>跟随走带</span>
        </label>
        <label className="score-preview-highlight-select">
          <span>高亮</span>
          <select
            value={highlightMode}
            onChange={(event) =>
              onHighlightModeChange(event.target.value as ScoreHighlightMode)
            }
          >
            <option value="color">彩色高亮</option>
            <option value="monochrome">纯色高亮</option>
            <option value="none">不高亮</option>
          </select>
        </label>
        {extra}
      </div>
    </div>
  );
}
