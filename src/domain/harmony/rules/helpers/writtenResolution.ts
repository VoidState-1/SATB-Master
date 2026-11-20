import { chordToneSpellings, type ChordQuality } from "../../../chordModel";
import { pitchClassEquals, writtenInterval, type SpelledPitchClass } from "../../../pitch";
import type { VoiceId } from "../../../project";
import type { AnalysisSlice } from "../../analysis";
import { soundsCompleteWrittenTones } from "../../writtenVoicing";

export function hasWrittenVoicing(slice: AnalysisSlice, tones: readonly SpelledPitchClass[]) {
  const bass = slice.notes.bass;
  return !!bass && slice.completeSatb && soundsCompleteWrittenTones(tones, Object.values(slice.notes), bass);
}

export function matchesWrittenChord(slice: AnalysisSlice, root: SpelledPitchClass, quality: ChordQuality) {
  const identity = slice.chord?.identity;
  if (identity && (identity.structure.kind !== "tertian" || identity.structure.quality !== quality ||
      identity.structure.extensions.length || identity.structure.alterations.length ||
      !pitchClassEquals(identity.root, root) || !slice.notes.bass ||
      !pitchClassEquals(identity.bass, slice.notes.bass.pitch))) return false;
  return hasWrittenVoicing(slice, chordToneSpellings(root, quality));
}

export function resolvesInVoice(source: AnalysisSlice, target: AnalysisSlice, voice: VoiceId,
  destination: SpelledPitchClass, direction: -1 | 1) {
  const from = source.notes[voice], to = target.notes[voice];
  if (!from || !to || from.startTick + from.durationTicks !== target.tick || to.startTick !== target.tick ||
      !pitchClassEquals(to.pitch, destination)) return false;
  const step = writtenInterval(from.pitch, to.pitch);
  return step.diatonicSteps === direction &&
    (step.semitones === direction || (direction === -1 && step.semitones === -2));
}
