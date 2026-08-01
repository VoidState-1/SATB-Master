import {
  buildHarmonyAnalysis,
  functionalClassOf,
  type AnalysisInvalidationRange,
  type HarmonyAnalysis,
  type ProjectSnapshot,
} from "./harmonyAnalysis";
import {
  VOICE_ORDER,
  type ProjectDocument,
  type VoiceId,
} from "./model";
import {
  type DiagnosticSeverity,
  type HarmonyRuleDefinition,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
} from "./harmonyRules";

export type DiagnosticEvidenceKind =
  | "note"
  | "chord"
  | "interval"
  | "key"
  | "function";

export interface DiagnosticEvidence {
  kind: DiagnosticEvidenceKind;
  id?: string;
  label: string;
  value: string;
}

export interface HarmonyDiagnostic {
  id: string;
  ruleId: HarmonyRuleId;
  source: "builtin";
  severity: DiagnosticSeverity;
  tick: number;
  endTick: number;
  voiceIds: VoiceId[];
  noteIds: string[];
  chordIds: string[];
  title: string;
  message: string;
  messageKey: string;
  params: Record<string, string | number | boolean>;
  evidence: DiagnosticEvidence[];
  confidence: number;
}

export type RuleDiagnostic = Omit<HarmonyDiagnostic, "id" | "severity">;

export type RuleSkipReason =
  | "no-chords"
  | "missing-function"
  | "ambiguous-function"
  | "insufficient-context"
  | "rule-error";

export interface SkippedRule {
  ruleId: HarmonyRuleId;
  reason: RuleSkipReason;
  message: string;
  partial: boolean;
}

export interface HarmonyCheckResult {
  diagnostics: HarmonyDiagnostic[];
  skippedRules: SkippedRule[];
  skippedRuleIds: HarmonyRuleId[];
  revision: number;
  superseded: boolean;
  invalidationRanges: readonly AnalysisInvalidationRange[];
}

export interface RuleConfig {
  readonly [key: string]: string | number | boolean | undefined;
}

export interface ReadonlyRuleContext {
  readonly analysis: HarmonyAnalysis;
}

export interface RuleEvaluation {
  readonly diagnostics: readonly RuleDiagnostic[];
  readonly skipped?: readonly Omit<SkippedRule, "ruleId">[];
}

export interface RuleDefinition
  extends Omit<HarmonyRuleDefinition, "id"> {
  readonly id: HarmonyRuleId;
  readonly evaluate: (
    context: ReadonlyRuleContext,
    config: RuleConfig,
  ) => RuleEvaluation | Promise<RuleEvaluation>;
}

export interface RuleRunRequest {
  project: ProjectDocument;
  severities: HarmonyRuleSeverities;
  revision: number;
  signal?: AbortSignal;
  configs?: Partial<Record<HarmonyRuleId, RuleConfig>>;
}

const MAX_DIAGNOSTICS_PER_RULE = 512;
const MAX_MESSAGE_LENGTH = 600;
const MAX_EVIDENCE_ITEMS = 16;

function stableObjects(items: readonly string[]) {
  return [...new Set(items)].sort();
}

function diagnosticId(item: RuleDiagnostic) {
  return [
    item.ruleId,
    item.messageKey,
    item.tick,
    stableObjects(item.noteIds).join(","),
    stableObjects(item.chordIds).join(","),
    stableObjects(item.voiceIds).join(","),
  ].join(":");
}

function validateDiagnostic(
  item: RuleDiagnostic,
  definition: RuleDefinition,
  analysis: HarmonyAnalysis,
  severity: DiagnosticSeverity,
) {
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

  const normalized: HarmonyDiagnostic = {
    ...item,
    id: diagnosticId(item),
    severity,
    voiceIds: stableObjects(item.voiceIds) as VoiceId[],
    noteIds: stableObjects(item.noteIds),
    chordIds: stableObjects(item.chordIds),
    params: { ...item.params },
    evidence: item.evidence.map((evidence) => ({ ...evidence })),
  };
  return normalized;
}

