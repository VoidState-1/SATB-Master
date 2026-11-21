import { chordToneSpellings, type ChordQuality, type KeyReference } from "../chordModel";
import {
  isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, stepIndex, toMidi,
  writtenInterval, type SpelledPitchClass,
} from "../pitch";
import { VOICE_ORDER, type VoiceId } from "../project";
import type { AnalysisSlice } from "./analysis";
import { soundsCompleteWrittenTones } from "./writtenVoicing";

export function hasWrittenVoicing(slice: Pick<AnalysisSlice, "notes" | "completeSatb">, tones: readonly SpelledPitchClass[]) {
  const bass = slice.notes.bass;
  return !!bass && slice.completeSatb && soundsCompleteWrittenTones(tones, Object.values(slice.notes), bass);
}

/** An absent label permits a written reading. A named chord must agree in spelling, bass and structure. */
export function allowsWrittenTertianIdentity(
  slice: Pick<AnalysisSlice, "chord" | "notes">, root: SpelledPitchClass, quality: ChordQuality,
) {
  const identity = slice.chord?.identity;
  if (!identity) return true;
  const { structure } = identity;
  const bass = slice.notes.bass;
  return !!bass && pitchClassEquals(identity.bass, bass.pitch) && pitchClassEquals(identity.root, root) &&
    structure.kind === "tertian" && structure.quality === quality &&
    !structure.extensions.length && !structure.alterations.length;
}

export function matchesWrittenChord(slice: AnalysisSlice, root: SpelledPitchClass, quality: ChordQuality) {
  return allowsWrittenTertianIdentity(slice, root, quality) && hasWrittenVoicing(slice, chordToneSpellings(root, quality));
}

type WrittenVoiceFrame = Pick<AnalysisSlice, "tick" | "notes">;

export function resolvesInVoice(source: WrittenVoiceFrame, target: WrittenVoiceFrame, voice: VoiceId,
  destination: SpelledPitchClass, direction: -1 | 1) {
  const from = source.notes[voice], to = target.notes[voice];
  if (!from || !to || from.startTick + from.durationTicks !== target.tick || to.startTick !== target.tick ||
      !pitchClassEquals(to.pitch, destination)) return false;
  const step = writtenInterval(from.pitch, to.pitch);
  return step.diatonicSteps === direction &&
    (step.semitones === direction || (direction === -1 && step.semitones === -2));
}

export function resolvesMaskedStep(
  from: WrittenVoiceFrame, to: WrittenVoiceFrame, voice: VoiceId, expectedFrom: SpelledPitchClass,
  destination: SpelledPitchClass, semitones: -1 | 1,
) {
  const start = from.notes[voice]!, end = to.notes[voice]!;
  return !start.nonChordToneRole && !end.nonChordToneRole && start.startTick + start.durationTicks === to.tick &&
    end.startTick === to.tick && pitchClassEquals(end.pitch, destination) &&
    (stepIndex(destination.step) - stepIndex(expectedFrom.step) + 7) % 7 === (semitones + 7) % 7 &&
    toMidi(end.pitch) - toMidi(start.pitch) === semitones;
}

export function keepsWrittenMember(from: WrittenVoiceFrame, to: WrittenVoiceFrame, voice: VoiceId) {
  const start = from.notes[voice]!, end = to.notes[voice]!;
  return !start.nonChordToneRole && !end.nonChordToneRole && spelledPitchEquals(start.pitch, end.pitch) &&
    (start.id === end.id || (start.startTick + start.durationTicks === to.tick && end.startTick === to.tick));
}

export function respeltDegrees(key: KeyReference) {
  return {
    tonic: key.tonic,
    tonicThird: scaleDegreePitchClass(key, 3),
    raisedSecond: scaleDegreePitchClass(key, 2, 1),
    raisedFourth: scaleDegreePitchClass(key, 4, 1),
    sixth: scaleDegreePitchClass(key, 6),
    dominant: scaleDegreePitchClass(key, 5),
  };
}

