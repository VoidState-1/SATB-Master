import { chordToneSpellings } from "../../../chordModel";
import { keyEquals, scaleDegreePitchClass } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { writtenDoubleDominantResolution } from "../../writtenResolution";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { agreesWithExplicitIdentity } from "./maskedChordSpelling";
import { crossesWrittenBoundary } from "./maskedContinuation";

export { respeltDegrees, writtenDoubleDominantResolution } from "../../writtenResolution";

export function readDoubleDominantResolution(context: HarmonyRuleContext, source: AnalysisSlice, target: AnalysisSlice) {
  const role = target.chord?.semantics?.cadenceRole;
  if (role && role !== "cadential64") return;
  const sourceReading = source.chord && context.harmony.primaryInterpretation(source.chord);
  const targetReading = target.chord && context.harmony.primaryInterpretation(target.chord);
  const sourceKey = sourceReading?.status === "resolved" ? sourceReading.value.localKey : undefined;
  const targetKey = targetReading?.status === "resolved" ? targetReading.value.localKey : undefined;
  if (sourceKey && targetKey && !keyEquals(sourceKey, targetKey)) return;
  const key = targetKey ?? sourceKey ?? source.key;
  const resolution = writtenDoubleDominantResolution(source, target, key);
  if (!resolution || crossesWrittenBoundary(context, source.notes[resolution.voiceId]!.startTick, target.tick)) return;

  // The declared diminished seventh retains its tertian identity even when
  // the score uses the enharmonic ♯II. Check both labels against that reading.
  const root = scaleDegreePitchClass(key, 4, 1);
  const trackLocked = context.analysis.project.chordTrack.locked;
  if (agreesWithExplicitIdentity(source, resolution.voiceId,
    { root, quality: "diminished7", member: chordToneSpellings(root, "diminished7")[3] }, trackLocked) &&
    agreesWithExplicitIdentity(target, resolution.voiceId,
      { root: key.tonic, quality: "major", member: resolution.current }, trackLocked)) return resolution;
}
