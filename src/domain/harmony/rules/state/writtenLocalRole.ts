import { keyEquals, type KeyLike } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { leadingTargetDegree } from "../services/harmony";
import { leadingToneResolutionKey } from "./leadingToneTarget";

/** Compare declared function after the caller has independently checked the written pitches. */
export function allowsWrittenLocalRole(rules: HarmonyRuleContext, frame: AnalysisSlice, key: KeyLike, degree: 1 | 5) {
  const chord = frame.chord;
  if (!chord?.semantics) return true;
  const reading = rules.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || chord.semantics.pedalContext) return false;
  const meaning = reading.value;
  if (meaning.source === "inferred" && !chord.locked && !rules.analysis.project.chordTrack.locked) return true;
  if (leadingTargetDegree(meaning)) {
    return degree === 5 && keyEquals(leadingToneResolutionKey(frame, rules.harmony), key);
  }
  return meaning.degree === degree && !meaning.degreeAlteration && keyEquals(meaning.localKey ?? frame.key, key);
}
