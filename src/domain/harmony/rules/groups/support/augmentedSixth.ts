import {
  chordIdentityEquals,
  chordIdentityToneSpellings,
  type ChordIdentity,
  chordToneSpellings,
} from "../../../../chordModel";
import {
  keyEquals,
  isWrittenStep,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  writtenInterval,
  type KeyLike,
  type SpelledPitchClass,
  pitchClassValue,
} from "../../../../pitch";
import { VOICE_ORDER } from "../../../../project/voice";
import type { AnalysisNote, AnalysisSlice, MelodyTransition, SliceTransition } from "../../../analysis";
import { movesToWrittenTone, resolvesDoubleAugmentedFourThree } from "../../../facts/dominantMotion";
import { soundsCompleteWrittenMembers } from "../../../facts/writtenVoicing";
import type { HarmonyRuleContext } from "../../context/createRuleContext";
import type { ConnectionView } from "../../context/views";
import type { VoicePairTransitionFact } from "../../sharedFacts";
import {
  agreesWithExplicitIdentity,
  agreesWithExplicitMembers,
  completeVoicings,
} from "../../helpers/chordVoicing";
import { activeNotes, crossesManualPhraseBoundary } from "../../helpers/core";
import {
  keepsWrittenMember,
  readMaskedPreparation,
  resolvesMaskedStep,
  unmarkedChordMembers,
  writtenMemberAt,
} from "../../helpers/motionHarmony";

function exactlyVoiced(slice: AnalysisSlice, tones: readonly SpelledPitchClass[]) {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass) return false;
  const notes = activeNotes(slice);
  const bassMidi = toMidi(bass.pitch);
  return notes.every(({ voiceId, note }) =>
    !note.nonChordToneRole &&
    (voiceId === "bass" || toMidi(note.pitch) > bassMidi) &&
    tones.some(tone => pitchClassEquals(note.pitch, tone)),
  ) &&
    tones.every(tone => notes.some(({ note }) => pitchClassEquals(note.pitch, tone)));
}

function sameKeyDominant(
  context: HarmonyRuleContext, slice: AnalysisSlice, key: KeyLike, quality: "major" | "dominant7",
) {
  const chord = slice.chord;
  if (!chord) return;
  const { root, structure } = chord.identity;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || structure.kind !== "tertian" ||
      structure.quality !== quality || structure.extensions.length || structure.alterations.length ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, 5))) return;
  const { degree, degreeAlteration, localKey, appliedTarget, designation } = reading.value;
  if (degree === 5 && degreeAlteration === 0 && !appliedTarget &&
      (!designation || designation.primaryFunction === "dominant") &&
      keyEquals(localKey ?? slice.key, key)) return chord.identity;
}

export function resolvesAugmentedSixthHighToDominantSeventh(
  context: HarmonyRuleContext, source: AnalysisSlice, target: AnalysisSlice, key: KeyLike,
  high: AnalysisNote, arrival: AnalysisNote,
) {
  const fourth = scaleDegreePitchClass(key, 4, 0);
  if (high.nonChordToneRole || arrival.nonChordToneRole ||
      !pitchClassEquals(high.pitch, scaleDegreePitchClass(key, 4, 1)) ||
      !movesToWrittenTone(high.pitch, arrival.pitch, fourth, 0, -1) ||
      crossesManualPhraseBoundary(context, source.tick, target.tick)) return false;

  const dominant = sameKeyDominant(context, target, key, "dominant7");
  return !!dominant && pitchClassEquals(chordIdentityToneSpellings(dominant)[3], arrival.pitch);
}

