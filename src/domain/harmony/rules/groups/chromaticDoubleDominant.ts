import {
  chordIdentityToneSpellings,
  chordToneSpellings,
  type FunctionalTarget,
  type KeyReference,
} from "../../../chordModel";
import {
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  writtenInterval,
  type SpelledPitchClass,
} from "../../../pitch";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { hasWrittenVoicing } from "../state/doubleDominantSeventh";
import { activeNotes } from "../helpers/core";

function sameKey(left: KeyReference, right: KeyReference) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

export function isRespeltDoubleDominantSeventh(
  context: HarmonyRuleContext,
  transition: MelodyTransition,
): boolean {
  const { previous, current, voiceId, writtenInterval: entry } = transition;
  if (
    !transition.contiguous || !transition.sameKey ||
    entry.diatonicSteps !== 0 || entry.semitones !== 1 ||
    current.nonChordToneRole
  ) return false;

  const preparation = context.sliceAt(current.startTick - 1);
  const middle = context.sliceAt(current.startTick);
  const chord = middle?.chord;
  if (
    !preparation || !middle || !chord || chord.startTick !== current.startTick ||
    middle.notes[voiceId]?.id !== current.id
  )
    return false;

  const key = respeltSeventhKey(context, middle);
  if (!key) return false;
  const preparationReading = preparation.chord &&
    context.harmony.primaryInterpretation(preparation.chord);
  const preparationKey = preparationReading?.status === "resolved"
    ? preparationReading.value.localKey ?? preparation.key
    : preparation.key;
  if (
    preparationReading?.status === "ambiguous" || !sameKey(preparationKey, key) ||
    !pitchClassEquals(previous.pitch, scaleDegreePitchClass(key, 2)) ||
    !pitchClassEquals(current.pitch, scaleDegreePitchClass(key, 2, 1))
  ) return false;

  const next = context.notes({ voiceId, startingAfter: current.startTick }).first()?.note;
  const landingTick = chord.startTick + chord.durationTicks;
  if (
    !next || next.nonChordToneRole || next.startTick !== landingTick ||
    current.startTick + current.durationTicks !== landingTick ||
    !pitchClassEquals(next.pitch, scaleDegreePitchClass(key, 3)) ||
    writtenInterval(current.pitch, next.pitch).semitones !== 1 ||
    context.analysis.project.keyEvents.some(event =>
      event.tick > previous.startTick && event.tick <= landingTick &&
      !sameKey(event, middle.key),
    )
  ) return false;

  const landing = context.sliceAt(landingTick);
  const target = landing?.chord;
  if (!landing || !target || target.startTick !== landingTick ||
      landing.notes[voiceId]?.id !== next.id) return false;
  return cadentialSixFourInKey(context, landing, key);
}

function respeltSeventhKey(context: HarmonyRuleContext, middle: AnalysisSlice) {
  const chord = middle.chord;
  if (!chord) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return;
  const { designation, appliedTarget, localKey } = reading.value;
  const key = localKey ?? middle.key;
  const kind = designation?.kind;
  if (
    key.mode !== "major" ||
    (kind !== "double-dominant-leading-tone" && kind !== "applied-leading-tone") ||
    (appliedTarget?.degree ?? (kind === "double-dominant-leading-tone" ? 5 : undefined)) !== 5
  ) return;

  const { identity } = chord;
  const { structure } = identity;
  if (
    structure.kind !== "tertian" || structure.quality !== "diminished7" ||
    structure.extensions.length !== 0 || structure.alterations.length !== 0 ||
    !pitchClassEquals(identity.root, scaleDegreePitchClass(key, 4, 1))
  ) return;

  // 第28章书186–188页，例28-423、427：原位或第一转位的重属导减七，
  // 其降III改写为升II，原声部上行半音解决到K46的三音。
  const [root, third, fifth, seventh] = chordIdentityToneSpellings(identity);
  const bass = middle.notes.bass;
  const sounding = activeNotes(middle);
  if (
    !pitchClassEquals(seventh, scaleDegreePitchClass(key, 3, -1)) ||
    (!pitchClassEquals(identity.bass, root) && !pitchClassEquals(identity.bass, third)) ||
    !bass || !pitchClassEquals(bass.pitch, identity.bass) ||
    ![root, third, fifth].every(tone => sounding.some(({ note }) =>
      !note.nonChordToneRole && pitchClassEquals(note.pitch, tone),
    ))
  ) return;

  return key;
}

