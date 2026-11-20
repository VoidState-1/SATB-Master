import { chordIdentityToneSpellingForDegree, type ChordIdentity } from "../chordModel";
import { pitchClassEquals, spelledPitchEquals, toMidi, writtenInterval } from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import type { MetricPosition } from "../rhythm/metric";
import type { AnalysisKey, AnalysisNote, AnalysisSlice } from "./analysis";
import { soundsCompleteWrittenChord } from "./writtenNeighbors";
import { hasCompleteWrittenTertianVoicing } from "./writtenTertian";

export interface LowerNeighborFrame extends Pick<AnalysisSlice, "tick" | "endTick" | "notes" | "completeSatb" | "key"> {
  readonly metric?: MetricPosition;
}

function orderedNotes(frame: LowerNeighborFrame) {
  if (!frame.completeSatb) return;
  const notes = VOICE_ORDER.map(voice => frame.notes[voice]!);
  if (notes.some((note, index) => note.nonChordToneRole ||
      (index > 0 && toMidi(notes[index - 1].pitch) <= toMidi(note.pitch)))) return;
  for (const [index, note] of notes.entries()) {
    if (notes.slice(index + 1).some(other => (toMidi(note.pitch) - toMidi(other.pitch)) % 12 === 0)) return;
  }
  return notes;
}

function sameKey(left: AnalysisKey, right: AnalysisKey) {
  return left.id === right.id && left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

function moves(from: AnalysisNote, to: AnalysisNote, steps: number, semitones: number) {
  const interval = writtenInterval(from.pitch, to.pitch);
  return interval.diatonicSteps === steps && interval.semitones === semitones;
}

/** Spasobin §40.3, 5 and 7. Identify the later, lower half of a written enclosure.
 * A complete upper sonority is compatible with this fact and keeps its own analysis. */
export function writtenLowerNeighborPair(
  dominant: ChordIdentity, anchor: ChordIdentity,
  [preparation, departure, upper, lower, arrival]: readonly [
    LowerNeighborFrame, LowerNeighborFrame, LowerNeighborFrame, LowerNeighborFrame, LowerNeighborFrame,
  ],
  boundaries: readonly number[],
) {
  if (dominant.structure.kind !== "tertian" || dominant.structure.quality !== "dominant7" ||
      dominant.structure.extensions.length || dominant.structure.alterations.length ||
      anchor.structure.kind !== "tertian" || anchor.structure.quality !== "diminished7" ||
      anchor.structure.extensions.length || anchor.structure.alterations.length ||
      !pitchClassEquals(dominant.root, dominant.bass)) return;
  const leadingTone = chordIdentityToneSpellingForDegree(dominant, 3);
  if (!leadingTone || !pitchClassEquals(leadingTone, anchor.root)) return;

  const frames = [preparation, departure, upper, lower, arrival];
  if (frames.some((frame, index) => !sameKey(frame.key, departure.key) ||
      (index > 0 && frames[index - 1].endTick !== frame.tick)) ||
      boundaries.some(tick => preparation.tick < tick && tick < arrival.endTick)) return;
  if (lower.metric?.confidence !== "certain" || lower.metric.role !== "subdivision" ||
      upper.metric?.confidence !== "certain" || upper.metric.level <= lower.metric.level ||
      arrival.metric?.confidence !== "certain" || arrival.metric.level <= lower.metric.level ||
      upper.endTick - upper.tick !== lower.endTick - lower.tick ||
      lower.endTick - lower.tick > Math.min(departure.endTick - departure.tick, arrival.endTick - arrival.tick)) return;

  const before = orderedNotes(preparation), first = orderedNotes(departure);
  const high = orderedNotes(upper), low = orderedNotes(lower), last = orderedNotes(arrival);
  if (!before || !first || !high || !low || !last ||
      !soundsCompleteWrittenChord(dominant, before, before[3]) ||
      !soundsCompleteWrittenChord(anchor, first, first[3]) ||
      !soundsCompleteWrittenChord(anchor, last, last[3]) ||
      !hasCompleteWrittenTertianVoicing(high.map(note => note.pitch)) ||
      hasCompleteWrittenTertianVoicing(low.map(note => note.pitch))) return;
  if ([0, 3].some(index => [high, low, last].some(notes => notes[index].id !== first[index].id))) return;

  for (const index of [1, 2]) {
    const [from, up, down, to] = [first, high, low, last].map(notes => notes[index]);
    if (up.startTick !== upper.tick || down.startTick !== lower.tick || to.startTick !== arrival.tick ||
        from.startTick + from.durationTicks !== up.startTick ||
        up.startTick + up.durationTicks !== down.startTick ||
        down.startTick + down.durationTicks !== to.startTick ||
        !spelledPitchEquals(from.pitch, to.pitch) ||
        !moves(from, up, 1, 1) || !moves(up, down, -2, -2) || !moves(down, to, 1, 1)) return;
  }
  if (![first, high, low, last].every(notes => {
    const interval = writtenInterval(notes[2].pitch, notes[1].pitch);
    return interval.diatonicSteps % 7 === 5 && interval.semitones % 12 === 9;
  })) return;

  return [low[1].id, low[2].id];
}
