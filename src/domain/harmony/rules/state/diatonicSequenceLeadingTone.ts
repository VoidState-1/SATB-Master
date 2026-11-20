import { chordIdentityInversion, chordIdentityToneSpellings } from "../../../chordModel";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import {
  keyEquals,
  leadingTonePitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  toMidi,
  writtenInterval,
  type SpelledPitchClass,
} from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import type { ObligationEnvironment } from "./obligation";
import type { LeadingTonePayload } from "./tendency";

const degrees = [1, 2, 3, 4, 5, 6, 7] as const;

function writtenSlot(context: HarmonyRuleContext, key: AnalysisSlice["key"], start: number, end: number) {
  const first = context.sliceAt(start);
  const chord = first?.chord;
  if (!first?.completeSatb || first.tick !== start || !first.notes.bass || !chord || chord.startTick !== start ||
      chord.startTick + chord.durationTicks !== end) return undefined;
  const meaning = context.harmony.primaryInterpretation(chord);
  if (meaning.status !== "resolved" || meaning.value.appliedTarget ||
      chord.semantics?.cadenceRole || chord.semantics?.pedalContext ||
      (meaning.value.localKey && !keyEquals(meaning.value.localKey, key))) return undefined;

  const { structure, bass } = chord.identity;
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length) return undefined;
  const tones = chordIdentityToneSpellings(chord.identity);
  const scale = degrees.map(degree => scaleDegreePitchClass(key, degree));
  if (tones.length < 3 || tones.length > 4 ||
      !tones.every(tone => scale.some(pitch => pitchClassEquals(tone, pitch))) ||
      !tones.every(tone => Object.values(first.notes).some(note => pitchClassEquals(note.pitch, tone)))) return undefined;

  const frames = [...context.slices({ overlapping: { fromTick: start, toTick: end } })];
  if (frames.at(-1)?.endTick !== end || frames.some(frame => {
    const bassNote = frame.notes.bass;
    if (frame.chord?.id !== chord.id || frame.key.id !== key.id || !frame.completeSatb ||
        !bassNote || !pitchClassEquals(bassNote.pitch, bass)) return true;
    const lowest = toMidi(bassNote.pitch);
    return Object.values(frame.notes).some(note => note.nonChordToneRole || toMidi(note.pitch) < lowest ||
      !tones.some(tone => pitchClassEquals(tone, note.pitch)));
  })) return undefined;
  return {
    frames, root: chord.identity.root, firstBass: first.notes.bass.pitch,
    inversion: chordIdentityInversion(chord.identity), size: tones.length,
  };
}

function copiedFrames(left: readonly AnalysisSlice[], right: readonly AnalysisSlice[], steps: number) {
  return left.length === right.length && left.every((frame, index) => {
    const shifted = right[index];
    return frame.endTick - frame.tick === shifted.endTick - shifted.tick && VOICE_ORDER.every(voice => {
      const before = frame.notes[voice];
      const after = shifted.notes[voice];
      return before && after &&
        frame.attackVoiceIds.includes(voice) === shifted.attackVoiceIds.includes(voice) &&
        writtenInterval(before.pitch, after.pitch).diatonicSteps === steps;
    });
  });
}

function shiftsBy(left: NonNullable<ReturnType<typeof writtenSlot>>, right: NonNullable<ReturnType<typeof writtenSlot>>, steps: number) {
  return left.size === right.size && left.inversion === right.inversion && copiedFrames(left.frames, right.frames, steps);
}

/**
 * Chapter 26 §3: a motif transfers its internal harmonic relation; the
 * seam between motifs does not inherit that relation. Check the narrower
 * case where the middle motif lands on a triad rooted on the ambient VII.
 */