export function cadentialSixFourInKey(context: HarmonyRuleContext, landing: AnalysisSlice, key: KeyReference) {
  const target = landing.chord;
  if (!target) return false;
  const targetReading = context.harmony.primaryInterpretation(target);
  if (targetReading.status !== "resolved" ||
      !sameKey(targetReading.value.localKey ?? landing.key, key)) return false;

  const role = target.semantics?.cadenceRole;
  const cadential = role === "cadential64" ||
    (role === undefined && targetReading.value.designation?.kind === "cadential64");
  const dominant = scaleDegreePitchClass(key, 5);
  const targetStructure = target.identity.structure;
  return (
    cadential &&
    targetStructure.kind === "tertian" && targetStructure.quality === "major" &&
    targetStructure.extensions.length === 0 && targetStructure.alterations.length === 0 &&
    pitchClassEquals(target.identity.root, key.tonic) &&
    pitchClassEquals(target.identity.bass, dominant) &&
    !!landing.notes.bass && pitchClassEquals(landing.notes.bass.pitch, dominant) &&
    activeNotes(landing).some(({ note }) =>
      !note.nonChordToneRole && pitchClassEquals(note.pitch, key.tonic),
    )
  );
}

/** §28.2, ex. 28-423/427. IV falls a diminished third to written #II,
 * the respelt seventh of DDvii°, then rises in that voice to III of K64. */
