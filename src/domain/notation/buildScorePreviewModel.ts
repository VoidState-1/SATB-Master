import {
  keySignatureFifths,
  type KeyLike,
} from "../pitch";
import {
  buildMeasures,
  keyAtTick,
  type MeasureInfo,
} from "../time";
import { VOICE_ORDER } from "../project/voice";
import type {
  NoteEvent,
  ProjectDocument,
  VoiceId,
} from "../project";
import { decomposeDuration } from "./rhythm";
import type {
  ScoreEvent,
  ScoreMeasure,
  ScorePreviewBuildOptions,
  ScorePreviewModel,
  ScorePreviewProject,
  ScorePreviewWarning,
  ScoreVoice,
} from "./types";

export const SCORE_VOICE_LAYOUT = Object.freeze({
  soprano: Object.freeze({
    voiceId: "soprano",
    staff: "treble",
    stemDirection: "up",
  }),
  alto: Object.freeze({
    voiceId: "alto",
    staff: "treble",
    stemDirection: "down",
  }),
  tenor: Object.freeze({
    voiceId: "tenor",
    staff: "bass",
    stemDirection: "up",
  }),
  bass: Object.freeze({
    voiceId: "bass",
    staff: "bass",
    stemDirection: "down",
  }),
} as const);

function keySignatureSpec(key: KeyLike) {
  const fifths = keySignatureFifths(key);
  const major = [
    "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C",
    "G", "D", "A", "E", "B", "F#", "C#",
  ];
  const minor = [
    "Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am",
    "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m",
  ];
  return (key.mode === "major" ? major : minor)[fifths + 7];
}

function warning(
  warnings: ScorePreviewWarning[],
  value: ScorePreviewWarning,
) {
  warnings.push(value);
}

function addDurationEvents(
  events: ScoreEvent[],
  kind: "rest" | "note",
  fromTick: number,
  toTick: number,
  note: NoteEvent | undefined,
  voiceId: VoiceId,
  ppq: number,
  warnings: ScorePreviewWarning[],
) {
  if (toTick <= fromTick) return true;
  const durations = decomposeDuration(ppq, toTick - fromTick);
  if (!durations) {
    warning(warnings, {
      code: "unsupported-rhythm",
      message: "该片段无法用首版支持的二进制/附点时值精确表示。",
      fromTick,
      toTick,
      voiceId,
      sourceNoteId: note?.id,
    });
    events.push({ kind: "unsupported", fromTick, toTick, sourceNoteId: note?.id });
    return false;
  }
  let cursor = fromTick;
  durations.forEach((duration, index) => {
    const next = cursor + duration.ticks;
    if (kind === "rest") {
      events.push({ kind: "rest", fromTick: cursor, toTick: next, duration });
    } else if (note) {
      events.push({
        kind: "note",
        sourceNoteId: note.id,
        voiceId,
        fromTick: cursor,
        toTick: next,
        pitch: note.pitch,
        tieFromPrevious: cursor > note.startTick || index > 0,
        tieToNext: next < note.startTick + note.durationTicks || index < durations.length - 1,
        duration,
      });
    }
    cursor = next;
  });
  return true;
}

