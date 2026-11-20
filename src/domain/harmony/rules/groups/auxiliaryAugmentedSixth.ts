import { chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval, type KeyLike } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { ConnectionView } from "../context/views";
import { movesToWrittenTone } from "../../dominantSixthMotion";
import { isGermanToFrenchVoicing } from "./augmentedSixthContinuation";
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
  lowerOctave: boolean,
) {
  const previous = context.sliceAt(start - 1);
  if (!previous?.completeSatb) return undefined;
  const matchesTonic = (slice: AnalysisSlice) =>
    isRootPositionTonic(context, slice, key) && sameVoicing(context, slice, anchor, !lowerOctave) &&
      pitchClassEquals(slice.notes.bass!.pitch, key.tonic);
  if (matchesTonic(previous)) return previous;

  // A single short descending bass passing note can precede the auxiliary
  // chord while the three upper voices still spell the preceding tonic.
  const passing = previous.notes.bass!;
  const position = context.metric.positionAt(passing.startTick);
  const beat = position && context.analysis.metricTimeline.measures[position.measureNumber - 1]?.beatLength;
  const limit = lowerOctave ? beat ?? 0 : context.analysis.project.ppq / 2;
  if (passing.durationTicks > limit ||
      passing.startTick + passing.durationTicks !== start ||
      (passing.nonChordToneRole && passing.nonChordToneRole !== "passing") ||
      !pitchClassEquals(passing.pitch, scaleDegreePitchClass(key, 7))) return undefined;
  const entry = context.sliceAt(passing.startTick - 1);
  if (!entry?.completeSatb || !matchesTonic(entry)) return undefined;
  const descent = writtenInterval(entry.notes.bass!.pitch, passing.pitch);
  if (descent.diatonicSteps !== -1 || descent.semitones !== -2) return undefined;
  const spacing = { fromTick: passing.startTick, toTick: start };
  return context.slices({ overlapping: spacing }).all(slice =>
    (!slice.chord || isRootPositionTonic(context, slice, key)) &&
    sameVoicing(context, slice, anchor, false),
  ) ? entry : undefined;
}

// Read the functional close at the actual tonic bass attack. The full tonic
// voicing can settle one slice later when the dominant seventh resolves late.
function hasAuthenticPreparation(context: HarmonyRuleContext, tonic: AnalysisSlice, key: KeyLike) {
  const attack = tonic.notes.bass!.startTick;
  const before = context.sliceAt(attack - 1);
  const chord = before?.chord;
  if (!before?.completeSatb || !chord || before.key.id !== tonic.key.id ||
      tonic.tick - attack > context.analysis.project.ppq / 2 ||
      context.analysis.phraseBoundaries.some(mark => !mark.stale && before.tick < mark.tick && mark.tick <= tonic.tick)) return false;
  const { identity } = chord;
  const { structure } = identity;
  const dominant = scaleDegreePitchClass(key, 5);
  const reading = context.harmony.primaryInterpretation(chord);
  if (structure.kind !== "tertian" || structure.quality !== "dominant7" ||
      structure.alterations.length || structure.extensions.length ||
      ![identity.root, identity.bass, before.notes.bass!.pitch].every(p => pitchClassEquals(p, dominant)) ||
      reading.status !== "resolved" || reading.value.degree !== 5 || reading.value.degreeAlteration !== 0 ||
      reading.value.appliedTarget || !sameKey(reading.value.localKey ?? before.key, key)) return false;

  const tones = chordIdentityToneSpellings(identity);
  const written = activeNotes(before);
  if (written.some(({ note }) => note.nonChordToneRole || !tones.some(p => pitchClassEquals(p, note.pitch)))) return false;
  const third = written.filter(({ note }) => pitchClassEquals(note.pitch, tones[1]));
  const seventh = written.filter(({ note }) => pitchClassEquals(note.pitch, tones[3]));
  if (third.length !== 1 || seventh.length !== 1) return false;
  const bassLeap = writtenInterval(before.notes.bass!.pitch, tonic.notes.bass!.pitch);
  return (bassLeap.semitones === 5 || bassLeap.semitones === -7) &&
    movesToWrittenTone(third[0].note.pitch, tonic.notes[third[0].voiceId]!.pitch, key.tonic, 1, 1) &&
    movesToWrittenTone(seventh[0].note.pitch, tonic.notes[seventh[0].voiceId]!.pitch, scaleDegreePitchClass(key, 3), -1);
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

  const bassMotion = writtenInterval(middle.notes.bass!.pitch, targetBass.pitch);
  const lowerOctave = bassMotion.diatonicSteps === -5 && bassMotion.semitones === -8;
  if (!lowerOctave && (bassMotion.diatonicSteps !== 2 || bassMotion.semitones !== 4)) return false;
  if (!middleNotes.every(({ voiceId, note }) => {
    const arrival = landing.notes[voiceId]!;
    if (note.nonChordToneRole || arrival.nonChordToneRole) return false;
    if (pitchClassEquals(note.pitch, key.tonic)) return context.pitch.sameWrittenPitch(note, arrival);
    const motion = writtenInterval(note.pitch, arrival.pitch);
    if (voiceId === "bass") return true;
    const goal = pitchClassEquals(note.pitch, second) ? minorThird : fifth;
    return (pitchClassEquals(note.pitch, second) || pitchClassEquals(note.pitch, upperLeadingTone)) &&
      pitchClassEquals(arrival.pitch, goal) && motion.diatonicSteps === 1 && motion.semitones === 1;
  })) return false;

  const phrase = context.phraseAt(landing.tick);
  if (!phrase || phrase.toTick !== target.span.toTick ||
      (phrase.toTick !== context.analysis.project.lengthTicks &&
        phrase.endBoundary?.confidence !== "certain")) return false;

  // A lower octave is a closing revoicing of an already settled tonic.
  // Read a contiguous German preparation if its endpoints continue into French.
  let auxiliaryOnset = source.span.fromTick;
  if (lowerOctave) {
    const incoming = context.spanNeighborhood(source).incoming;
    if (incoming?.connection.contiguous && incoming.connection.sameKey &&
        isGermanToFrenchVoicing(context, incoming.sourceBoundary, source.firstSlice, key)) {
      auxiliaryOnset = incoming.sourceBoundary.tick;
    }
  }
  const preparation = tonicPreparation(context, auxiliaryOnset, landing, key, lowerOctave);
  if (lowerOctave) {
    if (!preparation || preparation.key.id !== middle.key.id || targetBass.startTick !== landing.tick) return false;
    const drop = writtenInterval(preparation.notes.bass!.pitch, targetBass.pitch);
    if (drop.diatonicSteps !== -7 || drop.semitones !== -12 ||
        !middleNotes.some(({ voiceId, note }) => voiceId !== "bass" && pitchClassEquals(note.pitch, key.tonic) &&
          preparation.notes[voiceId]?.id === note.id && landing.notes[voiceId]?.id === note.id) ||
        !hasAuthenticPreparation(context, preparation, key)) return false;
  }
  return !!preparation && preparation.tick >= phrase.fromTick &&
    source.slices.every(slice =>
      slice.chord && pitchClassEquals(slice.chord.identity.bass, sixth) && sameVoicing(context, slice, middle),
    ) &&
    target.slices.every(slice => isRootPositionTonic(context, slice, key) && sameVoicing(context, slice, landing));
}