export function resolvesRaisedSecondApproach(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = motion;
  if (!motion.contiguous || !motion.sameKey || voiceId === "bass" ||
      entry.diatonicSteps !== -2 || entry.semitones !== -2) return false;

  const tick = current.startTick;
  const end = tick + current.durationTicks;
  const prep = context.sliceAt(tick - 1);
  const middle = context.sliceAt(tick);
  const landing = context.sliceAt(end);
  const target = landing?.chord;
  const arrival = landing?.notes[voiceId];
  if (!prep?.chord || !middle?.notes.bass || !landing?.notes.bass || !target || !arrival ||
      arrival.startTick !== end || landing.tick !== end || prep.notes[voiceId]?.id !== previous.id ||
      middle.notes[voiceId]?.id !== current.id ||
      landing.key.id !== middle.key.id || prep.key.id !== middle.key.id ||
      context.analysis.phraseBoundaries.some(b => !b.stale && previous.startTick < b.tick && b.tick <= end)) return false;

  const reading = context.harmony.primaryInterpretation(target);
  if (reading.status !== "resolved" || reading.value.appliedTarget) return false;
  const key = reading.value.localKey ?? landing.key;
  if (key.mode !== "major" || !cadentialSixFourInKey(context, landing, key) ||
      !hasWrittenVoicing(landing, chordToneSpellings(key.tonic, "major"))) return false;
  const fourth = scaleDegreePitchClass(key, 4);
  const raisedSecond = scaleDegreePitchClass(key, 2, 1);
  if (!pitchClassEquals(previous.pitch, fourth) || !pitchClassEquals(current.pitch, raisedSecond) ||
      !pitchClassEquals(arrival.pitch, scaleDegreePitchClass(key, 3)) ||
      writtenInterval(current.pitch, arrival.pitch).semitones !== 1) return false;

  const preparation = context.harmony.primaryInterpretation(prep.chord);
  if (preparation.status !== "resolved" || !sameKey(preparation.value.localKey ?? prep.key, key) ||
      preparation.value.appliedTarget || preparation.value.degreeAlteration !== 0 ||
      preparation.value.designation?.primaryFunction !== "subdominant") return false;
  const degree = preparation.value.degree;
  if (degree !== 4 && degree !== 2) return false;
  const quality = degree === 4 ? "major" : "minor";
  const root = scaleDegreePitchClass(key, degree);
  const from = prep.chord.identity;
  if (from.structure.kind !== "tertian" || from.structure.quality !== quality ||
      from.structure.extensions.length || from.structure.alterations.length ||
      !pitchClassEquals(from.root, root) || !prep.notes.bass || !pitchClassEquals(from.bass, prep.notes.bass.pitch) ||
      !hasWrittenVoicing(prep, chordToneSpellings(root, quality))) return false;

  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const sixth = scaleDegreePitchClass(key, 6);
  const dominant = scaleDegreePitchClass(key, 5);
  if (!hasWrittenVoicing(middle, [raisedFourth, sixth, key.tonic, raisedSecond]) ||
      (!pitchClassEquals(middle.notes.bass.pitch, raisedFourth) && !pitchClassEquals(middle.notes.bass.pitch, sixth))) return false;
  // §28.4: of two copies of IV, one rises chromatically in its own voice;
  // the other descends a whole tone into the respelt diminished seventh.
  const leadingVoice = activeNotes(middle).find(({ note }) => pitchClassEquals(note.pitch, raisedFourth))!;
  const leadingPrep = prep.notes[leadingVoice.voiceId];
  if (!leadingPrep || !pitchClassEquals(leadingPrep.pitch, fourth) ||
      writtenInterval(leadingPrep.pitch, leadingVoice.note.pitch).semitones !== 1) return false;
  const middleKey = middle.chord ? respeltSeventhKey(context, middle) : middle.key;
  if (!middleKey || !sameKey(middleKey, key) || (middle.chord && middle.chord.startTick !== tick)) return false;

  const bassTick = landing.notes.bass.startTick;
  if (target.startTick !== end && target.startTick !== bassTick) return false;
  if (middle.endTick !== end) {
    // The bass anticipates the cadential fourth and sixth. During the one
    // intervening sonority the two suspending upper notes must actually hold.
    const bridge = context.sliceAt(middle.endTick);
    if (!bridge?.completeSatb || bridge.tick !== bassTick || bridge.endTick !== end ||
        bridge.key.id !== middle.key.id || (bridge.chord && bridge.chord.id !== target.id) ||
        !pitchClassEquals(middle.notes.bass.pitch, raisedFourth) || bridge.notes.bass?.id !== landing.notes.bass.id) return false;
    for (const { voiceId: voice, note } of activeNotes(middle)) {
      if (voice === "bass") continue;
      const held = bridge.notes[voice];
      if (!held || held.nonChordToneRole || !spelledPitchEquals(held.pitch, note.pitch) ||
          (!pitchClassEquals(note.pitch, key.tonic) && held.id !== note.id)) return false;
    }
  } else if (bassTick !== end) return false;

  return activeNotes(middle).every(({ voiceId: voice, note }) => {
    const resolved = landing.notes[voice]!;
    if (voice === voiceId) return true;
    if (pitchClassEquals(note.pitch, key.tonic)) return spelledPitchEquals(note.pitch, resolved.pitch);
    return pitchClassEquals(resolved.pitch, dominant) &&
      writtenInterval(note.pitch, resolved.pitch).semitones === (pitchClassEquals(note.pitch, raisedFourth) ? 1 : -2);
  });
}

function respeltDegrees(key: KeyReference) {
  return {
    tonic: key.tonic,
    tonicThird: scaleDegreePitchClass(key, 3),
    raisedSecond: scaleDegreePitchClass(key, 2, 1),
    raisedFourth: scaleDegreePitchClass(key, 4, 1),
    sixth: scaleDegreePitchClass(key, 6),
    dominant: scaleDegreePitchClass(key, 5),
  };
}

function readRespeltPreparation(context: HarmonyRuleContext, middle: AnalysisSlice, key: KeyReference) {
  const slice = context.sliceAt(middle.tick - 1);
  const chord = slice?.chord;
  if (!slice || !chord || slice.key.id !== middle.key.id) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status === "ambiguous" ||
      (reading.status === "resolved" && !sameKey(reading.value.localKey ?? slice.key, key))) return;
  return { slice, chord, reading, tones: chordIdentityToneSpellings(chord.identity) };
}