function requirementSkips(
  definition: RuleDefinition,
  analysis: HarmonyAnalysis,
) {
  const skipped: SkippedRule[] = [];
  const chordCount = analysis.project.chordTrack.regions.length;
  if (definition.requires.includes("chords") && chordCount === 0) {
    skipped.push({
      ruleId: definition.id,
      reason: "no-chords",
      message: "和弦轨为空，缺少和弦上下文。",
      partial: false,
    });
    return skipped;
  }

  if (definition.requires.includes("complete-satb")) {
    const hasCompleteContext = analysis.slices.some(
      (slice) => slice.chord && slice.completeSatb,
    );
    if (!hasCompleteContext) {
      skipped.push({
        ruleId: definition.id,
        reason: "insufficient-context",
        message: "当前没有同时具备四个 SATB 声部的完整和弦切片。",
        partial: false,
      });
      return skipped;
    }
  }

  if (definition.requires.includes("functions")) {
    const regions = analysis.project.chordTrack.regions;
    const withFunction = regions.filter((region) => Boolean(region.function));
    if (withFunction.length === 0) {
      skipped.push({
        ruleId: definition.id,
        reason: "missing-function",
        message: "和弦尚未提供功能分析，无法判断功能进行。",
        partial: false,
      });
      return skipped;
    }
    const analyzable = withFunction.filter(
      (region) => functionalClassOf(region.function) !== "ambiguous",
    );
    if (analyzable.length === 0) {
      skipped.push({
        ruleId: definition.id,
        reason: "ambiguous-function",
        message: "现有功能分析均存在歧义，未将推断当作确定结论。",
        partial: false,
      });
      return skipped;
    }
    if (withFunction.length < regions.length) {
      skipped.push({
        ruleId: definition.id,
        reason: "missing-function",
        message: "部分和弦缺少功能分析；已仅检查上下文完整的连接。",
        partial: true,
      });
    }
    if (analyzable.length < withFunction.length) {
      skipped.push({
        ruleId: definition.id,
        reason: "ambiguous-function",
        message: "部分功能上下文存在歧义；已仅检查能够确定的连接。",
        partial: true,
      });
    }
  }
  return skipped;
}

function sameRootCause(left: HarmonyDiagnostic, right: HarmonyDiagnostic) {
  return (
    left.ruleId === right.ruleId &&
    left.messageKey === right.messageKey &&
    left.noteIds.join(",") === right.noteIds.join(",") &&
    left.chordIds.join(",") === right.chordIds.join(",") &&
    left.voiceIds.join(",") === right.voiceIds.join(",")
  );
}

function mergeDiagnostics(source: HarmonyDiagnostic[]) {
  const groups = new Map<string, HarmonyDiagnostic[]>();
  source.forEach((item) => {
    const key = [
      item.ruleId,
      item.messageKey,
      item.noteIds.join(","),
      item.chordIds.join(","),
      item.voiceIds.join(","),
    ].join(":");
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  });
  const merged = [...groups.values()].flatMap((group) => {
    const ordered = group.sort(
      (left, right) => left.tick - right.tick || left.endTick - right.endTick,
    );
    const result: HarmonyDiagnostic[] = [];
    ordered.forEach((item) => {
      const previous = result.at(-1);
      if (
        previous &&
        sameRootCause(previous, item) &&
        item.tick <= previous.endTick
      ) {
        previous.endTick = Math.max(previous.endTick, item.endTick);
        return;
      }
      result.push({ ...item });
    });
    return result;
  });

  // 书写音程规则比旧的“六个半音”判断信息更精确，同一根因只保留前者，避免双重提示。
  const specificIntervals = new Set(
    merged
      .filter((item) => item.ruleId === "augmented-diminished-interval")
      .map((item) => `${item.tick}:${item.noteIds.join(",")}`),
  );
  return merged.filter(
    (item) =>
      item.ruleId !== "melodic-tritone" ||
      !specificIntervals.has(`${item.tick}:${item.noteIds.join(",")}`),
  );
}