export function mozartFifths(
  context: HarmonyRuleContext, { previous: source, current: target, contiguous, sameKey }: SliceTransition,
  fact: VoicePairTransitionFact,
): "triad" | "seventh" | undefined {
  const [upper, lower] = fact.voiceIds;
  if (lower !== "bass" || (upper !== "alto" && upper !== "tenor") || !contiguous || !sameKey ||
      crossesManualPhraseBoundary(context, source.tick, target.tick)) return;
  const [inner, bass] = fact.previousNotes;
  const [nextInner, nextBass] = fact.currentNotes;
  if ([inner, bass, nextInner, nextBass].some(note => note.nonChordToneRole)) return;

  const reading = source.chord && context.harmony.primaryInterpretation(source.chord);
  const key = (reading?.status === "resolved" ? reading.value.localKey : undefined) ?? source.key;
  const majorKey = { tonic: key.tonic, mode: "major" } as const;
  const loweredSixth = scaleDegreePitchClass(majorKey, 6, -1);
  const loweredThird = scaleDegreePitchClass(majorKey, 3, -1);
  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const fifth = scaleDegreePitchClass(key, 5);
  if (!pitchClassEquals(bass.pitch, loweredSixth) || !pitchClassEquals(inner.pitch, loweredThird) ||
      !movesToWrittenTone(bass.pitch, nextBass.pitch, fifth, -1, -1) ||
      !movesToWrittenTone(inner.pitch, nextInner.pitch, scaleDegreePitchClass(key, 2), -1, -1)) return;

  const structure = source.chord?.identity.structure;
  if (!(structure?.kind === "augmented-sixth" && structure.variant === "german") &&
      !exactlyVoiced(source, [loweredSixth, key.tonic, loweredThird, raisedFourth])) return;

  const highEndpoints = activeNotes(source).filter(({ note }) => pitchClassEquals(note.pitch, raisedFourth));
  if (highEndpoints.length !== 1) return;
  const [{ voiceId, note: high }] = highEndpoints;
  const arrival = target.notes[voiceId];
  if (!arrival || high.nonChordToneRole || arrival.nonChordToneRole || !target.chord ||
      !pitchClassEquals(target.chord.identity.bass, fifth)) return;
  if (movesToWrittenTone(high.pitch, arrival.pitch, fifth, 1, 1) &&
      sameKeyDominant(context, target, key, "major")) return "triad";
  if (resolvesAugmentedSixthHighToDominantSeventh(context, source, target, key, high, arrival))
    return "seventh";
}

function resolvesEndpoint(
  previous: AnalysisNote,
  current: AnalysisNote,
  dominant: SpelledPitchClass,
  direction: 1 | -1,
) {
  const motion = writtenInterval(previous.pitch, current.pitch);
  return current.startTick === previous.startTick + previous.durationTicks &&
    pitchClassEquals(current.pitch, dominant) &&
    motion.diatonicSteps === direction && motion.semitones === direction;
}

function tertianIdentity(root: SpelledPitchClass, quality: "minor" | "major" | "dominant7", bass = root): ChordIdentity {
  return { root, bass, structure: { kind: "tertian", quality, extensions: [], alterations: [] } };
}

function agreesWithGermanCadence(
  context: HarmonyRuleContext, slice: AnalysisSlice, identity: ChordIdentity, key?: KeyLike,
) {
  if (!slice.chord) return true;
  if (!chordIdentityEquals(slice.chord.identity, identity)) return false;
  const reading = context.harmony.primaryInterpretation(slice.chord);
  if (reading.status === "ambiguous") return false;
  if (!key || reading.status !== "resolved") return true;
  const { localKey, appliedTarget } = reading.value;
  return !appliedTarget && (!localKey || keyEquals(localKey, key));
}

function hasFollowingRootPositionDominant(
  context: HarmonyRuleContext, landing: AnalysisSlice, sourceTick: number, key: KeyLike, cadential: ChordIdentity,
  voice: MelodyTransition["voiceId"],
) {
  const bass = landing.notes.bass!;
  const metric = context.metric.positionAt(landing.tick);
  const measure = metric && context.analysis.metricTimeline.measures[metric.measureNumber - 1];
  if (!measure) return false;
  // Look only as far as the end or first reattack of this bass note, and
  // at most two written beats from the complete six-four.
  const end = Math.min(bass.startTick + bass.durationTicks, landing.tick + 2 * measure.beatLength);
  const arriving = landing.notes[voice]!;
  let passing: AnalysisNote | undefined;
  for (const slice of context.slices({ overlapping: { fromTick: landing.tick + 1, toTick: end + 1 } })) {
    if (slice.tick <= landing.tick) continue;
    const nextBass = slice.notes.bass;
    if (!nextBass || !pitchClassEquals(nextBass.pitch, bass.pitch) ||
        Math.abs(toMidi(nextBass.pitch) - toMidi(bass.pitch)) > 12) return false;
    if (context.analysis.project.keyEvents.some(event =>
      sourceTick < event.tick && event.tick <= slice.tick && !keyEquals(event, landing.key)) ||
      context.analysis.phraseBoundaries.some(boundary =>
        !boundary.stale && sourceTick < boundary.tick && boundary.tick <= slice.tick)) return false;

    const dominant = [tertianIdentity(bass.pitch, "major"), tertianIdentity(bass.pitch, "dominant7")];
    if (dominant.some(identity => exactlyVoiced(slice, chordIdentityToneSpellings(identity)) &&
        agreesWithGermanCadence(context, slice, identity, key))) {
      if (!passing) return true;
      const next = slice.notes[voice]!;
      const step = writtenInterval(passing.pitch, next.pitch);
      return next.startTick === passing.startTick + passing.durationTicks && step.diatonicSteps === 1 && isWrittenStep(step);
    }
    if (nextBass.id !== bass.id || !agreesWithGermanCadence(context, slice, cadential, key)) return false;
    if (!passing && exactlyVoiced(slice, chordIdentityToneSpellings(cadential))) continue;
    // A raised sixth can pass between the resolved fifth and the leading tone
    // while the other three parts sustain the six-four in the same register.
    const note = slice.notes[voice];
    if (!note || (note.nonChordToneRole && note.nonChordToneRole !== "passing") ||
        (passing && note.id !== passing.id) || note.startTick !== arriving.startTick + arriving.durationTicks ||
        !movesUpWholeStep(arriving, note) ||
        activeNotes(landing).some(part => part.voiceId !== voice &&
          (!slice.notes[part.voiceId] || !context.pitch.sameWrittenPitch(part.note, slice.notes[part.voiceId]!)))) return false;
    passing = note;
  }
  return false;
}