function readRootDominant(
  context: HarmonyRuleContext,
  tick: number,
  key: KeyReference,
  keyId: AnalysisSlice["key"]["id"],
  dominant: SpelledPitchClass,
) {
  const slice = context.sliceAt(tick);
  const chord = slice?.chord;
  const bass = slice?.notes.bass;
  if (!slice || !chord || !bass || slice.tick !== tick || chord.startTick !== tick ||
      slice.key.id !== keyId ||
      ![bass.pitch, chord.identity.bass, chord.identity.root].every(pitch => pitchClassEquals(pitch, dominant))) return;
  const reading = context.harmony.primaryInterpretation(chord);
  const structure = chord.identity.structure;
  if (reading.status !== "resolved" || reading.value.appliedTarget || reading.value.degree !== 5 ||
      !sameKey(reading.value.localKey ?? slice.key, key) || structure.kind !== "tertian" ||
      structure.extensions.length || structure.alterations.length ||
      (structure.quality !== "major" && structure.quality !== "dominant7")) return;
  const tones = chordToneSpellings(dominant, structure.quality);
  if (hasWrittenVoicing(slice, tones)) return { slice, reading: reading.value, omitsFifth: false };
  if (structure.quality === "dominant7" && hasWrittenVoicing(slice, [tones[0], tones[1], tones[3]])) {
    return { slice, reading: reading.value, omitsFifth: true };
  }
}

function readRespeltContinuation(
  context: HarmonyRuleContext,
  middle: AnalysisSlice,
  key: KeyReference,
  { tonic, tonicThird, raisedSecond, raisedFourth, sixth, dominant }: ReturnType<typeof respeltDegrees>,
) {
  const soundingBass = middle.notes.bass;
  if (!soundingBass || !hasWrittenVoicing(middle, [raisedSecond, raisedFourth, sixth, tonic]) ||
      (!pitchClassEquals(soundingBass.pitch, raisedFourth) && !pitchClassEquals(soundingBass.pitch, sixth))) return;
  const end = middle.endTick;
  const landing = context.sliceAt(end);
  const chord = landing?.chord;
  if (!landing || !chord || landing.tick !== end || chord.startTick !== end ||
      landing.key.id !== middle.key.id || !cadentialSixFourInKey(context, landing, key) ||
      !hasWrittenVoicing(landing, chordToneSpellings(tonic, "major"))) return;

  const resolvesInVoice = activeNotes(middle).every(({ voiceId, note }) => {
    const next = landing.notes[voiceId]!;
    if (pitchClassEquals(note.pitch, tonic)) return spelledPitchEquals(note.pitch, next.pitch);
    const target = pitchClassEquals(note.pitch, raisedSecond) ? tonicThird : dominant;
    const semitones = pitchClassEquals(note.pitch, sixth) ? -2 : 1;
    const motion = writtenInterval(note.pitch, next.pitch);
    return note.startTick + note.durationTicks === end && next.startTick === end &&
      pitchClassEquals(next.pitch, target) && motion.diatonicSteps === Math.sign(semitones) && motion.semitones === semitones;
  });
  if (!resolvesInVoice) return;
  const dominantTick = chord.startTick + chord.durationTicks;
  const arrival = readRootDominant(context, dominantTick, key, middle.key.id, dominant);
  if (arrival) return { landing, landingChord: chord, arrival };
}

/** §28.5, examples 28-427/428. The written #II may take the seventh's
 * place in a double-dominant preparation. Check the original voices even
 * when there is no chord annotation on that sonority. */
export function preparesWrittenRespeltDoubleDominant(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = transition;
  if (!transition.contiguous || !transition.sameKey || previous.nonChordToneRole ||
      entry.diatonicSteps !== 0 || entry.semitones !== 1) return false;
  const tick = current.startTick;
  const middle = context.sliceAt(tick);
  if (!middle || middle.chord || middle.tick !== tick || middle.notes[voiceId]?.id !== current.id) return false;

  const key = middle.key;
  if (key.mode !== "major") return false;
  const preparation = readRespeltPreparation(context, middle, key);
  if (!preparation || preparation.slice.notes[voiceId]?.id !== previous.id ||
      !preparation.tones.some(tone => pitchClassEquals(previous.pitch, tone))) return false;
  const degrees = respeltDegrees(key);
  if (!pitchClassEquals(current.pitch, degrees.raisedSecond) && !pitchClassEquals(current.pitch, degrees.raisedFourth)) return false;
  const continuation = readRespeltContinuation(context, middle, key, degrees);
  return !!continuation &&
    context.phraseAt(preparation.slice.tick)?.id === context.phraseAt(continuation.arrival.slice.tick)?.id;
}

