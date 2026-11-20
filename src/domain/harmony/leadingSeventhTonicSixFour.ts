import { chordToneSpellings, primaryHarmonyInterpretation } from "../chordModel";
import { keyEquals, isWrittenStep, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import type { AnalysisSlice } from "./analysis";
import { matchesWrittenChord, resolvesInVoice } from "./writtenResolution";

function inWrittenKey(slice: AnalysisSlice, key: AnalysisSlice["key"]) {
  const reading = slice.chord?.semantics && primaryHarmonyInterpretation(slice.chord.semantics);
  const local = reading?.localKey ?? slice.key;
  return slice.key.id === key.id && !reading?.appliedTarget && keyEquals(local, key);
}

/** Spasobin §22.3, example 22-303: the leading-tone seventh in third
 * inversion may resolve to a third-doubled tonic 6/4 on the way to ii6. */
export function resolvesLeadingSeventhToPassingTonic(
  source: AnalysisSlice, tonic: AnalysisSlice, destination: AnalysisSlice,
) {
  const key = tonic.key;
  if (source.endTick !== tonic.tick || tonic.endTick !== destination.tick ||
      ![source, tonic, destination].every(slice => inWrittenKey(slice, key))) return false;

  const tonicQuality = key.mode === "major" ? "major" : "minor";
  const tonicTones = chordToneSpellings(key.tonic, tonicQuality);
  const leading = leadingTonePitchClass(key);
  const supertonic = scaleDegreePitchClass(key, 2);
  if (!matchesWrittenChord(tonic, key.tonic, tonicQuality) ||
      !matchesWrittenChord(destination, supertonic, key.mode === "major" ? "minor" : "diminished") ||
      !pitchClassEquals(tonic.notes.bass!.pitch, tonicTones[2]) ||
      !resolvesInVoice(tonic, destination, "bass", scaleDegreePitchClass(key, 4), -1)) return false;

  const qualities = ["diminished7", "halfDiminished7"] as const;
  const quality = qualities.find(value => matchesWrittenChord(source, leading, value));
  if (!quality) return false;
  const sourceTones = chordToneSpellings(leading, quality);
  if (!pitchClassEquals(source.notes.bass!.pitch, sourceTones[3])) return false;

  const destinations = [tonicTones[0], tonicTones[1], tonicTones[1], tonicTones[2]];
  return VOICE_ORDER.every(voice => {
    const from = source.notes[voice]!, to = tonic.notes[voice]!;
    const degree = sourceTones.findIndex(tone => pitchClassEquals(tone, from.pitch));
    const direction = degree < 2 ? 1 : -1;
    const step = writtenInterval(from.pitch, to.pitch);
    return from.startTick + from.durationTicks === tonic.tick && to.startTick === tonic.tick &&
      pitchClassEquals(to.pitch, destinations[degree]) && isWrittenStep(step) && step.diatonicSteps === direction;
  });
}
