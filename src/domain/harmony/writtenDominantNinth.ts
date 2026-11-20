import { chordIdentityToneSpellingForDegree, identityContainsWrittenPitchClass, type ChordIdentity } from "../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, writtenInterval, type SpelledPitch } from "../pitch";

export function dominantNinthTone(identity: ChordIdentity) {
  const structure = identity.structure;
  return structure.kind === "tertian" && structure.quality === "dominant7" && structure.extensions.includes(9)
    ? chordIdentityToneSpellingForDegree(identity, 9) : undefined;
}

/** The ninth is an absolute chord member. Use its written motion and the
 * actual landing identity, including the two textbook same-root V7 exits. */
export function writtenDominantNinthResolves(
  source: ChordIdentity, target: ChordIdentity, from: SpelledPitch, to: SpelledPitch,
) {
  const ninth = dominantNinthTone(source);
  if (!ninth || !pitchClassEquals(from, ninth) || !identityContainsWrittenPitchClass(target, to)) return false;
  const motion = writtenInterval(from, to);
  const step = motion.diatonicSteps === -1 && (motion.semitones === -1 || motion.semitones === -2);
  const structure = target.structure;
  if (structure.kind === "tertian" && !structure.extensions.length) {
    const tonic = scaleDegreePitchClass({ tonic: source.root, mode: "major" }, 4);
    if ((structure.quality === "major" || structure.quality === "minor") && pitchClassEquals(target.root, tonic)) {
      const fifth = chordIdentityToneSpellingForDegree(target, 5);
      return !!fifth && step && pitchClassEquals(to, fifth);
    }
    if (structure.quality === "dominant7" && pitchClassEquals(source.root, target.root)) {
      if (step && pitchClassEquals(to, target.root)) return true;
      const seventh = chordIdentityToneSpellingForDegree(target, 7);
      return !!seventh && pitchClassEquals(to, seventh) && motion.diatonicSteps === -2 &&
        (motion.semitones === -3 || motion.semitones === -4);
    }
  }
  return step;
}
