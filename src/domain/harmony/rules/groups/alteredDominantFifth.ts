import { chordToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, writtenInterval, type SpelledPitchClass } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import { soundsDeclaredChord } from "../../writtenVoicing";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { resolvesRaisedFifthToDoubledThird } from "../../raisedFifthResolution";
import { hasWrittenVoicing, matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";

function resolvesMember(
  source: AnalysisSlice, target: AnalysisSlice, member: SpelledPitchClass,
  destination: SpelledPitchClass, direction: 1 | -1,
) {
  return VOICE_ORDER.some(voice => pitchClassEquals(source.notes[voice]!.pitch, member) &&
    resolvesInVoice(source, target, voice, destination, direction));
}

function labelFitsAlteredDominant(slice: AnalysisSlice, root: SpelledPitchClass) {
  return !slice.chord || (pitchClassEquals(slice.chord.identity.root, root) && soundsDeclaredChord(slice));
}

/** A secondary dominant can be identified from the two successive leading
 * tones. Each must resolve in the part that sounds it, first to the root of
 * the altered dominant and then to the local tonic. */
function hasSuccessiveDominantResolutions(
  before: AnalysisSlice, altered: AnalysisSlice, arrival: AnalysisSlice,
  preparatoryRoot: SpelledPitchClass, root: SpelledPitchClass, tonic: SpelledPitchClass,
) {
  const [, preparatoryThird, , preparatorySeventh] = chordToneSpellings(preparatoryRoot, "dominant7");
  const dominantThird = chordToneSpellings(root, "major")[1];
  const hasSeventh = matchesWrittenChord(before, preparatoryRoot, "dominant7");
  if ((!hasSeventh && !matchesWrittenChord(before, preparatoryRoot, "major")) ||
      !matchesWrittenChord(arrival, tonic, "major")) return false;
  return resolvesMember(before, altered, preparatoryThird, root, 1) &&
    resolvesMember(altered, arrival, dominantThird, tonic, 1) &&
    (!hasSeventh || resolvesMember(before, altered, preparatorySeventh, dominantThird, -1));
}

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
  if (!pitchClassEquals(landing.pitch, raisesFifth ? major[1] : tonic)) return false;

  const [dominant, third, , seventh] = chordToneSpellings(root, "dominant7");
  const altered = [dominant, third, current.pitch];
  const alteredSeventh = [...altered, seventh];
  let heardDominantSeventh = hasWrittenVoicing(before, chordToneSpellings(root, "dominant7"));
  const alteredSlices = context.slices({ overlapping: { fromTick: start, toTick: end } }).toArray();
  for (const slice of alteredSlices) {
    if (slice.key.id !== before.key.id) return false;
    if (hasWrittenVoicing(slice, alteredSeventh)) heardDominantSeventh = true;
    else if (!hasWrittenVoicing(slice, altered)) return false;
  }
  if (!hasWrittenVoicing(arrival, major) &&
      (raisesFifth || !hasWrittenVoicing(arrival, chordToneSpellings(tonic, "minor")))) {
    const last = alteredSlices.at(-1);
    return raisesFifth && !!last && alteredSlices.every(slice => labelFitsAlteredDominant(slice, root)) &&
      resolvesRaisedFifthToDoubledThird(last, arrival, tonic);
  }
  if (heardDominantSeventh || (pitchClassEquals(tonic, arrival.key.tonic) &&
      (!raisesFifth || arrival.key.mode === "major"))) return true;

  // A raised fifth alone permits a tonic–subdominant reading. Away from
  // the printed tonic, seek the preceding dominant as independent evidence.
  const alteredOnset = alteredSlices[0];
  return raisesFifth && !!alteredOnset && !pitchClassEquals(root, before.key.tonic) &&
    alteredSlices.every(slice => labelFitsAlteredDominant(slice, root)) &&
    hasSuccessiveDominantResolutions(before, alteredOnset, arrival, previous.pitch, root, tonic);
}