function movesUpWholeStep(previous: AnalysisNote, current: AnalysisNote) {
  const step = writtenInterval(previous.pitch, current.pitch);
  return step.diatonicSteps === 1 && step.semitones === 2;
}

// Spasobin ch. 30 §§3–4, ex. 30-452 and 456: preparation and resolution
// of altered double dominants. Require the written VI–Ger+6–K46–V
// setting before accepting this melodic diminished third.
export function resolvesGermanSixthDiminishedThird(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = transition;
  if (!transition.contiguous || !transition.sameKey || voiceId === "bass" ||
      entry.diatonicSteps !== -2 || entry.semitones !== -2 ||
      previous.nonChordToneRole || current.nonChordToneRole) return false;

  const onset = current.startTick;
  const arrival = onset + current.durationTicks;
  const before = context.sliceAt(onset - 1);
  const middle = context.sliceAt(onset);
  const landing = context.sliceAt(arrival);
  const beforeBass = before?.notes.bass;
  const middleBass = middle?.notes.bass;
  const landingBass = landing?.notes.bass;
  const arriving = landing?.notes[voiceId];
  if (!before || !middle || !landing || !beforeBass || !middleBass || !landingBass || !arriving ||
      before.notes[voiceId]?.id !== previous.id || middle.notes[voiceId]?.id !== current.id) return false;

  // The K46 bass is the dominant of the local destination, even when the
  // printed key has not changed. Spell the tonic a fourth above that bass.
  const fifth = landingBass.pitch;
  const tonic = scaleDegreePitchClass({ tonic: fifth, mode: "major" }, 4);
  const key = { tonic, mode: "minor" } as const;
  const sixth = scaleDegreePitchClass(key, 6);
  if (!pitchClassEquals(previous.pitch, sixth) ||
      !pitchClassEquals(current.pitch, scaleDegreePitchClass(key, 4, 1))) return false;

  const preparation = tertianIdentity(sixth, "major", beforeBass.pitch);
  if (!exactlyVoiced(before, chordIdentityToneSpellings(preparation)) ||
      !agreesWithGermanCadence(context, before, preparation)) return false;

  const german: ChordIdentity = { root: sixth, bass: sixth, structure: { kind: "augmented-sixth", variant: "german" } };
  const germanTones = chordIdentityToneSpellings(german);
  const germanVoicing = activeNotes(middle);
  if (context.slices({ overlapping: { fromTick: onset, toTick: arrival } }).any(slice =>
    !pitchClassEquals(slice.notes.bass?.pitch ?? fifth, sixth) ||
    !exactlyVoiced(slice, germanTones) || !agreesWithGermanCadence(context, slice, german, key) ||
    germanVoicing.some(({voiceId: part, note}) => {
      const active = slice.notes[part];
      return !active || !context.pitch.sameWrittenPitch(note, active);
    }))) return false;

  const cadential = tertianIdentity(tonic, "minor", fifth);
  const role = landing.chord?.semantics?.cadenceRole;
  if ((role && role !== "cadential64") ||
      !exactlyVoiced(landing, chordIdentityToneSpellings(cadential)) ||
      !agreesWithGermanCadence(context, landing, cadential, key)) return false;

  const bassBeforeLanding = context.sliceAt(arrival - 1)?.notes.bass;
  if (!bassBeforeLanding || !resolvesEndpoint(bassBeforeLanding, landingBass, fifth, -1) ||
      !resolvesEndpoint(current, arriving, fifth, 1)) return false;
  for (const { voiceId: part, note } of germanVoicing) {
    if (part === "bass" || part === voiceId) continue;
    const common = landing.notes[part];
    if (!common || !context.pitch.sameWrittenPitch(note, common)) return false;
  }
  return hasFollowingRootPositionDominant(context, landing, previous.startTick, key, cadential, voiceId);
}

