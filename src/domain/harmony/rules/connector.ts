import {
  chordStructureQuality,
  harmonySemanticsConfidence,
  primaryHarmonyInterpretation,
  type FunctionalFamily,
  type FunctionalTarget,
  type HarmonyInterpretation,
  type KeyReference,
} from "../../chordModel";
import { effectiveFunctionalDesignation } from "../../functionalHarmonyCatalog";
import type { HarmonyAnalysis, HarmonySpan } from "../analysis";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass } from "../../pitch";

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
  if (!span.semantics) return undefined;
  const confidence = harmonySemanticsConfidence(span.semantics);
  return confidence === "ambiguous" || confidence === "unknown"
    ? undefined
    : primaryHarmonyInterpretation(span.semantics);
}

function localKeyOf(
  interpretation: HarmonyInterpretation | undefined,
  fallback: KeyReference,
) {
  return interpretation?.localKey ?? fallback;
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

function combinedConfidence(
  previousSpan: HarmonySpan,
  currentSpan: HarmonySpan,
): HarmonyConnectionAssessment["confidence"] {
  const values = [
    previousSpan.semantics
      ? harmonySemanticsConfidence(previousSpan.semantics)
      : "unknown",
    currentSpan.semantics
      ? harmonySemanticsConfidence(currentSpan.semantics)
      : "unknown",
  ];
  if (values.includes("unknown")) return "unknown";
  if (values.includes("ambiguous")) return "ambiguous";
  if (values.includes("probable")) return "probable";
  return "certain";
}

function representativeChordAtSpan(
  analysis: Pick<HarmonyAnalysis, "chordById">,
  span: HarmonySpan,
) {
  return span.regionIds.map((id) => analysis.chordById.get(id)).find(Boolean);
}

function projectKeyAtSpan(
  analysis: Pick<HarmonyAnalysis, "project">,
  span: HarmonySpan,
) {
  return (
    analysis.project.keyEvents
      .filter((event) => event.tick <= span.fromTick)
      .at(-1) ?? analysis.project.keyEvents[0]
  );
}

export function isCadential64Span(span: HarmonySpan) {
  const interpretation = interpretationOf(span);
  return (
    interpretation?.designation?.kind === "cadential64" ||
    span.semantics?.cadenceRole === "cadential64"
  );
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
  const sourceInterpretation = interpretationOf(sourceSpan);
  const currentInterpretation = interpretationOf(currentSpan);
  const sourceKey = localKeyOf(
    sourceInterpretation,
    projectKeyAtSpan(analysis, sourceSpan),
  );
  const currentKey = localKeyOf(
    currentInterpretation,
    projectKeyAtSpan(analysis, currentSpan),
  );
  return (
    keyEquals(sourceKey, currentKey) &&
    targetMatches(
      target,
      currentSpan,
      currentInterpretation,
      representativeChordAtSpan(analysis, currentSpan),
      sourceKey,
    )
  );
}

function assessConnection(
  analysis: Pick<HarmonyAnalysis, "project" | "chordById">,
  previous: HarmonySpan,
  current: HarmonySpan,
): HarmonyConnectionAssessment {
  const previousChord = representativeChordAtSpan(analysis, previous);
  const currentChord = representativeChordAtSpan(analysis, current);
  const previousInterpretation = interpretationOf(previous);
  const currentInterpretation = interpretationOf(current);
  const previousKey = localKeyOf(
    previousInterpretation,
    projectKeyAtSpan(analysis, previous),
  );
  const currentKey = localKeyOf(
    currentInterpretation,
    projectKeyAtSpan(analysis, current),
  );
  const keyMatches = keyEquals(previousKey, currentKey);
  const contiguous = previous.toTick === current.fromTick;
  const confidence = combinedConfidence(previous, current);

  const previousDesignation = designationOf(previous, previousChord);
  const currentDesignation = designationOf(current, currentChord);
  const previousFamily = familyOf(previous, previousChord);
  const currentFamily = familyOf(current, currentChord);
  const previousKind = previousDesignation?.kind;
  const currentKind = currentDesignation?.kind;
  let relation: HarmonyConnectionRelation = "unknown";
  let targetMatched: boolean | undefined;

  if (previous.identityKey === current.identityKey) {
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
    targetMatched = targetMatches(
      target,
      current,
      currentInterpretation,
      currentChord,
      previousKey,
    );
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
    targetMatched,
    evidence: Object.freeze([
      { code: "previous-family", value: previousFamily ?? "unknown" },
      { code: "current-family", value: currentFamily ?? "unknown" },
      { code: "previous-kind", value: previousKind ?? "unknown" },
      { code: "current-kind", value: currentKind ?? "unknown" },
    ]),
    confidence,
  });
}

export function buildHarmonyConnections(
  analysis: Pick<HarmonyAnalysis, "project" | "harmonySpans" | "chordById">,
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
        if (!connection || !connection.contiguous || !connection.sameKey) break;
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
