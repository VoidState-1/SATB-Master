import {
  chordStructureQuality,
  type FunctionalFamily,
  type FunctionalTarget,
  type HarmonyInterpretation,
  type KeyReference,
} from "../../chordModel";
import { effectiveFunctionalDesignation } from "../../functionalHarmonyCatalog";
import type { HarmonyAnalysis, HarmonySpan } from "../analysis";
import { crossesTonalBoundary, isDiminishedRotation, provesDiminishedPivotArrival, resolvedTonalInterpretation, tonalReading } from "../facts/localTonality";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass } from "../../pitch";

import { isCadential64Span, representativeChordAtSpan, spanEndpointSlice, writtenKeyAtTick } from "../facts/span";

export { isCadential64Span } from "../facts/span";

export type HarmonyConnectionRelation =
  | "same-harmony"
  | "tonic-departure"
  | "predominant-to-dominant"
  | "dominant-to-tonic"
  | "deceptive"
  | "applied-target"
  | "double-dominant-target"
  | "cadential64-target"
  | "retrogression"
  | "pivot-reinterpretation"
  | "unknown";

export interface ConnectionEvidence {
  code: string;
  value: string;
}

export interface HarmonyConnectionAssessment {
  connectionKey: string;
  previousSpanId: string;
  currentSpanId: string;
  previousInterpretationId?: string;
  currentInterpretationId?: string;
  relation: HarmonyConnectionRelation;
  contiguous: boolean;
  sameKey: boolean;
  tonalBoundary: boolean;
  diminishedPivot: boolean;
  targetMatched?: boolean;
  evidence: readonly ConnectionEvidence[];
  confidence: "certain" | "probable" | "ambiguous" | "unknown";
}

export interface FunctionalTargetChainFact {
  id: string;
  sourceSpanId: string;
  target: FunctionalTarget;
  pathSpanIds: readonly string[];
  connectionKeys: readonly string[];
  terminalSpanId?: string;
  status: "matched" | "violated" | "deferred";
  confidence: HarmonyConnectionAssessment["confidence"];
}

function interpretationOf(span: HarmonySpan) {
  return resolvedTonalInterpretation(span.semantics).interpretation;
}

function designationOf(
  span: HarmonySpan,
  chord: ReturnType<typeof representativeChordAtSpan>,
) {
  if (!interpretationOf(span) || !span.semantics) return undefined;
  return effectiveFunctionalDesignation(
    span.semantics,
    chord ? chordStructureQuality(chord.identity) : undefined,
  );
}

function familyOf(
  span: HarmonySpan,
  chord: ReturnType<typeof representativeChordAtSpan>,
): FunctionalFamily | undefined {
  return designationOf(span, chord)?.primaryFunction;
}

function targetMatches(
  target: FunctionalTarget | undefined,
  currentSpan: HarmonySpan,
  current: HarmonyInterpretation | undefined,
  currentChord: ReturnType<typeof representativeChordAtSpan>,
  sourceKey: KeyReference,
) {
  if (!target || !current || !currentChord) return false;
  const designation = designationOf(currentSpan, currentChord);
  if (!designation?.primaryFunction) return false;
  if (
    current.degree !== target.degree ||
    designation.primaryFunction !== target.primaryFunction ||
    (target.secondaryFunction !== undefined &&
      designation.secondaryFunction !== target.secondaryFunction)
  )
    return false;
  return pitchClassEquals(
    currentChord.identity.root,
    scaleDegreePitchClass(sourceKey, target.degree),
  );
}

function combinedConfidence(values: readonly HarmonyConnectionAssessment["confidence"][]): HarmonyConnectionAssessment["confidence"] {
  if (values.includes("unknown")) return "unknown";
  if (values.includes("ambiguous")) return "ambiguous";
  if (values.includes("probable")) return "probable";
  return "certain";
}

function spanTonalReading(analysis: Pick<HarmonyAnalysis, "project">, span: HarmonySpan) {
  return tonalReading(span.semantics, writtenKeyAtTick(analysis, span.fromTick));
}

function targetMatchesAtConnection(
  target: FunctionalTarget | undefined, currentSpan: HarmonySpan,
  current: ReturnType<typeof spanTonalReading>,
  chord: ReturnType<typeof representativeChordAtSpan>, source: ReturnType<typeof spanTonalReading>,
) {
  if (keyEquals(source.key, current.key))
    return targetMatches(target, currentSpan, current.interpretation, chord, source.key);
  // The old applied target may become I in an established destination.
  return !!target && !!chord && current.local && current.interpretation?.degree === 1 &&
    current.interpretation.degreeAlteration === 0 && !current.interpretation.appliedTarget &&
    familyOf(currentSpan, chord) === "tonic" &&
    pitchClassEquals(chord.identity.root, current.key.tonic) &&
    pitchClassEquals(current.key.tonic, scaleDegreePitchClass(source.key, target.degree));
}

