import { isWrittenStep, keyEquals, spelledPitchEquals, writtenInterval } from "../../pitch";
import type { SpelledPitch } from "../../pitch";
import type { ChordRegion, KeyEvent, NoteEvent, PhraseBoundary, ProjectDocument, VoiceId } from "../../project/types";
import { VOICE_ORDER } from "../../project/voice";
import { buildMetricTimeline, metricPositionAt, type MetricLevel } from "../../rhythm/metric";
import { inferPhrases } from "../phrase";
import type { AutoHarmonizationOptions, HarmonizationGivenVoice, HarmonizationRange } from "./types";

type CadenceZone = "final-authentic" | "medial-cadence";

export interface MelodySlice {
  tick: number;
  endTick: number;
  durationTicks: number;
  melody: NoteEvent;
  key: KeyEvent;
  metricLevel: MetricLevel;
  measureNumber: number;
  beatLength: number;
  lockedChord?: ChordRegion;
  lockedPitches: Partial<Record<VoiceId, SpelledPitch>>;
  ornament?: "passing" | "neighbor";
  cadence?: { zone: CadenceZone; stage: "approach" | "dominant" | "landing" | "hold" };
  phraseStart: boolean;
}

export interface MelodyGrid {
  slices: MelodySlice[];
  phraseBoundaries: PhraseBoundary[];
  range: HarmonizationRange;
  givenVoice: HarmonizationGivenVoice;
}

const endOf = (item: { startTick: number; durationTicks: number }) =>
  item.startTick + item.durationTicks;

function ordered<T extends { startTick: number }>(items: readonly T[]) {
  return [...items].sort((left, right) => left.startTick - right.startTick);
}

function activeAt<T extends { startTick: number; durationTicks: number }>(items: readonly T[]) {
  let next = 0;
  let active: T[] = [];
  return (tick: number) => {
    while (next < items.length && items[next].startTick <= tick) active.push(items[next++]);
    active = active.filter(item => endOf(item) > tick);
    return active.at(-1);
  };
}

function planBoundaries(
  project: ProjectDocument,
  notes: readonly NoteEvent[],
  givenVoice: HarmonizationGivenVoice,
  range: HarmonizationRange,
  timeline: ReturnType<typeof buildMetricTimeline>,
): PhraseBoundary[] {
  const manual = project.structure.phraseBoundaries.filter(boundary => boundary.source === "manual");
  if (manual.length) return manual.filter(boundary => boundary.tick > range.fromTick && boundary.tick < range.toTick);
  const inferred = inferPhrases({
    ppq: project.ppq,
    lengthTicks: range.toTick,
    meterEvents: project.meterEvents,
    keyEvents: project.keyEvents,
    satbTracks: [{ id: givenVoice, notes }],
  }).boundaries.filter(boundary =>
    boundary.tick > range.fromTick && boundary.tick < range.toTick);
  const measures = timeline.measures.filter(measure =>
    measure.startTick >= range.fromTick && measure.startTick < range.toTick);
  const boundaries: PhraseBoundary[] = [];
  for (let index = 4; index < measures.length; index += 4) {
    const measure = measures[index];
    if (range.toTick - measure.startTick < 2 * measure.beatLength) break;
    const nearby = inferred.find(boundary =>
      Math.abs(boundary.tick - measure.startTick) <= measure.beatLength &&
      notes.some(note => endOf(note) === boundary.tick && note.durationTicks >= measure.beatLength));
    const tick = nearby?.tick ?? measure.startTick;
    boundaries.push({ id: `harmonization-phrase-${tick}`, tick, source: "inferred", confidence: "probable" });
  }
  if (!boundaries.length) return inferred;
  return boundaries;
}

function markCadences(slices: MelodySlice[], boundaries: readonly PhraseBoundary[]) {
  let first = 0;
  const ends = [...boundaries.map(boundary => boundary.tick), slices.at(-1)?.endTick ?? 0];
  ends.forEach((end, phraseIndex) => {
    let after = first;
    while (after < slices.length && slices[after].tick < end) after++;
    if (first === after) return;
    const zone = phraseIndex === ends.length - 1 ? "final-authentic" : "medial-cadence";
    slices[first].phraseStart = true;
    let landing = after - 1;
    while (landing > first && slices[landing - 1].melody === slices[landing].melody &&
      keyEquals(slices[landing - 1].key, slices[landing].key)) landing--;
    const cutoff = slices[landing].tick - 2 * slices[landing].beatLength;
    for (let index = landing; index < after; index++) {
      slices[index].cadence = { zone, stage: index === landing ? "landing" : "hold" };
    }
    if (landing > first && slices[landing - 1].endTick === slices[landing].tick) {
      slices[landing - 1].cadence = { zone, stage: zone === "final-authentic" ? "dominant" : "approach" };
      for (let index = landing - 2; index >= first && slices[index].tick >= cutoff &&
        slices[index].endTick === slices[index + 1].tick; index--) {
        slices[index].cadence = { zone, stage: "approach" };
      }
    }
    first = after;
  });
}

