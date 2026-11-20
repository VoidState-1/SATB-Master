import { chordIdentityToneSpellings, type FunctionalDesignation, type HarmonyInterpretation, type KeyReference } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, type SpelledPitchClass } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { sameChordIdentityWithoutBass, type AnalysisSlice, type SliceTransition } from "../../analysis";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";

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
  if (leftKey.mode !== rightKey.mode || !pitchClassEquals(leftKey.tonic, rightKey.tonic)) return false;
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