export function functionalTargetMatches(
  analysis: Pick<HarmonyAnalysis, "project" | "harmonySpans" | "chordById">,
  sourceSpanId: string,
  currentSpanId: string,
  target: FunctionalTarget,
) {
  const sourceSpan = analysis.harmonySpans.find(
    (span) => span.id === sourceSpanId,
  );
  const currentSpan = analysis.harmonySpans.find(
    (span) => span.id === currentSpanId,
  );
  if (!sourceSpan || !currentSpan) return false;
  const source = spanTonalReading(analysis, sourceSpan), current = spanTonalReading(analysis, currentSpan);
  if (!keyEquals(source.key, current.key) && crossesTonalBoundary(analysis.project, sourceSpan.fromTick, currentSpan.fromTick))
    return false;
  return targetMatchesAtConnection(target, currentSpan, current, representativeChordAtSpan(analysis, currentSpan), source);
}

function assessConnection(
  analysis: Pick<HarmonyAnalysis, "project" | "chordById"> & Partial<Pick<HarmonyAnalysis, "slices">>,
  previous: HarmonySpan,
  current: HarmonySpan,
): HarmonyConnectionAssessment {
  const previousChord = representativeChordAtSpan(analysis, previous);
  const currentChord = representativeChordAtSpan(analysis, current);
  const source = spanTonalReading(analysis, previous), destination = spanTonalReading(analysis, current);
  const previousInterpretation = source.interpretation, currentInterpretation = destination.interpretation;
  const keyMatches = keyEquals(source.key, destination.key);
  const contiguous = previous.toTick === current.fromTick;
  const tonalBoundary = crossesTonalBoundary(analysis.project, previous.fromTick, current.fromTick);
  const pivotSliceIndex = current.sliceIndices.at(-1);
  const arrival = pivotSliceIndex !== undefined ? analysis.slices?.[pivotSliceIndex + 1] : undefined;
  const diminishedPivot = contiguous && !tonalBoundary && !!previousChord && !!currentChord && !!arrival &&
    isDiminishedRotation(previousChord, currentChord, source, destination) &&
    !crossesTonalBoundary(analysis.project, current.fromTick, arrival.tick) &&
    provesDiminishedPivotArrival(
      spanEndpointSlice(analysis.slices, previous, "last"), spanEndpointSlice(analysis.slices, current, "first"), arrival,
      previousChord, currentChord, destination.key,
    );
  const confidence = combinedConfidence([source.confidence, destination.confidence]);
  const previousDesignation = designationOf(previous, previousChord);
  const currentDesignation = designationOf(current, currentChord);
  const previousFamily = familyOf(previous, previousChord);
  const currentFamily = familyOf(current, currentChord);
  const previousKind = previousDesignation?.kind;
  const currentKind = currentDesignation?.kind;
  let relation: HarmonyConnectionRelation = "unknown";
  let targetMatched: boolean | undefined;

  if (diminishedPivot) {
    relation = "pivot-reinterpretation";
  } else if (previous.identityKey === current.identityKey) {
    relation =
      previousInterpretation?.id === currentInterpretation?.id && keyMatches
        ? "same-harmony"
        : "pivot-reinterpretation";
  } else if (previousKind === "cadential64") {
    targetMatched = currentFamily === "dominant";
    relation = "cadential64-target";
  } else if (
    previousKind === "applied-dominant" ||
    previousKind === "applied-leading-tone" ||
    previousInterpretation?.appliedTarget
  ) {
    const target = previousInterpretation?.appliedTarget;
    targetMatched = !tonalBoundary && targetMatchesAtConnection(target, current, destination, currentChord, source);
    relation = "applied-target";
  } else if (
    previousKind === "double-dominant" ||
    previousKind === "double-dominant-leading-tone"
  ) {
    targetMatched =
      currentFamily === "dominant" || currentKind === "cadential64";
    relation = "double-dominant-target";
  } else if (previousFamily === "dominant" && currentFamily === "subdominant") {
    relation = "retrogression";
  } else if (
    previousFamily === "dominant" &&
    currentFamily === "tonic" &&
    currentInterpretation?.degree === 6
  ) {
    relation = "deceptive";
  } else if (previousFamily === "dominant" && currentFamily === "tonic") {
    relation = "dominant-to-tonic";
  } else if (previousFamily === "subdominant" && currentFamily === "dominant") {
    relation = "predominant-to-dominant";
  } else if (
    previousFamily === "tonic" &&
    (currentFamily === "subdominant" || currentFamily === "dominant")
  ) {
    relation = "tonic-departure";
  }

  return Object.freeze({
    connectionKey: `connection:${previous.id}->${current.id}`,
    previousSpanId: previous.id,
    currentSpanId: current.id,
    previousInterpretationId: previousInterpretation?.id,
    currentInterpretationId: currentInterpretation?.id,
    relation,
    contiguous,
    sameKey: keyMatches,
    tonalBoundary,
    diminishedPivot,
    targetMatched,
    evidence: Object.freeze([
      ...(diminishedPivot ? [{ code: "diminished-rotation", value: "confirmed-local-key" }] : []),
      { code: "previous-family", value: previousFamily ?? "unknown" },
      { code: "current-family", value: currentFamily ?? "unknown" },
      { code: "previous-kind", value: previousKind ?? "unknown" },
      { code: "current-kind", value: currentKind ?? "unknown" },
    ]),
    confidence,
  });
}

