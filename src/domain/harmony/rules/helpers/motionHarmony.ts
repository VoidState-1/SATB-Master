import {
  chordIdentityToneSpellings,
  type FunctionalDesignation,
  type HarmonyInterpretation,
  type KeyReference,
  chordToneSpellings,
  QUALITY_INTERVALS,
  type ChordQuality,
  chordIdentityInversion,
} from "../../../chordModel";
import {
  keyEquals,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  toMidi,
  type SpelledPitchClass,
  writtenInterval,
} from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import {
  sameChordIdentityWithoutBass,
  type AnalysisSlice,
  type SliceTransition,
  type MelodyTransition,
} from "../../analysis";
import { doublesMoveAgainstAlteration } from "../../facts/tendencyResolution";
import { hasCompleteWrittenTertianVoicing } from "../../facts/writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { agreedMember, agreesWithExplicitIdentity, completeVoicings } from "./chordVoicing";
import { crossesManualPhraseBoundary, crossesWrittenBoundary } from "./core";

export { keepsWrittenMember, resolvesMaskedStep } from "../../facts/tendencyResolution";

function allWrittenMembers(pitches: readonly SpelledPitchClass[], tones: readonly SpelledPitchClass[]) {
  return pitches.every(pitch => tones.some(tone => pitchClassEquals(pitch, tone)));
}

export function sameHarmonyAtMelodicAttack(context: HarmonyRuleContext, tick: number, voice: VoiceId, bassMinorSixth = false) {
  const landing = context.sliceAt(tick);
  const motion = landing && context.sliceTransitions({ toSliceIndex: landing.index }).first();
  return !!motion && sameHarmonyOnTransition(motion, context.harmony, voice, bassMinorSixth);
}

function labelAllowsVoicing(slice: AnalysisSlice, pitches: readonly SpelledPitchClass[], complete: boolean) {
  const identity = slice.chord?.identity;
  if (!identity) return true;
  const tones = chordIdentityToneSpellings(identity);
  return allWrittenMembers(pitches, tones) && (!complete || allWrittenMembers(tones, pitches));
}

// The root-position lowered supertonic and the Neapolitan sixth use different
// designations. Verify each reading against its own sounding bass.
function writtenNeapolitanPosition(slice: AnalysisSlice, meaning: HarmonyInterpretation, key: KeyReference) {
  const identity = slice.chord?.identity;
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass || !identity || identity.structure.kind !== "tertian" ||
      identity.structure.quality !== "major" || identity.structure.extensions.length || identity.structure.alterations.length ||
      meaning.degree !== 2 || meaning.degreeAlteration !== -1 || meaning.appliedTarget ||
      meaning.designation?.primaryFunction !== "subdominant" || meaning.designation.secondaryFunction ||
      !pitchClassEquals(identity.root, scaleDegreePitchClass(key, 2, -1)) ||
      !pitchClassEquals(identity.bass, bass.pitch) ||
      Object.values(slice.notes).some(n => n.nonChordToneRole || toMidi(n.pitch) < toMidi(bass.pitch))) return;
  const { kind, specialRole } = meaning.designation;
  if (kind === "side-degree" && !specialRole && pitchClassEquals(bass.pitch, identity.root)) return "root";
  if (kind === "neapolitan" && specialRole === "neapolitan" &&
      pitchClassEquals(bass.pitch, chordIdentityToneSpellings(identity)[1])) return "first";
}

function explicitUsesAgree(previous: AnalysisSlice, current: AnalysisSlice, harmony: HarmonyRuleContext["harmony"], bassMinorSixth: boolean) {
  const left = previous.chord?.semantics;
  const right = current.chord?.semantics;
  if (left?.cadenceRole !== right?.cadenceRole || left?.mixture !== right?.mixture) return false;
  const leftPedal = left?.pedalContext;
  const rightPedal = right?.pedalContext;
  if (leftPedal?.role !== rightPedal?.role ||
      (leftPedal && rightPedal && !pitchClassEquals(leftPedal.pitch, rightPedal.pitch))) return false;

  const leftResolution = previous.chord && harmony.primaryInterpretation(previous.chord);
  const rightResolution = current.chord && harmony.primaryInterpretation(current.chord);
  if (leftResolution?.status === "ambiguous" || rightResolution?.status === "ambiguous") return false;
  const leftMeaning = leftResolution?.status === "resolved" ? leftResolution.value : undefined;
  const rightMeaning = rightResolution?.status === "resolved" ? rightResolution.value : undefined;
  const leftKey = leftMeaning?.localKey ?? previous.key;
  const rightKey = rightMeaning?.localKey ?? current.key;
  if (!keyEquals(leftKey, rightKey)) return false;
  const leftTarget = leftMeaning?.appliedTarget;
  const rightTarget = rightMeaning?.appliedTarget;
  if (leftTarget?.degree !== rightTarget?.degree ||
      leftTarget?.primaryFunction !== rightTarget?.primaryFunction ||
      leftTarget?.secondaryFunction !== rightTarget?.secondaryFunction) return false;
  if (leftMeaning && rightMeaning &&
      (leftMeaning.degree !== rightMeaning.degree || leftMeaning.degreeAlteration !== rightMeaning.degreeAlteration)) return false;

  const leftDesignation = leftMeaning?.designation;
  const rightDesignation = rightMeaning?.designation;
  if (bassMinorSixth && leftMeaning && rightMeaning && leftDesignation?.kind !== rightDesignation?.kind &&
      !left?.cadenceRole && !left?.pedalContext && !left?.mixture &&
      current.attackVoiceIds.length === 1 && current.attackVoiceIds[0] === "bass") {
    const before = writtenNeapolitanPosition(previous, leftMeaning, leftKey);
    const after = writtenNeapolitanPosition(current, rightMeaning, rightKey);
    if (before && after && before !== after) return true;
  }
  const ordinary = (kind?: FunctionalDesignation["kind"]) => !kind || kind === "primary" || kind === "side-degree";
  return (leftDesignation?.kind === rightDesignation?.kind ||
      (ordinary(leftDesignation?.kind) && ordinary(rightDesignation?.kind))) &&
    (!leftDesignation?.primaryFunction || !rightDesignation?.primaryFunction ||
      leftDesignation.primaryFunction === rightDesignation.primaryFunction) &&
    (!leftDesignation?.secondaryFunction || !rightDesignation?.secondaryFunction ||
      leftDesignation.secondaryFunction === rightDesignation.secondaryFunction) &&
    leftDesignation?.specialRole === rightDesignation?.specialRole;
}

