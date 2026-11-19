import { chordIdentityInversion, chordIdentityToneSpellings } from "../../../chordModel";
import { VOICE_ORDER } from "../../../project/voice";
import {
  leadingTonePitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  toMidi,
  writtenInterval,
} from "../../../pitch";
import type { RuleStepContext } from "../../runtime";
import { crossesManualPhraseBoundary } from "../groups/dominantSixthSubstitution";
import type { ObligationEnvironment } from "./obligation";
import type { LeadingTonePayload } from "./tendency";

const degrees = [1, 2, 3, 4, 5, 6, 7] as const;

function writtenSlot(context: RuleStepContext, start: number, end: number) {
  const first = context.rules.sliceAt(start);
  const chord = first?.chord;
  if (!first?.completeSatb || first.tick !== start || !first.notes.bass || !chord || chord.startTick !== start ||
      chord.startTick + chord.durationTicks !== end) return undefined;
  const meaning = context.rules.harmony.primaryInterpretation(chord);
  const key = context.slice.key;
  if (meaning.status !== "resolved" || meaning.value.appliedTarget ||
      chord.semantics?.cadenceRole || chord.semantics?.pedalContext ||
      (meaning.value.localKey && (meaning.value.localKey.mode !== key.mode ||
        !pitchClassEquals(meaning.value.localKey.tonic, key.tonic)))) return undefined;

  const { structure, bass } = chord.identity;
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length) return undefined;
  const tones = chordIdentityToneSpellings(chord.identity);
  const scale = degrees.map(degree => scaleDegreePitchClass(key, degree));
  if (tones.length < 3 || tones.length > 4 ||
      !tones.every(tone => scale.some(pitch => pitchClassEquals(tone, pitch))) ||
      !tones.every(tone => Object.values(first.notes).some(note => pitchClassEquals(note.pitch, tone)))) return undefined;

  const frames = [...context.rules.slices({ overlapping: { fromTick: start, toTick: end } })];
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

function shiftsBy(left: NonNullable<ReturnType<typeof writtenSlot>>, right: NonNullable<ReturnType<typeof writtenSlot>>, steps: number) {
  return left.size === right.size && left.inversion === right.inversion &&
    left.frames.length === right.frames.length && left.frames.every((frame, index) => {
      const shifted = right.frames[index];
      return frame.endTick - frame.tick === shifted.endTick - shifted.tick && VOICE_ORDER.every(voice => {
        const before = frame.notes[voice];
        const after = shifted.notes[voice];
        return before && after &&
          frame.attackVoiceIds.includes(voice) === shifted.attackVoiceIds.includes(voice) &&
          writtenInterval(before.pitch, after.pitch).diatonicSteps === steps;
      });
    });
}

/**
 * Chapter 26 §3: a motif transfers its internal harmonic relation; the
 * seam between motifs does not inherit that relation. Check the narrower
 * case where the middle motif lands on a triad rooted on the ambient VII.
 */
export function leavesDiatonicSequenceLeadingTone(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context, obligation } = environment;
  const { slice, rules } = context;
  const { payload, openedAt } = obligation;
  const { voiceId, targetStep, targetAlter, targetMode } = payload;
  const key = slice.key;
  if (key.mode !== targetMode || !pitchClassEquals(key.tonic, { step: targetStep, alter: targetAlter })) return false;

  const source = rules.sliceAt(openedAt.tick);
  const leading = source?.notes[voiceId];
  const middleArrival = source?.chord;
  const middleHead = rules.sliceAt(openedAt.tick - 1)?.chord;
  if (!source || !leading || !middleArrival || !middleHead ||
      source.tick !== middleArrival.startTick || !pitchClassEquals(leading.pitch, middleArrival.identity.root) ||
      !pitchClassEquals(leading.pitch, leadingTonePitchClass(key))) return false;

  const arrivalOffset = source.tick - middleHead.startTick;
  const nextStart = source.tick + middleArrival.durationTicks;
  const nextArrival = nextStart + arrivalOffset;
  if (arrivalOffset <= 0 || (slice.tick !== nextStart && slice.tick !== nextArrival)) return false;

  const period = nextStart - middleHead.startTick;
  const firstStart = middleHead.startTick - period;
  const end = nextStart + period;
  if (firstStart < 0 || crossesManualPhraseBoundary(context.rules, firstStart, end - 1)) return false;

  const firstHead = writtenSlot(context, firstStart, firstStart + arrivalOffset);
  const firstArrival = writtenSlot(context, firstStart + arrivalOffset, middleHead.startTick);
  const midHead = writtenSlot(context, middleHead.startTick, source.tick);
  const midArrival = writtenSlot(context, source.tick, nextStart);
  const lastHead = writtenSlot(context, nextStart, nextArrival);
  const lastArrival = writtenSlot(context, nextArrival, end);
  if (!firstHead || !firstArrival || !midHead || !midArrival || !lastHead || !lastArrival ||
      midArrival.size !== 3 || pitchClassEquals(lastHead.root, key.tonic) ||
      pitchClassEquals(lastArrival.root, key.tonic)) return false;

  // A seventh/triad (or triad/triad) model with an ascending written
  // fourth between roots. A diatonic copy may make that fourth augmented.
  const rootMotion = writtenInterval({ ...firstHead.root, octave: 4 }, { ...firstArrival.root, octave: 4 });
  if ((rootMotion.diatonicSteps + 7) % 7 !== 3) return false;
  const steps = writtenInterval(firstHead.firstBass, midHead.firstBass).diatonicSteps;
  if (Math.abs(steps) !== 1 || !shiftsBy(firstHead, midHead, steps) || !shiftsBy(midHead, lastHead, steps) ||
      !shiftsBy(firstArrival, midArrival, steps) || !shiftsBy(midArrival, lastArrival, steps)) return false;

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