function severityOrder(severity: DiagnosticSeverity) {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function completeResult(
  analysis: HarmonyAnalysis,
  diagnostics: HarmonyDiagnostic[],
  skippedRules: SkippedRule[],
  superseded: boolean,
): HarmonyCheckResult {
  const uniqueSkips = new Map(
    skippedRules.map((item) => [
      `${item.ruleId}:${item.reason}:${item.partial}`,
      item,
    ]),
  );
  return {
    diagnostics: mergeDiagnostics(diagnostics).sort(
      (left, right) =>
        left.tick - right.tick ||
        severityOrder(left.severity) - severityOrder(right.severity) ||
        left.ruleId.localeCompare(right.ruleId),
    ),
    skippedRules: [...uniqueSkips.values()],
    skippedRuleIds: [...new Set([...uniqueSkips.values()].map((item) => item.ruleId))],
    revision: analysis.revision,
    superseded,
    invalidationRanges: analysis.invalidationRanges,
  };
}

function collectEvaluation(
  definition: RuleDefinition,
  evaluation: RuleEvaluation,
  analysis: HarmonyAnalysis,
  severity: DiagnosticSeverity,
) {
  const diagnostics = evaluation.diagnostics
    .slice(0, MAX_DIAGNOSTICS_PER_RULE)
    .map((item) => validateDiagnostic(item, definition, analysis, severity))
    .filter((item): item is HarmonyDiagnostic => Boolean(item));
  const skipped = (evaluation.skipped ?? []).map((item) => ({
    ...item,
    ruleId: definition.id,
  }));
  return { diagnostics, skipped };
}

export function runRulesSynchronously(
  definitions: readonly RuleDefinition[],
  project: ProjectDocument,
  severities: HarmonyRuleSeverities,
  revision = 0,
) {
  const analysis = buildHarmonyAnalysis(project, revision);
  const diagnostics: HarmonyDiagnostic[] = [];
  const skippedRules: SkippedRule[] = [];
  for (const definition of definitions) {
    const severity = severities[definition.id];
    if (severity === "off") continue;
    const requirements = requirementSkips(definition, analysis);
    skippedRules.push(...requirements);
    if (requirements.some((item) => !item.partial)) continue;
    try {
      const evaluation = definition.evaluate({ analysis }, {});
      if (evaluation instanceof Promise)
        throw new Error("同步兼容入口不支持异步规则");
      const collected = collectEvaluation(
        definition,
        evaluation,
        analysis,
        severity,
      );
      diagnostics.push(...collected.diagnostics);
      skippedRules.push(...collected.skipped);
    } catch {
      skippedRules.push({
        ruleId: definition.id,
        reason: "rule-error",
        message: `规则“${definition.label}”本次执行失败，其他规则仍继续运行。`,
        partial: false,
      });
    }
  }
  return completeResult(analysis, diagnostics, skippedRules, false);
}

export class RuleScheduler {
  private runToken = 0;
  private previousSnapshot?: ProjectSnapshot;

  constructor(private readonly definitions: readonly RuleDefinition[]) {}

  cancel() {
    this.runToken += 1;
  }

  async run(request: RuleRunRequest): Promise<HarmonyCheckResult> {
    const token = ++this.runToken;
    await Promise.resolve();
    const analysis = buildHarmonyAnalysis(
      request.project,
      request.revision,
      this.previousSnapshot,
    );
    const diagnostics: HarmonyDiagnostic[] = [];
    const skippedRules: SkippedRule[] = [];

    for (const definition of this.definitions) {
      if (token !== this.runToken || request.signal?.aborted)
        return completeResult(analysis, [], skippedRules, true);
      const severity = request.severities[definition.id];
      if (severity === "off") continue;
      const requirements = requirementSkips(definition, analysis);
      skippedRules.push(...requirements);
      if (requirements.some((item) => !item.partial)) continue;
      let evaluation: RuleEvaluation;
      try {
        evaluation = await definition.evaluate(
          { analysis },
          request.configs?.[definition.id] ?? {},
        );
      } catch {
        skippedRules.push({
          ruleId: definition.id,
          reason: "rule-error",
          message: `规则“${definition.label}”本次执行失败，其他规则仍继续运行。`,
          partial: false,
        });
        continue;
      }
      if (token !== this.runToken || request.signal?.aborted)
        return completeResult(analysis, [], skippedRules, true);
      const collected = collectEvaluation(
        definition,
        evaluation,
        analysis,
        severity,
      );
      diagnostics.push(...collected.diagnostics);
      skippedRules.push(...collected.skipped);
    }

    this.previousSnapshot = analysis.project;
    return completeResult(analysis, diagnostics, skippedRules, false);
  }
}
