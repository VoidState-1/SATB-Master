import {
  primaryHarmonyInterpretation,
  type FunctionalFamily,
  type HarmonyInterpretation,
  type KeyReference,
} from "../../chordModel";
import type {
  HarmonyAnalysis,
  HarmonySpan,
} from "../analysis";
import { pitchClassEquals } from "../../pitch";
import type { RuleExceptionContext } from "./types";

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
  previousSpanId: string;
  currentSpanId: string;
  previousInterpretationId?: string;
  currentInterpretationId?: string;
  relation: HarmonyConnectionRelation;
  contiguous: boolean;
  sameKey: boolean;
  targetMatched?: boolean;
  exceptionTags: readonly RuleExceptionContext[];
  evidence: readonly ConnectionEvidence[];
  confidence: "certain" | "probable" | "ambiguous" | "unknown";
}

function interpretationOf(span: HarmonySpan) {
  return span.semantics
    ? primaryHarmonyInterpretation(span.semantics)
    : undefined;
}

function localKeyOf(
  interpretation: HarmonyInterpretation | undefined,
  fallback: KeyReference,
) {
  return interpretation?.localKey ?? fallback;
}

function sameKey(left: KeyReference, right: KeyReference) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

function familyOf(
  interpretation: HarmonyInterpretation | undefined,
): FunctionalFamily | undefined {
  const designation = interpretation?.designation;
  if (designation?.primaryFunction) return designation.primaryFunction;
  if (!interpretation) return undefined;
  if ([1, 3, 6].includes(interpretation.degree)) return "tonic";
  if ([2, 4].includes(interpretation.degree)) return "subdominant";
  if ([5, 7].includes(interpretation.degree)) return "dominant";
  return undefined;
}

function combinedConfidence(
  previous: HarmonyInterpretation | undefined,
  current: HarmonyInterpretation | undefined,
): HarmonyConnectionAssessment["confidence"] {
  const values = [previous?.confidence ?? "unknown", current?.confidence ?? "unknown"];
  if (values.includes("unknown")) return "unknown";
  if (values.includes("ambiguous")) return "ambiguous";
  if (values.includes("probable")) return "probable";
  return "certain";
}

function primaryChordAtSpan(
  analysis: Pick<HarmonyAnalysis, "chordById">,
  span: HarmonySpan,
) {
  return span.regionIds
    .map((id) => analysis.chordById.get(id))
    .find(Boolean);
}

function assessConnection(
  analysis: Pick<HarmonyAnalysis, "project" | "chordById">,
  previous: HarmonySpan,
  current: HarmonySpan,
): HarmonyConnectionAssessment {
  const previousChord = primaryChordAtSpan(analysis, previous);
  const currentChord = primaryChordAtSpan(analysis, current);
  const previousInterpretation = interpretationOf(previous);
  const currentInterpretation = interpretationOf(current);
  const previousKey = localKeyOf(
    previousInterpretation,
    previousChord
      ? analysis.project.keyEvents
          .filter((event) => event.tick <= previousChord.startTick)
          .at(-1)!
      : analysis.project.keyEvents[0],
  );
  const currentKey = localKeyOf(
    currentInterpretation,
    currentChord
      ? analysis.project.keyEvents
          .filter((event) => event.tick <= currentChord.startTick)
          .at(-1)!
      : analysis.project.keyEvents[0],
  );
  const keyMatches = sameKey(previousKey, currentKey);
  const contiguous = previous.toTick === current.fromTick;
  const exceptionTags: RuleExceptionContext[] = [];
  if (!keyMatches) exceptionTags.push("modulation");
  if (previous.semantics?.pedalContext || current.semantics?.pedalContext)
    exceptionTags.push("pedal-point");

  const confidence = combinedConfidence(
    previousInterpretation,
    currentInterpretation,
  );
  if (confidence === "ambiguous" || confidence === "unknown")
    exceptionTags.push("ambiguous-semantics");

  const previousFamily = familyOf(previousInterpretation);
  const currentFamily = familyOf(currentInterpretation);
  const previousKind =
    previousInterpretation?.designation?.kind ??
    (previous.semantics?.cadenceRole === "cadential64"
      ? "cadential64"
      : undefined);
  const currentKind =
    currentInterpretation?.designation?.kind ??
    (current.semantics?.cadenceRole === "cadential64"
      ? "cadential64"
      : undefined);
  let relation: HarmonyConnectionRelation = "unknown";
  let targetMatched: boolean | undefined;

  if (previous.identityKey === current.identityKey) {
    relation =
      previousInterpretation?.id === currentInterpretation?.id && keyMatches
        ? "same-harmony"
        : "pivot-reinterpretation";
    if (relation === "same-harmony") exceptionTags.push("same-harmony");
  } else if (previousKind === "cadential64") {
    targetMatched = currentFamily === "dominant";
    relation = "cadential64-target";
  } else if (
    previousKind === "applied-dominant" ||
    previousKind === "applied-leading-tone" ||
    previousInterpretation?.appliedTarget
  ) {
    const target = previousInterpretation?.appliedTarget;
    targetMatched = Boolean(
      target && currentInterpretation?.degree === target.degree,
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
  } else if (
    previousFamily === "subdominant" &&
    currentFamily === "dominant"
  ) {
    relation = "predominant-to-dominant";
  } else if (
    previousFamily === "tonic" &&
    (currentFamily === "subdominant" || currentFamily === "dominant")
  ) {
    relation = "tonic-departure";
  }

  return Object.freeze({
    previousSpanId: previous.id,
    currentSpanId: current.id,
    previousInterpretationId: previousInterpretation?.id,
    currentInterpretationId: currentInterpretation?.id,
    relation,
    contiguous,
    sameKey: keyMatches,
    targetMatched,
    exceptionTags: Object.freeze([...new Set(exceptionTags)]),
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
