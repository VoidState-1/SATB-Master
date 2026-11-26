import {
  buildHarmonyAnalysis,
  computeAnalysisInvalidationRanges,
  type AnalysisInvalidationRange,
  type AnalysisSlice,
  type HarmonyAnalysis,
  type HarmonySpan,
  type ProjectSnapshot,
  type SliceTransition,
} from "./analysis";
import type { ProjectDocument, VoiceId } from "../project/types";
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
import {
  createHarmonyRuleContext,
  type HarmonyRuleContext,
} from "./rules/context/createRuleContext";
import { RULE_RUNTIME_LIMITS } from "./rules/policy/limits";
import {
  completeHarmonyResult,
  severityAfterApplicability,
} from "./rules/policy/result";
import { compareDiagnosticSeverity } from "./rules/policy/severity";
import { validateRuleStates as validateRuleStateEnvelopes } from "./rules/policy/state";

export type { RuleConfig } from "./rules/types";

type RuntimeRuleSeverities = Record<string, HarmonyRuleSeverity>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

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

export type DiagnosticDebugEventKind =
  | "note"
  | "chord"
  | "slice"
  | "span"
  | "melody-transition"
  | "slice-transition"
  | "connection";

export interface DiagnosticDebugEventRef {
  kind: DiagnosticDebugEventKind;
  id: string;
  role?: string;
}

export interface DiagnosticDebugEvent {
  kind: DiagnosticDebugEventKind;
  id: string;
  role?: string;
  data: Record<string, JsonValue>;
}

export interface DiagnosticDebugObligationStep {
  tick: number;
  sliceIndex: number;
  spanId?: string;
  outcome: DiagnosticTraceEntry["outcome"];
  reason: string;
  subjectRefs?: DiagnosticSubjectRefs;
  currentNoteIds: string[];
  attackedVoiceIds: VoiceId[];
  facts?: Record<string, JsonValue>;
}

export interface DiagnosticDebugObligation {
  id: string;
  partitionKey: string;
  openedAt: { tick: number; sliceIndex: number };
  openedBy: DiagnosticSubjectRefs;
  payload: JsonValue;
  steps: DiagnosticDebugObligationStep[];
}

export interface DiagnosticDebugSnapshot {
  schemaVersion: "satb-diagnostic-debug/v1";
  kind: "stateful-obligation" | "stateless-rule" | "external-rule";
  runtime: {
    revision: number;
    ruleId: string;
    source: "builtin" | "external";
    severity?: DiagnosticSeverity;
    config?: Record<string, JsonValue>;
    exceptionPolicy?: Record<string, string>;
    package?: Record<string, string>;
  };
  diagnostic: {
    id?: string;
    ruleId: string;
    source: "builtin" | "external";
    severity?: DiagnosticSeverity;
    tick: number;
    endTick: number;
    title: string;
    message: string;
    messageKey: string;
    params: Record<string, JsonValue>;
    evidence: {
      kind: DiagnosticEvidenceKind;
      id?: string;
      label: string;
      value: string;
    }[];
    confidence: number;
    causeRefs: string[];
    coverageRefs: string[];
    trace: DiagnosticTraceEntry[];
  };
  location: {
    tick: number;
    endTick: number;
    sliceIndex?: number;
    spanId?: string;
  };
  subjects: {
    origin: DiagnosticDebugEventRef[];
    failure: DiagnosticDebugEventRef[];
    context: DiagnosticDebugEventRef[];
  };
  relatedEvents: {
    notes: DiagnosticDebugEvent[];
    chords: DiagnosticDebugEvent[];
    spans: DiagnosticDebugEvent[];
    slices: DiagnosticDebugEvent[];
    transitions: DiagnosticDebugEvent[];
    connections: DiagnosticDebugEvent[];
  };
  obligation?: DiagnosticDebugObligation;
  notes?: string[];
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
  debug?: DiagnosticDebugSnapshot;
  /** 同一处已证实可随主因修正的原始诊断。 */
  consequences?: HarmonyDiagnostic[];
}

export type RuleDiagnostic = Omit<
  HarmonyDiagnostic,
  "id" | "severity" | "exceptionContexts" | "consequences"
> & {
  /** 在产生声部对诊断的同一连接上观测到的进行事实。 */
  pairMotion?: {
    voiceExchange?: boolean;
    bassStepUp?: boolean;
    cadence?: boolean;
    innerVoices?: boolean;
  };
  /** 教材认可的例外可限制诊断等级。 */
  severityCap?: DiagnosticSeverity;
  /** 同和声例外在本条诊断所指的连接上是否成立。 */
  motionSameHarmony?: boolean;
  /** 确知诊断对应的旋律连接时，例外只使用本次起奏的证据。 */
  melodyTransitionId?: string;
  /** 确知诊断对应的切片连接时，不通过共享音符扩展例外范围。 */
  sliceTransitionId?: string;
  /** A proved finding can call for strict handling within a contextual default. */
  strictDefaultContext?: RuleExceptionContext;
};

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

export type ReadonlyRuleContext = HarmonyRuleContext;