type WrittenResolutionFrame = Pick<AnalysisSlice, "tick" | "endTick" | "notes" | "completeSatb">;

// Spasobin §28, ex. 28-423/427. The leading seventh of V may write its
// seventh as ♯II in root position or first inversion before K64.
export function writtenDoubleDominantResolution(
  source: WrittenResolutionFrame, target: WrittenResolutionFrame, key: KeyReference,
) {
  if (key.mode !== "major" || !source.completeSatb || !target.completeSatb || source.endTick !== target.tick) return;
  const { tonic, tonicThird, raisedSecond, raisedFourth, sixth, dominant } = respeltDegrees(key);
  const bass = source.notes.bass!.pitch;
  if ((!pitchClassEquals(bass, raisedFourth) && !pitchClassEquals(bass, sixth)) ||
      !pitchClassEquals(target.notes.bass!.pitch, dominant)) return;

  const loweredThird = scaleDegreePitchClass(key, 3, -1);
  const voiceId = VOICE_ORDER.find(voice => {
    const pitch = source.notes[voice]!.pitch;
    return pitchClassEquals(pitch, loweredThird) || pitchClassEquals(pitch, raisedSecond);
  });
  if (!voiceId || !hasWrittenVoicing(source, [raisedFourth, sixth, tonic, source.notes[voiceId]!.pitch]) ||
      !hasWrittenVoicing(target, [tonic, tonicThird, dominant]) ||
      !resolvesMaskedStep(source, target, voiceId, raisedSecond, tonicThird, 1)) return;

  for (const voice of VOICE_ORDER) {
    if (voice === voiceId) continue;
    const pitch = source.notes[voice]!.pitch;
    if (pitchClassEquals(pitch, tonic)) {
      if (!keepsWrittenMember(source, target, voice)) return;
    } else if (!resolvesInVoice(source, target, voice, dominant, pitchClassEquals(pitch, raisedFourth) ? 1 : -1)) return;
  }
  return { voiceId, previous: raisedSecond, current: tonicThird };
}

/** §22.3: the leading seventh's root and third rise, while its fifth and seventh
 * descend. The two middle members meet on the third of the receiving tonic. */
export function resolvesLeadingSeventhToDoubledThird(
  source: AnalysisSlice, target: AnalysisSlice,
  sourceTones: readonly SpelledPitchClass[], tonicTones: readonly SpelledPitchClass[],
) {
  const destinations = [tonicTones[0], tonicTones[1], tonicTones[1], tonicTones[2]];
  return VOICE_ORDER.every(voice => {
    const from = source.notes[voice], to = target.notes[voice];
    if (!from || !to || from.startTick + from.durationTicks !== source.endTick || to.startTick !== source.endTick) return false;
    const member = sourceTones.findIndex(tone => pitchClassEquals(from.pitch, tone));
    if (member < 0 || !pitchClassEquals(to.pitch, destinations[member])) return false;
    const motion = writtenInterval(from.pitch, to.pitch);
    return isWrittenStep(motion) && motion.diatonicSteps === (member < 2 ? 1 : -1);
  });
}

/** §32.4c. A doubled chromatically altered degree leaves in contrary stepwise motion. */
export function doublesMoveAgainstAlteration(
  before: Pick<AnalysisSlice, "notes">, after: Pick<AnalysisSlice, "notes">,
  alteredVoice: VoiceId, unalteredTone: SpelledPitchClass, semitones: number,
) {
  return VOICE_ORDER.every(voice => {
    const from = before.notes[voice];
    if (voice === alteredVoice || !from || !pitchClassEquals(from.pitch, unalteredTone)) return true;
    const to = after.notes[voice];
    if (!to) return false;
    const motion = writtenInterval(from.pitch, to.pitch);
    return motion.diatonicSteps === -semitones && Math.sign(motion.semitones) === -semitones &&
      Math.abs(motion.semitones) <= 2;
  });
}
