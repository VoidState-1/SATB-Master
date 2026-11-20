import { chordIdentityToneSpellings, type FunctionalDesignation } from "../../../chordModel";
import { pitchClassEquals, type SpelledPitchClass } from "../../../pitch";
import { sameChordIdentityWithoutBass, type AnalysisSlice, type SliceTransition } from "../../analysis";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";

function allWrittenMembers(pitches: readonly SpelledPitchClass[], tones: readonly SpelledPitchClass[]) {
  return pitches.every(pitch => tones.some(tone => pitchClassEquals(pitch, tone)));
}

export function sameHarmonyAtMelodicAttack(context: HarmonyRuleContext, tick: number) {
  const landing = context.sliceAt(tick);
  const motion = landing && context.sliceTransitions({ toSliceIndex: landing.index }).first();
  return !!motion && sameHarmonyOnTransition(motion, context.harmony);
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

/** Prove revoicing on this connection from the two sounding voicings. */
export function sameHarmonyOnTransition(transition: SliceTransition, harmony: HarmonyRuleContext["harmony"]) {
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
    !before.some(note => note.nonChordToneRole) && !after.some(note => note.nonChordToneRole) &&
    explicitUsesAgree(previous, current, harmony);
}
