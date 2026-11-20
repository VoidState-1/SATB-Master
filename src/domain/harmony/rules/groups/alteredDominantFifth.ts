import { chordToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { MelodyTransition } from "../../analysis";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { hasWrittenVoicing } from "../helpers/writtenResolution";

/** Spasobin §46. A natural scale degree II becomes the altered fifth of V.
 * Its direction and its actual destination distinguish this motion from an
 * arbitrary chromatic unison, even when the passage has no chord labels. */
export function preparesAlteredDominantFifth(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = motion;
  if (!motion.contiguous || !motion.sameKey || entry.diatonicSteps !== 0 ||
      Math.abs(entry.semitones) !== 1 || previous.nonChordToneRole || current.nonChordToneRole) return false;

  const start = current.startTick;
  const end = start + current.durationTicks;
  const before = context.sliceAt(start - 1);
  const arrival = context.sliceAt(end);
  const landing = arrival?.notes[voiceId];
  if (!before?.completeSatb || !arrival || !landing || landing.startTick !== end ||
      before.key.id !== arrival.key.id || context.phraseAt(start - 1)?.id !== context.phraseAt(end)?.id ||
      VOICE_ORDER.some(voice => before.notes[voice]!.nonChordToneRole) ||
      !hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(voice => before.notes[voice]!.pitch))) return false;
  const exit = writtenInterval(current.pitch, landing.pitch);
  if (exit.semitones !== entry.semitones || exit.diatonicSteps !== entry.semitones) return false;

  // Relative to the original fifth, the dominant root is a fourth above
  // and its tonic is a whole step below. Keep their written spellings.
  const fifth = { tonic: previous.pitch, mode: "major" } as const;
  const root = scaleDegreePitchClass(fifth, 4);
  const tonic = scaleDegreePitchClass(fifth, 7, -1);
  const major = chordToneSpellings(tonic, "major");
  const raisesFifth = entry.semitones > 0;
  if (!pitchClassEquals(landing.pitch, raisesFifth ? major[1] : tonic) ||
      !(hasWrittenVoicing(arrival, major) ||
        (!raisesFifth && hasWrittenVoicing(arrival, chordToneSpellings(tonic, "minor"))))) return false;

  const [dominant, third, , seventh] = chordToneSpellings(root, "dominant7");
  const altered = [dominant, third, current.pitch];
  const alteredSeventh = [...altered, seventh];
  return context.slices({ overlapping: { fromTick: start, toTick: end } }).toArray().every(slice =>
    slice.key.id === before.key.id &&
    (hasWrittenVoicing(slice, altered) || hasWrittenVoicing(slice, alteredSeventh)));
}
