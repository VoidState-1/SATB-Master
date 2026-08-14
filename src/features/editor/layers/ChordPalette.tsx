import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  chordIdentityInversion,
  resolveChordIdentity,
} from "../../../domain/chordModel";
import { formatChord } from "../../../domain/chords";
import {
  FUNCTIONAL_BASE_DEFINITIONS,
  FUNCTIONAL_TARGET_OPTIONS,
  functionalScopeForForm,
  inversionFigures,
  type FunctionalBaseId,
} from "../../../domain/functionalHarmonyCatalog";
import {
  CHORD_TONE_ALTERATIONS,
  applyChordEditorAction,
  createChordEditorModel,
} from "../../../domain/chordEditorModel";
import type {
  ChordDraft,
  KeyEvent,
} from "../../../domain/project";
import {
  formatPitchClass,
  keyTonicOptions,
  parsePitchClass,
  scaleDegreePitchClass,
  serializePitchClass,
} from "../../../domain/pitch";
import {
  CHORD_ACCIDENTAL_OPTIONS,
  CHORD_APPLIED_OPTIONS,
  CHORD_DEGREE_OPTIONS,
  CHORD_INVERSION_OPTIONS,
  CHORD_QUALITY_OPTIONS,
} from "./chordAnalysisOptions";

type PaletteView = "functional" | "roman" | "absolute";

interface ChordPaletteProps {
  draft: ChordDraft;
  keyEvent: KeyEvent;
  anchor: { x: number; y: number };
  onChange(patch: Partial<ChordDraft>): void;
  onClose(): void;
}

const FORM_LABELS = {
  triad: "三和弦",
  seventh: "七和弦",
  ninth: "九和弦",
};

