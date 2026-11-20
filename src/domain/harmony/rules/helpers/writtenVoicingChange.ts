import { keyEquals, spelledPitchEquals } from "../../../pitch";
import { VOICE_ORDER } from "../../../project";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "./phraseBoundary";

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
