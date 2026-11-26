import type { HarmonyAnalysis } from "../analysis";
import type {
  HarmonyDiagnostic,
  RuleDefinition,
  RuleDiagnostic,
} from "../runtime";
import type { VoiceId } from "../../project/types";
import type { DiagnosticSeverity, RuleConfig, RuleExceptionPolicy } from "./types";
import { createDiagnosticDebugSnapshot } from "../debug/diagnosticDebug";
import { compareDiagnosticSeverity } from "./policy/severity";
import {
  normalizeDiagnosticSubjects,
  validateDiagnosticReferences,
  validateDiagnosticShape,
} from "./policy/diagnostic";

function stable(items: readonly string[]) {
  return [...new Set(items)].sort();
}

function evidenceIds(item: Pick<HarmonyDiagnostic, "evidence">) {
  return stable(
    item.evidence
      .map((entry) => entry.id)
      .filter((id): id is string => Boolean(id)),
  );
}

function canonicalScope(item: RuleDiagnostic) {
  if (item.chordIds.length > 0)
    return `chord:${stable(item.chordIds).join(",")}`;
  if (item.noteIds.length > 0) return `note:${stable(item.noteIds).join(",")}`;
  if (item.voiceIds.length > 0)
    return `voice:${stable(item.voiceIds).join(",")}`;
  return "project";
}

export function stableRootCauseKey(item: RuleDiagnostic) {
  return [
    item.ruleId,
    canonicalScope(item),
    `${item.tick}-${item.endTick}`,
    stable(item.causeRefs ?? []).join(",") || evidenceIds(item).join(","),
    item.rootCauseKey ?? item.messageKey,
  ].join("|");
}

export function normalizeBuiltinDiagnostic(
  item: RuleDiagnostic,
  definition: RuleDefinition,
  analysis: HarmonyAnalysis,
  severity: DiagnosticSeverity,
  config: RuleConfig = {},
  exceptionPolicy: RuleExceptionPolicy = {},
): HarmonyDiagnostic | undefined {
  if (item.ruleId !== definition.id || item.source !== "builtin")
    return undefined;
  const references = {
    maximumTick: analysis.project.lengthTicks,
    noteIds: analysis.noteById,
    chordIds: analysis.chordById,
    spanIds: new Set(analysis.harmonySpans.map((span) => span.id)),
  };
  if (
    !validateDiagnosticShape(item, references.maximumTick).ok ||
    !validateDiagnosticReferences(item, references).ok
  )
    return undefined;
  const {
    pairMotion: _pairMotion, motionSameHarmony: _motionSameHarmony,
    melodyTransitionId: _melodyTransitionId, sliceTransitionId: _sliceTransitionId,
    strictDefaultContext: _strictDefaultContext,
    severityCap: _severityCap, ...report
  } = item;
  const normalized: HarmonyDiagnostic = {
    ...report,
    id: stableRootCauseKey(item),
    severity,
    voiceIds: stable(item.voiceIds) as VoiceId[],
    noteIds: stable(item.noteIds),
    chordIds: stable(item.chordIds),
    params: { ...item.params },
    evidence: item.evidence.map((entry) => ({ ...entry })),
    causeRefs:
      item.causeRefs && item.causeRefs.length > 0
        ? stable(item.causeRefs)
        : undefined,
    coverageRefs:
      item.coverageRefs && item.coverageRefs.length > 0
        ? stable(item.coverageRefs)
        : undefined,
    subjects: normalizeDiagnosticSubjects(item.subjects),
    trace: item.trace?.map((entry) => ({ ...entry })),
  };
  normalized.debug = item.debug
    ? {
        ...item.debug,
        runtime: {
          ...item.debug.runtime,
          revision: analysis.revision,
          severity,
          config: Object.fromEntries(
            Object.entries(config).map(([key, value]) => [key, value]),
          ),
          exceptionPolicy: Object.fromEntries(
            Object.entries(exceptionPolicy).map(([key, value]) => [key, value]),
          ),
        },
        diagnostic: {
          ...item.debug.diagnostic,
          id: normalized.id,
          severity,
        },
      }
    : createDiagnosticDebugSnapshot({
        analysis,
        diagnostic: normalized,
        revision: analysis.revision,
        config,
        exceptionPolicy,
      });
  return normalized;
}

function sameCauseObjects(left: HarmonyDiagnostic, right: HarmonyDiagnostic) {
  return (
    stable(left.noteIds).join(",") === stable(right.noteIds).join(",") &&
    stable(left.chordIds).join(",") === stable(right.chordIds).join(",") &&
    stable(left.voiceIds).join(",") === stable(right.voiceIds).join(",")
  );
}

