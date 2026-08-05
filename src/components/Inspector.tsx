import { useEffect, useMemo, useState, type InputHTMLAttributes } from "react";
import { FolderOpen, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import {
  chordDraftFromRegion,
  defaultChordDraftAtTick,
  formatChord,
  formatChordRegion,
} from "../domain/chords";
import {
  chordIdentityInversion,
  primaryHarmonyInterpretation,
  resolveChordIdentity,
  semanticsFromChordDraft,
} from "../domain/chordModel";
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
} from "../domain/functionalHarmonyCatalog";
import {
  VOICE_CONFIG,
  type Alteration,
  type ChordDraft,
  type ChordRegion,
  type DiatonicStep,
  type EditableRange,
  type KeyMode,
  type KeyEvent,
  type NoteEvent,
  type ProjectDocument,
  type SatbTrack,
  type VoiceId,
} from "../domain/model";
import {
  formatPitchClass,
  keyTonicOptions,
  parsePitchClass,
  serializePitchClass,
  spellMidi,
  toMidi,
} from "../domain/pitch";
import type { ChordRegionPatch } from "../domain/editing";
import {
  inspectChordRegion,
  inspectNoteEvent,
} from "../domain/developerInspection";
import {
  buildMeasures,
  formatPosition,
  keyAtTick,
  ticksForMeasures,
} from "../domain/time";
import { IconButton } from "./IconButton";
import { DeveloperEventInspector } from "./DeveloperEventInspector";

type InspectorTab = "selection" | "project" | "sound";

interface CommitFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> {
  value: string | number;
  onCommit(value: string): void;
}

