import { chordToneSpellings } from "../../../chordModel";
import { pitchClassEquals, type SpelledPitchClass } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import { movesToWrittenTone } from "../../dominantSixthMotion";
import { matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";

// Spasobin §14.4, ex. 14-195. The root goes to the tonic; the fifth and
// seventh step down in their own voices while the inner third goes to the tonic fifth.
export function supportsWrittenInnerLeadingToneDescent(
  source: AnalysisSlice, target: AnalysisSlice, dominant: SpelledPitchClass, tonic: SpelledPitchClass,
) {
  const fromBass = source.notes.bass;
  const toBass = target.notes.bass;
  if (!fromBass || !toBass || !pitchClassEquals(fromBass.pitch, dominant) ||
      !matchesWrittenChord(source, dominant, "dominant7") ||
      !(movesToWrittenTone(fromBass.pitch, toBass.pitch, tonic, 3, 5) ||
        movesToWrittenTone(fromBass.pitch, toBass.pitch, tonic, -4, -7))) return false;

  const quality = (["major", "minor"] as const).find(mode => matchesWrittenChord(target, tonic, mode));
  if (!quality) return false;

  const [, , fifth, seventh] = chordToneSpellings(dominant, "dominant7");
  const [, tonicThird] = chordToneSpellings(tonic, quality);
  const fifthVoice = VOICE_ORDER.find(voice => pitchClassEquals(source.notes[voice]!.pitch, fifth));
  const seventhVoice = VOICE_ORDER.find(voice => pitchClassEquals(source.notes[voice]!.pitch, seventh));
  return !!fifthVoice && !!seventhVoice &&
    resolvesInVoice(source, target, fifthVoice, tonic, -1) &&
    resolvesInVoice(source, target, seventhVoice, tonicThird, -1);
}
