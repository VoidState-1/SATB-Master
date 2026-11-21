import { chordToneSpellings, type FunctionalTarget, type HarmonyInterpretation, type KeyReference } from "../../../chordModel";
import {
  keyDeclarationEquals, keyEquals, pitchClassEquals, scaleDegreePitchClass, toMidi, type SpelledPitchClass,
} from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import { readWrittenDominantSeventh, readWrittenDominantSeventhHandoff } from "../../writtenDominantSeventh";
import { allowsWrittenTertianIdentity, hasWrittenVoicing, matchesWrittenChord } from "../../writtenResolution";
import { soundsDeclaredChord } from "../../writtenVoicing";
import { isCadential64Span } from "../connector";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { ConnectionView } from "../context/views";
import { writtenDoubleDominantResolution } from "../helpers/doubleDominantResolution";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";

type WrittenSeventh = NonNullable<ReturnType<typeof readWrittenDominantSeventh>>;
type WrittenAppliedFrame =
  | { kind: "dominant"; seventh?: WrittenSeventh }
  | { kind: "leading" }
  | { kind: "augmented-sixth" };

function sameTarget(left: FunctionalTarget, right: FunctionalTarget) {
  return left.degree === right.degree && left.primaryFunction === right.primaryFunction &&
    left.secondaryFunction === right.secondaryFunction;
}

function targetsDominant(target: FunctionalTarget) {
  return target.degree === 5 && target.primaryFunction === "dominant" && !target.secondaryFunction;
}

function writtenSeventh(slice: AnalysisSlice, root: SpelledPitchClass) {
  const seventh = readWrittenDominantSeventh(slice.notes);
  if (seventh && pitchClassEquals(seventh.root, root) &&
      allowsWrittenTertianIdentity(slice, root, "dominant7") &&
      Object.values(slice.notes).every(note => toMidi(note.pitch) >= toMidi(slice.notes.bass!.pitch))) {
    return seventh;
  }
}

function writtenAppliedFrame(
  slice: AnalysisSlice, reading: HarmonyInterpretation, key: KeyReference, target: FunctionalTarget,
  provesRisingSeventh?: (root: SpelledPitchClass) => boolean,
): WrittenAppliedFrame | undefined {
  const identity = slice.chord?.identity;
  if (!identity || !slice.completeSatb) return;
  const localTonic = scaleDegreePitchClass(key, target.degree);
  const targetKey = { tonic: localTonic, mode: "major" } as const;
  const { designation, appliedTarget, degree, degreeAlteration } = reading;

  if (identity.structure.kind === "augmented-sixth") {
    // ♭2 and 7 of the receiving root form the written augmented sixth.
    if (designation?.kind === "augmented-sixth" && targetsDominant(target) &&
        (!appliedTarget || sameTarget(appliedTarget, target)) &&
        pitchClassEquals(identity.root, scaleDegreePitchClass(targetKey, 2, -1)) &&
        soundsDeclaredChord(slice)) return { kind: "augmented-sixth" };
    return;
  }

  if (!appliedTarget || !sameTarget(appliedTarget, target) || degreeAlteration !== 0 ||
      designation?.primaryFunction !== "dominant") return;
  if (degree === 5 && (designation.kind === "double-dominant" || designation.kind === "applied-dominant")) {
    const root = scaleDegreePitchClass(targetKey, 5);
    if (matchesWrittenChord(slice, root, "major")) return { kind: "dominant" };
    const seventh = writtenSeventh(slice, root);
    if (seventh) return { kind: "dominant", seventh };
  }
  if (degree === 7 && (designation.kind === "double-dominant-leading-tone" || designation.kind === "applied-leading-tone")) {
    const root = scaleDegreePitchClass(targetKey, 7);
    const { quality } = identity.structure;
    if (quality === "diminished" || quality === "diminished7" || quality === "halfDiminished7") {
      if (matchesWrittenChord(slice, root, quality) ||
          (quality === "diminished7" && provesRisingSeventh?.(root))) return { kind: "leading" };
    }
  }
}

/** Preserve the DDVII reading when the score writes its seventh as raised II
 * and the next written voicing confirms the cadential six-four. */
function hasRisingSeventhIntoCadential64(
  rules: HarmonyRuleContext, { target: { span, slices, lastSlice } }: ConnectionView,
  key: KeyReference, root: SpelledPitchClass,
) {
  const landing = rules.spanAt(span.toTick);
  if (!landing || landing.span.fromTick !== span.toTick || !isCadential64Span(landing.span) ||
      crossesManualPhraseBoundary(rules, span.fromTick, landing.span.fromTick)) return false;
  const goal = landing.firstSlice;
  const reading = rules.harmony.primaryInterpretation(landing.span);
  const role = landing.span.semantics?.cadenceRole;
  if ((role && role !== "cadential64") || reading.status !== "resolved" ||
      reading.value.appliedTarget || reading.value.degree !== 1 || reading.value.degreeAlteration !== 0 ||
      !keyEquals(reading.value.localKey ?? goal.key, key) ||
      !matchesWrittenChord(goal, key.tonic, key.mode)) return false;

  const resolution = writtenDoubleDominantResolution(lastSlice, goal, key);
  if (!resolution) return false;
  const [first, third, fifth] = chordToneSpellings(root, "diminished7");
  const tones = [first, third, fifth, resolution.previous];
  return slices.every(frame => keyDeclarationEquals(frame.key, goal.key) &&
    allowsWrittenTertianIdentity(frame, root, "diminished7") && hasWrittenVoicing(frame, tones));
}

export function writtenAppliedDominantMotion(
  rules: HarmonyRuleContext, view: ConnectionView, pendingTarget: FunctionalTarget,
): "prolongation" | "target-transfer" | undefined {
  const { connection, sourceBoundary: before, targetBoundary: after } = view;
  if (!connection.contiguous || !connection.sameKey || before.endTick !== after.tick ||
      !keyDeclarationEquals(before.key, after.key) ||
      crossesManualPhraseBoundary(rules, view.source.span.fromTick, after.tick)) return;
  const source = rules.harmony.primaryInterpretation(view.source.span);
  const arrival = rules.harmony.primaryInterpretation(view.target.span);
  if (source.status !== "resolved" || arrival.status !== "resolved") return;

  const key = source.value.localKey ?? before.key;
  const nextTarget = arrival.value.appliedTarget ?? pendingTarget;
  const from = writtenAppliedFrame(before, source.value, key, pendingTarget);
  if (!from) return;
  const sameGoal = sameTarget(pendingTarget, nextTarget);
  const to = writtenAppliedFrame(after, arrival.value, key, nextTarget, root =>
    sameGoal && from.kind === "dominant" && targetsDominant(pendingTarget) &&
    hasRisingSeventhIntoCadential64(rules, view, key, root));
  if (!to) return;

  if (sameGoal) {
    if (from.kind === to.kind || to.kind === "augmented-sixth" ||
        (targetsDominant(pendingTarget) && from.kind === "dominant" && to.kind === "leading")) {
      return "prolongation";
    }
    return;
  }

  const sourceSeventh = from.kind === "dominant" ? from.seventh : undefined;
  const targetSeventh = to.kind === "dominant" ? to.seventh : undefined;
  if (sourceSeventh && targetSeventh && pitchClassEquals(sourceSeventh.target, targetSeventh.root) &&
      VOICE_ORDER.some(voice => readWrittenDominantSeventhHandoff(before, after, voice, sourceSeventh.root))) {
    return "target-transfer";
  }
}