export function diatonicSequenceAtMiddleArrival(source: AnalysisSlice, context: HarmonyRuleContext, departureTick?: number) {
  const { key, chord: middleArrival } = source;
  const middleHead = context.sliceAt(source.tick - 1)?.chord;
  if (!middleArrival || !middleHead || source.tick !== middleArrival.startTick ||
      !pitchClassEquals(middleArrival.identity.root, leadingTonePitchClass(key))) return undefined;

  const arrivalOffset = source.tick - middleHead.startTick;
  const nextStart = source.tick + middleArrival.durationTicks;
  const nextArrival = nextStart + arrivalOffset;
  if (arrivalOffset <= 0 || (departureTick !== undefined && departureTick !== nextStart && departureTick !== nextArrival))
    return undefined;

  const period = nextStart - middleHead.startTick;
  const firstStart = middleHead.startTick - period;
  const end = nextStart + period;
  if (firstStart < 0 || crossesManualPhraseBoundary(context, firstStart, end - 1)) return undefined;

  const firstHead = writtenSlot(context, key, firstStart, firstStart + arrivalOffset);
  const firstArrival = writtenSlot(context, key, firstStart + arrivalOffset, middleHead.startTick);
  const midHead = writtenSlot(context, key, middleHead.startTick, source.tick);
  const midArrival = writtenSlot(context, key, source.tick, nextStart);
  const lastHead = writtenSlot(context, key, nextStart, nextArrival);
  const lastArrival = writtenSlot(context, key, nextArrival, end);
  if (!firstHead || !firstArrival || !midHead || !midArrival || !lastHead || !lastArrival ||
      midArrival.size !== 3 || pitchClassEquals(lastHead.root, key.tonic) ||
      pitchClassEquals(lastArrival.root, key.tonic)) return undefined;

  // A seventh/triad (or triad/triad) model with an ascending written
  // fourth between roots. A diatonic copy may make that fourth augmented.
  const rootMotion = writtenInterval({ ...firstHead.root, octave: 4 }, { ...firstArrival.root, octave: 4 });
  if ((rootMotion.diatonicSteps + 7) % 7 !== 3) return undefined;
  const steps = writtenInterval(firstHead.firstBass, midHead.firstBass).diatonicSteps;
  if (Math.abs(steps) !== 1 || !shiftsBy(firstHead, midHead, steps) || !shiftsBy(midHead, lastHead, steps) ||
      !shiftsBy(firstArrival, midArrival, steps) || !shiftsBy(midArrival, lastArrival, steps)) return undefined;

  return { nextStart, lastHead, lastArrival };
}

export function leavesDiatonicSequenceLeadingTone(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context, obligation } = environment;
  const { slice, rules } = context;
  const { payload, openedAt } = obligation;
  const { voiceId, targetStep, targetAlter, targetMode } = payload;
  const key = slice.key;
  if (!keyEquals(key, { tonic: { step: targetStep, alter: targetAlter }, mode: targetMode })) return false;

  const source = rules.sliceAt(openedAt.tick);
  const leading = source?.notes[voiceId];
  if (source?.tick !== openedAt.tick || !leading ||
      !pitchClassEquals(leading.pitch, leadingTonePitchClass(key))) return false;

  const sequence = diatonicSequenceAtMiddleArrival(source, rules, slice.tick);
  if (!sequence) return false;
  const { nextStart, lastHead, lastArrival } = sequence;

  if (slice.tick === nextStart) return true;

  // The same written pitch may be rearticulated at the seam, then move
  // as a different chord member inside the new motif.
  const nextHeadNote = lastHead.frames[0].notes[voiceId];
  const lastHeadNote = lastHead.frames.at(-1)?.notes[voiceId];
  return Boolean(nextHeadNote && lastHeadNote && spelledPitchEquals(nextHeadNote.pitch, leading.pitch) &&
    spelledPitchEquals(lastHeadNote.pitch, leading.pitch) &&
    !pitchClassEquals(lastHead.root, scaleDegreePitchClass(key, 5)) &&
    !pitchClassEquals(leading.pitch, leadingTonePitchClass({ tonic: lastArrival.root, mode: "major" })));
}

// The four natural seventh-chord members starting at this scale index.
function naturalSeventh(scale: readonly SpelledPitchClass[], root: number) {
  return [0, 2, 4, 6].map(offset => scale[(root + offset) % 7]);
}