function rolesAllowRevoicing(slice: AnalysisSlice, melodicVoice?: VoiceId) {
  const notes = Object.entries(slice.notes);
  return notes.every(([part, note]) => {
    if (!note.nonChordToneRole) return true;
    // A suspension tag covers the whole note, including its consonant preparation.
    // Require a separate part at the very same written pitch to confirm the doubling.
    return melodicVoice !== undefined && part !== melodicVoice && part !== "bass" && !!slice.chord &&
      note.nonChordToneRole === "suspension" && note.startTick + note.durationTicks > slice.endTick &&
      notes.some(([, other]) => !other.nonChordToneRole && spelledPitchEquals(other.pitch, note.pitch));
  });
}

/** Prove revoicing on this connection from the two sounding voicings. */
export function sameHarmonyOnTransition(
  transition: SliceTransition, harmony: HarmonyRuleContext["harmony"], melodicVoice?: VoiceId, bassMinorSixth = false,
) {
  if (!transition.contiguous || !transition.sameKey) return false;
  const { previous, current } = transition;
  if (previous.chord && current.chord &&
      !sameChordIdentityWithoutBass(previous.chord.identity, current.chord.identity)) return false;
  const before = Object.values(previous.notes);
  const after = Object.values(current.notes);
  const left = before.map(note => note.pitch);
  const right = after.map(note => note.pitch);
  const leftComplete = hasCompleteWrittenTertianVoicing(left);
  const rightComplete = hasCompleteWrittenTertianVoicing(right);
  if (!labelAllowsVoicing(previous, left, leftComplete) || !labelAllowsVoicing(current, right, rightComplete)) return false;
  if (!leftComplete || !rightComplete) {
    // A labeled partial voicing can retain its exact local exception.
    // It cannot prove continuity across a labeling or interpretation gap.
    return transition.sameHarmony;
  }
  return allWrittenMembers(left, right) && allWrittenMembers(right, left) &&
    rolesAllowRevoicing(previous, melodicVoice) && rolesAllowRevoicing(current, melodicVoice) &&
    explicitUsesAgree(previous, current, harmony, bassMinorSixth);
}

/** Locate the first new written voicing and the actual note events before it.
 * A reminder, reattack or label boundary can split a sustained voicing. */
export function nextWrittenVoicingChange(
  rules: HarmonyRuleContext, start: AnalysisSlice, supportsContinuation: (frame: AnalysisSlice) => boolean,
) {
  if (!start.completeSatb) return;
  let departure = start;
  for (;;) {
    const landing = rules.sliceAt(departure.endTick);
    if (!landing || landing.tick !== departure.endTick || !keyEquals(start.key, landing.key) ||
        crossesManualPhraseBoundary(rules, departure.tick, landing.tick)) return;
    const sameVoicing = landing.completeSatb && VOICE_ORDER.every(voice =>
      spelledPitchEquals(departure.notes[voice]!.pitch, landing.notes[voice]!.pitch));
    if (!sameVoicing) return { departure, landing };
    if (!supportsContinuation(landing)) return;
    departure = landing;
  }
}

const tertianQualities = Object.keys(QUALITY_INTERVALS) as ChordQuality[];

export function unmarkedChordMembers(
  frame: AnalysisSlice, masked: VoiceId, member: SpelledPitchClass, tones: readonly SpelledPitchClass[],
  requireMasked = false,
) {
  const bass = frame.notes.bass;
  if (!bass || bass.nonChordToneRole || (requireMasked && frame.notes[masked]?.nonChordToneRole)) return false;
  return tones.every(tone => VOICE_ORDER.some(voice => {
    const note = frame.notes[voice];
    return note && !note.nonChordToneRole && pitchClassEquals(voice === masked ? member : note.pitch, tone);
  }));
}

