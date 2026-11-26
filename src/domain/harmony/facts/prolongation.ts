import {
  chordIdentityEquals,
  type ChordIdentity,
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  chordIdentityInversion,
} from "../../chordModel";
import {
  keyDeclarationEquals,
  pitchClassEquals,
  spelledPitchEquals,
  isWrittenStep,
  toMidi,
  writtenInterval,
  type SpelledPitch,
  scaleDegreePitchClass,
  stepIndex,
} from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { VoiceId } from "../../project/types";
import type { AnalysisNote, AnalysisSlice } from "../analysis";
import {
  readSoundingTertianIdentity,
  soundsCompleteWrittenChord,
  hasCompleteWrittenTertianVoicing,
  soundsCompleteWrittenMembers,
} from "./writtenVoicing";
import { type MetricPosition, compareMetricStrength } from "../../rhythm/metric";
import { writtenStepDirection } from "./ornamentalMotion";

type WrittenProlongationFrame = Pick<AnalysisSlice, "tick" | "endTick" | "key" | "notes" | "completeSatb">;

export interface WrittenProlongation {
  readonly departureTick: number;
  readonly fromTick: number;
  readonly returnTick: number;
  readonly anchorIdentity: ChordIdentity;
  readonly surfaceIdentity: ChordIdentity;
  readonly bass: AnalysisNote;
  readonly voices: readonly {
    readonly voice: VoiceId;
    readonly departure: AnalysisNote;
    readonly middle: AnalysisNote;
    readonly arrival: AnalysisNote;
    readonly motion: "common-tone" | "neighbor";
  }[];
}

/** Physical return and neighboring motions give a structural relation.
 * The written intermediate chord keeps its own members and bass. */
export function readWrittenProlongation(
  left: WrittenProlongationFrame | undefined,
  middle: WrittenProlongationFrame,
  right: WrittenProlongationFrame | undefined,
  boundaries: readonly number[],
): WrittenProlongation | undefined {
  const bass = middle.notes.bass;
  if (!left?.completeSatb || !right?.completeSatb || !middle.completeSatb || !bass ||
      left.endTick !== middle.tick || middle.endTick !== right.tick ||
      !keyDeclarationEquals(left.key, middle.key) || !keyDeclarationEquals(middle.key, right.key) ||
      boundaries.some(tick => left.tick < tick && tick <= right.tick)) return;

  const voices: Array<WrittenProlongation["voices"][number]> = [];
  for (const voice of VOICE_ORDER) {
    const departure = left.notes[voice], note = middle.notes[voice], arrival = right.notes[voice];
    if (!departure || !note || !arrival || departure.nonChordToneRole || note.nonChordToneRole ||
        arrival.nonChordToneRole || !spelledPitchEquals(departure.pitch, arrival.pitch)) return;
    const common = spelledPitchEquals(departure.pitch, note.pitch);
    if (!common) {
      if (note.startTick !== middle.tick || arrival.startTick !== right.tick ||
          !returnsByWrittenStep(departure, note, arrival)) return;
    }
    voices.push({ voice, departure, middle: note, arrival, motion: common ? "common-tone" : "neighbor" });
  }
  if (!voices.some(voice => voice.motion === "common-tone") ||
      !voices.some(voice => voice.motion === "neighbor")) return;

  const anchor = readSoundingTertianIdentity(left);
  if (!anchor || anchor.structure.kind !== "tertian" ||
      (anchor.structure.quality !== "major" && anchor.structure.quality !== "minor") ||
      !voices.some(voice => voice.motion === "common-tone" &&
        pitchClassEquals(voice.middle.pitch, anchor.root))) return;
  const arrival = readSoundingTertianIdentity(right);
  if (!arrival || !chordIdentityEquals(anchor, arrival)) return;
  const surface = readSoundingTertianIdentity(middle);
  if (!surface || surface.structure.kind !== "tertian" || surface.structure.quality !== "diminished7") return;

  return Object.freeze({
    departureTick: left.tick, fromTick: middle.tick, returnTick: right.tick,
    anchorIdentity: anchor, surfaceIdentity: surface, bass,
    voices: Object.freeze(voices.map(item => Object.freeze(item))),
  });
}

export function readSliceProlongations(
  slices: readonly AnalysisSlice[], boundaries: readonly number[],
): ReadonlyMap<number, WrittenProlongation> {
  const facts = new Map<number, WrittenProlongation>();
  for (let i = 1; i + 1 < slices.length; i++) {
    const fact = readWrittenProlongation(slices[i - 1], slices[i], slices[i + 1], boundaries);
    if (fact) facts.set(fact.fromTick, fact);
  }
  return facts;
}

