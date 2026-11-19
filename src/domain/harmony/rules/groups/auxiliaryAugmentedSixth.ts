import { chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval, type KeyLike } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { ConnectionView } from "../context/views";
import { activeNotes } from "../helpers/core";

function sameKey(left: KeyLike, right: KeyLike) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

function isRootPositionTonic(context: HarmonyRuleContext, slice: AnalysisSlice, key: KeyLike) {
  const chord = slice.chord;
  if (!chord || chord.semantics?.cadenceRole) return false;
  const { root, bass, structure } = chord.identity;
  if (
    structure.kind !== "tertian" || structure.quality !== "minor" ||
    structure.alterations.length || structure.extensions.length ||
    !pitchClassEquals(root, key.tonic) || !pitchClassEquals(bass, root)
  ) return false;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status === "ambiguous") return false;
  if (reading.status === "unavailable") return sameKey(slice.key, key);
  const { degree, degreeAlteration, localKey, appliedTarget, designation } = reading.value;
  return degree === 1 && degreeAlteration === 0 && !appliedTarget &&
    (!designation || (designation.kind === "primary" && designation.primaryFunction === "tonic")) &&
    sameKey(localKey ?? slice.key, key);
}

function sameVoicing(
  context: HarmonyRuleContext,
  slice: AnalysisSlice,
  reference: AnalysisSlice,
  includeBass = true,
) {
  return sameKey(slice.key, reference.key) && slice.completeSatb &&
    VOICE_ORDER.every(voiceId => {
      if (!includeBass && voiceId === "bass") return true;
      const note = slice.notes[voiceId]!;
      return !note.nonChordToneRole && context.pitch.sameWrittenPitch(note, reference.notes[voiceId]!);
    });
}

function voicesInOrder(slice: AnalysisSlice) {
  const notes = activeNotes(slice);
  return notes.every(({ note }, index) =>
    index === 0 || toMidi(notes[index - 1].note.pitch) > toMidi(note.pitch),
  );
}

function tonicPreparation(
  context: HarmonyRuleContext,
  start: number,
  anchor: AnalysisSlice,
  key: KeyLike,
) {
  const previous = context.sliceAt(start - 1);
  if (!previous?.completeSatb) return undefined;
  if (isRootPositionTonic(context, previous, key) && sameVoicing(context, previous, anchor))
    return previous;

  // A single short descending bass passing note can precede the auxiliary
  // chord while the three upper voices still spell the preceding tonic.
  const passing = previous.notes.bass!;
  if (passing.durationTicks > context.analysis.project.ppq / 2 ||
      passing.startTick + passing.durationTicks !== start ||
      (passing.nonChordToneRole && passing.nonChordToneRole !== "passing") ||
      !pitchClassEquals(passing.pitch, scaleDegreePitchClass(key, 7))) return undefined;
  const entry = context.sliceAt(passing.startTick - 1);
  if (!entry || !isRootPositionTonic(context, entry, key) ||
      !sameVoicing(context, entry, anchor)) return undefined;
  const descent = writtenInterval(entry.notes.bass!.pitch, passing.pitch);
  if (descent.diatonicSteps !== -1 || descent.semitones !== -2) return undefined;
  const spacing = { fromTick: passing.startTick, toTick: start };
  return context.slices({ overlapping: spacing }).all(slice =>
    (!slice.chord || isRootPositionTonic(context, slice, key)) &&
    sameVoicing(context, slice, anchor, false),
  ) ? entry : undefined;
}

/** 第 30 章书 203–204 页「补充」，例 30-461、462。
 * 仅核对句末同一原位小主和弦之间，完整法增六的辅助性回归。 */
export function isAuxiliaryFrenchSixthReturn(
  context: HarmonyRuleContext,
  { source, target, sourceBoundary: middle, targetBoundary: landing }: ConnectionView,
  key: KeyLike,
): boolean {
  const chord = middle.chord;
  if (
    key.mode !== "minor" || !middle.completeSatb || !landing.completeSatb ||
    chord?.identity.structure.kind !== "augmented-sixth" ||
    chord.identity.structure.variant !== "french" ||
    context.harmony.primaryInterpretation(chord).status === "ambiguous" ||
    !isRootPositionTonic(context, landing, key) ||
    !voicesInOrder(middle) || !voicesInOrder(landing)
  ) return false;

  const sixth = scaleDegreePitchClass(key, 6);
  const targetBass = landing.notes.bass!;
  if (!pitchClassEquals(chord.identity.root, sixth) ||
      !pitchClassEquals(chord.identity.bass, sixth) ||
      !pitchClassEquals(middle.notes.bass!.pitch, sixth) ||
      !pitchClassEquals(targetBass.pitch, key.tonic)) return false;

  const middleNotes = activeNotes(middle);
  const tones = chordIdentityToneSpellings(chord.identity);
  if (!tones.every(tone => middleNotes.some(({ note }) => pitchClassEquals(note.pitch, tone))))
    return false;
  const upperLeadingTone = scaleDegreePitchClass(key, 4, 1);
  const second = scaleDegreePitchClass(key, 2);
  const minorThird = scaleDegreePitchClass(key, 3);
  const fifth = scaleDegreePitchClass(key, 5);

  if (!middleNotes.every(({ voiceId, note }) => {
    const arrival = landing.notes[voiceId]!;
    if (note.nonChordToneRole || arrival.nonChordToneRole) return false;
    if (pitchClassEquals(note.pitch, key.tonic)) return context.pitch.sameWrittenPitch(note, arrival);
    const motion = writtenInterval(note.pitch, arrival.pitch);
    if (voiceId === "bass") return motion.diatonicSteps === 2 && motion.semitones === 4;
    const goal = pitchClassEquals(note.pitch, second) ? minorThird : fifth;
    return (pitchClassEquals(note.pitch, second) || pitchClassEquals(note.pitch, upperLeadingTone)) &&
      pitchClassEquals(arrival.pitch, goal) && motion.diatonicSteps === 1 && motion.semitones === 1;
  })) return false;

  const phrase = context.phraseAt(landing.tick);
  if (!phrase || phrase.toTick !== target.span.toTick ||
      (phrase.toTick !== context.analysis.project.lengthTicks &&
        phrase.endBoundary?.confidence !== "certain")) return false;

  const preparation = tonicPreparation(context, source.span.fromTick, landing, key);
  return !!preparation && preparation.tick >= phrase.fromTick &&
    source.slices.every(slice =>
      slice.chord && pitchClassEquals(slice.chord.identity.bass, sixth) && sameVoicing(context, slice, middle),
    ) &&
    target.slices.every(slice => isRootPositionTonic(context, slice, key) && sameVoicing(context, slice, landing));
}
