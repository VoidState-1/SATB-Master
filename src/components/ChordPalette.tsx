import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { formatChord, isSeventhChord } from "../domain/chords";
import type { ChordDraft, KeyEvent } from "../domain/model";
import {
  CHORD_ACCIDENTAL_OPTIONS,
  CHORD_APPLIED_OPTIONS,
  CHORD_DEGREE_OPTIONS,
  CHORD_INVERSION_OPTIONS,
  CHORD_QUALITY_OPTIONS,
} from "./chordAnalysisOptions";

interface ChordPaletteProps {
  draft: ChordDraft;
  keyEvent: KeyEvent;
  anchor: { x: number; y: number };
  onChange(patch: Partial<ChordDraft>): void;
  onClose(): void;
}

export function ChordPalette({
  draft,
  keyEvent,
  anchor,
  onChange,
  onClose,
}: ChordPaletteProps) {
  const paletteRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(anchor);
  const formatted = formatChord(draft, keyEvent);
  const seventhChord = isSeventhChord(draft.quality);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const palette = paletteRef.current;
      if (!palette) return;
      const margin = 8;
      const gap = 7;
      const rect = palette.getBoundingClientRect();
      const left = Math.max(
        margin,
        Math.min(anchor.x, window.innerWidth - rect.width - margin),
      );
      const below = anchor.y + gap;
      const top =
        below + rect.height <= window.innerHeight - margin
          ? below
          : Math.max(margin, anchor.y - rect.height - gap);
      setPosition({ x: left, y: top });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [anchor, seventhChord]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!paletteRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <aside
      ref={paletteRef}
      className="chord-palette"
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="和弦设置"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="chord-palette-header">
        <span>和弦设置</span>
        <div className="chord-palette-name" aria-live="polite">
          <strong>{formatted.roman}</strong>
          <small>{formatted.absolute}</small>
        </div>
        <button
          type="button"
          className="chord-palette-close"
          aria-label="关闭和弦设置"
          title="关闭"
          onClick={onClose}
        >
          <X />
        </button>
      </header>

      <div className="chord-palette-columns">
        <section
          className="chord-palette-column"
          aria-labelledby="palette-degree-title"
        >
          <h3 id="palette-degree-title">级数</h3>
          {CHORD_DEGREE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={draft.degree === option.value ? "is-selected" : ""}
              aria-pressed={draft.degree === option.value}
              onClick={() => onChange({ degree: option.value })}
            >
              {option.label}
            </button>
          ))}
        </section>

        <section
          className="chord-palette-column"
          aria-labelledby="palette-accidental-title"
        >
          <h3 id="palette-accidental-title">变化音</h3>
          {CHORD_ACCIDENTAL_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.title}
              className={
                draft.degreeAlteration === option.value ? "is-selected" : ""
              }
              aria-pressed={draft.degreeAlteration === option.value}
              onClick={() => onChange({ degreeAlteration: option.value })}
            >
              {option.label}
            </button>
          ))}
        </section>

        <section
          className="chord-palette-column quality"
          aria-labelledby="palette-quality-title"
        >
          <h3 id="palette-quality-title">和弦性质</h3>
          {CHORD_QUALITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.label}
              className={draft.quality === option.value ? "is-selected" : ""}
              aria-pressed={draft.quality === option.value}
              onClick={() =>
                onChange({
                  quality: option.value,
                  inversion: Math.min(
                    draft.inversion,
                    isSeventhChord(option.value) ? 3 : 2,
                  ) as ChordDraft["inversion"],
                })
              }
            >
              {option.shortLabel}
            </button>
          ))}
        </section>

        <section
          className="chord-palette-column"
          aria-labelledby="palette-inversion-title"
        >
          <h3 id="palette-inversion-title">转位</h3>
          {CHORD_INVERSION_OPTIONS.map((option) => {
            const unavailable = option.value === 3 && !seventhChord;
            return (
              <button
                key={option.value}
                type="button"
                disabled={unavailable}
                className={
                  draft.inversion === option.value ? "is-selected" : ""
                }
                aria-pressed={draft.inversion === option.value}
                onClick={() => onChange({ inversion: option.value })}
              >
                {option.label}
              </button>
            );
          })}
        </section>

        <section
          className="chord-palette-column"
          aria-labelledby="palette-applied-title"
        >
          <h3 id="palette-applied-title">副属目标</h3>
          {CHORD_APPLIED_OPTIONS.map((option) => (
            <button
              key={option.value ?? "none"}
              type="button"
              className={
                draft.appliedTarget === option.value
                  ? "is-selected"
                  : ""
              }
              aria-pressed={draft.appliedTarget === option.value}
              onClick={() =>
                onChange({
                  appliedTarget: option.value,
                })
              }
            >
              {option.label}
            </button>
          ))}
        </section>
      </div>
    </aside>,
    document.body,
  );
}