export function returnsByWrittenStep(first: AnalysisNote, middle: AnalysisNote, last: AnalysisNote) {
  if (first.nonChordToneRole || last.nonChordToneRole ||
      (middle.nonChordToneRole && middle.nonChordToneRole !== "neighbor") ||
      !spelledPitchEquals(first.pitch, last.pitch) ||
      first.startTick + first.durationTicks !== middle.startTick ||
      middle.startTick + middle.durationTicks !== last.startTick ||
      middle.durationTicks > Math.min(first.durationTicks, last.durationTicks)) return false;
  return writtenStepDirection(first, middle, false) !== 0;
}

function formsThirdOrSixth(lower: SpelledPitch, upper: SpelledPitch) {
  const interval = writtenInterval(lower, upper);
  const steps = interval.diatonicSteps % 7;
  const semitones = interval.semitones % 12;
  return (steps === 2 && (semitones === 3 || semitones === 4)) ||
    (steps === 5 && (semitones === 8 || semitones === 9));
}

/** Once both voices have a written step and return, parallel neighbors require
 * a major or minor third or sixth (possibly compound) at both positions. */
export function supportsPairedNeighborMotion(
  lowerBefore: SpelledPitch, upperBefore: SpelledPitch,
  lowerNeighbor: SpelledPitch, upperNeighbor: SpelledPitch,
) {
  const lowerMotion = writtenInterval(lowerBefore, lowerNeighbor);
  const upperMotion = writtenInterval(upperBefore, upperNeighbor);
  return lowerMotion.diatonicSteps !== upperMotion.diatonicSteps ||
    (formsThirdOrSixth(lowerBefore, upperBefore) && formsThirdOrSixth(lowerNeighbor, upperNeighbor));
}

type NeighborFrame = Pick<AnalysisSlice, "tick" | "notes" | "completeSatb">;

