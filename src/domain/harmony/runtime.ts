import {
  buildHarmonyAnalysis,
  type AnalysisInvalidationRange,
  type AnalysisSlice,
  type HarmonyAnalysis,
  type HarmonySpan,
  type ProjectSnapshot,
  type SliceTransition,
} from "./analysis";
import type { ProjectDocument, VoiceId } from "../project/types";
import { VOICE_ORDER } from "../project/voice";
import { planRuleApplicability } from "./rules/applicability";
import {
  arbitrateDiagnostics,
  normalizeBuiltinDiagnostic,
} from "./rules/diagnosticArbiter";
import {
  type DiagnosticSeverity,
  type HarmonyRuleDefinition,
  type HarmonyRuleSeverity,
  type RuleConfig,
  type RuleExceptionContext,
  type RuleExceptionPolicy,
} from "./rules/types";

export type { RuleConfig } from "./rules/types";

type RuntimeRuleSeverities = Record<string, HarmonyRuleSeverity>;

export type DiagnosticEvidenceKind =
  "note" | "chord" | "interval" | "key" | "function";

export interface DiagnosticEvidence {
  kind: DiagnosticEvidenceKind;
  id?: string;
  label: string;
  value: string;
}

export interface DiagnosticSubjectRefs {
  voiceIds?: VoiceId[];
  noteIds?: string[];
  chordIds?: string[];
  spanIds?: string[];
}

export interface DiagnosticSubjects {
  origin?: DiagnosticSubjectRefs;
  failure?: DiagnosticSubjectRefs;
  context?: DiagnosticSubjectRefs;
}

export interface DiagnosticTraceEntry {
  tick: number;
  outcome: "continue" | "resolve" | "violate" | "cancel" | "indeterminate";
  reason: string;
}

export interface HarmonyDiagnostic {
  id: string;
  ruleId: string;
  source: "builtin" | "external";
  severity: DiagnosticSeverity;
  tick: number;
  endTick: number;
  voiceIds: VoiceId[];
  noteIds: string[];
  chordIds: string[];
  title: string;
  message: string;
  messageKey: string;
  /** 同一音乐学根因跨切片重复出现时使用的稳定键；省略时退回 messageKey。 */
  rootCauseKey?: string;
  /** 规则产生诊断所依据的稳定音乐学根因。 */
  causeRefs?: string[];
  /** 专用规则声明本条诊断能够覆盖的通用根因。 */
  coverageRefs?: string[];
  params: Record<string, string | number | boolean>;
  evidence: DiagnosticEvidence[];
  confidence: number;
  exceptionContexts?: RuleExceptionContext[];
  subjects?: DiagnosticSubjects;
  trace?: DiagnosticTraceEntry[];
}

export type RuleDiagnostic = Omit<
  HarmonyDiagnostic,
  "id" | "severity" | "exceptionContexts"
>;

export type RuleSkipReason =
  | "no-chords"
  | "missing-semantics"
  | "ambiguous-semantics"
  | "insufficient-context"
  | "rule-error";

export interface SkippedRule {
  ruleId: string;
  reason: RuleSkipReason;
  message: string;
  partial: boolean;
}

export interface HarmonyCheckResult {
  diagnostics: HarmonyDiagnostic[];
  skippedRules: SkippedRule[];
  skippedRuleIds: string[];
  revision: number;
  superseded: boolean;
  invalidationRanges: readonly AnalysisInvalidationRange[];
}

export interface ReadonlyRuleContext {
  readonly analysis: HarmonyAnalysis;
}

