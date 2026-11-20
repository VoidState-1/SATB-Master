import { chordIdentityToneSpellings } from "../../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, toMidi } from "../../../pitch";
import type { MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { hasExactPitch } from "../helpers/core";
import { readDoubleDominantSeventhLanding, isDoubleDominantSeventhBassPreparation } from "../state/doubleDominantSeventh";
import { preparesAlteredDominantFifth } from "./alteredDominantFifth";
import { preparesWrittenAppliedSeventh } from "./chromaticAppliedResolution";
import { recognizesAugmentedSixthPreparation } from "./chromaticAugmentedSixth";
import { isRespeltDoubleDominantSeventh, preparesWrittenRespeltDoubleDominant } from "./chromaticDoubleDominant";
import { lowersSixthInSubdominant } from "./harmonicMajorSubdominant";
import { subdominantSeventhBassEntry } from "./heldDoubleDominantContinuation";

function preparesChromaticDominant(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { previous, current, writtenInterval } = transition;
  const heldBass = subdominantSeventhBassEntry(context, transition);
  if (heldBass !== undefined) return heldBass;
  if (preparesWrittenAppliedSeventh(context, transition)) return true;
  const targetSlice = context.sliceAt(current.startTick);
  const target = targetSlice?.chord;
  if (!targetSlice || !target || target.startTick !== current.startTick) return false;
  const source = context.sliceAt(current.startTick - 1)?.chord;
  if (!source || !hasExactPitch(previous, chordIdentityToneSpellings(source.identity)) ||
      !hasExactPitch(current, chordIdentityToneSpellings(target.identity))) return false;
  const resolution = context.harmony.primaryInterpretation(target);
  if (resolution.status !== "resolved") return false;
  const meaning = resolution.value;
  const key = meaning.localKey ?? targetSlice.key;
  const augmentedSixth = target.identity.structure.kind === "augmented-sixth";
  const kind = meaning.designation?.kind;
  const targetsDominant = kind === "double-dominant" || kind === "double-dominant-leading-tone" ||
    (meaning.appliedTarget?.degree === 5 && (kind === "applied-dominant" || kind === "applied-leading-tone"));
  if (writtenInterval.semitones === -1) {
    return augmentedSixth && key.mode === "major" &&
      pitchClassEquals(current.pitch, scaleDegreePitchClass(key, 6, -1));
  }
  if (augmentedSixth || targetsDominant)
    return pitchClassEquals(current.pitch, scaleDegreePitchClass(key, 4, 1));

  if (!meaning.appliedTarget || (kind !== "applied-dominant" && kind !== "applied-leading-tone")) return false;
  const tonic = scaleDegreePitchClass(key, meaning.appliedTarget.degree);
  if (!pitchClassEquals(current.pitch, leadingTonePitchClass({ tonic, mode: "major" }))) return false;

  const following = context.notes({ voiceId: transition.voiceId, startingAfter: current.startTick }).first()?.note;
  const landing = context.sliceAt(target.startTick + target.durationTicks)?.chord;
  return Boolean(following && landing &&
    following.startTick === current.startTick + current.durationTicks &&
    following.startTick === landing.startTick &&
    !previous.nonChordToneRole && !current.nonChordToneRole && !following.nonChordToneRole &&
    pitchClassEquals(landing.identity.root, tonic) &&
    pitchClassEquals(following.pitch, tonic) &&
    toMidi(following.pitch) === toMidi(current.pitch) + 1);
}

function lowerDoubleDominantLeadingTone(context: HarmonyRuleContext, transition: MelodyTransition) {
  const proof = readDoubleDominantSeventhLanding(context, transition.current.startTick);
  return proof?.leading.voiceId === transition.voiceId && proof.leading.note.id === transition.previous.id &&
    proof.leadingArrival.id === transition.current.id;
}

function preparesDoubleDominantSeventhBass(context: HarmonyRuleContext, transition: MelodyTransition) {
  return transition.voiceId === "bass" &&
    isDoubleDominantSeventhBassPreparation(context, transition.previous, transition.current);
}

/** Test harmonic preparations of a chromatic semitone in the same voice. */
export function hasSupportedChromaticPreparation(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { diatonicSteps, semitones } = transition.writtenInterval;
  if (diatonicSteps !== 0 || Math.abs(semitones) !== 1 || !transition.contiguous || !transition.sameKey) return false;
  if (preparesAlteredDominantFifth(context, transition) || preparesChromaticDominant(context, transition) ||
      recognizesAugmentedSixthPreparation(context, transition)) return true;
  if (semitones < 0) return lowersSixthInSubdominant(context, transition) ||
    lowerDoubleDominantLeadingTone(context, transition) || preparesDoubleDominantSeventhBass(context, transition);
  return isRespeltDoubleDominantSeventh(context, transition) || preparesWrittenRespeltDoubleDominant(context, transition);
}
