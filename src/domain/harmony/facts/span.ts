import type { AnalysisSlice, HarmonyAnalysis, HarmonySpan } from "../analysis";
import { resolvedTonalInterpretation } from "./localTonality";

export function representativeChordAtSpan(
  analysis: Pick<HarmonyAnalysis, "chordById">,
  span: HarmonySpan,
) {
  return span.regionIds.map((id) => analysis.chordById.get(id)).find(Boolean);
}

export function writtenKeyAtTick(analysis: Pick<HarmonyAnalysis, "project">, tick: number) {
  return (
    analysis.project.keyEvents
      .filter((event) => event.tick <= tick)
      .at(-1) ?? analysis.project.keyEvents[0]
  );
}

/** Read the original slice. Phrase clipping belongs to the consumer. */
export function spanEndpointSlice(
  slices: readonly AnalysisSlice[] | undefined, span: HarmonySpan, side: "first" | "last",
): AnalysisSlice | undefined {
  const index = side === "first" ? span.sliceIndices[0] : span.sliceIndices.at(-1);
  return index === undefined ? undefined : slices?.[index];
}

export function isCadential64Span(span: HarmonySpan) {
  const interpretation = resolvedTonalInterpretation(span.semantics).interpretation;
  return (
    interpretation?.designation?.kind === "cadential64" ||
    span.semantics?.cadenceRole === "cadential64"
  );
}

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
