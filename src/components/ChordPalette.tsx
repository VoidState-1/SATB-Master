import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  chordIdentityInversion,
  primaryHarmonyInterpretation,
  resolveChordIdentity,
  semanticsFromChordDraft,
} from "../domain/chordModel";
import { formatChord, isSeventhChord } from "../domain/chords";
import {
  FUNCTIONAL_BASE_DEFINITIONS,
  FUNCTIONAL_TARGET_OPTIONS,
  applyFunctionalDefinition,
  applyFunctionalForm,
  applyFunctionalTarget,
  chordFormFromDraft,
  compatibleFunctionalInterpretations,
  functionalBaseIdFromDraft,
  functionalDefinition,
  functionalScopeForForm,
  inversionFigures,
  type FunctionalBaseId,
  type FunctionalChordForm,
} from "../domain/functionalHarmonyCatalog";
import type { ChordDraft, KeyEvent, KeyReference } from "../domain/model";
import {
  formatPitchClass,
  keyTonicOptions,
  parsePitchClass,
  scaleDegreePitchClass,
  serializePitchClass,
} from "../domain/pitch";
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

const FORM_LABELS: Record<FunctionalChordForm, string> = {
  triad: "三和弦",
  seventh: "七和弦",
  ninth: "九和弦",
};

const TONE_ALTERATIONS: ReadonlyArray<{
  label: string;
  degree?: 5 | 9;
  alter?: -1 | 1;
  tendency?: "up" | "down";
}> = [
  { label: "无" },
  { label: "♭5", degree: 5, alter: -1, tendency: "down" },
  { label: "♯5", degree: 5, alter: 1, tendency: "up" },
  { label: "♭9", degree: 9, alter: -1, tendency: "down" },
  { label: "♯9", degree: 9, alter: 1, tendency: "up" },
];

function maximumInversion(draft: ChordDraft) {
  if (draft.augmentedSixthVariant || draft.extensions?.includes(9)) return 0;
  return isSeventhChord(draft.quality) ? 3 : 2;
}