function isRootPositionTonic(context: HarmonyRuleContext, slice: AnalysisSlice, key: KeyLike) {
  const chord = slice.chord;
  if (!chord || chord.semantics?.cadenceRole) return false;
  const { root, bass, structure } = chord.identity;
  if (
    structure.kind !== "tertian" || structure.quality !== key.mode ||
    structure.alterations.length || structure.extensions.length ||
    !pitchClassEquals(root, key.tonic) || !pitchClassEquals(bass, root)
  ) return false;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status === "ambiguous") return false;
  if (reading.status === "unavailable") return keyEquals(slice.key, key);
  const { degree, degreeAlteration, localKey, appliedTarget, designation } = reading.value;
  return degree === 1 && degreeAlteration === 0 && !appliedTarget &&
    (!designation || (designation.kind === "primary" && designation.primaryFunction === "tonic")) &&
    keyEquals(localKey ?? slice.key, key);
}

function sameVoicing(
  context: HarmonyRuleContext,
  slice: AnalysisSlice,
  reference: AnalysisSlice,
  includeBass = true,
) {
  return keyEquals(slice.key, reference.key) && slice.completeSatb &&
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
      reading.value.appliedTarget || !keyEquals(reading.value.localKey ?? before.key, key)) return false;

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
 * 核对句末同一原位主和弦之间有实写支持的辅助性回归。 */
