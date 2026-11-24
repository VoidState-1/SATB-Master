import { useMemo } from "react";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import {
  chordDraftFromRegion,
  formatChord,
  formatChordRegion,
} from "../../domain/chords";
import { inversionBassOptions } from "../../domain/chordModel";
import {
  inspectChordRegion,
  inspectNoteEvent,
} from "../../domain/developerInspection";
import {
  getAllPlayableTracks,
  resolveTrackColor,
  type Alteration,
  type DiatonicStep,
  type NoteEvent,
} from "../../domain/project";
import {
  enharmonicSpellings,
  formatPitchClass,
  formatSpelledPitch,
  pitchClassEquals,
  parseSpelledPitch,
  serializeSpelledPitch,
  spellMidi,
  toMidi,
} from "../../domain/pitch";
import { keyAtTick } from "../../domain/time";
import { ChordSemanticsEditor } from "./ChordSemanticsEditor";
import { CadenceEditor } from "./CadenceEditor";
import { CommitField } from "./CommitField";
import { DeveloperEventInspector } from "./DeveloperEventInspector";
import type { SelectionInspectorProps } from "./types";

const nonChordToneOptions = [
  ["passing", "经过音"],
  ["neighbor", "辅助音"],
  ["suspension", "延留音"],
  ["retardation", "延宕音"],
  ["appoggiatura", "倚音"],
  ["anticipation", "先现音"],
  ["escape", "逃逸音"],
  ["pedal", "持续音"],
  ["other", "其他"],
] as const;

export function SelectionInspector({
  project,
  selectedNote,
  selectedChord,
  selectedChordIds,
  selectedChordCount,
  developerMode,
  chordBrush,
  playheadTick,
  onUpdateNote,
  onUpdateChord,
  onDeleteChords,
  onUpdateChordBrush,
  cadenceCandidates,
  onAddCadenceAnnotation,
  onUpdateCadenceAnnotation,
  onDeleteCadenceAnnotation,
}: SelectionInspectorProps) {
  const noteTrack = selectedNote && getAllPlayableTracks(project).find(
    (track) => track.id === selectedNote.voiceId,
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

  const chordName = selectedChord && formatChordRegion(project, selectedChord);
  const chordDraft = selectedChord && chordDraftFromRegion(selectedChord);
  const writtenBassOptions = selectedChord && !chordDraft ? inversionBassOptions(selectedChord.identity) : [];
  const selectedBassIndex = selectedChord
    ? writtenBassOptions.findIndex(bass => pitchClassEquals(bass, selectedChord.identity.bass))
    : -1;

  return (
    <>
      {selectedNote && noteTrack ? (
        <section className="property-section">
          <header>
            <span
              className="voice-dot"
              style={{
                background: resolveTrackColor(
                  noteTrack,
                  noteTrack.kind === "auxiliary" ? project.auxiliaryTracks.indexOf(noteTrack) : 0,
                ),
              }}
            />
            音符 · {noteTrack.name}
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
            <span>同音异名</span>
            <select
              value={serializeSpelledPitch(selectedNote.note.pitch)}
              onChange={(event) => {
                const nextPitch = parseSpelledPitch(event.target.value);
                if (nextPitch) {
                  onUpdateNote(selectedNote.voiceId, selectedNote.note.id, {
                    pitch: nextPitch,
                    spellingSource: "manual",
                  });
                }
              }}
            >
              {enharmonicSpellings(selectedNote.note.pitch).map((option) => (
                <option
                  key={serializeSpelledPitch(option)}
                  value={serializeSpelledPitch(option)}
                >
                  {formatSpelledPitch(option)}
                </option>
              ))}
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
          {noteTrack.kind === "satb" ? (
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
          ) : (
            <p className="property-hint">额外声部不参与和声检查</p>
          )}
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
      {noteInspection ? (
        <DeveloperEventInspector inspection={noteInspection} />
      ) : null}

      {selectedChord && chordName ? (
        <section className="property-section">
          <header>和弦 · {chordDraft ? chordName.functional : chordName.absolute}</header>
          <div className="computed-chord-name">
            <strong>{chordDraft ? chordName.functional : chordName.absolute}</strong>
            {chordDraft ? <span>{chordName.roman} · {chordName.absolute}</span> : null}
            <small>{chordDraft ? chordName.semanticSummary : "局部功能未定"}</small>
          </div>
          {chordDraft ? (
            <ChordSemanticsEditor
              draft={chordDraft}
              keyEvent={keyAtTick(project.keyEvents, selectedChord.startTick)}
              onChange={draft => onUpdateChord(selectedChord.id, { draft })}
            />
          ) : (
            <label>
              <span>实写转位低音</span>
              <select value={selectedBassIndex} disabled={selectedChord.locked || project.chordTrack.locked}
                onChange={event => {
                  const writtenBass = writtenBassOptions[Number(event.target.value)];
                  if (writtenBass) onUpdateChord(selectedChord.id, { writtenBass });
                }}>
                {selectedBassIndex < 0 && (
                  <option value={-1} disabled>{formatPitchClass(selectedChord.identity.bass)}（当前低音）</option>
                )}
                {writtenBassOptions.map((bass, index) => (
                  <option key={index} value={index}>{formatPitchClass(bass)}</option>
                ))}
              </select>
            </label>
          )}
          <CadenceEditor
            project={project}
            selectedChord={selectedChord}
            candidates={cadenceCandidates}
            onAdd={onAddCadenceAnnotation}
            onUpdate={onUpdateCadenceAnnotation}
            onDelete={onDeleteCadenceAnnotation}
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
      {chordInspection ? (
        <DeveloperEventInspector inspection={chordInspection} />
      ) : null}

      {!selectedNote && !selectedChord && selectedChordCount > 1 ? (
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

      {!selectedNote && !selectedChord && selectedChordCount === 0 ? (
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
    </>
  );
}
