import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { resolveAuxiliaryTrackColor, type AuxiliaryTrack } from "../../domain/project";
import type { ScoreHighlightMode } from "./ScorePreviewPane";

interface AuxiliaryTrackPickerProps {
  auxiliaryTracks: readonly AuxiliaryTrack[];
  onToggleAuxiliaryTrack?(trackId: string, show: boolean): void;
  onSetAllAuxiliaryTracks?(show: boolean): void;
}

function AuxiliaryTrackPicker({
  auxiliaryTracks,
  onToggleAuxiliaryTrack,
  onSetAllAuxiliaryTracks,
}: AuxiliaryTrackPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const shown = auxiliaryTracks.filter((track) => track.showInScorePreview).length;

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover) return;
    const position = () => {
      const anchor = button.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      const above = anchor.top - gap - margin;
      const below = window.innerHeight - anchor.bottom - gap - margin;
      const placeBelow = below >= popover.scrollHeight || below >= above;
      const width = popover.offsetWidth;
      popover.style.left = `${Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin))}px`;
      popover.style.top = placeBelow ? `${anchor.bottom + gap}px` : "auto";
      popover.style.bottom = placeBelow ? "auto" : `${window.innerHeight - anchor.top + gap}px`;
      popover.style.maxHeight = `${Math.max(0, Math.min(320, placeBelow ? below : above))}px`;
    };
    position();
    popover.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!buttonRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="score-preview-aux-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        额外声部 {shown}/{auxiliaryTracks.length}
        <ChevronDown aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          className="score-preview-aux-popover"
          role="dialog"
          aria-label="五线谱额外声部"
          tabIndex={-1}
        >
          <div className="score-preview-aux-actions">
            <button type="button" disabled={!onSetAllAuxiliaryTracks || shown === auxiliaryTracks.length}
              onClick={() => onSetAllAuxiliaryTracks?.(true)}>
              全部显示
            </button>
            <button type="button" disabled={!onSetAllAuxiliaryTracks || shown === 0}
              onClick={() => onSetAllAuxiliaryTracks?.(false)}>
              全部隐藏
            </button>
          </div>
          <div className="score-preview-aux-list">
            {auxiliaryTracks.map((track, index) => (
              <label key={track.id} className="score-preview-aux-row">
                <input
                  type="checkbox"
                  checked={Boolean(track.showInScorePreview)}
                  disabled={!onToggleAuxiliaryTrack}
                  onChange={(event) => onToggleAuxiliaryTrack?.(track.id, event.target.checked)}
                />
                <span className="score-preview-aux-swatch" aria-hidden="true"
                  style={{ backgroundColor: resolveAuxiliaryTrackColor(track, index) }} />
                <span className="score-preview-aux-name" title={track.name}>{track.name}</span>
                <span className="score-preview-aux-count">{track.notes.length} 个音符</span>
              </label>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

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
  auxiliaryTracks?: AuxiliaryTrackPickerProps["auxiliaryTracks"];
  onToggleAuxiliaryTrack?: AuxiliaryTrackPickerProps["onToggleAuxiliaryTrack"];
  onSetAllAuxiliaryTracks?: AuxiliaryTrackPickerProps["onSetAllAuxiliaryTracks"];
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
  auxiliaryTracks,
  onToggleAuxiliaryTrack,
  onSetAllAuxiliaryTracks,
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
        {auxiliaryTracks?.length ? (
          <AuxiliaryTrackPicker
            auxiliaryTracks={auxiliaryTracks}
            onToggleAuxiliaryTrack={onToggleAuxiliaryTrack}
            onSetAllAuxiliaryTracks={onSetAllAuxiliaryTracks}
          />
        ) : null}
        {extra}
      </div>
    </div>
  );
}
