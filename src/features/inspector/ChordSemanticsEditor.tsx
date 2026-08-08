import { useMemo } from "react";
import {
  chordIdentityInversion,
  primaryHarmonyInterpretation,
  resolveChordIdentity,
  semanticsFromChordDraft,
} from "../../domain/chordModel";
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
  inversionFigures,
  type FunctionalBaseId,
} from "../../domain/functionalHarmonyCatalog";
import type { ChordDraft, KeyEvent } from "../../domain/project";
import {
  formatPitchClass,
  keyTonicOptions,
  parsePitchClass,
  serializePitchClass,
} from "../../domain/pitch";

export function ChordSemanticsEditor({
  draft,
  keyEvent,
  onChange,
}: {
  draft: ChordDraft;
  keyEvent: KeyEvent;
  onChange(patch: Partial<ChordDraft>): void;
}) {
  const baseId = functionalBaseIdFromDraft(draft);
  const definition = baseId ? functionalDefinition(baseId) : undefined;
  const form = chordFormFromDraft(draft);
  const maximumInversion = draft.augmentedSixthVariant
    ? 0
    : draft.extensions?.includes(9)
      ? 0
      : form === "seventh"
        ? 3
        : 2;
  const secondary = draft.secondaryInterpretation;
  const identity = resolveChordIdentity(draft, keyEvent);
  const identitySignature = JSON.stringify(identity);
  const primary = primaryHarmonyInterpretation(semanticsFromChordDraft(draft));
  const primaryLocalKey = primary.localKey ?? {
    tonic: keyEvent.tonic,
    mode: keyEvent.mode,
  };
  const sameInterpretation = (
    left: typeof primary,
    right: typeof primary,
  ) => {
    const leftKey = left.localKey ?? primaryLocalKey;
    const rightKey = right.localKey ?? primaryLocalKey;
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
    () => compatibleFunctionalInterpretations(identity),
    [identitySignature],
  );
  const secondaryCandidates = compatibleCandidates.filter(
    (candidate) => !sameInterpretation(candidate.interpretation, primary),
  );
  const selectedSecondaryCandidate = secondary
    ? secondaryCandidates.find((candidate) =>
        sameInterpretation(candidate.interpretation, secondary),
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

  return (
    <>
      <label>
        <span>功能标记</span>
        <select
          value={baseId ?? ""}
          onChange={(event) =>
            onChange(
              applyFunctionalDefinition(
                draft,
                functionalDefinition(event.target.value as FunctionalBaseId),
                keyEvent.mode,
              ),
            )
          }
        >
          {!baseId ? <option value="">未指定</option> : null}
          {FUNCTIONAL_BASE_DEFINITIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} · {item.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>和弦形态</span>
        <select
          value={form}
          disabled={!definition || definition.forms.length === 1}
          onChange={(event) =>
            definition &&
            onChange(
              applyFunctionalForm(
                draft,
                definition,
                event.target.value as ReturnType<typeof chordFormFromDraft>,
                keyEvent.mode,
              ),
            )
          }
        >
          {(definition?.forms ?? [form]).map((item) => (
            <option key={item} value={item}>
              {item === "triad" ? "三和弦" : item === "seventh" ? "七和弦" : "九和弦"}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>转位</span>
        <select
          value={draft.inversion}
          onChange={(event) =>
            onChange({
              inversion: Number(
                event.target.value,
              ) as ChordDraft["inversion"],
              secondaryInterpretation: undefined,
            })
          }
        >
          <option value="0">原位</option>
          {maximumInversion >= 1 ? <option value="1">第一转位</option> : null}
          {maximumInversion >= 2 ? <option value="2">第二转位</option> : null}
          {maximumInversion === 3 ? <option value="3">第三转位</option> : null}
        </select>
      </label>
      <label>
        <span>离调目标</span>
        <select
          value={draft.appliedTarget ?? ""}
          disabled={baseId !== "D" && baseId !== "DVII"}
          onChange={(event) =>
            onChange(
              applyFunctionalTarget(
                draft,
                FUNCTIONAL_TARGET_OPTIONS.find(
                  (item) => item.target.degree === Number(event.target.value),
                )?.target,
              ),
            )
          }
        >
          <option value="">无</option>
          {FUNCTIONAL_TARGET_OPTIONS.map((item) => (
            <option key={item.id} value={item.target.degree}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
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
        <span>终止 / 六四角色</span>
        <select
          value={draft.cadenceRole ?? ""}
          onChange={(event) =>
            onChange({
              cadenceRole: (event.target.value || undefined) as
                | NonNullable<ChordDraft["cadenceRole"]>
                | undefined,
            })
          }
        >
          <option value="">无</option>
          <option value="deceptive">阻碍进行起点</option>
          <option value="cadential64">终止四六</option>
          <option value="passing64">经过四六</option>
          <option value="pedal64">辅助四六</option>
        </select>
      </label>
      <label>
        <span>构成音变化</span>
        <select
          value={
            draft.alterations?.[0]
              ? `${draft.alterations[0].degree}:${draft.alterations[0].alter}`
              : ""
          }
          disabled={baseId !== "D" && baseId !== "DD"}
          onChange={(event) => {
            const [degree, alter] = event.target.value
              .split(":")
              .map(Number);
            const altered = Boolean(event.target.value);
            onChange({
              alterations: altered
                ? [
                    {
                      degree: degree as 5 | 9,
                      alter: alter as -1 | 1,
                      tendency: alter > 0 ? "up" : "down",
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
          <option value="">无</option>
          <option value="5:-1">♭5</option>
          <option value="5:1">♯5</option>
          <option value="9:-1">♭9</option>
          <option value="9:1">♯9</option>
        </select>
      </label>
      <label>
        <span>解决方向</span>
        <select
          value={draft.alterations?.[0]?.tendency ?? ""}
          disabled={!draft.alterations?.[0]}
          onChange={(event) => {
            const alteration = draft.alterations?.[0];
            if (!alteration) return;
            onChange({
              alterations: [
                {
                  ...alteration,
                  tendency: (event.target.value || undefined) as
                    | "up"
                    | "down"
                    | undefined,
                },
              ],
              secondaryInterpretation: undefined,
            });
          }}
        >
          <option value="">未指定（不检查）</option>
          <option value="up">上行半音</option>
          <option value="down">下行半音</option>
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
                    pitch: draft.pedalContext?.pitch ?? identity.bass,
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
      <label className="toggle-row">
        <span>共同和弦双解释</span>
        <input
          type="checkbox"
          checked={Boolean(secondary)}
          disabled={secondaryCandidates.length === 0}
          onChange={(event) => {
            if (!event.target.checked) {
              onChange({ secondaryInterpretation: undefined });
              return;
            }
            onChange({
              secondaryInterpretation:
                secondaryCandidates[0]?.interpretation,
            });
          }}
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
                      chordIdentityInversion(identity),
                    )}
                  </option>
                ))}
            </select>
          </label>
        </>
      ) : null}
    </>
  );
}