/**
 * 规则之间不共享可变状态。每条有状态规则只能把自己的 JSON 信封沿切片链
 * 传给下一步；信封只是时间上下文的传递容器，生命周期和判定语义由规则自己决定。
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface RuleStateEnvelope<T extends JsonValue = JsonValue> {
  readonly id: string;
  readonly ownerRuleId: string;
  readonly createdAt: { readonly tick: number; readonly sliceIndex: number };
  readonly subjectRefs?: {
    readonly voiceIds?: readonly VoiceId[];
    readonly noteIds?: readonly string[];
    readonly chordIds?: readonly string[];
    readonly spanIds?: readonly string[];
  };
  readonly payload: T;
}

export interface RuleStepContext {
  readonly analysis: HarmonyAnalysis;
  readonly slice: AnalysisSlice;
  readonly sliceIndex: number;
  readonly previous?: AnalysisSlice;
  readonly transitionFromPrevious?: SliceTransition;
  readonly span?: HarmonySpan;
  readonly isSpanStart: boolean;
  readonly isSpanEnd: boolean;
}

export interface RuleEvaluation {
  readonly diagnostics: readonly RuleDiagnostic[];
  readonly skipped?: readonly Omit<SkippedRule, "ruleId">[];
}

export interface StatelessRuleDefinition
  extends Omit<HarmonyRuleDefinition, "id"> {
  readonly id: string;
  readonly evaluate: (
    context: ReadonlyRuleContext,
    config: RuleConfig,
  ) => RuleEvaluation | Promise<RuleEvaluation>;
}

export interface RuleStepResult<T extends JsonValue = JsonValue>
  extends RuleEvaluation {
  readonly outgoing: readonly RuleStateEnvelope<T>[];
}

export interface StatefulRuleDefinition<T extends JsonValue = JsonValue>
  extends Omit<HarmonyRuleDefinition, "id"> {
  readonly id: string;
  readonly process: (
    context: RuleStepContext,
    incoming: readonly RuleStateEnvelope<T>[],
    config: RuleConfig,
  ) => RuleStepResult<T> | Promise<RuleStepResult<T>>;
  readonly finalize?: (
    context: RuleStepContext | undefined,
    remaining: readonly RuleStateEnvelope<T>[],
    config: RuleConfig,
  ) => RuleEvaluation | Promise<RuleEvaluation>;
}

export type RuleDefinition = StatelessRuleDefinition | StatefulRuleDefinition;

function isStatefulRule(
  definition: RuleDefinition,
): definition is StatefulRuleDefinition {
  return "process" in definition;
}

export interface RuleRunRequest {
  project: ProjectDocument;
  analysis?: HarmonyAnalysis;
  severities: RuntimeRuleSeverities;
  revision: number;
  signal?: AbortSignal;
  configs?: Partial<Record<string, RuleConfig>>;
  exceptions?: Partial<Record<string, RuleExceptionPolicy>>;
}

const MAX_DIAGNOSTICS_PER_RULE = 512;
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

  if (definition.requires.includes("semantics")) {
    const spans = analysis.harmonySpans;
    const withSemantics = spans.filter((span) => Boolean(span.semantics));
    if (withSemantics.length === 0) {
      skipped.push({
        ruleId: definition.id,
        reason: "missing-semantics",
        message: "和弦尚未提供和声语义，无法判断功能进行。",
        partial: false,
      });
      return skipped;
    }
    const analyzable = withSemantics.filter((span) => span.status === "complete");
    if (analyzable.length === 0) {
      skipped.push({
        ruleId: definition.id,
        reason: "ambiguous-semantics",
        message: "现有和声语义均存在歧义，未将推断当作确定结论。",
        partial: false,
      });
      return skipped;
    }
    if (withSemantics.length < spans.length) {
      skipped.push({
        ruleId: definition.id,
        reason: "missing-semantics",
        message: "部分和弦缺少和声语义；已仅检查上下文完整的连接。",
        partial: true,
      });
    }
    if (analyzable.length < withSemantics.length) {
      skipped.push({
        ruleId: definition.id,
        reason: "ambiguous-semantics",
        message: "部分和声语义存在歧义；已仅检查能够确定的连接。",
        partial: true,
      });
    }
  }
  return skipped;
}

function severityOrder(severity: DiagnosticSeverity) {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function completeResult(
  analysis: HarmonyAnalysis,
  diagnostics: HarmonyDiagnostic[],
  skippedRules: SkippedRule[],
  superseded: boolean,
  definitions: readonly RuleDefinition[],
): HarmonyCheckResult {
  const uniqueSkips = new Map(
    skippedRules.map((item) => [
      `${item.ruleId}:${item.reason}:${item.partial}`,
      item,
    ]),
  );
  return {
    diagnostics: arbitrateDiagnostics(diagnostics, definitions).sort(
      (left, right) =>
        left.tick - right.tick ||
        severityOrder(left.severity) - severityOrder(right.severity) ||
        left.ruleId.localeCompare(right.ruleId),
    ),
    skippedRules: [...uniqueSkips.values()],
    skippedRuleIds: [
      ...new Set([...uniqueSkips.values()].map((item) => item.ruleId)),
    ],
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
  exceptionPolicy: RuleExceptionPolicy = {},
) {
  const effectiveExceptionPolicy = {
    ...exceptionPolicy,
  };
  const diagnostics = evaluation.diagnostics
    .slice(0, MAX_DIAGNOSTICS_PER_RULE)
    .map((item) => {
      const applicability = planRuleApplicability(
        definition,
        item,
        analysis,
        effectiveExceptionPolicy,
      );
      if (
        applicability.policy === "skip" ||
        applicability.policy === "deferred"
      )
        return undefined;
      const effectiveSeverity = applicability.policy === "downgraded"
        ? severity === "error"
          ? "warning"
          : "suggestion"
        : severity;
      return normalizeBuiltinDiagnostic(
        item,
        definition,
        analysis,
        effectiveSeverity,
      );
    })
    .filter((item): item is HarmonyDiagnostic => Boolean(item));
  const skipped = (evaluation.skipped ?? []).map((item) => ({
    ...item,
    ruleId: definition.id,
  }));
  return { diagnostics, skipped };
}

const MAX_RULE_STATES = 512;
const MAX_RULE_STATE_BYTES = 16 * 1024;

function stepContextAt(
  analysis: HarmonyAnalysis,
  sliceIndex: number,
  spanById: ReadonlyMap<string, HarmonySpan>,
): RuleStepContext {
  const slice = analysis.slices[sliceIndex];
  const previous = analysis.slices[sliceIndex - 1];
  const transitionFromPrevious = analysis.sliceTransitions[sliceIndex - 1];
  const spanId = analysis.sliceSpanIds.get(sliceIndex);
  const previousSpanId = analysis.sliceSpanIds.get(sliceIndex - 1);
  const nextSpanId = analysis.sliceSpanIds.get(sliceIndex + 1);
  const span = spanId ? spanById.get(spanId) : undefined;
  return {
    analysis,
    slice,
    sliceIndex,
    previous,
    transitionFromPrevious,
    span,
    isSpanStart: Boolean(spanId) && spanId !== previousSpanId,
    isSpanEnd: Boolean(spanId) && spanId !== nextSpanId,
  };
}

function isJsonValue(
  value: unknown,
  seen = new Set<object>(),
): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value))
    return value.every((item) => isJsonValue(item, seen));
  return Object.entries(value).every(
    ([, item]) => item !== undefined && isJsonValue(item, seen),
  );
}

function validateRuleStates(
  definition: StatefulRuleDefinition,
  states: readonly RuleStateEnvelope[],
  context: RuleStepContext,
  validSpanIds: ReadonlySet<string>,
) {
  if (!Array.isArray(states) || states.length > MAX_RULE_STATES)
    throw new Error("规则状态数量超过限制");
  const ids = new Set<string>();
  return states.map((state) => {
    if (
      !state ||
      typeof state.id !== "string" ||
      !state.id.trim() ||
      state.id.length > 128 ||
      ids.has(state.id) ||
      state.ownerRuleId !== definition.id
    )
      throw new Error("规则状态标识无效");
    ids.add(state.id);
    if (
      !Number.isInteger(state.createdAt?.tick) ||
      !Number.isInteger(state.createdAt?.sliceIndex) ||
      state.createdAt.tick < 0 ||
      state.createdAt.tick > context.slice.tick ||
      state.createdAt.sliceIndex < 0 ||
      state.createdAt.sliceIndex > context.sliceIndex
    )
      throw new Error("规则状态创建位置无效");
    const refs = state.subjectRefs;
    if (
      refs?.voiceIds?.some((id: VoiceId) => !VOICE_ORDER.includes(id)) ||
      refs?.noteIds?.some((id: string) => !context.analysis.noteById.has(id)) ||
      refs?.chordIds?.some(
        (id: string) => !context.analysis.chordById.has(id),
      ) ||
      refs?.spanIds?.some((id: string) => !validSpanIds.has(id))
    )
      throw new Error("规则状态引用了不存在的分析对象");
    if (!isJsonValue(state.payload)) throw new Error("规则状态必须是纯 JSON 数据");
    const serialized = JSON.stringify(state.payload);
    if (serialized.length > MAX_RULE_STATE_BYTES)
      throw new Error("单个规则状态超过 16 KiB 限制");
    return {
      ...state,
      createdAt: { ...state.createdAt },
      subjectRefs: refs
        ? {
            voiceIds: refs.voiceIds ? [...refs.voiceIds] : undefined,
            noteIds: refs.noteIds ? [...refs.noteIds] : undefined,
            chordIds: refs.chordIds ? [...refs.chordIds] : undefined,
            spanIds: refs.spanIds ? [...refs.spanIds] : undefined,
          }
        : undefined,
      payload: JSON.parse(serialized) as JsonValue,
    } satisfies RuleStateEnvelope;
  });
}

function runStatefulRuleSynchronously(
  definition: StatefulRuleDefinition,
  analysis: HarmonyAnalysis,
  config: RuleConfig,
): RuleEvaluation {
  const diagnostics: RuleDiagnostic[] = [];
  const skipped: Omit<SkippedRule, "ruleId">[] = [];
  let states: readonly RuleStateEnvelope[] = [];
  let lastContext: RuleStepContext | undefined;
  const spanById = new Map(analysis.harmonySpans.map((span) => [span.id, span]));
  const validSpanIds = new Set(spanById.keys());
  for (let index = 0; index < analysis.slices.length; index += 1) {
    lastContext = stepContextAt(analysis, index, spanById);
    const result = definition.process(lastContext, states, config);
    if (result instanceof Promise) throw new Error("同步入口不支持异步规则");
    diagnostics.push(...result.diagnostics);
    skipped.push(...(result.skipped ?? []));
    states = validateRuleStates(
      definition,
      result.outgoing,
      lastContext,
      validSpanIds,
    );
  }
  if (definition.finalize) {
    const finalResult = definition.finalize(lastContext, states, config);
    if (finalResult instanceof Promise) throw new Error("同步入口不支持异步规则");
    diagnostics.push(...finalResult.diagnostics);
    skipped.push(...(finalResult.skipped ?? []));
  }
  return { diagnostics, skipped };
}

async function runRule(
  definition: RuleDefinition,
  analysis: HarmonyAnalysis,
  config: RuleConfig,
) {
  if (!isStatefulRule(definition))
    return definition.evaluate({ analysis }, config);
  const diagnostics: RuleDiagnostic[] = [];
  const skipped: Omit<SkippedRule, "ruleId">[] = [];
  let states: readonly RuleStateEnvelope[] = [];
  let lastContext: RuleStepContext | undefined;
  const spanById = new Map(analysis.harmonySpans.map((span) => [span.id, span]));
  const validSpanIds = new Set(spanById.keys());
  for (let index = 0; index < analysis.slices.length; index += 1) {
    lastContext = stepContextAt(analysis, index, spanById);
    const result = await definition.process(lastContext, states, config);
    diagnostics.push(...result.diagnostics);
    skipped.push(...(result.skipped ?? []));
    states = validateRuleStates(
      definition,
      result.outgoing,
      lastContext,
      validSpanIds,
    );
  }
  if (definition.finalize) {
    const finalResult = await definition.finalize(lastContext, states, config);
    diagnostics.push(...finalResult.diagnostics);
    skipped.push(...(finalResult.skipped ?? []));
  }
  return { diagnostics, skipped } satisfies RuleEvaluation;
}

export function runRulesSynchronously(
  definitions: readonly RuleDefinition[],
  project: ProjectDocument,
  severities: RuntimeRuleSeverities,
  revision = 0,
  configs: Partial<Record<string, RuleConfig>> = {},
  exceptions: Partial<Record<string, RuleExceptionPolicy>> = {},
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
      const evaluation = isStatefulRule(definition)
        ? runStatefulRuleSynchronously(
            definition,
            analysis,
            configs[definition.id] ?? {},
          )
        : definition.evaluate({ analysis }, configs[definition.id] ?? {});
      if (evaluation instanceof Promise)
        throw new Error("同步兼容入口不支持异步规则");
      const collected = collectEvaluation(
        definition,
        evaluation,
        analysis,
        severity,
        exceptions[definition.id],
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
  return completeResult(analysis, diagnostics, skippedRules, false, definitions);
}

export class RuleScheduler {
  private runToken = 0;
  private previousSnapshot?: ProjectSnapshot;
  private cachedAnalysis?: HarmonyAnalysis;
  private cachedAnalysisSignature?: string;
  private previousRuleSignatures = new Map<string, string>();
  private previousRuleDiagnostics = new Map<string, HarmonyDiagnostic[]>();
  private previousRuleSkips = new Map<string, SkippedRule[]>();

  constructor(private readonly definitions: readonly RuleDefinition[]) {}

  cancel() {
    this.runToken += 1;
  }

  prepareAnalysis(project: ProjectDocument, revision: number) {
    // 规则 profile 与界面元数据不参与切片/连接构建；只改配置时复用音乐分析快照。
    const signature = JSON.stringify({
      ppq: project.ppq,
      lengthTicks: project.lengthTicks,
      tempoEvents: project.tempoEvents,
      meterEvents: project.meterEvents,
      keyEvents: project.keyEvents,
      satbTracks: project.satbTracks,
      chordTrack: project.chordTrack,
      auxiliaryTracks: project.auxiliaryTracks,
    });
    if (
      this.cachedAnalysis &&
      this.cachedAnalysisSignature === signature
    ) {
      return Object.freeze({
        ...this.cachedAnalysis,
        revision,
        invalidationRanges: Object.freeze([]),
      }) satisfies HarmonyAnalysis;
    }
    const analysis = buildHarmonyAnalysis(
      project,
      revision,
      this.previousSnapshot,
    );
    this.previousSnapshot = analysis.project;
    this.cachedAnalysis = analysis;
    this.cachedAnalysisSignature = signature;
    return analysis;
  }

  async run(request: RuleRunRequest): Promise<HarmonyCheckResult> {
    const token = ++this.runToken;
    await Promise.resolve();
    const analysis =
      request.analysis ?? this.prepareAnalysis(request.project, request.revision);
    const diagnostics: HarmonyDiagnostic[] = [];
    const skippedRules: SkippedRule[] = [];
    const canReuseRuleResults = analysis.invalidationRanges.length === 0;
    const nextRuleSignatures = new Map<string, string>();
    const nextRuleDiagnostics = new Map<string, HarmonyDiagnostic[]>();
    const nextRuleSkips = new Map<string, SkippedRule[]>();

    for (const definition of this.definitions) {
      if (token !== this.runToken || request.signal?.aborted)
        return completeResult(
          analysis,
          [],
          skippedRules,
          true,
          this.definitions,
        );
      const severity = request.severities[definition.id];
      const ruleSignature = JSON.stringify({
        severity,
        config: request.configs?.[definition.id] ?? {},
        exceptions: request.exceptions?.[definition.id] ?? {},
      });
      nextRuleSignatures.set(definition.id, ruleSignature);
      if (severity === "off") {
        nextRuleDiagnostics.set(definition.id, []);
        nextRuleSkips.set(definition.id, []);
        continue;
      }
      if (
        canReuseRuleResults &&
        this.previousRuleSignatures.get(definition.id) === ruleSignature
      ) {
        const reusedDiagnostics = this.previousRuleDiagnostics.get(definition.id) ?? [];
        const reusedSkips = this.previousRuleSkips.get(definition.id) ?? [];
        diagnostics.push(...reusedDiagnostics);
        skippedRules.push(...reusedSkips);
        nextRuleDiagnostics.set(definition.id, reusedDiagnostics);
        nextRuleSkips.set(definition.id, reusedSkips);
        continue;
      }
      const requirements = requirementSkips(definition, analysis);
      skippedRules.push(...requirements);
      if (requirements.some((item) => !item.partial)) {
        nextRuleDiagnostics.set(definition.id, []);
        nextRuleSkips.set(definition.id, requirements);
        continue;
      }
      let evaluation: RuleEvaluation;
      try {
        evaluation = await runRule(
          definition,
          analysis,
          request.configs?.[definition.id] ?? {},
        );
      } catch {
        const failure = {
          ruleId: definition.id,
          reason: "rule-error",
          message: `规则“${definition.label}”本次执行失败，其他规则仍继续运行。`,
          partial: false,
        } satisfies SkippedRule;
        skippedRules.push(failure);
        nextRuleDiagnostics.set(definition.id, []);
        nextRuleSkips.set(definition.id, [...requirements, failure]);
        continue;
      }
      if (token !== this.runToken || request.signal?.aborted)
        return completeResult(
          analysis,
          [],
          skippedRules,
          true,
          this.definitions,
        );
      const collected = collectEvaluation(
        definition,
        evaluation,
        analysis,
        severity,
        request.exceptions?.[definition.id],
      );
      diagnostics.push(...collected.diagnostics);
      skippedRules.push(...collected.skipped);
      nextRuleDiagnostics.set(definition.id, collected.diagnostics);
      nextRuleSkips.set(definition.id, [
        ...requirements,
        ...collected.skipped,
      ]);
    }

    this.previousRuleSignatures = nextRuleSignatures;
    this.previousRuleDiagnostics = nextRuleDiagnostics;
    this.previousRuleSkips = nextRuleSkips;
    return completeResult(
      analysis,
      diagnostics,
      skippedRules,
      false,
      this.definitions,
    );
  }
}
