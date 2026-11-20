import { metricPositionAt, buildMetricTimeline } from "../../rhythm/metric";
import {
  isWrittenStep,
  pitchClassEquals,
  pitchClassValue,
  spelledPitchEquals,
  toMidi,
  writtenInterval,
  type SpelledPitchClass,
} from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { AnalysisKey, AnalysisNote } from "../analysis";
import type { KeyEvent, ProjectDocument, VoiceId } from "../../project";
import type { ChordInferenceObservation } from "./types";

function uniquePitchClasses(notes: readonly AnalysisNote[]) {
  const seen = new Set<number>();
  const values: SpelledPitchClass[] = [];
  for (const note of notes) {
    const value = pitchClassValue(note.pitch);
    if (seen.has(value)) continue;
    seen.add(value);
    values.push({ step: note.pitch.step, alter: note.pitch.alter });
  }
  return Object.freeze(values);
}

function keyAt(keys: readonly KeyEvent[], tick: number) {
  let current = keys[0];
  for (const event of keys) {
    if (event.tick > tick) break;
    current = event;
  }
  if (!current) throw new Error("和声推导至少需要一个位于起点的调号事件");
  return current as AnalysisKey;
}

function noteAtVoice(
  project: ProjectDocument,
  voiceId: VoiceId,
  tick: number,
): AnalysisNote | undefined {
  const track = project.satbTracks.find((candidate) => candidate.id === voiceId);
  return track?.notes.find(
    (note) =>
      note.startTick <= tick && note.startTick + note.durationTicks > tick,
  ) as AnalysisNote | undefined;
}

function collectBoundaries(
  project: ProjectDocument,
  fromTick: number,
  toTick: number,
) {
  const boundaries = new Set<number>([fromTick, toTick]);
  for (const track of project.satbTracks) {
    for (const note of track.notes) {
      const start = Math.max(fromTick, note.startTick);
      const end = Math.min(toTick, note.startTick + note.durationTicks);
      if (start > fromTick && start < toTick) boundaries.add(start);
      if (end > fromTick && end < toTick) boundaries.add(end);
    }
  }
  for (const event of project.keyEvents) {
    if (event.tick > fromTick && event.tick < toTick)
      boundaries.add(event.tick);
  }
  return [...boundaries].sort((left, right) => left - right);
}

/**
 * Builds a timeline from SATB notes only. Existing chord regions intentionally
 * do not contribute boundaries or facts, so a previous annotation cannot bias
 * a new inference run.
 */
export function buildChordInferenceObservations(
  project: ProjectDocument,
  range: { readonly fromTick?: number; readonly toTick?: number } = {},
) {
  const fromTick = Math.max(0, Math.min(
    project.lengthTicks,
    Math.floor(range.fromTick ?? 0),
  ));
  const toTick = Math.max(
    fromTick,
    Math.min(project.lengthTicks, Math.floor(range.toTick ?? project.lengthTicks)),
  );
  if (toTick <= fromTick) return Object.freeze([]) as readonly ChordInferenceObservation[];

  const metricTimeline = buildMetricTimeline(project);
  const boundaries = collectBoundaries(project, fromTick, toTick);
  const observations: ChordInferenceObservation[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end <= start) continue;
    const activeNotes = Object.fromEntries(
      VOICE_ORDER.map((voiceId) => [voiceId, noteAtVoice(project, voiceId, start)]),
    ) as Partial<Record<VoiceId, AnalysisNote | undefined>>;
    const notes = VOICE_ORDER.flatMap((voiceId) => {
      const note = activeNotes[voiceId];
      return note ? [note] : [];
    });
    const attackVoiceIds = VOICE_ORDER.filter((voiceId) => {
      const note = activeNotes[voiceId];
      return note?.startTick === start;
    });
    const bass = activeNotes.bass;
    const metric = metricPositionAt(metricTimeline, start);
    const measure = metric && metricTimeline.measures[metric.measureNumber - 1];
    observations.push({
      index: observations.length,
      fromTick: start,
      toTick: end,
      activeNotes: activeNotes as Partial<Record<VoiceId, AnalysisNote>>,
      attackVoiceIds: Object.freeze(attackVoiceIds),
      soundingPitchClasses: uniquePitchClasses(notes),
      bass,
      key: keyAt(project.keyEvents, start),
      metric,
      measureDurationTicks: measure && measure.numerator * measure.beatLength,
      completeSatb: notes.length === VOICE_ORDER.length,
    });
  }
  return Object.freeze(observations);
}

export function observationNotes(
  observation: ChordInferenceObservation,
) {
  return VOICE_ORDER.flatMap((voiceId) => {
    const note = observation.activeNotes[voiceId];
    return note ? [{ voiceId, note }] : [];
  });
}

export function observationPitchClassKey(
  observation: ChordInferenceObservation,
) {
  return observation.soundingPitchClasses
    .map((pitch) => `${pitch.step}:${pitch.alter}:${pitchClassValue(pitch)}`)
    .join("|");
}

export function noteMidi(note: AnalysisNote) {
  return toMidi(note.pitch);
}

export function soundingBass(observation: ChordInferenceObservation) {
  const bass = observation.bass;
  if (observation.completeSatb && bass && observationNotes(observation).every(
    ({ note }) => toMidi(note.pitch) >= toMidi(bass.pitch) && !note.nonChordToneRole,
  )) return bass.pitch;
}

export function resolvesTone(
  source: ChordInferenceObservation,
  target: ChordInferenceObservation,
  from: SpelledPitchClass,
  to: SpelledPitchClass,
  direction: -1 | 0 | 1,
) {
  return observationNotes(source).some(({ voiceId, note }) => {
    const next = target.activeNotes[voiceId];
    if (!next || !pitchClassEquals(note.pitch, from) || !pitchClassEquals(next.pitch, to)) return false;
    if (direction === 0) return spelledPitchEquals(note.pitch, next.pitch);
    if (next.startTick !== target.fromTick) return false;
    const interval = writtenInterval(note.pitch, next.pitch);
    return interval.diatonicSteps === direction &&
      (direction === 1 ? interval.semitones === 1 : isWrittenStep(interval));
  });
}
