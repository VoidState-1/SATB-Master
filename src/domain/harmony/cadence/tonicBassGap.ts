import type { AnalysisSlice } from "../analysis";
import type { CadenceSpanFacts } from "./types";

/** One sounding, unlabelled slice between two chord spans in the same written key. */
export function tonicBassGapFrames(
  dominant: CadenceSpanFacts,
  tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  beatTicks: number,
) {
  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const suspension = before && slices[before.index + 1];
  const landing = tonic.boundarySlice;
  if (!before?.completeSatb || !suspension?.completeSatb || !landing?.completeSatb || suspension.chord ||
      before.endTick !== dominant.span.toTick || suspension.tick !== before.endTick ||
      suspension.endTick !== tonic.span.fromTick || landing.tick !== suspension.endTick ||
      landing.index !== suspension.index + 1 ||
      before.key.id !== suspension.key.id || suspension.key.id !== landing.key.id ||
      suspension.endTick - suspension.tick > beatTicks) return;
  return { before, suspension, landing };
}