export function ChordPalette({
  draft,
  keyEvent,
  anchor,
  onChange,
  onClose,
}: ChordPaletteProps) {
  const paletteRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(anchor);
  const [view, setView] = useState<PaletteView>("functional");
  const formatted = formatChord(draft, keyEvent);
  const model = createChordEditorModel(draft, keyEvent);
  const {
    baseId,
    baseDefinition,
    form,
    maximumInversion: inversionLimit,
    canApplyTarget,
    canAlterTone,
    secondaryCandidates,
    selectedSecondaryCandidate,
    secondaryKeyOptions,
  } = model;
  const secondary = draft.secondaryInterpretation;
  const currentIdentity = resolveChordIdentity(draft, keyEvent);

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
  }, [anchor, view, baseId, form, Boolean(secondary)]);

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

  const selectDefinition = (id: FunctionalBaseId) => {
    onChange(
      applyChordEditorAction(draft, keyEvent, {
        type: "select-functional-definition",
        id,
      }),
    );
  };

  const setSecondaryEnabled = (enabled: boolean) => {
    onChange(
      applyChordEditorAction(draft, keyEvent, {
        type: "set-secondary-enabled",
        enabled,
      }),
    );
  };
  const structuralColumns = (absolute: boolean) => (
    <div className="chord-palette-columns is-structural">
      <section className="chord-palette-column">
        <h3>{absolute ? "根音" : "级数"}</h3>
        {CHORD_DEGREE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={draft.degree === option.value ? "is-selected" : ""}
            aria-pressed={draft.degree === option.value}
            onClick={() =>
              onChange(
                applyChordEditorAction(draft, keyEvent, {
                  type: "set-degree",
                  degree: option.value,
                }),
              )
            }
          >
            {absolute
              ? formatPitchClass(
                  scaleDegreePitchClass(
                    keyEvent,
                    option.value,
                    draft.degreeAlteration,
                  ),
                )
              : option.label}
          </button>
        ))}
      </section>

      <section className="chord-palette-column">
        <h3>变化音</h3>
        {CHORD_ACCIDENTAL_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.title}
            className={
              draft.degreeAlteration === option.value ? "is-selected" : ""
            }
            aria-pressed={draft.degreeAlteration === option.value}
            onClick={() =>
              onChange(
                applyChordEditorAction(draft, keyEvent, {
                  type: "set-degree-alteration",
                  alteration: option.value,
                }),
              )
            }
          >
            {option.label}
          </button>
        ))}
      </section>

      <section className="chord-palette-column quality">
        <h3>和弦性质</h3>
        {CHORD_QUALITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.label}
            className={draft.quality === option.value ? "is-selected" : ""}
            aria-pressed={draft.quality === option.value}
            onClick={() =>
              onChange(
                applyChordEditorAction(draft, keyEvent, {
                  type: "set-quality",
                  quality: option.value,
                }),
              )
            }
          >
            {option.shortLabel}
          </button>
        ))}
      </section>

      <section className="chord-palette-column">
        <h3>转位</h3>
        {CHORD_INVERSION_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={option.value > inversionLimit}
            className={draft.inversion === option.value ? "is-selected" : ""}
            aria-pressed={draft.inversion === option.value}
            onClick={() =>
              onChange(
                applyChordEditorAction(draft, keyEvent, {
                  type: "set-inversion",
                  inversion: option.value,
                }),
              )
            }
          >
            {option.label}
          </button>
        ))}
      </section>

      <section className="chord-palette-column">
        <h3>副属目标</h3>
        {CHORD_APPLIED_OPTIONS.map((option) => (
          <button
            key={option.value ?? "none"}
            type="button"
            className={
              draft.appliedTarget === option.value ? "is-selected" : ""
            }
            aria-pressed={draft.appliedTarget === option.value}
            onClick={() =>
              onChange(
                applyChordEditorAction(draft, keyEvent, {
                  type: "set-structural-applied-target",
                  degree: option.value,
                }),
              )
            }
          >
            {option.label}
          </button>
        ))}
      </section>
    </div>
  );

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
          <strong>{formatted.functional}</strong>
          <small>
            {formatted.roman} · {formatted.absolute}
          </small>
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

      <div
        className="chord-palette-modes"
        role="tablist"
        aria-label="和弦编辑体系"
      >
        {(
          [
            ["functional", "功能"],
            ["roman", "级数"],
            ["absolute", "绝对"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            className={view === value ? "is-selected" : ""}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "functional" ? (
        <>
          <div className="chord-palette-columns is-functional">
            <section className="chord-palette-column functional-base">
              <h3>功能</h3>
              {FUNCTIONAL_BASE_DEFINITIONS.map((definition) => (
                <button
                  key={definition.id}
                  type="button"
                  title={`${definition.title} · 范围 ${functionalScopeForForm(
                    definition,
                    definition.forms[0],
                  )}`}
                  className={baseId === definition.id ? "is-selected" : ""}
                  aria-pressed={baseId === definition.id}
                  onClick={() => selectDefinition(definition.id)}
                >
                  {definition.label}
                </button>
              ))}
            </section>

            <section className="chord-palette-column">
              <h3>形态</h3>
              {(baseDefinition?.forms ?? ["triad"]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={form === option ? "is-selected" : ""}
                  aria-pressed={form === option}
                  onClick={() =>
                    baseDefinition &&
                    onChange(
                      applyChordEditorAction(draft, keyEvent, {
                        type: "select-functional-form",
                        form: option,
                      }),
                    )
                  }
                >
                  {FORM_LABELS[option]}
                </button>
              ))}
            </section>

            <section className="chord-palette-column">
              <h3>转位</h3>
              {CHORD_INVERSION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={
                    option.value > inversionLimit ||
                    (baseDefinition?.fixedInversion !== undefined &&
                      option.value !== baseDefinition.fixedInversion)
                  }
                  className={
                    draft.inversion === option.value ? "is-selected" : ""
                  }
                  aria-pressed={draft.inversion === option.value}
                  onClick={() =>
                    onChange(
                      applyChordEditorAction(draft, keyEvent, {
                        type: "set-inversion",
                        inversion: option.value,
                      }),
                    )
                  }
                >
                  {option.label}
                </button>
              ))}
            </section>

            <section className="chord-palette-column">
              <h3>离调目标</h3>
              <button
                type="button"
                disabled={!canApplyTarget}
                className={!draft.appliedTarget ? "is-selected" : ""}
                onClick={() =>
                  onChange(
                    applyChordEditorAction(draft, keyEvent, {
                      type: "set-applied-target",
                    }),
                  )
                }
              >
                无
              </button>
              {FUNCTIONAL_TARGET_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={!canApplyTarget}
                  className={
                    draft.appliedTarget === option.target.degree
                      ? "is-selected"
                      : ""
                  }
                  onClick={() =>
                    onChange(
                      applyChordEditorAction(draft, keyEvent, {
                        type: "set-applied-target",
                        degree: option.target.degree,
                      }),
                    )
                  }
                >
                  {option.label}
                </button>
              ))}
            </section>

            <section className="chord-palette-column">
              <h3>构成音变化</h3>
              {CHORD_TONE_ALTERATIONS.map((option) => {
                const selected = option.degree
                  ? draft.alterations?.some(
                      (item) =>
                        item.degree === option.degree &&
                        item.alter === option.alter,
                    )
                  : !draft.alterations?.length;
                return (
                  <button
                    key={option.label}
                    type="button"
                    disabled={!canAlterTone}
                    className={selected ? "is-selected" : ""}
                    onClick={() => {
                      onChange(
                        applyChordEditorAction(draft, keyEvent, {
                          type: "set-tone-alteration",
                          choice: option,
                        }),
                      );
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </section>
          </div>

          <div className="chord-palette-context">
            <label>
              <span>借用</span>
              <select
                value={draft.mixture ?? ""}
                onChange={(event) =>
                  onChange(
                    applyChordEditorAction(draft, keyEvent, {
                      type: "set-mixture",
                      mixture: (event.target.value ||
                        undefined) as ChordDraft["mixture"],
                    }),
                  )
                }
              >
                <option value="">无</option>
                <option value="parallel-major">同主大调</option>
                <option value="parallel-minor">同主小调</option>
                <option value="modal">调式借用</option>
              </select>
            </label>
            <label>
              <span>持续低音</span>
              <select
                value={draft.pedalContext?.role ?? ""}
                onChange={(event) =>
                  onChange(
                    applyChordEditorAction(draft, keyEvent, {
                      type: "set-pedal-role",
                      role: (event.target.value || undefined) as
                        | NonNullable<ChordDraft["pedalContext"]>["role"]
                        | undefined,
                    }),
                  )
                }
              >
                <option value="">无</option>
                <option value="start">开始</option>
                <option value="continue">持续</option>
                <option value="end">结束</option>
              </select>
            </label>
            {draft.pedalContext ? (
              <label>
                <span>低音音高</span>
                <select
                  value={serializePitchClass(draft.pedalContext.pitch)}
                  onChange={(event) => {
                    const pitch = parsePitchClass(event.target.value);
                    if (pitch)
                      onChange(
                        applyChordEditorAction(draft, keyEvent, {
                          type: "set-pedal-pitch",
                          pitch,
                        }),
                      );
                  }}
                >
                  {keyTonicOptions(keyEvent.mode).map((option) => (
                    <option
                      key={serializePitchClass(option)}
                      value={serializePitchClass(option)}
                    >
                      {formatPitchClass(option)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="toggle-row compact">
              <span>共同和弦</span>
              <input
                type="checkbox"
                checked={Boolean(secondary)}
                disabled={secondaryCandidates.length === 0}
                onChange={(event) => setSecondaryEnabled(event.target.checked)}
              />
            </label>
            {secondary ? (
              <>
                <label>
                  <span>第二调性</span>
                  <select
                    value={
                      selectedSecondaryCandidate
                        ? `${serializePitchClass(
                            selectedSecondaryCandidate.localKey.tonic,
                          )}:${selectedSecondaryCandidate.localKey.mode}`
                        : ""
                    }
                    onChange={(event) => {
                      const candidate = secondaryKeyOptions.find(
                        (item) =>
                          `${serializePitchClass(item.localKey.tonic)}:${item.localKey.mode}` ===
                          event.target.value,
                      );
                      if (candidate)
                        onChange(
                          applyChordEditorAction(draft, keyEvent, {
                            type: "select-secondary",
                            candidateId: candidate.id,
                          }),
                        );
                    }}
                  >
                    {secondaryKeyOptions.map((candidate) => (
                      <option
                        key={`${serializePitchClass(candidate.localKey.tonic)}:${candidate.localKey.mode}`}
                        value={`${serializePitchClass(candidate.localKey.tonic)}:${candidate.localKey.mode}`}
                      >
                        {formatPitchClass(candidate.localKey.tonic)}{" "}
                        {candidate.localKey.mode === "major" ? "大调" : "小调"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>第二功能</span>
                  <select
                    value={selectedSecondaryCandidate?.id ?? ""}
                    onChange={(event) => {
                      const candidate = secondaryCandidates.find(
                        (item) => item.id === event.target.value,
                      );
                      if (candidate)
                        onChange(
                          applyChordEditorAction(draft, keyEvent, {
                            type: "select-secondary",
                            candidateId: candidate.id,
                          }),
                        );
                    }}
                  >
                    {secondaryCandidates
                      .filter(
                        (candidate) =>
                          !selectedSecondaryCandidate ||
                          (serializePitchClass(candidate.localKey.tonic) ===
                            serializePitchClass(
                              selectedSecondaryCandidate.localKey.tonic,
                            ) &&
                            candidate.localKey.mode ===
                              selectedSecondaryCandidate.localKey.mode),
                      )
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.baseId}
                          {inversionFigures(
                            candidate.form,
                            chordIdentityInversion(currentIdentity),
                          )}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        </>
      ) : (
        structuralColumns(view === "absolute")
      )}
    </aside>,
    document.body,
  );
}