function naturalFrame(frame: AnalysisSlice, key: AnalysisSlice["key"], scale: readonly SpelledPitchClass[]) {
  if (!frame.completeSatb || frame.key.id !== key.id) return false;
  const { chord } = frame, semantics = chord?.semantics;
  if (semantics?.cadenceRole || semantics?.pedalContext || semantics?.mixture || semantics?.alternatives?.length ||
      (semantics && semantics.interpretations.length !== 1)) return false;
  const reading = semantics?.interpretations[0];
  if (reading && (reading.appliedTarget || reading.designation?.specialRole ||
      (reading.designation && !["primary", "side-degree"].includes(reading.designation.kind)) ||
      (reading.localKey && !keyEquals(reading.localKey, key)) ||
      !pitchClassEquals(chord!.identity.root, scaleDegreePitchClass(key, reading.degree, reading.degreeAlteration)))) return false;

  const structure = chord?.identity.structure;
  if (chord && (structure?.kind !== "tertian" || structure.extensions.length || structure.alterations.length ||
      !pitchClassEquals(frame.notes.bass!.pitch, chord.identity.bass))) return false;
  const members = chord ? chordIdentityToneSpellings(chord.identity) : scale;
  let ceiling = Infinity;
  return VOICE_ORDER.every(v => {
    const note = frame.notes[v]!;
    const midi = toMidi(note.pitch);
    if (note.nonChordToneRole || midi > ceiling || !scale.some(p => pitchClassEquals(p, note.pitch)) ||
        !members.some(p => pitchClassEquals(p, note.pitch))) return false;
    ceiling = midi;
    return true;
  });
}

/** §26.9, ex. 26-381. Read the two complete sevenths in the parts. Their
 * roots and thirds stay; the fifth and seventh each descend one written step. */
function seventhPair(head: AnalysisSlice, arrival: AnalysisSlice, voice: VoiceId, scale: readonly SpelledPitchClass[]) {
  const fifth = head.notes[voice];
  const index = scale.findIndex(p => fifth && pitchClassEquals(fifth.pitch, p));
  if (index < 0) return false;
  const source = naturalSeventh(scale, (index + 3) % 7);
  const target = naturalSeventh(scale, (index + 6) % 7);
  for (const [frame, tones] of [[head, source], [arrival, target]] as const) {
    if (!tones.every(t => VOICE_ORDER.some(v => frame.notes[v] && pitchClassEquals(frame.notes[v]!.pitch, t))) ||
        (frame.chord && !pitchClassEquals(frame.chord.identity.root, tones[0]))) return false;
  }
  return VOICE_ORDER.every(v => {
    const before = head.notes[v]!.pitch, after = arrival.notes[v]!.pitch;
    const member = source.findIndex(t => pitchClassEquals(before, t));
    if (member < 2) return spelledPitchEquals(before, after);
    const step = writtenInterval(before, after);
    return pitchClassEquals(after, target[member - 2]) && step.diatonicSteps === -1 &&
      (step.semitones === -1 || step.semitones === -2);
  });
}

export function resolvesCopiedSeventhFifth({ context, obligation }: ObligationEnvironment<LeadingTonePayload>) {
  const { rules, previous, slice } = context;
  const { openedAt, openedBy, payload } = obligation;
  const key = slice.key, voice = payload.voiceId, from = previous?.notes[voice], to = slice.notes[voice];
  if (!previous || !from || !to || previous.tick !== openedAt.tick || from.startTick !== openedAt.tick ||
      !openedBy.noteIds?.includes(from.id) || to.startTick !== slice.tick || previous.endTick !== slice.tick ||
      !keyEquals(key, { tonic: { step: payload.targetStep, alter: payload.targetAlter }, mode: payload.targetMode }) ||
      !pitchClassEquals(from.pitch, leadingTonePitchClass(key))) return false;
  const scale = degrees.map(degree => scaleDegreePitchClass(key, degree));
  if (!seventhPair(previous, slice, voice, scale)) return false;

  // Adjacent pairs (ex. 381), or a pair plus a continuation of the same
  // duration (keyboard 16). Compare the intervening music, including reattacks.
  const start = previous.tick, pairLength = slice.endTick - start;
  return [pairLength, 2 * pairLength].some(period => {
    const modelStart = start - period;
    if (modelStart < 0 || crossesManualPhraseBoundary(rules, modelStart, start + period - 1)) return false;
    const frames = (l: number, h: number) => [...rules.slices({ overlapping: { fromTick: l, toTick: h } })];
    const model = frames(modelStart, start), copy = frames(start, start + period);
    if (model[0]?.tick !== modelStart || copy.at(-1)?.endTick !== start + period ||
        ![...model, ...copy].every(f => naturalFrame(f, key, scale))) return false;
    const steps = writtenInterval(model[0].notes.bass!.pitch, previous.notes.bass!.pitch).diatonicSteps;
    return Math.abs(steps) === 1 && copiedFrames(model, copy, steps) && seventhPair(model[0], model[1], voice, scale);
  });
}
