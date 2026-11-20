import { chordToneSpellings } from "../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, writtenInterval, type SpelledPitchClass } from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import type { AnalysisSlice } from "./analysis";
import { soundsDeclaredChord } from "./writtenVoicing";
import { hasWrittenVoicing, resolvesInVoice } from "./writtenResolution";

export type RaisedFifthFrame = Pick<AnalysisSlice, "tick" | "endTick" | "notes" | "key" | "completeSatb" | "chord">;

/** Spasobin §46.4: in root position V7(#5), the raised fifth and the seventh
 * approach the major tonic third from opposite sides. Both parts keep it. */
export function resolvesRaisedFifthToDoubledThird(source: RaisedFifthFrame, landing: RaisedFifthFrame, tonic: SpelledPitchClass) {
  const localMajor = { tonic, mode: "major" } as const;
  const root = scaleDegreePitchClass(localMajor, 5);
  const [, leading, , seventh] = chordToneSpellings(root, "dominant7");
  const raisedFifth = scaleDegreePitchClass(localMajor, 2, 1);
  const tonicThird = scaleDegreePitchClass(localMajor, 3);
  const target = landing.chord?.identity;
  if (source.endTick !== landing.tick || source.key.id !== landing.key.id ||
      !hasWrittenVoicing(source, [root, leading, raisedFifth, seventh]) ||
      !hasWrittenVoicing(landing, [tonic, tonicThird]) ||
      !pitchClassEquals(source.notes.bass!.pitch, root) || !pitchClassEquals(landing.notes.bass!.pitch, tonic) ||
      (source.chord && (!pitchClassEquals(source.chord.identity.root, root) || !soundsDeclaredChord(source))) ||
      (target && (!pitchClassEquals(target.root, tonic) || !pitchClassEquals(target.bass, tonic) ||
        target.structure.kind !== "tertian" || target.structure.quality !== "major" ||
        target.structure.extensions.length || target.structure.alterations.length))) return false;

  return VOICE_ORDER.every(voice => {
    const from = source.notes[voice]!;
    if (voice === "bass") {
      const to = landing.notes.bass!;
      const leap = writtenInterval(from.pitch, to.pitch);
      return from.startTick + from.durationTicks === landing.tick && to.startTick === landing.tick &&
        (leap.semitones === 5 || leap.semitones === -7);
    }
    if (pitchClassEquals(from.pitch, leading)) return resolvesInVoice(source, landing, voice, tonic, 1);
    return resolvesInVoice(source, landing, voice, tonicThird, pitchClassEquals(from.pitch, seventh) ? -1 : 1);
  });
}
