import { chordIdentityInversion, chordIdentityToneSpellings, type ChordIdentity } from "../chordModel";
import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval } from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import { upperPassingMotion, type UpperPassingFrame } from "./upperPassingMotion";
import { soundsCompleteWrittenChord, soundsCompleteWrittenMembers } from "./writtenVoicing";

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
  if (sixFour.toTick !== after.fromTick || after.key.id !== key.id || after.key.mode !== key.mode ||
      !pitchClassEquals(after.key.tonic, key.tonic) ||
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