function keyReference(event: KeyEvent): KeyReference {
  return { tonic: event.tonic, mode: event.mode };
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
  const [view, setView] = useState<PaletteView>("functional");
  const formatted = formatChord(draft, keyEvent);
  const baseId = functionalBaseIdFromDraft(draft);
  const baseDefinition = baseId ? functionalDefinition(baseId) : undefined;
  const form = chordFormFromDraft(draft);
  const inversionLimit = maximumInversion(draft);
  const canApplyTarget = baseId === "D" || baseId === "DVII";
  const canAlterTone = baseId === "D" || baseId === "DD";
  const secondary = draft.secondaryInterpretation;
  const currentIdentity = resolveChordIdentity(draft, keyEvent);
  const identitySignature = JSON.stringify(currentIdentity);
  const primary = primaryHarmonyInterpretation(semanticsFromChordDraft(draft));
  const primaryLocalKey = primary.localKey ?? keyReference(keyEvent);
  const interpretationMatches = (
    left: typeof primary,
    right: typeof primary,
    rightFallback = primaryLocalKey,
  ) => {
    const leftKey = left.localKey ?? primaryLocalKey;
    const rightKey = right.localKey ?? rightFallback;
    return (
      serializePitchClass(leftKey.tonic) === serializePitchClass(rightKey.tonic) &&
      leftKey.mode === rightKey.mode &&
      left.degree === right.degree &&
      left.degreeAlteration === right.degreeAlteration &&
      JSON.stringify(left.appliedTarget) === JSON.stringify(right.appliedTarget) &&
      JSON.stringify(left.designation) === JSON.stringify(right.designation)
    );
  };
  const compatibleCandidates = useMemo(
    () => compatibleFunctionalInterpretations(currentIdentity),
    [identitySignature],
  );
  const secondaryCandidates = compatibleCandidates.filter(
    (candidate) =>
      !interpretationMatches(candidate.interpretation, primary, primaryLocalKey),
  );
  const selectedSecondaryCandidate = secondary
    ? secondaryCandidates.find((candidate) =>
        interpretationMatches(candidate.interpretation, secondary),
      )
    : undefined;
  const secondaryKeyOptions = [
    ...new Map(
      secondaryCandidates.map((candidate) => [
        `${serializePitchClass(candidate.localKey.tonic)}:${candidate.localKey.mode}`,
        candidate,
      ]),
    ).values(),
  ];

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
      applyFunctionalDefinition(
        draft,
        functionalDefinition(id),
        keyEvent.mode,
      ),
    );
  };

  const setSecondaryEnabled = (enabled: boolean) => {
    if (!enabled) {
      onChange({ secondaryInterpretation: undefined });
      return;
    }
    onChange({ secondaryInterpretation: secondaryCandidates[0]?.interpretation });
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
              onChange({
                degree: option.value,
                designation: undefined,
                secondaryInterpretation: undefined,
              })
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
              onChange({
                degreeAlteration: option.value,
                designation: undefined,
                secondaryInterpretation: undefined,
              })
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
              onChange({
                quality: option.value,
                extensions: [],
                augmentedSixthVariant: undefined,
                inversion: Math.min(
                  draft.inversion,
                  isSeventhChord(option.value) ? 3 : 2,
                ) as ChordDraft["inversion"],
                designation: undefined,
                secondaryInterpretation: undefined,
              })
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
              onChange({
                inversion: option.value,
                secondaryInterpretation: undefined,
              })
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
              onChange({
                appliedTarget: option.value,
                appliedTargetFunction: undefined,
                designation: undefined,
                secondaryInterpretation: undefined,
              })
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
          <small>{formatted.roman} · {formatted.absolute}</small>
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

      <div className="chord-palette-modes" role="tablist" aria-label="和弦编辑体系">
        {([
          ["functional", "功能"],
          ["roman", "级数"],
          ["absolute", "绝对"],
        ] as const).map(([value, label]) => (
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
                      applyFunctionalForm(
                        draft,
                        baseDefinition,
                        option,
                        keyEvent.mode,
                      ),
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
                    onChange({
                      inversion: option.value,
                      secondaryInterpretation: undefined,
                    })
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
                onClick={() => onChange(applyFunctionalTarget(draft, undefined))}
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
                    onChange(applyFunctionalTarget(draft, option.target))
                  }
                >
                  {option.label}
                </button>
              ))}
            </section>

            <section className="chord-palette-column">
              <h3>构成音变化</h3>
              {TONE_ALTERATIONS.map((option) => {
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
                      const altered = Boolean(option.degree && option.alter);
                      onChange({
                        alterations:
                          altered
                            ? [
                                {
                                  degree: option.degree!,
                                  alter: option.alter!,
                                  tendency: option.tendency!,
                                },
                              ]
                            : [],
                        designation:
                          baseId === "D" && draft.designation
                            ? {
                                ...draft.designation,
                                kind: altered
                                  ? "altered-dominant"
                                  : draft.appliedTarget
                                    ? "applied-dominant"
                                    : "primary",
                              }
                            : draft.designation,
                        secondaryInterpretation: undefined,
                      });
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
                  onChange({
                    mixture: (event.target.value || undefined) as ChordDraft["mixture"],
                  })
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
                  onChange({
                    pedalContext: event.target.value
                      ? {
                          pitch: draft.pedalContext?.pitch ?? currentIdentity.bass,
                          role: event.target.value as NonNullable<
                            ChordDraft["pedalContext"]
                          >["role"],
                        }
                      : undefined,
                  })
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
                      onChange({
                        pedalContext: { ...draft.pedalContext!, pitch },
                      });
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
                        onChange({
                          secondaryInterpretation: candidate.interpretation,
                        });
                    }}
                  >
                    {secondaryKeyOptions.map((candidate) => (
                        <option
                          key={`${serializePitchClass(candidate.localKey.tonic)}:${candidate.localKey.mode}`}
                          value={`${serializePitchClass(candidate.localKey.tonic)}:${candidate.localKey.mode}`}
                        >
                          {formatPitchClass(candidate.localKey.tonic)} {candidate.localKey.mode === "major" ? "大调" : "小调"}
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
                        onChange({
                          secondaryInterpretation: candidate.interpretation,
                        });
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
      ) : structuralColumns(view === "absolute")}
    </aside>,
    document.body,
  );
}