function targetsDominant(target: FunctionalTarget | undefined) {
  return target?.degree === 5 && target.primaryFunction === "dominant" && !target.secondaryFunction;
}

function hasSingleInterpretation(slice: AnalysisSlice) {
  return slice.chord?.semantics?.interpretations.length === 1;
}

function hasMemberRulePreparation(
  preparation: NonNullable<ReturnType<typeof readRespeltPreparation>>,
  source: AnalysisSlice,
  key: KeyReference,
  degrees: ReturnType<typeof respeltDegrees>,
) {
  const { slice, chord, reading, tones } = preparation;
  if (reading.status !== "resolved" || !hasSingleInterpretation(slice) || reading.value.degreeAlteration !== 0 ||
      !slice.notes.bass || !pitchClassEquals(slice.notes.bass.pitch, chord.identity.bass) ||
      !hasWrittenVoicing(slice, tones)) return false;

  const { root, structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length) return false;
  const { designation, appliedTarget, degree } = reading.value;
  if (targetsDominant(appliedTarget)) {
    return (designation?.kind === "double-dominant" || designation?.kind === "applied-dominant") &&
      degree === 5 && structure.quality === "dominant7" &&
      pitchClassEquals(root, scaleDegreePitchClass(key, 2));
  }
  if (appliedTarget || designation?.primaryFunction !== "subdominant" ||
      !(degree === 4 && structure.quality === "major" ||
        degree === 2 && (structure.quality === "minor" || structure.quality === "minor7")) ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, degree))) return false;

  const fourth = scaleDegreePitchClass(key, 4);
  return activeNotes(source).some(({ voiceId, note }) => {
    const previous = slice.notes[voiceId];
    return previous && pitchClassEquals(previous.pitch, fourth) &&
      pitchClassEquals(note.pitch, degrees.raisedFourth) &&
      writtenInterval(previous.pitch, note.pitch).semitones === 1;
  });
}

/** A labelled DDVII with a proved #II may satisfy the two written member checks. */
export function respeltDoubleDominantMember(context: HarmonyRuleContext, source: AnalysisSlice) {
  const chord = source.chord;
  if (!chord || !hasSingleInterpretation(source) || source.tick !== chord.startTick ||
      source.endTick !== chord.startTick + chord.durationTicks) return;
  const key = respeltSeventhKey(context, source);
  if (!key) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return;
  const { degree, degreeAlteration, designation, appliedTarget } = reading.value;
  if (degree !== 7 || degreeAlteration !== 0 || designation?.primaryFunction !== "dominant" ||
      (appliedTarget ? !targetsDominant(appliedTarget) : designation.kind !== "double-dominant-leading-tone")) return;

  const degrees = respeltDegrees(key);
  const preparation = readRespeltPreparation(context, source, key);
  if (!preparation || !hasMemberRulePreparation(preparation, source, key, degrees)) return;
  const continuation = readRespeltContinuation(context, source, key, degrees);
  if (!continuation) return;
  const { landing, landingChord, arrival } = continuation;
  if (landing.endTick !== landingChord.startTick + landingChord.durationTicks ||
      !hasSingleInterpretation(landing) || !hasSingleInterpretation(arrival.slice) ||
      context.analysis.phraseBoundaries.some(boundary =>
        !boundary.stale && preparation.slice.tick < boundary.tick && boundary.tick <= arrival.slice.tick)) return;

  const landingReading = context.harmony.primaryInterpretation(landingChord);
  if (landingReading.status !== "resolved" || landingReading.value.appliedTarget ||
      landingReading.value.degree !== 1 || landingReading.value.degreeAlteration !== 0 ||
      arrival.reading.degreeAlteration !== 0 || arrival.reading.designation?.kind !== "primary" ||
      arrival.reading.designation.primaryFunction !== "dominant") return;
  if (arrival.omitsFifth && activeNotes(arrival.slice)
    .filter(({ note }) => pitchClassEquals(note.pitch, degrees.dominant)).length !== 2) return;

  const written = activeNotes(source).find(({ note }) => pitchClassEquals(note.pitch, degrees.raisedSecond));
  if (written) return { noteId: written.note.id, seventh: chordIdentityToneSpellings(chord.identity)[3] };
}
