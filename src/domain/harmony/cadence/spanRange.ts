import type { AnalysisSlice, HarmonySpan } from "../analysis";

export function sliceWithinSpan(slice: AnalysisSlice, span: HarmonySpan): AnalysisSlice {
  const tick = Math.max(slice.tick, span.fromTick);
  const endTick = Math.min(slice.endTick, span.toTick);
  if (tick === slice.tick && endTick === slice.endTick) return slice;
  return {
    ...slice, tick, endTick,
    attackVoiceIds: tick === slice.tick ? slice.attackVoiceIds : [],
    continuity: tick === slice.tick ? slice.continuity : "continuous",
  };
}

/** Keep the source span ID for navigation while exposing only the part inside a cadence. */
export function clipHarmonySpan(
  span: HarmonySpan,
  slices: readonly AnalysisSlice[],
  start: number,
  end: number,
): HarmonySpan | undefined {
  const fromTick = Math.max(start, span.fromTick);
  const toTick = Math.min(end, span.toTick);
  if (fromTick >= toTick) return undefined;
  if (fromTick === span.fromTick && toTick === span.toTick) return span;
  const part = span.sliceIndices.map(index => slices[index])
    .filter(slice => slice.tick < toTick && fromTick < slice.endTick);
  if (!part.length || part[0].tick > fromTick || part[part.length - 1].endTick < toTick) return undefined;
  return {
    ...span, fromTick, toTick,
    sliceIndices: part.map(slice => slice.index),
    regionIds: [...new Set(part.flatMap(slice => slice.chord ? [slice.chord.id] : []))],
  };
}
