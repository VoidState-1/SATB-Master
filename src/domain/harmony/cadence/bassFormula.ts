import { chordIdentityInversion, chordIdentityToneSpellings, type ChordIdentity, type KeyReference } from "../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, type SpelledPitchClass } from "../../pitch";

/** Classifies observed basses against the written V and I, not just their function labels. */
export function authenticBassFormula(
  key: KeyReference,
  source: ChordIdentity | undefined,
  target: ChordIdentity | undefined,
  sourceBass: SpelledPitchClass | undefined,
  targetBass: SpelledPitchClass | undefined,
): "root" | "inverted" | undefined {
  if (!source || !target || !sourceBass || !targetBass || !pitchClassEquals(source.root, scaleDegreePitchClass(key, 5)) ||
      !pitchClassEquals(target.root, key.tonic) ||
      !pitchClassEquals(sourceBass, source.bass) || !pitchClassEquals(targetBass, target.bass)) return;
  if (!chordIdentityToneSpellings(source).some(tone => pitchClassEquals(tone, sourceBass)) ||
      !chordIdentityToneSpellings(target).some(tone => pitchClassEquals(tone, targetBass))) return;
  const from = chordIdentityInversion(source);
  const to = chordIdentityInversion(target);
  if (to > 1 || (from === 0 && !pitchClassEquals(sourceBass, source.root)) ||
      (to === 0 && !pitchClassEquals(targetBass, target.root))) return;
  return from === 0 && to === 0 ? "root" : "inverted";
}