function buildVoice(
  project: ScorePreviewProject,
  measure: MeasureInfo,
  voiceId: VoiceId,
  warnings: ScorePreviewWarning[],
): ScoreVoice {
  const track = project.satbTracks.find((candidate) => candidate.id === voiceId);
  const notes = [...(track?.notes ?? [])]
    .filter(
      (note) =>
        note.startTick < measure.endTick &&
        note.startTick + note.durationTicks > measure.startTick,
    )
    .sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
  const events: ScoreEvent[] = [];
  let cursor = measure.startTick;
  let lastAcceptedEnd = measure.startTick;

  for (const note of notes) {
    const rawStart = Math.max(measure.startTick, note.startTick);
    const rawEnd = Math.min(measure.endTick, note.startTick + note.durationTicks);
    if (rawEnd <= rawStart) continue;
    if (rawStart < lastAcceptedEnd) {
      warning(warnings, {
        code: "invalid-overlap",
        message: "同一声部存在重叠音符，该冲突片段未绘制。",
        fromTick: rawStart,
        toTick: rawEnd,
        voiceId,
        sourceNoteId: note.id,
      });
      continue;
    }
    if (rawStart > cursor)
      addDurationEvents(events, "rest", cursor, rawStart, undefined, voiceId, project.ppq, warnings);
    const segmentStart = Math.max(cursor, rawStart);
    if (segmentStart < rawEnd)
      addDurationEvents(events, "note", segmentStart, rawEnd, note, voiceId, project.ppq, warnings);
    cursor = rawEnd;
    lastAcceptedEnd = rawEnd;
  }
  if (cursor < measure.endTick)
    addDurationEvents(events, "rest", cursor, measure.endTick, undefined, voiceId, project.ppq, warnings);
  return {
    voiceId,
    events: Object.freeze(events),
    totalTicks: measure.endTick - measure.startTick,
  };
}

function buildMeasure(
  project: ScorePreviewProject,
  measure: MeasureInfo,
  warnings: ScorePreviewWarning[],
): ScoreMeasure {
  const key = keyAtTick(project.keyEvents, measure.startTick);
  project.keyEvents
    .filter(
      (event) =>
        event.tick > measure.startTick && event.tick < measure.endTick,
    )
    .forEach((event) => {
      warning(warnings, {
        code: "unsupported-key",
        message: "小节内调号变化暂不单独绘制；音符仍保留工程中的原始拼写。",
        fromTick: event.tick,
        toTick: measure.endTick,
      });
    });
  let keySignature: string | undefined;
  try {
    keySignature = keySignatureSpec(key);
  } catch {
    warning(warnings, {
      code: "unsupported-key",
      message: "当前调号无法直接转换为五线谱调号，将使用显式临时记号。",
      fromTick: measure.startTick,
      toTick: measure.endTick,
    });
  }
  const voices = Object.fromEntries(
    VOICE_ORDER.map((voiceId) => [voiceId, buildVoice(project, measure, voiceId, warnings)]),
  ) as Record<VoiceId, ScoreVoice>;
  return {
    number: measure.number,
    fromTick: measure.startTick,
    toTick: measure.endTick,
    numerator: measure.numerator,
    denominator: measure.denominator,
    key,
    keySignature,
    voices,
  };
}

export function buildScorePreviewModel(
  project: ScorePreviewProject | ProjectDocument,
  options: ScorePreviewBuildOptions = {},
): ScorePreviewModel {
  const warnings: ScorePreviewWarning[] = [];
  const measures = buildMeasures(project).map((measure) =>
    buildMeasure(project, measure, warnings),
  );
  const omittedAuxiliaryTrackCount = project.auxiliaryTracks.length;
  const omittedAuxiliaryNoteCount = project.auxiliaryTracks.reduce(
    (total, track) => total + track.notes.length,
    0,
  );
  if (omittedAuxiliaryTrackCount > 0) {
    warning(warnings, {
      code: "omitted-auxiliary",
      message:
        "已省略 " +
        omittedAuxiliaryTrackCount +
        " 条辅助轨（" +
        omittedAuxiliaryNoteCount +
        " 个音符）。",
    });
  }
  return Object.freeze({
    revision: options.revision ?? 0,
    ppq: project.ppq,
    projectLengthTicks: project.lengthTicks,
    measures: Object.freeze(measures),
    warnings: Object.freeze(warnings),
    omittedAuxiliaryTrackCount,
    omittedAuxiliaryNoteCount,
  });
}

export function scoreVoiceLayout(voiceId: VoiceId) {
  return SCORE_VOICE_LAYOUT[voiceId];
}

export function measureDurationTicks(measure: ScoreMeasure) {
  return measure.toTick - measure.fromTick;
}

export function isScorePreviewProject(value: unknown): value is ScorePreviewProject {
  return Boolean(value && typeof value === "object");
}