export function isAuxiliaryAugmentedSixthReturn(
  context: HarmonyRuleContext,
  { source, target, sourceBoundary: middle, targetBoundary: landing }: ConnectionView,
  key: KeyLike,
): boolean {
  const chord = middle.chord;
  const major = key.mode === "major";
  const variant = major ? "doubleAugmented43" : "french";
  if (
    !middle.completeSatb || !landing.completeSatb ||
    chord?.identity.structure.kind !== "augmented-sixth" ||
    chord.identity.structure.variant !== variant ||
    context.harmony.primaryInterpretation(chord).status === "ambiguous" ||
    !isRootPositionTonic(context, landing, key) ||
    !voicesInOrder(middle) || !voicesInOrder(landing)
  ) return false;

  const sixth = scaleDegreePitchClass(key, 6, major ? -1 : 0);
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
  const second = scaleDegreePitchClass(key, 2, major ? 1 : 0);
  const third = scaleDegreePitchClass(key, 3);
  const fifth = scaleDegreePitchClass(key, 5);

  const bassMotion = writtenInterval(middle.notes.bass!.pitch, targetBass.pitch);
  const lowerOctave = !major && bassMotion.diatonicSteps === -5 && bassMotion.semitones === -8;
  if (!lowerOctave && (bassMotion.diatonicSteps !== 2 || bassMotion.semitones !== 4)) return false;
  if (!middleNotes.every(({ voiceId, note }) => {
    const arrival = landing.notes[voiceId]!;
    if (note.nonChordToneRole || arrival.nonChordToneRole) return false;
    if (pitchClassEquals(note.pitch, key.tonic)) return context.pitch.sameWrittenPitch(note, arrival);
    const motion = writtenInterval(note.pitch, arrival.pitch);
    if (voiceId === "bass") return true;
    const goal = pitchClassEquals(note.pitch, second) ? third : fifth;
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

function frenchVoicingChange(
  context: HarmonyRuleContext, before: AnalysisSlice, after: AnalysisSlice, key: KeyLike,
  variant: "german" | "italian",
) {
  const source = before.chord;
  const target = after.chord;
  if (!before.completeSatb || !after.completeSatb ||
      source?.identity.structure.kind !== "augmented-sixth" || source.identity.structure.variant !== variant ||
      target?.identity.structure.kind !== "augmented-sixth" || target.identity.structure.variant !== "french" ||
      before.endTick !== after.tick || before.key.id !== after.key.id ||
      context.phraseAt(before.tick)?.id !== context.phraseAt(after.tick)?.id) return;

  const low = scaleDegreePitchClass({ ...key, mode: "minor" }, 6);
  const bassBefore = before.notes.bass!;
  const bassAfter = after.notes.bass!;
  if (![source.identity.root, source.identity.bass, target.identity.root, target.identity.bass,
    bassBefore.pitch, bassAfter.pitch].every(pitch => pitchClassEquals(pitch, low))) return;

  const sourceReading = context.harmony.primaryInterpretation(source);
  const targetReading = context.harmony.primaryInterpretation(target);
  if (sourceReading.status === "ambiguous" || targetReading.status === "ambiguous") return;
  const targetKey = targetReading.status === "resolved" ? targetReading.value.localKey ?? after.key : after.key;
  if (!keyEquals(targetKey, key)) return;

  const sourceTones = chordIdentityToneSpellings(source.identity);
  const frenchTones = chordIdentityToneSpellings(target.identity);
  const voices = activeNotes(before).map(({ voiceId, note }) => ({
    voiceId, from: note, to: after.notes[voiceId]!,
  }));
  if (!soundsCompleteWrittenMembers(sourceTones, voices.map(voice => voice.from)) ||
      !soundsCompleteWrittenMembers(frenchTones, voices.map(voice => voice.to))) return;
  return { sourceTones, frenchTones, voices, bassBefore, bassAfter };
}

// Spasobin §30, example 460. The fifth descends a semitone.
// The other voices may reattack the same written pitches.
export function isGermanToFrenchVoicing(
  context: HarmonyRuleContext, before: AnalysisSlice, after: AnalysisSlice, key: KeyLike,
) {
  const change = frenchVoicingChange(context, before, after, key, "german");
  if (!change) return false;
  return change.voices.every(({ from, to }) => {
    if (!pitchClassEquals(from.pitch, change.sourceTones[2])) return context.pitch.sameWrittenPitch(from, to);
    const descent = writtenInterval(from.pitch, to.pitch);
    return descent.diatonicSteps === -1 && descent.semitones === -1 &&
      pitchClassEquals(to.pitch, change.frenchTones[2]);
  });
}

// The other tonic voice supplies the new second while the remaining
// notes, including both endpoints, continue as the same events.
export function isItalianToFrenchVoicing(
  context: HarmonyRuleContext, before: AnalysisSlice, after: AnalysisSlice, key: KeyLike,
) {
  const change = frenchVoicingChange(context, before, after, key, "italian");
  if (!change) return false;
  const lowBefore = toMidi(change.bassBefore.pitch);
  const lowAfter = toMidi(change.bassAfter.pitch);
  if (change.voices.some(({ from, to }) => toMidi(from.pitch) < lowBefore || toMidi(to.pitch) < lowAfter)) return false;

  const moving = change.voices.filter(({ from, to }) => from.id !== to.id);
  if (moving.length !== 1) return false;
  const [{ voiceId, from, to }] = moving;
  const step = writtenInterval(from.pitch, to.pitch);
  return voiceId !== "bass" && pitchClassEquals(from.pitch, key.tonic) &&
    from.startTick + from.durationTicks === after.tick && to.startTick === after.tick &&
    pitchClassEquals(to.pitch, change.frenchTones[2]) &&
    step.diatonicSteps === 1 && step.semitones === 2;
}

/** Spasobin §§36–37: two prepared upward suspensions over the new K46 bass.
 * Verify the actual same-voice releases inside the already identified K46. */
export function resolvesPreparedDoubleAugmentedFourThree(
  context: HarmonyRuleContext,
  { source, sourceBoundary: before, targetBoundary: entry, target }: ConnectionView,
  key: KeyLike,
): boolean {
  const chord = entry.chord;
  const bass = entry.notes.bass;
  if (!chord || !bass || bass.startTick !== entry.tick) return false;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== 1 ||
      reading.value.degreeAlteration !== 0 || reading.value.appliedTarget) return false;
  const designation = reading.value.designation;
  if (designation && designation.kind !== "cadential64" &&
      (designation.kind !== "primary" || designation.primaryFunction !== "tonic")) return false;

  const raised = [scaleDegreePitchClass(key, 2, 1), scaleDegreePitchClass(key, 4, 1)];
  const held = activeNotes(before).filter(({ voiceId, note }) =>
    voiceId !== "bass" && raised.some(tone => pitchClassEquals(note.pitch, tone)));
  if (held.length !== 2) return false;
  const releaseTick = held[0].note.startTick + held[0].note.durationTicks;
  if (releaseTick <= entry.tick || releaseTick >= target.span.toTick ||
      held.some(({ voiceId, note }) => entry.notes[voiceId]?.id !== note.id ||
        note.startTick + note.durationTicks !== releaseTick)) return false;
  const landing = context.sliceAt(releaseTick);
  if (!landing?.completeSatb || landing.chord?.id !== chord.id || landing.notes.bass?.id !== bass.id ||
      held.some(({ voiceId }) => landing.notes[voiceId]?.startTick !== releaseTick)) return false;

  const accent = context.metric.positionAt(entry.tick);
  const weak = context.metric.positionAt(releaseTick);
  if (!accent || !weak || accent.measureNumber !== weak.measureNumber ||
      weak.beatPosition - accent.beatPosition > 1 || context.metric.compare(accent, weak) !== "stronger" ||
      crossesManualPhraseBoundary(context, source.span.fromTick, releaseTick)) return false;

  const common = activeNotes(before).find(({ voiceId, note }) =>
    voiceId !== "bass" && pitchClassEquals(note.pitch, key.tonic));
  if (!common || common.note.id !== landing.notes[common.voiceId]?.id) return false;
  if (context.slices({ overlapping: { fromTick: entry.tick, toTick: releaseTick } }).any(slice =>
    slice.chord?.id !== chord.id || slice.key.id !== before.key.id)) return false;

  return landing.key.id === before.key.id &&
    resolvesDoubleAugmentedFourThree(before.notes, landing.notes, key);
}

// Spasobin §§28, 30: the augmented sixth expands by contrary semitones to an octave on scale degree 5.
// The raised second proceeds to the tonic third and the tonic itself stays in place.
export function readWrittenAugmentedSixthSpelling(context: HarmonyRuleContext, motion: MelodyTransition) {
  if (motion.voiceId === "bass" || motion.writtenInterval.semitones !== 1) return;
  const prep = readMaskedPreparation(context, motion);
  if (!prep || prep.middle.key.mode !== "major") return;
  const { voiceId, source, middle, target, trackLocked } = prep;
  const key = middle.key;
  const low = scaleDegreePitchClass(key, 6, -1);
  const high = scaleDegreePitchClass(key, 4, 1);
  const raisedSecond = scaleDegreePitchClass(key, 2, 1);
  const dominant = scaleDegreePitchClass(key, 5);
  const third = scaleDegreePitchClass(key, 3);
  const tones = [low, high, raisedSecond, key.tonic];
  if (!pitchClassEquals(middle.notes.bass!.pitch, low) || !pitchClassEquals(target.notes.bass!.pitch, dominant)) return;

  const bassSound = toMidi(middle.notes.bass!.pitch);
  if (VOICE_ORDER.some(voice => voice !== "bass" && toMidi(middle.notes[voice]!.pitch) <= bassSound)) return;

  const member = [high, raisedSecond].find(tone => pitchClassValue(tone) === pitchClassValue(motion.current.pitch));
  if (!member || !pitchClassEquals(source, scaleDegreePitchClass(key, pitchClassEquals(member, high) ? 4 : 2))) return;
  const parts = VOICE_ORDER.map(voice => ({ voice, tone: writtenMemberAt(middle, voice, voiceId, member) }));
  if (!tones.every(tone => parts.some(part => pitchClassEquals(part.tone, tone)))) return;
  const goal = completeVoicings(target, voiceId, ["major"]).find(chord =>
    pitchClassEquals(chord.root, key.tonic) && pitchClassEquals(chord.member, target.notes[voiceId]!.pitch));
  if (!goal) return;

  if (!parts.every(({ voice, tone }) => {
    if (pitchClassEquals(tone, low)) return resolvesMaskedStep(middle, target, voice, low, dominant, -1);
    if (pitchClassEquals(tone, high)) return resolvesMaskedStep(middle, target, voice, high, dominant, 1);
    if (pitchClassEquals(tone, raisedSecond)) return resolvesMaskedStep(middle, target, voice, raisedSecond, third, 1);
    return keepsWrittenMember(middle, target, voice);
  })) return;
  if (!unmarkedChordMembers(target, voiceId, goal.member, chordToneSpellings(goal.root, goal.quality), true) ||
      !agreesWithExplicitMembers(middle, voiceId, { root: low, member }, tones, trackLocked) ||
      !agreesWithExplicitIdentity(target, voiceId, goal, trackLocked)) return;
  return { previous: source, current: member };
}