function CommitField({ value, onCommit, ...props }: CommitFieldProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface InspectorProps {
  project: ProjectDocument;
  activeVoice: VoiceId;
  selectedNote?: { voiceId: VoiceId; note: NoteEvent };
  selectedChord?: ChordRegion;
  selectedChordIds: Set<string>;
  selectedChordCount: number;
  developerMode: boolean;
  chordBrush: ChordDraft;
  playheadTick: number;
  audioStatus: string;
  soundFontSize?: string;
  soundFontLoad?: { percent: number; detail: string };
  onUpdateProject(
    patch: Partial<
      Pick<ProjectDocument, "title" | "author" | "notes" | "lengthTicks">
    >,
  ): void;
  onUpdateInstructions(instructions: string): void;
  onAddEditableRange(): void;
  onUpdateEditableRange(rangeId: string, patch: Partial<EditableRange>): void;
  onDeleteEditableRange(rangeId: string): void;
  onUpdateNote(
    voiceId: VoiceId,
    noteId: string,
    patch: Partial<NoteEvent>,
  ): void;
  onUpdateChord(chordId: string, patch: ChordRegionPatch): void;
  onDeleteChords(chordIds: Set<string>): void;
  onUpdateChordBrush(patch: Partial<ChordDraft>): void;
  onUpdateChordTrack(
    patch: Partial<
      Pick<ProjectDocument["chordTrack"], "visible" | "locked" | "displayMode">
    >,
  ): void;
  onAddTimingEvent(type: "tempo" | "meter" | "key"): void;
  onUpdateTimingEvent(
    type: "tempo" | "meter" | "key",
    id: string,
    patch: Record<string, string | number>,
  ): void;
  onDeleteTimingEvent(type: "tempo" | "meter" | "key", id: string): void;
  onUpdateAudio(masterVolume: number): void;
  onUpdateTrack(voiceId: VoiceId, patch: Partial<SatbTrack>): void;
  onChooseSoundFont(): void;
  onUseDefaultSoundFont(): void;
}

const nonChordToneOptions = [
  ["passing", "经过音"],
  ["neighbor", "辅助音"],
  ["suspension", "延留音"],
  ["appoggiatura", "倚音"],
  ["anticipation", "先现音"],
  ["escape", "逃逸音"],
  ["pedal", "持续音"],
  ["other", "其他"],
] as const;

function ChordSemanticsEditor({
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

export function Inspector({
  project,
  activeVoice,
  selectedNote,
  selectedChord,
  selectedChordIds,
  selectedChordCount,
  developerMode,
  chordBrush,
  playheadTick,
  audioStatus,
  soundFontSize,
  soundFontLoad,
  onUpdateProject,
  onUpdateInstructions,
  onAddEditableRange,
  onUpdateEditableRange,
  onDeleteEditableRange,
  onUpdateNote,
  onUpdateChord,
  onDeleteChords,
  onUpdateChordBrush,
  onUpdateChordTrack,
  onAddTimingEvent,
  onUpdateTimingEvent,
  onDeleteTimingEvent,
  onUpdateAudio,
  onUpdateTrack,
  onChooseSoundFont,
  onUseDefaultSoundFont,
}: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("selection");
  const activeTrack = project.satbTracks.find(
    (track) => track.id === activeVoice,
  )!;
  const projectMeasureCount = useMemo(
    () => buildMeasures(project).length,
    [project],
  );
  const noteInspection = useMemo(
    () =>
      developerMode && selectedNote
        ? inspectNoteEvent(selectedNote.voiceId, selectedNote.note)
        : undefined,
    [developerMode, selectedNote],
  );
  const chordInspection = useMemo(
    () =>
      developerMode && selectedChord
        ? inspectChordRegion(selectedChord)
        : undefined,
    [developerMode, selectedChord],
  );

  return (
    <aside className="inspector">
      <div className="inspector-tabs" role="tablist">
        <button
          type="button"
          className={tab === "selection" ? "is-active" : ""}
          onClick={() => setTab("selection")}
        >
          属性
        </button>
        <button
          type="button"
          className={tab === "project" ? "is-active" : ""}
          onClick={() => setTab("project")}
        >
          工程
        </button>
        <button
          type="button"
          className={tab === "sound" ? "is-active" : ""}
          onClick={() => setTab("sound")}
        >
          音源
        </button>
      </div>

      <div className="inspector-content">
        {tab === "selection" && selectedNote ? (
          <section className="property-section">
            <header>
              <span
                className="voice-dot"
                style={{ background: VOICE_CONFIG[selectedNote.voiceId].color }}
              />
              音符 · {VOICE_CONFIG[selectedNote.voiceId].name}
            </header>
            <label>
              <span>音名</span>
              <select
                value={selectedNote.note.pitch.step}
                onChange={(event) =>
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    pitch: {
                      ...selectedNote.note.pitch,
                      step: event.target.value as DiatonicStep,
                    },
                    spellingSource: "manual",
                  })
                }
              >
                {(["C", "D", "E", "F", "G", "A", "B"] as const).map((step) => (
                  <option key={step} value={step}>
                    {step}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>升降号</span>
              <select
                value={selectedNote.note.pitch.alter}
                onChange={(event) =>
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    pitch: {
                      ...selectedNote.note.pitch,
                      alter: Number(event.target.value) as Alteration,
                    },
                    spellingSource: "manual",
                  })
                }
              >
                <option value="-2">重降</option>
                <option value="-1">降</option>
                <option value="0">还原</option>
                <option value="1">升</option>
                <option value="2">重升</option>
              </select>
            </label>
            <label>
              <span>八度</span>
              <CommitField
                type="number"
                min="-1"
                max="9"
                value={selectedNote.note.pitch.octave}
                onCommit={(value) =>
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    pitch: {
                      ...selectedNote.note.pitch,
                      octave: Number(value),
                    },
                    spellingSource: "manual",
                  })
                }
              />
            </label>
            <label>
              <span>实际音高（MIDI）</span>
              <CommitField
                type="number"
                min="0"
                max="127"
                value={toMidi(selectedNote.note.pitch)}
                onCommit={(value) =>
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    pitch: spellMidi(
                      Number(value),
                      keyAtTick(project.keyEvents, selectedNote.note.startTick),
                    ),
                    spellingSource: "manual",
                  })
                }
              />
            </label>
            <label>
              <span>起点（tick）</span>
              <CommitField
                type="number"
                min="0"
                value={selectedNote.note.startTick}
                onCommit={(value) =>
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    startTick: Number(value),
                  })
                }
              />
            </label>
            <label>
              <span>时值（tick）</span>
              <CommitField
                type="number"
                min="1"
                value={selectedNote.note.durationTicks}
                onCommit={(value) =>
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    durationTicks: Number(value),
                  })
                }
              />
            </label>
            <label>
              <span>力度</span>
              <CommitField
                type="number"
                min="1"
                max="127"
                value={selectedNote.note.velocity}
                onCommit={(value) =>
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    velocity: Number(value),
                  })
                }
              />
            </label>
            <label>
              <span>非和弦音角色</span>
              <select
                value={selectedNote.note.nonChordToneRole ?? ""}
                onChange={(event) =>
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    nonChordToneRole: event.target.value
                      ? (event.target.value as NoteEvent["nonChordToneRole"])
                      : undefined,
                  })
                }
              >
                <option value="">未标注</option>
                {nonChordToneOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="command-button"
              onClick={() =>
                onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                  locked: !selectedNote.note.locked,
                })
              }
            >
              {selectedNote.note.locked ? <LockOpen /> : <Lock />}
              {selectedNote.note.locked ? "解锁音符" : "锁定音符"}
            </button>
          </section>
        ) : null}

        {tab === "selection" && noteInspection ? (
          <DeveloperEventInspector inspection={noteInspection} />
        ) : null}

        {tab === "selection" && selectedChord ? (
          <section className="property-section">
            <header>
              和弦 · {formatChordRegion(project, selectedChord).functional}
            </header>
            <div className="computed-chord-name">
              <strong>{formatChordRegion(project, selectedChord).functional}</strong>
              <span>
                {formatChordRegion(project, selectedChord).roman} · {formatChordRegion(project, selectedChord).absolute}
              </span>
              <small>{formatChordRegion(project, selectedChord).semanticSummary}</small>
            </div>
            <ChordSemanticsEditor
              draft={
                chordDraftFromRegion(selectedChord) ??
                defaultChordDraftAtTick(project, selectedChord.startTick)
              }
              keyEvent={keyAtTick(project.keyEvents, selectedChord.startTick)}
              onChange={(patch) =>
                onUpdateChord(selectedChord.id, {
                  draft: selectedChord.semantics
                    ? patch
                    : {
                        ...defaultChordDraftAtTick(
                          project,
                          selectedChord.startTick,
                        ),
                        ...patch,
                      },
                })
              }
            />
            <label>
              <span>起点</span>
              <CommitField
                type="number"
                min="0"
                value={selectedChord.startTick}
                onCommit={(value) =>
                  onUpdateChord(selectedChord.id, { startTick: Number(value) })
                }
              />
            </label>
            <label>
              <span>时值</span>
              <CommitField
                type="number"
                min="1"
                value={selectedChord.durationTicks}
                onCommit={(value) =>
                  onUpdateChord(selectedChord.id, {
                    durationTicks: Number(value),
                  })
                }
              />
            </label>
            <div className="inline-commands">
              <button
                type="button"
                className="command-button"
                onClick={() =>
                  onUpdateChord(selectedChord.id, {
                    locked: !selectedChord.locked,
                  })
                }
              >
                {selectedChord.locked ? <LockOpen /> : <Lock />}
                {selectedChord.locked ? "解锁" : "锁定"}
              </button>
              <button
                type="button"
                className="command-button danger"
                disabled={selectedChord.locked}
                onClick={() => onDeleteChords(new Set([selectedChord.id]))}
              >
                <Trash2 />
                删除
              </button>
            </div>
          </section>
        ) : null}

        {tab === "selection" && chordInspection ? (
          <DeveloperEventInspector inspection={chordInspection} />
        ) : null}

        {tab === "selection" &&
        !selectedNote &&
        !selectedChord &&
        selectedChordCount > 1 ? (
          <section className="property-section">
            <header>已选择 {selectedChordCount} 个和弦区域</header>
            <p className="property-hint">
              移动、复制、粘贴和删除会作为一次操作处理。
            </p>
            <button
              type="button"
              className="command-button danger"
              onClick={() => onDeleteChords(selectedChordIds)}
            >
              <Trash2 />
              删除选中区域
            </button>
          </section>
        ) : null}

        {tab === "selection" &&
        !selectedNote &&
        !selectedChord &&
        selectedChordCount === 0 ? (
          <section className="property-section">
            <header>当前和弦画笔</header>
            <div className="computed-chord-name">
              <strong>
                {
                  formatChord(
                    chordBrush,
                    keyAtTick(project.keyEvents, playheadTick),
                  ).functional
                }
              </strong>
              <span>
                {
                  formatChord(
                    chordBrush,
                    keyAtTick(project.keyEvents, playheadTick),
                  ).roman
                }
                {" · "}
                {
                  formatChord(
                    chordBrush,
                    keyAtTick(project.keyEvents, playheadTick),
                  ).absolute
                }
              </span>
            </div>
            <ChordSemanticsEditor
              draft={chordBrush}
              keyEvent={keyAtTick(project.keyEvents, playheadTick)}
              onChange={onUpdateChordBrush}
            />
            <p className="property-hint">铅笔工具将在和弦轨中使用这组结构。</p>
          </section>
        ) : null}

        {tab === "project" ? (
          <>
            <section className="property-section">
              <header>工程信息</header>
              <label>
                <span>标题</span>
                <CommitField
                  value={project.title}
                  onCommit={(value) =>
                    onUpdateProject({ title: value || "未命名练习" })
                  }
                />
              </label>
              <label>
                <span>作者</span>
                <CommitField
                  value={project.author}
                  onCommit={(value) => onUpdateProject({ author: value })}
                />
              </label>
              <label>
                <span>总长度（小节）</span>
                <CommitField
                  type="number"
                  min={1}
                  step={1}
                  value={projectMeasureCount}
                  onCommit={(value) =>
                    onUpdateProject({
                      lengthTicks: ticksForMeasures(project, Number(value)),
                    })
                  }
                />
              </label>
              <label className="stacked">
                <span>练习说明</span>
                <textarea
                  value={project.exercise.instructions}
                  onChange={(event) => onUpdateInstructions(event.target.value)}
                  placeholder="例如：给定低音，完成其余三个声部"
                />
              </label>
            </section>

            <section className="property-section">
              <header>和弦轨</header>
              <label>
                <span>显示方式</span>
                <select
                  value={project.chordTrack.displayMode}
                  onChange={(event) =>
                    onUpdateChordTrack({
                      displayMode: event.target
                        .value as ProjectDocument["chordTrack"]["displayMode"],
                    })
                  }
                >
                  <option value="functional">功能标记</option>
                  <option value="roman">罗马数字</option>
                  <option value="absolute">绝对和弦</option>
                  <option value="functional-absolute">功能 + 绝对</option>
                  <option value="roman-absolute">罗马 + 绝对</option>
                </select>
              </label>
              <label className="toggle-row">
                <span>显示和弦区域</span>
                <input
                  type="checkbox"
                  checked={project.chordTrack.visible}
                  onChange={(event) =>
                    onUpdateChordTrack({ visible: event.target.checked })
                  }
                />
              </label>
              <button
                type="button"
                className="command-button"
                onClick={() =>
                  onUpdateChordTrack({ locked: !project.chordTrack.locked })
                }
              >
                {project.chordTrack.locked ? <LockOpen /> : <Lock />}
                {project.chordTrack.locked ? "解锁和弦轨" : "锁定和弦轨"}
              </button>
            </section>

            <section className="property-section range-section">
              <header>
                <span>锁定时间区间</span>
                <IconButton
                  label="在播放头添加锁定区间"
                  icon={<Plus />}
                  onClick={onAddEditableRange}
                />
              </header>
              {project.exercise.editableRanges.length === 0 ? (
                <p className="property-hint">当前没有区间限制。</p>
              ) : null}
              {project.exercise.editableRanges.map((range) => (
                <div className="range-editor" key={range.id}>
                  <div className="range-editor-head">
                    <small>
                      {formatPosition(project, range.fromTick)} -{" "}
                      {formatPosition(project, range.toTick)}
                    </small>
                    <IconButton
                      label="删除锁定区间"
                      icon={<Trash2 />}
                      onClick={() => onDeleteEditableRange(range.id)}
                    />
                  </div>
                  <label>
                    <span>开始 tick</span>
                    <CommitField
                      type="number"
                      min="0"
                      value={range.fromTick}
                      onCommit={(value) =>
                        onUpdateEditableRange(range.id, {
                          fromTick: Number(value),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>结束 tick</span>
                    <CommitField
                      type="number"
                      min="1"
                      value={range.toTick}
                      onCommit={(value) =>
                        onUpdateEditableRange(range.id, {
                          toTick: Number(value),
                        })
                      }
                    />
                  </label>
                  <div className="range-voices" aria-label="锁定声部">
                    {project.satbTracks.map((track) => (
                      <label key={track.id}>
                        <input
                          type="checkbox"
                          checked={range.voiceIds.includes(track.id)}
                          onChange={(event) =>
                            onUpdateEditableRange(range.id, {
                              voiceIds: event.target.checked
                                ? [...range.voiceIds, track.id]
                                : range.voiceIds.filter(
                                    (voiceId) => voiceId !== track.id,
                                  ),
                            })
                          }
                        />
                        <span>{track.shortName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <TimingSection
              title="速度变化"
              onAdd={() => onAddTimingEvent("tempo")}
              rows={project.tempoEvents.map((event) => ({
                id: event.id,
                tick: event.tick,
                value: event.bpm.toString(),
                protected: event.tick === 0,
                onValue: (value) =>
                  onUpdateTimingEvent("tempo", event.id, {
                    bpm: Number(value),
                  }),
                onDelete: () => onDeleteTimingEvent("tempo", event.id),
              }))}
            />
            <TimingSection
              title="拍号变化"
              onAdd={() => onAddTimingEvent("meter")}
              rows={project.meterEvents.map((event) => ({
                id: event.id,
                tick: event.tick,
                value: `${event.numerator}/${event.denominator}`,
                protected: event.tick === 0,
                onValue: (value) => {
                  const [numerator, denominator] = value.split("/").map(Number);
                  onUpdateTimingEvent("meter", event.id, {
                    numerator,
                    denominator,
                  });
                },
                onDelete: () => onDeleteTimingEvent("meter", event.id),
              }))}
            />
            <section className="property-section timing-section">
              <header>
                <span>调号变化</span>
                <IconButton
                  label="在播放头添加调号"
                  icon={<Plus />}
                  onClick={() => onAddTimingEvent("key")}
                />
              </header>
              {project.keyEvents.map((event) => (
                <div className="timing-row" key={event.id}>
                  <small>{formatPosition(project, event.tick)}</small>
                  <select
                    value={serializePitchClass(event.tonic)}
                    onChange={(change) =>
                      onUpdateTimingEvent("key", event.id, {
                        tonic: change.target.value,
                      })
                    }
                  >
                    {keyTonicOptions(event.mode).map((tonic) => (
                      <option
                        key={serializePitchClass(tonic)}
                        value={serializePitchClass(tonic)}
                      >
                        {formatPitchClass(tonic)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={event.mode}
                    onChange={(change) =>
                      onUpdateTimingEvent("key", event.id, {
                        mode: change.target.value as KeyMode,
                      })
                    }
                  >
                    <option value="major">大调</option>
                    <option value="minor">小调</option>
                  </select>
                  <IconButton
                    label="删除调号事件"
                    icon={<Trash2 />}
                    disabled={event.tick === 0}
                    onClick={() => onDeleteTimingEvent("key", event.id)}
                  />
                </div>
              ))}
            </section>
          </>
        ) : null}

        {tab === "sound" ? (
          <>
            <section className="property-section soundfont-section">
              <header>SoundFont</header>
              <strong>{project.audio.soundFont.name}</strong>
              <div className="soundfont-status">
                <small>{audioStatus}</small>
                {soundFontSize && !soundFontLoad ? (
                  <small>文件大小 {soundFontSize}</small>
                ) : null}
                {soundFontLoad ? (
                  <>
                    <progress
                      max="100"
                      value={soundFontLoad.percent}
                      aria-label="SoundFont 加载进度"
                    />
                    <small>{soundFontLoad.detail}</small>
                  </>
                ) : null}
              </div>
              <button
                type="button"
                className="command-button primary"
                onClick={onChooseSoundFont}
              >
                <FolderOpen />
                选择本地 SF2
              </button>
              {project.audio.soundFont.kind === "user" ? (
                <button
                  type="button"
                  className="command-button"
                  onClick={onUseDefaultSoundFont}
                >
                  恢复默认音色
                </button>
              ) : null}
            </section>
            <section className="property-section">
              <header>主输出</header>
              <label className="stacked">
                <span>
                  主音量 {Math.round(project.audio.masterVolume * 100)}%
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={project.audio.masterVolume}
                  onChange={(event) =>
                    onUpdateAudio(Number(event.target.value))
                  }
                />
              </label>
            </section>
            <section className="property-section">
              <header>{activeTrack.name}音源</header>
              <label>
                <span>GM Program</span>
                <CommitField
                  type="number"
                  min="0"
                  max="127"
                  value={activeTrack.program}
                  onCommit={(value) =>
                    onUpdateTrack(activeVoice, { program: Number(value) })
                  }
                />
              </label>
              <label className="stacked">
                <span>声像 {Math.round(activeTrack.pan * 100)}</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={activeTrack.pan}
                  onChange={(event) =>
                    onUpdateTrack(activeVoice, {
                      pan: Number(event.target.value),
                    })
                  }
                />
              </label>
            </section>
          </>
        ) : null}
      </div>
    </aside>
  );
}

interface TimingRow {
  id: string;
  tick: number;
  value: string;
  protected: boolean;
  onValue(value: string): void;
  onDelete(): void;
}

function TimingSection({
  title,
  onAdd,
  rows,
}: {
  title: string;
  onAdd(): void;
  rows: TimingRow[];
}) {
  return (
    <section className="property-section timing-section">
      <header>
        <span>{title}</span>
        <IconButton
          label={`在播放头添加${title}`}
          icon={<Plus />}
          onClick={onAdd}
        />
      </header>
      {rows.map((row) => (
        <div className="timing-row" key={row.id}>
          <small>tick {row.tick}</small>
          <CommitField value={row.value} onCommit={row.onValue} />
          <IconButton
            label={`删除${title}事件`}
            icon={<Trash2 />}
            disabled={row.protected}
            onClick={row.onDelete}
          />
        </div>
      ))}
    </section>
  );
}
