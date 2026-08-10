import type { HarmonyAnalysis } from "../analysis";
import type {
  HarmonyDiagnostic,
  RuleDefinition,
  RuleDiagnostic,
} from "../runtime";
import type { VoiceId } from "../../project/types";
import { VOICE_ORDER } from "../../project/voice";
import type { DiagnosticSeverity } from "./types";

const MAX_MESSAGE_LENGTH = 600;
const MAX_EVIDENCE_ITEMS = 16;

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
  if (item.chordIds.length > 0) return `chord:${stable(item.chordIds).join(",")}`;
  if (item.noteIds.length > 0) return `note:${stable(item.noteIds).join(",")}`;
  if (item.voiceIds.length > 0) return `voice:${stable(item.voiceIds).join(",")}`;
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
): HarmonyDiagnostic | undefined {
  if (item.ruleId !== definition.id || item.source !== "builtin") return undefined;
  if (
    !Number.isInteger(item.tick) ||
    !Number.isInteger(item.endTick) ||
    item.tick < 0 ||
    item.endTick < item.tick ||
    item.endTick > analysis.project.lengthTicks
  )
    return undefined;
  if (
    !item.title.trim() ||
    !item.message.trim() ||
    item.title.length > 120 ||
    item.message.length > MAX_MESSAGE_LENGTH ||
    !item.messageKey.trim() ||
    item.messageKey.length > 120
  )
    return undefined;
  if (
    item.noteIds.some((id) => !analysis.noteById.has(id)) ||
    item.chordIds.some((id) => !analysis.chordById.has(id)) ||
    item.voiceIds.some((id) => !VOICE_ORDER.includes(id))
  )
    return undefined;
  if (
    !Number.isFinite(item.confidence) ||
    item.confidence < 0 ||
    item.confidence > 1 ||
    item.evidence.length > MAX_EVIDENCE_ITEMS
  )
    return undefined;
  const validStructuredRefs = (refs: readonly string[] | undefined) =>
    refs === undefined ||
    (refs.length <= 32 &&
      refs.every(
        (ref) =>
          typeof ref === "string" &&
          ref.trim().length > 0 &&
          ref.length <= 240,
      ));
  if (
    !validStructuredRefs(item.causeRefs) ||
    !validStructuredRefs(item.coverageRefs)
  )
    return undefined;
  const normalized: HarmonyDiagnostic = {
    ...item,
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
  };
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

/** 去重后由子规则覆盖同证据上的通用父规则，且不依赖规则执行顺序。 */
export function arbitrateDiagnostics(
  source: readonly HarmonyDiagnostic[],
  definitions: readonly RuleDefinition[],
) {
  const merged = mergeRanges(source);
  const coveredByRule = new Map<string, ReadonlySet<string>>(
    definitions
      .filter((definition) => definition.coveredRuleIds.length > 0)
      .map((definition) => [
        definition.id,
        new Set(definition.coveredRuleIds),
      ]),
  );
  return merged.filter((candidate) => {
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
}
