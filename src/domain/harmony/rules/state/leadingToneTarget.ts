import { scaleDegreePitchClass } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyAnalysisService } from "../services/harmony";

/** The local tonic to which a written leading tone owes its resolution.
 * An applied interpretation names its target by degree in the local key. */
export function leadingToneResolutionKey(slice: AnalysisSlice, harmony: HarmonyAnalysisService) {
  const reading = slice.chord && harmony.primaryInterpretation(slice.chord);
  const meaning = reading?.status === "resolved" ? reading.value : undefined;
  const key = meaning?.localKey ?? slice.key;
  if (!meaning?.appliedTarget) return key;
  return { tonic: scaleDegreePitchClass(key, meaning.appliedTarget.degree), mode: "major" as const };
}
