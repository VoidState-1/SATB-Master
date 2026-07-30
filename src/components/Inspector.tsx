import {
  useEffect,
  useMemo,
  useState,
  type InputHTMLAttributes,
} from "react";
import { FolderOpen, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import {
  formatChord,
  formatChordRegion,
  isSeventhChord,
} from "../domain/chords";
import {
  KEY_NAMES,
  VOICE_CONFIG,
  type ChordAnalysis,
  type ChordRegion,
  type EditableRange,
  type KeyMode,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../domain/model";
import type { ChordRegionPatch } from "../domain/editing";
import {
  buildMeasures,
  formatPosition,
  keyAtTick,
  ticksForMeasures,
} from "../domain/time";
import { IconButton } from "./IconButton";
import { CHORD_QUALITY_OPTIONS } from "./chordAnalysisOptions";

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
  chordBrush: ChordAnalysis;
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
  onUpdateChordBrush(patch: Partial<ChordAnalysis>): void;
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
  onUpdateTrack(
    voiceId: VoiceId,
    patch: Partial<ProjectDocument["tracks"][number]>,
  ): void;
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

function ChordAnalysisEditor({
  analysis,
  onChange,
}: {
  analysis: ChordAnalysis;
  onChange(patch: Partial<ChordAnalysis>): void;
}) {
  const maximumInversion = isSeventhChord(analysis.quality) ? 3 : 2;
  return (
    <>
      <label>
        <span>级数</span>
        <select
          value={analysis.degree}
          onChange={(event) =>
            onChange({
              degree: Number(event.target.value) as ChordAnalysis["degree"],
            })
          }
        >
          {[1, 2, 3, 4, 5, 6, 7].map((degree) => (
            <option key={degree} value={degree}>
              {degree}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>变化音</span>
        <select
          value={analysis.accidental}
          onChange={(event) =>
            onChange({
              accidental: Number(
                event.target.value,
              ) as ChordAnalysis["accidental"],
            })
          }
        >
          <option value="-2">重降</option>
          <option value="-1">降</option>
          <option value="0">无</option>
          <option value="1">升</option>
          <option value="2">重升</option>
        </select>
      </label>
      <label>
        <span>性质</span>
        <select
          value={analysis.quality}
          onChange={(event) => {
            const quality = event.target.value as ChordAnalysis["quality"];
            onChange({
              quality,
              inversion: Math.min(
                analysis.inversion,
                isSeventhChord(quality) ? 3 : 2,
              ) as ChordAnalysis["inversion"],
            });
          }}
        >
          {CHORD_QUALITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>转位</span>
        <select
          value={analysis.inversion}
          onChange={(event) =>
            onChange({
              inversion: Number(
                event.target.value,
              ) as ChordAnalysis["inversion"],
            })
          }
        >
          <option value="0">原位</option>
          <option value="1">第一转位</option>
          <option value="2">第二转位</option>
          {maximumInversion === 3 ? <option value="3">第三转位</option> : null}
        </select>
      </label>
      <label>
        <span>副属目标</span>
        <select
          value={analysis.appliedToDegree ?? ""}
          onChange={(event) =>
            onChange({
              appliedToDegree: event.target.value
                ? (Number(
                    event.target.value,
                  ) as ChordAnalysis["appliedToDegree"])
                : undefined,
            })
          }
        >
          <option value="">无</option>
          {[1, 2, 3, 4, 5, 6, 7].map((degree) => (
            <option key={degree} value={degree}>
              {degree} 级
            </option>
          ))}
        </select>
      </label>
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
  const activeTrack = project.tracks.find((track) => track.id === activeVoice)!;
  const projectMeasureCount = useMemo(
    () => buildMeasures(project).length,
    [project],
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
              <span>音高（MIDI）</span>
              <CommitField
                type="number"
                min="0"
                max="127"
                value={selectedNote.note.midiNote}
                onCommit={(value) =>
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    midiNote: Number(value),
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

        {tab === "selection" && selectedChord ? (
          <section className="property-section">
            <header>
              和弦 · {formatChordRegion(project, selectedChord).roman}
            </header>
            <div className="computed-chord-name">
              <strong>{formatChordRegion(project, selectedChord).roman}</strong>
              <span>{formatChordRegion(project, selectedChord).absolute}</span>
              <small>
                {formatChordRegion(project, selectedChord).functionLabel}
              </small>
            </div>
            <ChordAnalysisEditor
              analysis={selectedChord.analysis}
              onChange={(patch) =>
                onUpdateChord(selectedChord.id, { analysis: patch })
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
                  ).roman
                }
              </strong>
              <span>
                {
                  formatChord(
                    chordBrush,
                    keyAtTick(project.keyEvents, playheadTick),
                  ).absolute
                }
              </span>
            </div>
            <ChordAnalysisEditor
              analysis={chordBrush}
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
                  <option value="roman">罗马数字</option>
                  <option value="absolute">绝对和弦</option>
                  <option value="both">两者</option>
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
                    {project.tracks.map((track) => (
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
                    value={event.tonic}
                    onChange={(change) =>
                      onUpdateTimingEvent("key", event.id, {
                        tonic: Number(change.target.value),
                      })
                    }
                  >
                    {KEY_NAMES.map((key, index) => (
                      <option key={key} value={index}>
                        {key}
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
