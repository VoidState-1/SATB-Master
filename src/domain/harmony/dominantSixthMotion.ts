import { pitchClassEquals, writtenInterval, type SpelledPitch, type SpelledPitchClass } from "../pitch";

export function movesToWrittenTone(
  from: SpelledPitch,
  to: SpelledPitch,
  target: SpelledPitchClass,
  diatonicSteps: number,
  semitones?: number,
) {
  if (!pitchClassEquals(to, target)) return false;
  const motion = writtenInterval(from, to);
  return motion.diatonicSteps === diatonicSteps && (semitones === undefined || motion.semitones === semitones);
}

export function resolvesDominantInnerVoice(
  from: SpelledPitch | undefined,
  to: SpelledPitch | undefined,
  leadingTone: SpelledPitchClass,
  seventh: SpelledPitchClass,
  tonic: SpelledPitchClass,
  third: SpelledPitchClass,
) {
  if (!from || !to) return false;
  if (pitchClassEquals(from, leadingTone)) return movesToWrittenTone(from, to, tonic, 1, 1);
  return pitchClassEquals(from, seventh) && movesToWrittenTone(from, to, third, -1);
}
