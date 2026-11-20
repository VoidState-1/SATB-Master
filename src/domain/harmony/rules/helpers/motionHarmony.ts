import { chordIdentityToneSpellings, type FunctionalDesignation } from "../../../chordModel";
import { pitchClassEquals, spelledPitchEquals, type SpelledPitchClass } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { sameChordIdentityWithoutBass, type AnalysisSlice, type SliceTransition } from "../../analysis";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";

function allWrittenMembers(pitches: readonly SpelledPitchClass[], tones: readonly SpelledPitchClass[]) {
  return pitches.every(pitch => tones.some(tone => pitchClassEquals(pitch, tone)));
}

export function sameHarmonyAtMelodicAttack(context: HarmonyRuleContext, tick: number, voice: VoiceId) {
  const landing = context.sliceAt(tick);
  const motion = landing && context.sliceTransitions({ toSliceIndex: landing.index }).first();
  return !!motion && sameHarmonyOnTransition(motion, context.harmony, voice);
}

function labelAllowsVoicing(slice: AnalysisSlice, pitches: readonly SpelledPitchClass[], complete: boolean) {
  const identity = slice.chord?.identity;
  if (!identity) return true;
  const tones = chordIdentityToneSpellings(identity);
  return allWrittenMembers(pitches, tones) && (!complete || allWrittenMembers(tones, pitches));
}

function explicitUsesAgree(previous: AnalysisSlice, current: AnalysisSlice, harmony: HarmonyRuleContext["harmony"]) {
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
  transition: SliceTransition, harmony: HarmonyRuleContext["harmony"], melodicVoice?: VoiceId,
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
    explicitUsesAgree(previous, current, harmony);
}
