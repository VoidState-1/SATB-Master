import type { ChordIdentity } from "../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, type KeyLike } from "../pitch";
import { VOICE_ORDER, type VoiceId } from "../project";
import type { AnalysisNote } from "./analysis";
import { movesToWrittenTone } from "./dominantSixthMotion";

type Voicing = Readonly<Partial<Record<VoiceId, AnalysisNote>>>;

export function isMajorTonicSixFour(identity: ChordIdentity, key: KeyLike) {
  const { structure } = identity;
  return key.mode === "major" && structure.kind === "tertian" && structure.quality === "major" &&
    structure.extensions.length === 0 && structure.alterations.length === 0 &&
    pitchClassEquals(identity.root, key.tonic) &&
    pitchClassEquals(identity.bass, scaleDegreePitchClass(key, 5));
}

/** Spasobin examples 28-423, 30-451 and 30-456. Require the written ♯2, not ♭3. */
export function resolvesDoubleAugmentedFourThree(source: Voicing, target: Voicing, key: KeyLike) {
  const bass = source.bass;
  const targetBass = target.bass;
  if (key.mode !== "major" || !bass || !targetBass ||
      !pitchClassEquals(bass.pitch, scaleDegreePitchClass(key, 6, -1))) return false;
  const raisedSecond = scaleDegreePitchClass(key, 2, 1);
  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const majorThird = scaleDegreePitchClass(key, 3);
  const dominant = scaleDegreePitchClass(key, 5);
  const upperNotes = [source.soprano, source.alto, source.tenor];
  if (![key.tonic, raisedSecond, raisedFourth].every(tone =>
    upperNotes.some(note => note && pitchClassEquals(note.pitch, tone)))) return false;

  return VOICE_ORDER.every(voice => {
    const before = source[voice];
    const after = target[voice];
    if (!before || !after || before.nonChordToneRole || after.nonChordToneRole) return false;
    if (toMidi(before.pitch) < toMidi(bass.pitch) || toMidi(after.pitch) < toMidi(targetBass.pitch)) return false;
    if (voice === "bass") return movesToWrittenTone(before.pitch, after.pitch, dominant, -1, -1);
    if (pitchClassEquals(before.pitch, key.tonic)) return spelledPitchEquals(before.pitch, after.pitch);
    if (pitchClassEquals(before.pitch, raisedSecond)) return movesToWrittenTone(before.pitch, after.pitch, majorThird, 1, 1);
    return movesToWrittenTone(before.pitch, after.pitch, dominant, 1, 1);
  });
}