/**
 * 规则之间不共享可变状态。每条有状态规则只能把自己的 JSON 信封沿切片链
 * 传给下一步；信封只是时间上下文的传递容器，生命周期和判定语义由规则自己决定。
 */
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
  readonly rules: HarmonyRuleContext;
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

export interface StatelessRuleDefinition extends Omit<
  HarmonyRuleDefinition,
  "id"
> {
  readonly id: string;
  readonly evaluate: (
    context: ReadonlyRuleContext,
    config: RuleConfig,
    exceptionPolicy?: RuleExceptionPolicy,
  ) => RuleEvaluation | Promise<RuleEvaluation>;
}

export interface RuleStepResult<
  T extends JsonValue = JsonValue,
> extends RuleEvaluation {
  readonly outgoing: readonly RuleStateEnvelope<T>[];
}

export interface StatefulRuleDefinition<
  T extends JsonValue = JsonValue,
> extends Omit<HarmonyRuleDefinition, "id"> {
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

function requirementSkips(
  definition: RuleDefinition,
  analysis: HarmonyAnalysis,
) {
  const skipped: SkippedRule[] = [];
  const chordCount = analysis.project.chordTrack.regions.length;
  const needsWrittenFallback = definition.requires.includes("chords-or-complete-satb");
  if (chordCount === 0 && (definition.requires.includes("chords") ||
      (needsWrittenFallback && !analysis.slices.some(slice => slice.completeSatb)))) {
    skipped.push({
      ruleId: definition.id,
      reason: "no-chords",
      message: needsWrittenFallback ? "和弦轨为空，且缺少完整的四声部实写切片。" : "和弦轨为空，缺少和弦上下文。",
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
    const analyzable = withSemantics.filter(
      (span) => span.status === "complete",
    );
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

function completeResult(
  analysis: HarmonyAnalysis,
  diagnostics: HarmonyDiagnostic[],
  skippedRules: SkippedRule[],
  superseded: boolean,
  definitions: readonly RuleDefinition[],
): HarmonyCheckResult {
  return completeHarmonyResult({
    diagnostics,
    skippedRules,
    revision: analysis.revision,
    superseded,
    invalidationRanges: analysis.invalidationRanges,
    arbitrate: (source) => arbitrateDiagnostics(source, definitions),
  });
}

function collectEvaluation(
  definition: RuleDefinition,
  evaluation: RuleEvaluation,
  analysis: HarmonyAnalysis,
  severity: DiagnosticSeverity,
  config: RuleConfig = {},
  exceptionPolicy: RuleExceptionPolicy = {},
) {
  const effectiveExceptionPolicy = {
    ...exceptionPolicy,
  };
  const diagnostics = evaluation.diagnostics
    .slice(0, RULE_RUNTIME_LIMITS.diagnosticsPerRule)
    .map((item) => {
      const applicability = planRuleApplicability(
        definition,
        item,
        analysis,
        effectiveExceptionPolicy,
      );
      let effectiveSeverity = severityAfterApplicability(
        severity,
        applicability.policy,
      );
      if (!effectiveSeverity) return undefined;
      if (item.severityCap && compareDiagnosticSeverity(item.severityCap, effectiveSeverity) > 0)
        effectiveSeverity = item.severityCap;
      return normalizeBuiltinDiagnostic(
        item,
        definition,
        analysis,
        effectiveSeverity,
        config,
        exceptionPolicy,
      );
    })
    .filter((item): item is HarmonyDiagnostic => Boolean(item));
  const skipped = (evaluation.skipped ?? []).map((item) => ({
    ...item,
    ruleId: definition.id,
  }));
  return { diagnostics, skipped };
}

function stepContextAt(
  analysis: HarmonyAnalysis,
  rules: HarmonyRuleContext,
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
    rules,
    slice,
    sliceIndex,
    previous,
    transitionFromPrevious,
    span,
    isSpanStart: Boolean(spanId) && spanId !== previousSpanId,
    isSpanEnd: Boolean(spanId) && spanId !== nextSpanId,
  };
}

function validateRuleStates(
  definition: StatefulRuleDefinition,
  states: readonly RuleStateEnvelope[],
  context: RuleStepContext,
  validSpanIds: ReadonlySet<string>,
) {
  return validateRuleStateEnvelopes(states, {
    ownerRuleId: definition.id,
    maximumTick: context.slice.tick,
    maximumSliceIndex: context.sliceIndex,
    knownReferences: {
      noteIds: context.analysis.noteById,
      chordIds: context.analysis.chordById,
      spanIds: validSpanIds,
    },
  });
}

interface StatefulRuleRun {
  readonly contexts: readonly RuleStepContext[];
  readonly validSpanIds: ReadonlySet<string>;
  readonly diagnostics: RuleDiagnostic[];
  readonly skipped: Omit<SkippedRule, "ruleId">[];
  states: readonly RuleStateEnvelope[];
}

function createStatefulRuleRun(
  analysis: HarmonyAnalysis,
  rules: HarmonyRuleContext,
): StatefulRuleRun {
  const spanById = new Map(
    analysis.harmonySpans.map((span) => [span.id, span]),
  );
  return {
    contexts: analysis.slices.map((_, index) =>
      stepContextAt(analysis, rules, index, spanById),
    ),
    validSpanIds: new Set(spanById.keys()),
    diagnostics: [],
    skipped: [],
    states: [],
  };
}

function accumulateStatefulStep(
  run: StatefulRuleRun,
  definition: StatefulRuleDefinition,
  context: RuleStepContext,
  result: RuleStepResult,
) {
  run.diagnostics.push(...result.diagnostics);
  run.skipped.push(...(result.skipped ?? []));
  run.states = validateRuleStates(
    definition,
    result.outgoing,
    context,
    run.validSpanIds,
  );
}

function accumulateStatefulFinal(
  run: StatefulRuleRun,
  result: RuleEvaluation,
) {
  run.diagnostics.push(...result.diagnostics);
  run.skipped.push(...(result.skipped ?? []));
}

function statefulEvaluation(run: StatefulRuleRun): RuleEvaluation {
  return { diagnostics: run.diagnostics, skipped: run.skipped };
}

function runStatefulRuleSynchronously(
  definition: StatefulRuleDefinition,
  analysis: HarmonyAnalysis,
  rules: HarmonyRuleContext,
  config: RuleConfig,
): RuleEvaluation {
  const run = createStatefulRuleRun(analysis, rules);
  for (const context of run.contexts) {
    const result = definition.process(context, run.states, config);
    if (result instanceof Promise) throw new Error("同步入口不支持异步规则");
    accumulateStatefulStep(run, definition, context, result);
  }
  if (definition.finalize) {
    const finalResult = definition.finalize(
      run.contexts.at(-1),
      run.states,
      config,
    );
    if (finalResult instanceof Promise)
      throw new Error("同步入口不支持异步规则");
    accumulateStatefulFinal(run, finalResult);
  }
  return statefulEvaluation(run);
}

async function runRule(
  definition: RuleDefinition,
  analysis: HarmonyAnalysis,
  rules: HarmonyRuleContext,
  config: RuleConfig,
  exceptionPolicy?: RuleExceptionPolicy,
) {
  if (!isStatefulRule(definition))
    return definition.evaluate(rules, config, exceptionPolicy);
  const run = createStatefulRuleRun(analysis, rules);
  for (const context of run.contexts) {
    const result = await definition.process(context, run.states, config);
    accumulateStatefulStep(run, definition, context, result);
  }
  if (definition.finalize) {
    const finalResult = await definition.finalize(
      run.contexts.at(-1),
      run.states,
      config,
    );
    accumulateStatefulFinal(run, finalResult);
  }
  return statefulEvaluation(run);
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
  const rules = createHarmonyRuleContext(analysis);
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
            rules,
            configs[definition.id] ?? {},
          )
        : definition.evaluate(rules, configs[definition.id] ?? {}, exceptions[definition.id]);
      if (evaluation instanceof Promise)
        throw new Error("同步兼容入口不支持异步规则");
      const collected = collectEvaluation(
        definition,
        evaluation,
        analysis,
        severity,
        configs[definition.id] ?? {},
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
  return completeResult(
    analysis,
    diagnostics,
    skippedRules,
    false,
    definitions,
  );
}

export class RuleScheduler {
  private runToken = 0;
  private completedRuleSnapshot?: ProjectSnapshot;
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
      structure: project.structure,
    });
    if (this.cachedAnalysis && this.cachedAnalysisSignature === signature) {
      return Object.freeze({
        ...this.cachedAnalysis,
        revision,
        invalidationRanges: Object.freeze([]),
      }) satisfies HarmonyAnalysis;
    }
    const analysis = buildHarmonyAnalysis(
      project,
      revision,
      this.cachedAnalysis?.project,
    );
    this.cachedAnalysis = analysis;
    this.cachedAnalysisSignature = signature;
    return analysis;
  }

  async run(request: RuleRunRequest): Promise<HarmonyCheckResult> {
    const token = ++this.runToken;
    await Promise.resolve();
    const analysis =
      request.analysis ??
      this.prepareAnalysis(request.project, request.revision);
    const rules = createHarmonyRuleContext(analysis);
    const diagnostics: HarmonyDiagnostic[] = [];
    const skippedRules: SkippedRule[] = [];
    // 上次准备的分析可能已取消；规则缓存对应的是上次完成检查的快照。
    const canReuseRuleResults = analysis.invalidationRanges.length === 0 && (
      this.completedRuleSnapshot === analysis.project ||
      computeAnalysisInvalidationRanges(this.completedRuleSnapshot, analysis.project).length === 0
    );
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
        const reusedDiagnostics =
          this.previousRuleDiagnostics.get(definition.id) ?? [];
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
          rules,
          request.configs?.[definition.id] ?? {},
          request.exceptions?.[definition.id],
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
        request.configs?.[definition.id] ?? {},
        request.exceptions?.[definition.id],
      );
      diagnostics.push(...collected.diagnostics);
      skippedRules.push(...collected.skipped);
      nextRuleDiagnostics.set(definition.id, collected.diagnostics);
      nextRuleSkips.set(definition.id, [...requirements, ...collected.skipped]);
    }

    this.completedRuleSnapshot = analysis.project;
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
