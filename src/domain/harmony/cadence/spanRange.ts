import type { AnalysisSlice, HarmonySpan } from "../analysis";

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
    .filter(slice => fromTick <= slice.tick && slice.endTick <= toTick);
  if (part[0]?.tick !== fromTick || part.at(-1)?.endTick !== toTick) return undefined;
  return {
    ...span, fromTick, toTick,
    sliceIndices: part.map(slice => slice.index),
    regionIds: [...new Set(part.flatMap(slice => slice.chord ? [slice.chord.id] : []))],
  };
}
