import { functionalTargetForDegree } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, type SpelledPitchClass } from "../../../pitch";
import type { AnalysisChord, AnalysisSlice } from "../../analysis";
import { diatonicMinorTarget, proveLocalMinorDeceptiveDominant } from "../../localDeceptiveDominant";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { ConnectionView } from "../context/views";

function voicing(slice: AnalysisSlice) {
  return { fromTick: slice.tick, toTick: slice.endTick, activeNotes: slice.notes };
}

function isPlainRootPosition(
  chord: AnalysisChord | undefined, quality: "dominant7" | "major", pitch: SpelledPitchClass,
) {
  const identity = chord?.identity;
  return identity?.structure.kind === "tertian" && identity.structure.quality === quality &&
    identity.structure.extensions.length === 0 && identity.structure.alterations.length === 0 &&
    pitchClassEquals(identity.root, pitch) && pitchClassEquals(identity.bass, pitch);
}

export function isProvenLocalDeceptiveTarget(
  context: HarmonyRuleContext, { source, target, sourceBoundary: before, targetBoundary: after }: ConnectionView,
) {
  const phrase = context.phraseAt(before.tick);
  if (source.span.toTick !== target.span.fromTick || before.endTick !== after.tick ||
      before.key.id !== after.key.id || !phrase || after.tick >= phrase.toTick ||
      context.boundaryAt(after.tick)) return false;

  const sourceReading = context.harmony.primaryInterpretation(source.span);
  const arrivalReading = context.harmony.primaryInterpretation(target.span);
  if (sourceReading.status !== "resolved" || arrivalReading.status !== "resolved") return false;
  const interpretation = sourceReading.value;
  const declaredTarget = interpretation.appliedTarget;
  if (!declaredTarget || interpretation.designation?.kind !== "applied-dominant" ||
      interpretation.designation.primaryFunction !== "dominant" ||
      interpretation.degree !== 5 || interpretation.degreeAlteration !== 0 ||
      arrivalReading.value.appliedTarget) return false;

  const proof = proveLocalMinorDeceptiveDominant(voicing(before), voicing(after));
  if (!proof || !isPlainRootPosition(before.chord, "dominant7", proof.dominant) ||
      !isPlainRootPosition(after.chord, "major", proof.sixth)) return false;

  const homeKey = interpretation.localKey ?? before.key;
  const degree = diatonicMinorTarget(homeKey, proof.key.tonic);
  if (!degree || declaredTarget.degree !== degree) return false;
  const expected = functionalTargetForDegree(degree);
  const arrival = arrivalReading.value;
  const arrivalKey = arrival.localKey ?? after.key;
  return declaredTarget.primaryFunction === expected.primaryFunction &&
    declaredTarget.secondaryFunction === expected.secondaryFunction &&
    homeKey.mode === arrivalKey.mode && pitchClassEquals(homeKey.tonic, arrivalKey.tonic) &&
    pitchClassEquals(scaleDegreePitchClass(arrivalKey, arrival.degree, arrival.degreeAlteration), proof.sixth);
}
