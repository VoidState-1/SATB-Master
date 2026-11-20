import { chordIdentityEquals } from "../../../chordModel";
import { keyEquals } from "../../../pitch";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import { writtenLowerNeighborPair, type LowerNeighborFrame } from "../../writtenLowerNeighborPair";
import type { HarmonyRuleContext } from "../context/createRuleContext";

function agreeOnAnchorContext(context: HarmonyRuleContext, departure: AnalysisSlice, arrival: AnalysisSlice) {
  if (!departure.chord || !arrival.chord ||
      !chordIdentityEquals(departure.chord.identity, arrival.chord.identity)) return false;
  const left = context.harmony.primaryInterpretation(departure.chord);
  const right = context.harmony.primaryInterpretation(arrival.chord);
  if (left.status === "ambiguous" || right.status === "ambiguous") return false;
  const earlier = left.status === "resolved" ? left.value : undefined;
  const later = right.status === "resolved" ? right.value : undefined;
  const leftKey = earlier?.localKey ?? departure.key;
  const rightKey = later?.localKey ?? arrival.key;
  if (!keyEquals(leftKey, rightKey)) return false;
  if (!earlier || !later) return true;
  return earlier.degree === later.degree && earlier.degreeAlteration === later.degreeAlteration &&
    earlier.appliedTarget?.degree === later.appliedTarget?.degree &&
    earlier.appliedTarget?.primaryFunction === later.appliedTarget?.primaryFunction &&
    earlier.appliedTarget?.secondaryFunction === later.appliedTarget?.secondaryFunction;
}

export function isWrittenLowerNeighborMotion(context: HarmonyRuleContext, transition: MelodyTransition) {
  const lower = context.sliceAt(transition.current.startTick);
  if (!lower || lower.chord || lower.tick !== transition.current.startTick) return false;
  const upper = context.sliceAt(lower.tick - 1);
  if (!upper || upper.notes[transition.voiceId]?.id !== transition.previous.id) return false;
  const departure = context.sliceAt(upper.tick - 1);
  const preparation = departure && context.sliceAt(departure.tick - 1);
  const arrival = context.sliceAt(lower.endTick);
  if (!preparation?.chord || !departure?.chord || !arrival ||
      !agreeOnAnchorContext(context, departure, arrival)) return false;
  const frame = (slice: AnalysisSlice): LowerNeighborFrame =>
    ({ ...slice, metric: context.metric.positionAt(slice.tick) });
  const phraseEnd = context.phraseAt(preparation.tick)?.toTick;
  const pair = writtenLowerNeighborPair(preparation.chord.identity, departure.chord.identity,
    [frame(preparation), frame(departure), frame(upper), frame(lower), frame(arrival)],
    phraseEnd === undefined ? [] : [phraseEnd]);
  return pair?.includes(transition.current.id) ?? false;
}
