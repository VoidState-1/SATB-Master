import { chordToneSpellings } from "../chordModel";
import { pitchClassEquals, spelledPitchEquals, writtenInterval, type SpelledPitch, type SpelledPitchClass } from "../pitch";
import type { VoiceId } from "../project/types";
import type { AnalysisNote } from "./analysis";

export const dominantSixthInnerVoices = ["alto", "tenor"] as const;
export const dominantSixthLowerVoices = ["alto", "tenor", "bass"] as const;

type Voicing = Readonly<Partial<Record<VoiceId, AnalysisNote>>>;

export function continuesWrittenDominantSeventh(previous: Voicing, source: Voicing, root: SpelledPitchClass) {
  const { soprano, alto, tenor, bass } = previous;
  if (!soprano || !alto || !tenor || !bass || bass.id !== source.bass?.id ||
      [soprano, alto, tenor, bass].some(note => note.nonChordToneRole) ||
      !pitchClassEquals(bass.pitch, root)) return false;
  const [, third, fifth, seventh] = chordToneSpellings(root, "dominant7");
  return (pitchClassEquals(soprano.pitch, root) || pitchClassEquals(soprano.pitch, fifth)) &&
    ((pitchClassEquals(alto.pitch, third) && pitchClassEquals(tenor.pitch, seventh)) ||
     (pitchClassEquals(alto.pitch, seventh) && pitchClassEquals(tenor.pitch, third))) &&
    Boolean(source.alto && source.tenor &&
      spelledPitchEquals(alto.pitch, source.alto.pitch) && spelledPitchEquals(tenor.pitch, source.tenor.pitch));
}

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
  tonicFifth?: SpelledPitchClass,
) {
  if (!from || !to) return false;
  if (pitchClassEquals(from, leadingTone)) {
    return movesToWrittenTone(from, to, tonic, 1, 1) ||
      leadingToneDescendsToTonicFifth(from, to, leadingTone, tonicFifth);
  }
  return pitchClassEquals(from, seventh) && movesToWrittenTone(from, to, third, -1);
}

export function leadingToneDescendsToTonicFifth(
  from: SpelledPitch | undefined,
  to: SpelledPitch | undefined,
  leadingTone: SpelledPitchClass,
  tonicFifth: SpelledPitchClass | undefined,
) {
  return Boolean(from && to && tonicFifth && pitchClassEquals(from, leadingTone) &&
    movesToWrittenTone(from, to, tonicFifth, -2, -4));
}
