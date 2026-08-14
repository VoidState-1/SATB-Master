import {
  chordIdentityInversion,
  resolveChordIdentity,
} from "../../domain/chordModel";
import {
  FUNCTIONAL_BASE_DEFINITIONS,
  FUNCTIONAL_TARGET_OPTIONS,
  inversionFigures,
} from "../../domain/functionalHarmonyCatalog";
import {
  CHORD_TONE_ALTERATIONS,
  applyChordEditorAction,
  createChordEditorModel,
} from "../../domain/chordEditorModel";
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
  const model = createChordEditorModel(draft, keyEvent);
  const {
    baseId,
    baseDefinition: definition,
    form,
    maximumInversion,
    secondaryCandidates,
    selectedSecondaryCandidate,
    secondaryKeyOptions,
  } = model;
  const secondary = draft.secondaryInterpretation;
  const identity = resolveChordIdentity(draft, keyEvent);

  return (
    <>
      <label>
        <span>功能标记</span>
        <select
          value={baseId ?? ""}
          onChange={(event) =>
            onChange(
              applyChordEditorAction(draft, keyEvent, {
                type: "select-functional-definition",
                id: event.target.value as NonNullable<typeof baseId>,
              }),
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
            onChange(
              applyChordEditorAction(draft, keyEvent, {
                type: "select-functional-form",
                form: event.target.value as typeof form,
              }),
            )
          }
        >
          {(definition?.forms ?? [form]).map((item) => (
            <option key={item} value={item}>
              {item === "triad"
                ? "三和弦"
                : item === "seventh"
                  ? "七和弦"
                  : "九和弦"}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>转位</span>
        <select
          value={draft.inversion}
          onChange={(event) =>
            onChange(
              applyChordEditorAction(draft, keyEvent, {
                type: "set-inversion",
                inversion: Number(event.target.value) as ChordDraft["inversion"],
              }),
            )
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
              applyChordEditorAction(draft, keyEvent, {
                type: "set-applied-target",
                degree: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              }),
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
        <span>终止 / 六四角色</span>
        <select
          value={draft.cadenceRole ?? ""}
          onChange={(event) =>
            onChange(
              applyChordEditorAction(draft, keyEvent, {
                type: "set-cadence-role",
                cadenceRole: (event.target.value || undefined) as
                  | NonNullable<ChordDraft["cadenceRole"]>
                  | undefined,
              }),
            )
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
        <span>终止类型</span>
        <select
          value={draft.cadenceType ?? ""}
          onChange={(event) =>
            onChange(
              applyChordEditorAction(draft, keyEvent, {
                type: "set-cadence-type",
                cadenceType: (event.target.value || undefined) as
                  | NonNullable<ChordDraft["cadenceType"]>
                  | undefined,
              }),
            )
          }
        >
          <option value="">无</option>
          <option value="perfect-authentic">完全终止</option>
          <option value="imperfect-authentic">不完全终止</option>
          <option value="half">半终止</option>
          <option value="plagal">变格终止</option>
          <option value="deceptive">阻碍终止</option>
          <option value="open">开放结束</option>
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
            const choice = CHORD_TONE_ALTERATIONS.find((candidate) =>
              candidate.degree
                ? `${candidate.degree}:${candidate.alter}` === event.target.value
                : event.target.value === "",
            );
            if (choice)
              onChange(
                applyChordEditorAction(draft, keyEvent, {
                  type: "set-tone-alteration",
                  choice,
                }),
              );
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
            onChange(
              applyChordEditorAction(draft, keyEvent, {
                type: "set-alteration-tendency",
                tendency: (event.target.value || undefined) as
                  | "up"
                  | "down"
                  | undefined,
              }),
            );
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
      <label className="toggle-row">
        <span>共同和弦双解释</span>
        <input
          type="checkbox"
          checked={Boolean(secondary)}
          disabled={secondaryCandidates.length === 0}
          onChange={(event) => {
            onChange(
              applyChordEditorAction(draft, keyEvent, {
                type: "set-secondary-enabled",
                enabled: event.target.checked,
              }),
            );
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