export function buildHarmonyConnections(
  analysis: Pick<HarmonyAnalysis, "project" | "harmonySpans" | "chordById"> & Partial<Pick<HarmonyAnalysis, "slices">>,
) {
  const result: HarmonyConnectionAssessment[] = [];
  for (let index = 1; index < analysis.harmonySpans.length; index += 1) {
    result.push(
      assessConnection(
        analysis,
        analysis.harmonySpans[index - 1],
        analysis.harmonySpans[index],
      ),
    );
  }
  return Object.freeze(result);
}

function explicitTargetOf(span: HarmonySpan): FunctionalTarget | undefined {
  const interpretation = interpretationOf(span);
  if (interpretation?.appliedTarget) return interpretation.appliedTarget;
  const kind = interpretation?.designation?.kind;
  if (kind === "double-dominant" || kind === "double-dominant-leading-tone") {
    return { degree: 5, primaryFunction: "dominant" };
  }
  return undefined;
}

/**
 * 将副属/重属目标沿 span 链展开。K46 只在目标为属功能时作为中介，
 * 休止、转调和歧义连接均保守标为 deferred，不伪造一个失败目标。
 */
export function buildFunctionalTargetChains(
  analysis: Pick<
    HarmonyAnalysis,
    "project" | "harmonySpans" | "chordById" | "connections"
  >,
): readonly FunctionalTargetChainFact[] {
  const connectionBySource = new Map(
    analysis.connections.map((connection) => [
      connection.previousSpanId,
      connection,
    ]),
  );
  return Object.freeze(
    analysis.harmonySpans.flatMap((sourceSpan) => {
      const target = explicitTargetOf(sourceSpan);
      if (!target) return [];
      const pathSpanIds: string[] = [];
      const connectionKeys: string[] = [];
      let currentSpanId = sourceSpan.id;
      let terminalSpanId: string | undefined;
      let status: FunctionalTargetChainFact["status"] = "deferred";
      let confidence: FunctionalTargetChainFact["confidence"] = "certain";

      while (true) {
        const connection = connectionBySource.get(currentSpanId);
        if (!connection || !connection.contiguous || connection.tonalBoundary || connection.diminishedPivot) break;
        connectionKeys.push(connection.connectionKey);
        terminalSpanId = connection.currentSpanId;
        pathSpanIds.push(connection.currentSpanId);
        confidence = connection.confidence;
        if (
          connection.confidence === "ambiguous" ||
          connection.confidence === "unknown"
        )
          break;
        if (
          functionalTargetMatches(
            analysis,
            sourceSpan.id,
            connection.currentSpanId,
            target,
          )
        ) {
          status = "matched";
          break;
        }
        if (!connection.sameKey) break;
        const currentSpan = analysis.harmonySpans.find(
          (span) => span.id === connection.currentSpanId,
        );
        if (
          target.primaryFunction === "dominant" &&
          currentSpan &&
          isCadential64Span(currentSpan)
        ) {
          currentSpanId = currentSpan.id;
          continue;
        }
        status = "violated";
        break;
      }

      return [
        Object.freeze({
          id: `target-chain:${sourceSpan.id}`,
          sourceSpanId: sourceSpan.id,
          target: Object.freeze({ ...target }),
          pathSpanIds: Object.freeze(pathSpanIds),
          connectionKeys: Object.freeze(connectionKeys),
          terminalSpanId,
          status,
          confidence,
        }),
      ];
    }),
  );
}