/** Return the upper neighbor notes supported by the same sounding harmony on both sides. */
export function writtenNeighborsOverHeldBass(
  identity: ChordIdentity, before: NeighborFrame, middle: NeighborFrame, after: NeighborFrame,
) {
  if (!before.completeSatb || !middle.completeSatb || !after.completeSatb) return;
  const bass = before.notes.bass!;
  if (!soundsCompleteWrittenChord(identity, VOICE_ORDER.map(voice => before.notes[voice]!), bass)) return;
  const tones = chordIdentityToneSpellings(identity);
  const neighbors: string[] = [];
  for (const voice of VOICE_ORDER) {
    const first = before.notes[voice]!, note = middle.notes[voice]!, last = after.notes[voice]!;
    if (last.nonChordToneRole || !spelledPitchEquals(first.pitch, last.pitch) || toMidi(note.pitch) < toMidi(bass.pitch)) return;
    if (first.id === note.id && note.id === last.id) continue;
    if (voice === "bass" || note.startTick !== middle.tick || last.startTick !== after.tick ||
        tones.some(tone => pitchClassEquals(tone, note.pitch)) || !returnsByWrittenStep(first, note, last)) return;
    neighbors.push(note.id);
  }
  if (!neighbors.length || hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(voice => middle.notes[voice]!.pitch))) return;
  return neighbors;
}

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
  if (frames.some((frame, index) => !keyDeclarationEquals(frame.key, departure.key) ||
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

export interface UpperPassingFrame {
  fromTick: number;
  toTick: number;
  key: AnalysisSlice["key"];
  activeNotes: AnalysisSlice["notes"];
  metric?: MetricPosition;
}

// Spasobin §38.1–4. Follow one written line from chord tone to chord tone;
// at the intervening weak attack all three other note events must still sound.
export function upperPassingMotion(
  left: UpperPassingFrame, middle: UpperPassingFrame, right: UpperPassingFrame, ppq: number,
  { allowHeldDeparture = false, allowCompleteSonority = false, allowAccentedPassing = false } = {},
) {
  if (left.toTick !== middle.fromTick || middle.toTick !== right.fromTick ||
      middle.metric?.confidence !== "certain" || right.metric?.confidence !== "certain" ||
      (!allowAccentedPassing && (middle.metric.level >= 2 || compareMetricStrength(left.metric, middle.metric) !== "stronger" ||
        compareMetricStrength(right.metric, middle.metric) === "weaker"))) return;
  for (const frame of [left, middle, right]) {
    const bass = frame.activeNotes.bass;
    if (!bass || !keyDeclarationEquals(frame.key, middle.key)) return;
    for (const voice of VOICE_ORDER) {
      const note = frame.activeNotes[voice];
      if (!note || toMidi(note.pitch) < toMidi(bass.pitch)) return;
    }
  }
  const attacks = VOICE_ORDER.filter(voice => middle.activeNotes[voice]!.startTick === middle.fromTick);
  if (attacks.length !== 1 || attacks[0] === "bass") return;
  const voice = attacks[0];
  if (VOICE_ORDER.some(v => v !== voice && (middle.activeNotes[v]!.id !== left.activeNotes[v]!.id ||
      middle.activeNotes[v]!.nonChordToneRole))) return;
  const before = left.activeNotes[voice]!, note = middle.activeNotes[voice]!, after = right.activeNotes[voice]!;
  if (before.nonChordToneRole || after.nonChordToneRole || (note.nonChordToneRole && note.nonChordToneRole !== "passing") ||
      (!allowHeldDeparture && before.startTick !== left.fromTick) ||
      before.startTick + before.durationTicks !== note.startTick ||
      note.startTick + note.durationTicks !== right.fromTick || after.startTick !== right.fromTick ||
      note.durationTicks > ppq || note.durationTicks > before.durationTicks) return;
  const into = writtenInterval(before.pitch, note.pitch), out = writtenInterval(note.pitch, after.pitch);
  const degree = (stepIndex(note.pitch.step) - stepIndex(middle.key.tonic.step) + 7) % 7 + 1;
  if (!isWrittenStep(into) || !isWrittenStep(out) || into.diatonicSteps !== out.diatonicSteps ||
      Math.sign(into.semitones) !== into.diatonicSteps || Math.sign(out.semitones) !== out.diatonicSteps ||
      !pitchClassEquals(note.pitch, scaleDegreePitchClass(middle.key, degree)) ||
      (!allowCompleteSonority && hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(v => middle.activeNotes[v]!.pitch)))) return;
  return { note, after };
}

type ChordFrame = UpperPassingFrame & { readonly identity: ChordIdentity };

function plainTriad(frame: ChordFrame, quality: "major" | "minor", inversion: number) {
  const { structure } = frame.identity;
  return structure.kind === "tertian" && structure.quality === quality && !structure.extensions.length &&
    !structure.alterations.length && chordIdentityInversion(frame.identity) === inversion &&
    !!frame.activeNotes.bass && VOICE_ORDER.every(voice => frame.activeNotes[voice]) &&
    soundsCompleteWrittenChord(frame.identity, Object.values(frame.activeNotes), frame.activeNotes.bass);
}

function risesByStep(from: UpperPassingFrame, to: UpperPassingFrame, voice: (typeof VOICE_ORDER)[number]) {
  const interval = writtenInterval(from.activeNotes[voice]!.pitch, to.activeNotes[voice]!.pitch);
  return interval.diatonicSteps === 1 && interval.semitones > 0 && isWrittenStep(interval);
}

/** Spasobin §§13.2–3 and 38.1: a weak upper passing attack can decorate
 * the opening tonic sixth in T6–D64–T. Use the same written frames when
 * assigning the harmony and when checking the resulting ornament. */
export function decoratedPassingSixFourMotion(
  before: ChordFrame, ornament: UpperPassingFrame, sixFour: ChordFrame, after: ChordFrame, ppq: number,
) {
  const key = before.key;
  const tonicQuality = key.mode === "major" ? "major" : "minor";
  if (sixFour.toTick !== after.fromTick || !keyDeclarationEquals(after.key, key) ||
      sixFour.metric?.confidence !== "certain" || sixFour.metric.role === "downbeat" ||
      !pitchClassEquals(before.identity.root, key.tonic) || !plainTriad(before, tonicQuality, 1) ||
      !pitchClassEquals(sixFour.identity.root, scaleDegreePitchClass(key, 5)) || !plainTriad(sixFour, "major", 2) ||
      !pitchClassEquals(after.identity.root, key.tonic) || !plainTriad(after, tonicQuality, 0)) return;
  const into = writtenInterval(before.activeNotes.bass!.pitch, sixFour.activeNotes.bass!.pitch);
  const out = writtenInterval(sixFour.activeNotes.bass!.pitch, after.activeNotes.bass!.pitch);
  if (!isWrittenStep(into) || !isWrittenStep(out) || into.diatonicSteps !== -1 || out.diatonicSteps !== -1 ||
      into.semitones >= 0 || out.semitones >= 0) return;

  const upper = VOICE_ORDER.filter(voice => voice !== "bass");
  const common = upper.some(voice => spelledPitchEquals(before.activeNotes[voice]!.pitch, sixFour.activeNotes[voice]!.pitch) &&
    spelledPitchEquals(sixFour.activeNotes[voice]!.pitch, after.activeNotes[voice]!.pitch));
  if (!common || !upper.some(voice => risesByStep(before, sixFour, voice) && risesByStep(sixFour, after, voice))) return;

  // The passing pitch may form a different literal tertian collection. The
  // other three written, held notes must still spell the entire opening T6.
  const motion = upperPassingMotion(before, ornament, sixFour, ppq, {
    allowHeldDeparture: true, allowCompleteSonority: true,
  });
  if (!motion || motion.note.durationTicks > before.toTick - before.fromTick) return;
  const tonicTones = chordIdentityToneSpellings(before.identity);
  if (tonicTones.some(tone => pitchClassEquals(tone, motion.note.pitch)) ||
      chordIdentityToneSpellings(sixFour.identity).some(tone => pitchClassEquals(tone, motion.note.pitch)) ||
      !soundsCompleteWrittenMembers(tonicTones, Object.values(ornament.activeNotes).filter(note => note.id !== motion.note.id))) return;
  return motion;
}
