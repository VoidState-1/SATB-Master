import { chordIdentityInversion, chordStructureQuality, type FunctionalFamily, type KeyReference } from "../../chordModel";
import { effectiveFunctionalDesignation } from "../../functionalHarmonyCatalog";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { buildMetricTimeline, metricPositionAt } from "../../rhythm/metric";
import { buildMeasures, measureAtTick, ticksPerBeat, type MeasureInfo } from "../../time";
import type { AnalysisChord, AnalysisSlice, HarmonyAnalysis, HarmonySpan } from "../analysis";
import { crossesTonalBoundary, tonalReading } from "../facts/localTonality";
import { isCadential64Span, representativeChordAtSpan, sliceWithinSpan, spanEndpointSlice, writtenKeyAtTick } from "../facts/span";
import { resolvesInVoice } from "../facts/tendencyResolution";
import type { createSliceStructuralVoicingReader } from "../facts/writtenVoicing";
import { dominantNeighborEvidence, structuralCadentialBass } from "./authenticEndings";
import type { CadenceEvidence, CadenceSpanFacts } from "./model";

export function sameKey(left: KeyReference | undefined, right: KeyReference | undefined) {
  return Boolean(left && right && keyEquals(left, right));
}

function familyOf(
  span: HarmonySpan,
  chord: AnalysisChord | undefined,
): FunctionalFamily | undefined {
  if (!span.semantics || !chord) return undefined;
  return effectiveFunctionalDesignation(
    span.semantics,
    chordStructureQuality(chord.identity),
  )?.primaryFunction;
}

export function factsFor(
  analysis: Pick<HarmonyAnalysis, "project" | "chordById" | "slices">,
  span: HarmonySpan,
  readStructural?: ReturnType<typeof createSliceStructuralVoicingReader>,
): CadenceSpanFacts {
  const chord = representativeChordAtSpan(analysis, span);
  const first = spanEndpointSlice(analysis.slices, span, "first");
  const slice = first && sliceWithinSpan(first, span);
  const writtenKey = writtenKeyAtTick(analysis, span.fromTick);
  const { interpretation, confidence: semanticConfidence, key: localKey } = tonalReading(span.semantics, writtenKey);
  const unavailable = !span.semantics || !chord || !interpretation;
  const ambiguous =
    span.status !== "complete" ||
    semanticConfidence === "ambiguous" ||
    semanticConfidence === "unknown" ||
    Boolean(interpretation?.appliedTarget);
  const family = ambiguous ? undefined : familyOf(span, chord);
  const degree = ambiguous ? undefined : interpretation?.degree;
  let releaseTick: number | undefined;
  for (let index = span.sliceIndices.length - 1; index >= 0; index--) {
    const slice = analysis.slices[span.sliceIndices[index]];
    if (Object.keys(slice.notes).length) {
      releaseTick = Math.min(span.toTick, slice.endTick);
      break;
    }
  }
  return {
    span,
    releaseTick,
    key: localKey,
    writtenKey,
    hardBoundaryBefore: crossesTonalBoundary(analysis.project, span.fromTick - 1, span.fromTick),
    chord,
    boundarySlice: slice,
    structuralArrival: slice?.chord && readStructural?.(slice.index, slice.chord.identity),
    family,
    degree,
    isTonic: family === "tonic" && degree === 1,
    isDominant: family === "dominant",
    isSubdominant: family === "subdominant",
    isCadential64: isCadential64Span(span),
    isStable:
      ambiguous || !family
        ? undefined
        : family === "tonic" || family === "subdominant" || family === "dominant",
    interpretationStatus: unavailable
      ? "unavailable"
      : ambiguous
        ? "ambiguous"
        : "resolved",
  };
}

export function connectionIsValid(
  previous: CadenceSpanFacts,
  current: CadenceSpanFacts,
) {
  return (
    previous.span.toTick === current.span.fromTick &&
    sameKey(previous.key, current.key) &&
    sameKey(previous.writtenKey, current.writtenKey) &&
    previous.interpretationStatus === "resolved" &&
    current.interpretationStatus === "resolved"
  );
}

export function isFifthDegreeDominant(facts: CadenceSpanFacts) {
  return facts.isDominant && facts.degree === 5 && facts.chord !== undefined &&
    pitchClassEquals(facts.chord.identity.root, scaleDegreePitchClass(facts.key, 5));
}

export function writtenBassMatches(facts: CadenceSpanFacts) {
  const bass = structuralCadentialBass(facts);
  return bass && facts.chord && pitchClassEquals(bass.pitch, facts.chord.identity.bass);
}

export function isRootPosition(facts: CadenceSpanFacts) {
  return facts.chord !== undefined && chordIdentityInversion(facts.chord.identity) === 0;
}

export function predominant(fact: CadenceSpanFacts | undefined): boolean {
  return Boolean(fact?.isSubdominant && !fact.span.semantics?.cadenceRole &&
    fact.degree !== undefined && [2, 4, 6].includes(fact.degree) && writtenBassMatches(fact));
}

export function resolvesLeadingTone(before: AnalysisSlice, after: AnalysisSlice, tonic: KeyReference["tonic"]) {
  const leading = leadingTonePitchClass({ tonic, mode: "major" });
  return VOICE_ORDER.some(voice => before.notes[voice] && pitchClassEquals(before.notes[voice]!.pitch, leading) &&
    resolvesInVoice(before, after, voice, tonic, 1));
}

export type CadenceAnalysis = Pick<HarmonyAnalysis, "project" | "harmonySpans" | "chordById" | "slices" | "phraseSegments">;

export interface CadenceDetectionContext {
  readonly analysis: CadenceAnalysis;
  readonly measureFor: (tick: number) => MeasureInfo | undefined;
  readonly writtenBeatAt: (tick: number) => number | undefined;
  readonly metricAt: (tick: number) => ReturnType<typeof metricPositionAt>;
  readonly gapEvidence: (left: CadenceSpanFacts, right: CadenceSpanFacts) => CadenceEvidence | undefined;
}

export function createDetectionContext(analysis: CadenceAnalysis): CadenceDetectionContext {
  let measures: ReturnType<typeof buildMeasures> | undefined;
  const measureFor = (tick: number) => measureAtTick(measures ??= buildMeasures(analysis.project), tick);
  const writtenBeatAt = (tick: number) => {
    const measure = measureFor(tick);
    return measure && ticksPerBeat(analysis.project.ppq, measure.denominator);
  };
  let metricTimeline: ReturnType<typeof buildMetricTimeline> | undefined;
  const metricAt = (tick: number) => metricPositionAt(metricTimeline ??= buildMetricTimeline(analysis.project), tick);
  const gapEvidence = (left: CadenceSpanFacts, right: CadenceSpanFacts) =>
    dominantNeighborEvidence(left, right, analysis.slices, metricAt);
  return { analysis, measureFor, writtenBeatAt, metricAt, gapEvidence };
}