function mergeRanges(source: readonly HarmonyDiagnostic[]) {
  const groups = new Map<string, HarmonyDiagnostic[]>();
  source.forEach((item) => {
    const key = [
      item.ruleId,
      item.rootCauseKey ?? item.messageKey,
      stable(item.causeRefs ?? []).join(","),
      stable(item.noteIds).join(","),
      stable(item.chordIds).join(","),
      stable(item.voiceIds).join(","),
      item.params.missing,
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return [...groups.values()].flatMap((group) => {
    const ordered = [...group].sort(
      (left, right) => left.tick - right.tick || left.endTick - right.endTick,
    );
    const result: HarmonyDiagnostic[] = [];
    ordered.forEach((item) => {
      const previous = result.at(-1);
      if (
        previous &&
        sameCauseObjects(previous, item) &&
        item.tick <= previous.endTick
      ) {
        previous.endTick = Math.max(previous.endTick, item.endTick);
        previous.id = stableRootCauseKey(previous);
        if (previous.debug) {
          previous.debug = {
            ...previous.debug,
            diagnostic: {
              ...previous.debug.diagnostic,
              id: previous.id,
              endTick: previous.endTick,
            },
            location: {
              ...previous.debug.location,
              endTick: previous.endTick,
            },
            notes: [
              ...(previous.debug.notes ?? []),
              "相邻的同一根因诊断已合并；调试事件以首个诊断位置为中心。",
            ],
          };
        }
      } else {
        result.push({ ...item });
      }
    });
    return result;
  });
}

function structuredCoverageMatches(
  specific: HarmonyDiagnostic,
  candidate: HarmonyDiagnostic,
) {
  const candidateCauses = new Set(candidate.causeRefs ?? []);
  if (
    (specific.coverageRefs ?? []).some((reference) =>
      candidateCauses.has(reference),
    )
  )
    return true;
  return (specific.causeRefs ?? []).some((reference) =>
    candidateCauses.has(reference),
  );
}

function overlaps(left: HarmonyDiagnostic, right: HarmonyDiagnostic) {
  return left.tick <= right.endTick && right.tick <= left.endTick;
}

function attachBassConsequences(items: HarmonyDiagnostic[]) {
  const bassErrors = items.filter(item => item.source === "builtin" && item.ruleId === "chord.inversion-bass" &&
    typeof item.params.expectedBass === "string" && item.chordIds.length === 1 && item.noteIds.length === 1);
  const primary = items.filter(item => {
    if (item.source !== "builtin" || item.chordIds.length !== 1 ||
        (item.ruleId !== "chord.incomplete-members" && item.ruleId !== "chord.unclassified-nonchord-tone")) return true;
    const cause = bassErrors.find(bass =>
      bass.chordIds[0] === item.chordIds[0] && bass.tick <= item.tick && item.endTick <= bass.endTick &&
      compareDiagnosticSeverity(bass.severity, item.severity) <= 0 &&
      (item.ruleId === "chord.incomplete-members"
        ? item.params.missing === bass.params.expectedBass
        : item.noteIds.length === 1 && item.noteIds[0] === bass.noteIds[0]));
    if (!cause) return true;
    cause.consequences = [...(cause.consequences ?? []), item];
    return false;
  });
  for (const bass of bassErrors) {
    if (bass.consequences) bass.consequences = [...bass.consequences].sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  }
  return primary;
}

/** 去重后由子规则覆盖同证据上的通用父规则，且不依赖规则执行顺序。 */
export function arbitrateDiagnostics(
  source: readonly HarmonyDiagnostic[],
  definitions: readonly RuleDefinition[],
) {
  const merged = mergeRanges(source);
  const coveredByRule = new Map<string, ReadonlySet<string>>(
    definitions
      .filter((definition) => definition.coveredRuleIds.length > 0)
      .map((definition) => [definition.id, new Set(definition.coveredRuleIds)]),
  );
  const primary = merged.filter((candidate) => {
    return !merged.some((specific) => {
      const specificCoversCandidate =
        coveredByRule.get(specific.ruleId)?.has(candidate.ruleId) ?? false;
      if (!specificCoversCandidate) return false;
      return (
        overlaps(specific, candidate) &&
        (structuredCoverageMatches(specific, candidate) ||
          sameCauseObjects(specific, candidate))
      );
    });
  });
  return attachBassConsequences(primary);
}