export function readMaskedPreparation(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, voiceId } = motion;
  const entry = motion.writtenInterval.semitones;
  if (!motion.contiguous || !motion.sameKey || Math.abs(entry) !== 1 || previous.nonChordToneRole ||
      current.nonChordToneRole) return;
  const start = current.startTick, end = start + current.durationTicks;
  const before = context.sliceAt(start - 1), middle = context.sliceAt(start), target = context.sliceAt(end);
  if (!before?.completeSatb || !middle?.completeSatb || !target?.completeSatb ||
      before.notes[voiceId]?.id !== previous.id || middle.notes[voiceId]?.id !== current.id ||
      target.tick !== end || target.notes[voiceId]?.startTick !== end ||
      crossesWrittenBoundary(context, previous.startTick, end)) return;

  // The chromatic event must coincide with an independent change of written pitch.
  if (!VOICE_ORDER.some(voice => voice !== voiceId && middle.notes[voice]!.startTick === start &&
      !middle.notes[voice]!.nonChordToneRole &&
      !pitchClassEquals(before.notes[voice]!.pitch, middle.notes[voice]!.pitch))) return;

  const antecedents = completeVoicings(before, voiceId, tertianQualities);
  const source = agreedMember(antecedents);
  const trackLocked = context.analysis.project.chordTrack.locked;
  if (!source || !doublesMoveAgainstAlteration(before, middle, voiceId, source, entry) ||
      !antecedents.some(chord => unmarkedChordMembers(before, voiceId, source,
        chordToneSpellings(chord.root, chord.quality), true) &&
        agreesWithExplicitIdentity(before, voiceId, chord, trackLocked))) return;
  return { voiceId, source, middle, target, trackLocked };
}

export function writtenMemberAt(
  frame: AnalysisSlice, voice: VoiceId, masked: VoiceId, member: SpelledPitchClass,
) {
  return voice === masked ? member : frame.notes[voice]!.pitch;
}

/** Assess the complete statement when its only weaker change is an upper fifth
 * replaced by the root. The written omission still belongs to the later slice. */
export function continuesCompleteSeventh(context: HarmonyRuleContext, current: AnalysisSlice) {
  const { chord, tick, endTick, attackVoiceIds } = current;
  const bass = current.notes.bass;
  if (!chord || !bass || !current.completeSatb || attackVoiceIds.length !== 1) return false;
  const { structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length ||
      (structure.quality !== "dominant7" && structure.quality !== "major7" && structure.quality !== "minor7"))
    return false;
  const inversion = chordIdentityInversion(chord.identity);
  if (inversion !== 1 && inversion !== 3) return false;
  const semantics = chord.semantics;
  if (semantics?.alternatives?.length || semantics?.mixture || semantics?.cadenceRole || semantics?.pedalContext)
    return false;
  const reading = context.harmony.primaryInterpretation(chord);
  const kind = reading.status === "resolved" && reading.value.designation?.kind;
  if (reading.status !== "resolved" || reading.value.appliedTarget ||
      (kind !== "primary" && kind !== "side-degree")) return false;

  const before = context.sliceAt(tick - 1);
  if (!before?.completeSatb || before.chord?.id !== chord.id || before.tick !== chord.startTick ||
      before.endTick !== tick || before.key.id !== current.key.id ||
      endTick - tick > Math.min(tick - before.tick, context.analysis.project.ppq) ||
      context.metric.compare(context.metric.positionAt(before.tick), context.metric.positionAt(tick)) !== "stronger" ||
      context.analysis.phraseBoundaries.some(mark =>
        mark.source === "manual" && before.tick < mark.tick && mark.tick < endTick)) return false;

  const voice = attackVoiceIds[0];
  if (voice === "bass" || !pitchClassEquals(bass.pitch, chord.identity.bass)) return false;
  const from = before.notes[voice]!, to = current.notes[voice]!;
  const tones = chordIdentityToneSpellings(chord.identity);
  if (from.startTick + from.durationTicks !== tick || to.startTick !== tick ||
      !pitchClassEquals(from.pitch, tones[2]) || !pitchClassEquals(to.pitch, tones[0])) return false;
  const leap = writtenInterval(from.pitch, to.pitch);
  if (leap.diatonicSteps !== 3 && leap.diatonicSteps !== -4) return false;

  const lowest = toMidi(bass.pitch);
  return tones.every(tone => VOICE_ORDER.some(part => pitchClassEquals(before.notes[part]!.pitch, tone))) &&
    VOICE_ORDER.every(part => {
      const initial = before.notes[part]!, sustained = current.notes[part]!;
      return !initial.nonChordToneRole && !sustained.nonChordToneRole &&
        toMidi(initial.pitch) >= lowest && toMidi(sustained.pitch) >= lowest &&
        (part === voice || (initial.id === sustained.id && spelledPitchEquals(initial.pitch, sustained.pitch)));
    });
}
