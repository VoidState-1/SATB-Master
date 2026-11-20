import {
  chordIdentityToneSpellings,
  chordToneSpellings,
  type KeyReference,
} from "../../../chordModel";
import {
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  writtenInterval,
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

/** §28.5, examples 28-427/428. The written #II may take the seventh's
 * place in a double-dominant preparation. Check the original voices even
 * when there is no chord annotation on that sonority. */
export function preparesWrittenRespeltDoubleDominant(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = transition;
  if (!transition.contiguous || !transition.sameKey || previous.nonChordToneRole ||
      entry.diatonicSteps !== 0 || entry.semitones !== 1) return false;
  const tick = current.startTick;
  const before = context.sliceAt(tick - 1);
  const middle = context.sliceAt(tick);
  if (!before?.chord || !middle || middle.chord || middle.tick !== tick ||
      before.notes[voiceId]?.id !== previous.id || middle.notes[voiceId]?.id !== current.id ||
      !chordIdentityToneSpellings(before.chord.identity).some(tone => pitchClassEquals(previous.pitch, tone))) return false;

  const key = middle.key;
  const preparation = context.harmony.primaryInterpretation(before.chord);
  if (key.mode !== "major" || before.key.id !== key.id || preparation.status === "ambiguous" ||
      (preparation.status === "resolved" && !sameKey(preparation.value.localKey ?? before.key, key))) return false;
  const raisedSecond = scaleDegreePitchClass(key, 2, 1);
  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const sixth = scaleDegreePitchClass(key, 6);
  const tonic = key.tonic;
  const dominant = scaleDegreePitchClass(key, 5);
  if (!pitchClassEquals(current.pitch, raisedSecond) && !pitchClassEquals(current.pitch, raisedFourth)) return false;
  if (!hasWrittenVoicing(middle, [raisedSecond, raisedFourth, sixth, tonic]) ||
      (!pitchClassEquals(middle.notes.bass!.pitch, raisedFourth) && !pitchClassEquals(middle.notes.bass!.pitch, sixth))) return false;

  const end = middle.endTick;
  const landing = context.sliceAt(end);
  if (!landing?.chord || landing.tick !== end || landing.chord.startTick !== end ||
      landing.key.id !== key.id || !cadentialSixFourInKey(context, landing, key) ||
      !hasWrittenVoicing(landing, chordToneSpellings(tonic, "major"))) return false;
  const third = scaleDegreePitchClass(key, 3);
  const resolvesInVoice = activeNotes(middle).every(({ voiceId: voice, note }) => {
    const next = landing.notes[voice]!;
    if (pitchClassEquals(note.pitch, tonic)) return spelledPitchEquals(note.pitch, next.pitch);
    const target = pitchClassEquals(note.pitch, raisedSecond) ? third : dominant;
    const semitones = pitchClassEquals(note.pitch, sixth) ? -2 : 1;
    const motion = writtenInterval(note.pitch, next.pitch);
    return note.startTick + note.durationTicks === end && next.startTick === end &&
      pitchClassEquals(next.pitch, target) && motion.diatonicSteps === Math.sign(semitones) && motion.semitones === semitones;
  });
  if (!resolvesInVoice) return false;

  const dominantTick = landing.chord.startTick + landing.chord.durationTicks;
  const after = context.sliceAt(dominantTick);
  const chord = after?.chord;
  if (!after || !chord || after.tick !== dominantTick || chord.startTick !== dominantTick ||
      after.key.id !== key.id || !after.notes.bass ||
      !pitchClassEquals(after.notes.bass.pitch, dominant) || !pitchClassEquals(chord.identity.bass, dominant) ||
      !pitchClassEquals(chord.identity.root, dominant) ||
      context.phraseAt(before.tick)?.id !== context.phraseAt(dominantTick)?.id) return false;
  const reading = context.harmony.primaryInterpretation(chord);
  const structure = chord.identity.structure;
  if (reading.status !== "resolved" || reading.value.appliedTarget || reading.value.degree !== 5 ||
      !sameKey(reading.value.localKey ?? after.key, key) || structure.kind !== "tertian" ||
      structure.extensions.length || structure.alterations.length ||
      (structure.quality !== "major" && structure.quality !== "dominant7")) return false;
  const tones = chordToneSpellings(dominant, structure.quality);
  return hasWrittenVoicing(after, tones) || (structure.quality === "dominant7" &&
    hasWrittenVoicing(after, tones.filter((_, index) => index !== 2)));
}