export function buildMelodyGrid(project: ProjectDocument, options: AutoHarmonizationOptions): MelodyGrid {
  const length = project.lengthTicks;
  const clampTick = (tick: number | undefined, fallback: number) =>
    Number.isFinite(tick) ? Math.min(length, Math.max(0, Math.trunc(tick!))) : fallback;
  const fromTick = clampTick(options.fromTick, 0);
  const limit = Math.max(fromTick, clampTick(options.toTick, length));
  const overlaps = (note: NoteEvent) => fromTick < limit && note.startTick < limit && endOf(note) > fromTick;
  const trackNotes = (voice: VoiceId) => project.satbTracks.find(track => track.id === voice)?.notes ?? [];
  const givenVoice = options.givenVoice ??
    (trackNotes("soprano").some(overlaps) || !trackNotes("bass").some(overlaps) ? "soprano" : "bass");
  const notes = ordered(trackNotes(givenVoice).filter(overlaps));
  const toTick = options.toTick === undefined
    ? notes.reduce((end, note) => Math.max(end, endOf(note)), fromTick)
    : limit;
  const range = { fromTick, toTick };
  if (!notes.length) return { range, givenVoice, slices: [], phraseBoundaries: [] };

  const timeline = buildMetricTimeline({ ...project, lengthTicks: toTick });
  const phraseBoundaries = planBoundaries(project, notes, givenVoice, range, timeline);
  const preserveLocks = options.respectLockedConstraints ?? true;
  const chords = preserveLocks ? ordered(project.chordTrack.regions.filter(chord => chord.locked)) : [];
  const locked = VOICE_ORDER.filter(voice => voice !== givenVoice).map(voice => ({
    voice, notes: preserveLocks ? ordered(trackNotes(voice).filter(note => note.locked)) : [],
  }));
  const keys = [...project.keyEvents].sort((left, right) => left.tick - right.tick);
  const ticks = new Set<number>([
    fromTick, toTick,
    ...keys.map(key => key.tick),
    ...phraseBoundaries.map(boundary => boundary.tick),
    ...timeline.measures.flatMap(measure => measure.beatTicks),
  ]);
  for (const item of [...notes, ...chords, ...locked.flatMap(track => track.notes)]) {
    ticks.add(item.startTick);
    ticks.add(endOf(item));
  }
  const grid = [...ticks].filter(tick => tick >= fromTick && tick <= toTick).sort((a, b) => a - b);
  const melodyAt = activeAt(notes);
  const chordAt = activeAt(chords);
  const anchors = locked.map(({ voice, notes: items }) => [voice, activeAt(items)] as const);
  const slices: MelodySlice[] = [];
  let keyIndex = 0;
  for (let index = 0; index < grid.length - 1; index++) {
    const tick = grid[index];
    const melody = melodyAt(tick);
    if (!melody) continue;
    while (keyIndex + 1 < keys.length && keys[keyIndex + 1].tick <= tick) keyIndex++;
    const metric = metricPositionAt(timeline, tick)!;
    const measure = timeline.measures[metric.measureNumber - 1];
    const lockedPitches: MelodySlice["lockedPitches"] = {};
    for (const [voice, noteAt] of anchors) {
      const note = noteAt(tick);
      if (note) lockedPitches[voice] = note.pitch;
    }
    slices.push({
      tick, endTick: grid[index + 1], durationTicks: grid[index + 1] - tick,
      melody, key: keys[keyIndex], metricLevel: metric.level, measureNumber: metric.measureNumber,
      beatLength: measure.beatLength, lockedChord: chordAt(tick), lockedPitches, phraseStart: false,
    });
  }

  if (options.allowPassingAndNeighborMelodies) {
    for (let index = 1; index < slices.length - 1; index++) {
      const [left, slice, right] = [slices[index - 1], slices[index], slices[index + 1]];
      if (slice.metricLevel !== 0 || slice.melody.startTick !== slice.tick ||
        left.endTick !== slice.tick || slice.endTick !== right.tick ||
        right.melody.startTick !== right.tick) continue;
      // In M1 the whole weak subdivision must be bounded by two contiguous written steps.
      const into = writtenStep(left.melody.pitch, slice.melody.pitch);
      const out = writtenStep(slice.melody.pitch, right.melody.pitch);
      if (into && out) slice.ornament = spelledPitchEquals(left.melody.pitch, right.melody.pitch)
        ? "neighbor" : into === out ? "passing" : undefined;
    }
  }
  markCadences(slices, phraseBoundaries);
  return { range, givenVoice, slices, phraseBoundaries };
}

function writtenStep(from: SpelledPitch, to: SpelledPitch) {
  const interval = writtenInterval(from, to);
  return isWrittenStep(interval) ? Math.sign(interval.semitones) : 0;
}
