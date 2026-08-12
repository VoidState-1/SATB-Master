import type { HarmonyAnalysis } from "../../analysis";
import type {
  DiagnosticEvidence,
  DiagnosticSubjectRefs,
  DiagnosticSubjects,
  DiagnosticTraceEntry,
  JsonValue,
  RuleDiagnostic,
  RuleStateEnvelope,
  RuleStepContext,
} from "../../runtime";
import type { RuleConfig, RuleRequirement } from "../types";
import { defineStatefulRule, type RuleMetadataInput } from "../defineRule";
import { analysisMoment, type AnalysisMoment } from "./moment";

export type RetriggerPolicy =
  | "retain-existing"
  | "refresh-source"
  | "fork"
  | "reject";

export interface SubjectRefs {
  readonly voiceIds?: readonly import("../../../project/types").VoiceId[];
  readonly noteIds?: readonly string[];
  readonly chordIds?: readonly string[];
  readonly spanIds?: readonly string[];
}

export interface ObligationCandidate<Payload extends JsonValue> {
  readonly partitionKey: string;
  readonly payload: Payload;
  readonly subjectRefs: SubjectRefs;
}

export interface ObligationOpenEnvironment {
  readonly context: RuleStepContext;
  readonly moment: AnalysisMoment;
  readonly config: RuleConfig;
}

export interface ObligationSource<Payload extends JsonValue> {
  readonly id: string;
  readonly requires: readonly RuleRequirement[];
  readonly collect: (
    environment: ObligationOpenEnvironment,
  ) => readonly ObligationCandidate<Payload>[];
}

export type ObligationOutcome =
  | "continue"
  | "resolve"
  | "violate"
  | "cancel"
  | "indeterminate";

export interface ObligationHistoryEntry {
  readonly tick: number;
  readonly outcome: ObligationOutcome;
  readonly reason: string;
}

export interface ObligationRuntimeTraceEntry extends ObligationHistoryEntry {
  readonly ruleId: string;
  readonly obligationId: string;
  readonly partitionKey: string;
}

export interface ObligationView<Payload extends JsonValue> {
  readonly id: string;
  readonly partitionKey: string;
  readonly openedAt: { readonly tick: number; readonly sliceIndex: number };
  readonly openedBy: SubjectRefs;
  readonly payload: Payload;
  readonly history: readonly ObligationHistoryEntry[];
}

export interface ObligationEnvironment<Payload extends JsonValue> {
  readonly context: RuleStepContext;
  readonly moment: AnalysisMoment;
  readonly config: RuleConfig;
  readonly obligation: ObligationView<Payload>;
}

export interface ObligationDecision {
  readonly outcome: ObligationOutcome;
  readonly reason: string;
  readonly evidence?: readonly DiagnosticEvidence[];
  readonly subjectRefs?: SubjectRefs;
}

type StoredHistoryEntry = {
  readonly [key: string]: JsonValue;
  readonly tick: number;
  readonly outcome: ObligationOutcome;
  readonly reason: string;
};

type StoredObligation<Payload extends JsonValue> = {
  readonly [key: string]: JsonValue;
  readonly engine: "obligation-v2";
  readonly partitionKey: string;
  readonly payload: Payload;
  readonly history: StoredHistoryEntry[];
};

export interface ObligationRuleInput<
  Id extends string,
  Payload extends JsonValue,
> extends RuleMetadataInput<Id> {
  readonly source: ObligationSource<Payload>;
  readonly retrigger: RetriggerPolicy;
  readonly transition: (
    environment: ObligationEnvironment<Payload>,
  ) => ObligationDecision | undefined;
  readonly onNoDecision?: "continue" | "cancel";
  readonly onEnd?: "cancel";
  readonly reportViolation: (
    environment: ObligationEnvironment<Payload>,
    decision: ObligationDecision,
  ) => RuleDiagnostic | undefined;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeRefs(refs: RuleStateEnvelope["subjectRefs"]): SubjectRefs {
  if (!refs) return {};
  return {
    ...(refs.voiceIds ? { voiceIds: refs.voiceIds } : {}),
    ...(refs.noteIds ? { noteIds: refs.noteIds } : {}),
    ...(refs.chordIds ? { chordIds: refs.chordIds } : {}),
    ...(refs.spanIds ? { spanIds: refs.spanIds } : {}),
  };
}

function storedPayload<Payload extends JsonValue>(state: RuleStateEnvelope) {
  const stored = state.payload as StoredObligation<Payload>;
  if (stored.engine !== "obligation-v2")
    throw new Error("义务状态格式无效");
  return stored;
}

function obligationView<Payload extends JsonValue>(
  state: RuleStateEnvelope,
): ObligationView<Payload> {
  const stored = storedPayload<Payload>(state);
  return {
    id: state.id,
    partitionKey: stored.partitionKey,
    openedAt: state.createdAt,
    openedBy: normalizeRefs(state.subjectRefs),
    payload: stored.payload,
    history: stored.history,
  };
}

function appendHistory<Payload extends JsonValue>(
  state: RuleStateEnvelope,
  entry: ObligationHistoryEntry,
) {
  const stored = storedPayload<Payload>(state);
  const previous = stored.history.at(-1);
  const history =
    previous?.tick === entry.tick &&
    previous.outcome === entry.outcome &&
    previous.reason === entry.reason
      ? stored.history
      : [...stored.history, entry].slice(-32);
  return {
    ...state,
    payload: { ...stored, history } as StoredObligation<Payload>,
  } satisfies RuleStateEnvelope;
}

function makeEnvelope<Payload extends JsonValue>(
  ruleId: string,
  context: RuleStepContext,
  candidate: ObligationCandidate<Payload>,
  ordinal: number,
): RuleStateEnvelope {
  const identity = `${ruleId}|${candidate.partitionKey}|${context.slice.tick}|${ordinal}`;
  return {
    id: `obligation:${stableHash(identity)}`,
    ownerRuleId: ruleId,
    createdAt: { tick: context.slice.tick, sliceIndex: context.sliceIndex },
    subjectRefs: candidate.subjectRefs,
    payload: {
      engine: "obligation-v2",
      partitionKey: candidate.partitionKey,
      payload: candidate.payload,
      history: [
        {
          tick: context.slice.tick,
          outcome: "continue",
          reason: "obligation-opened",
        },
      ],
    } as StoredObligation<Payload>,
  };
}

function assertRequirements(
  ruleId: string,
  declared: readonly RuleRequirement[],
  required: readonly RuleRequirement[],
) {
  for (const requirement of required) {
    if (!declared.includes(requirement))
      throw new Error(`规则“${ruleId}”的义务源依赖未声明：“${requirement}”`);
  }
}

function existingPartitions<Payload extends JsonValue>(
  states: readonly RuleStateEnvelope[],
) {
  const result = new Map<string, RuleStateEnvelope[]>();
  for (const state of states) {
    const key = storedPayload<Payload>(state).partitionKey;
    const group = result.get(key) ?? [];
    group.push(state);
    result.set(key, group);
  }
  return result;
}

export function defineObligationRule<
  const Id extends string,
  Payload extends JsonValue,
>(input: ObligationRuleInput<Id, Payload>) {
  const {
    source,
    retrigger,
    transition,
    onNoDecision = "continue",
    onEnd = "cancel",
    reportViolation,
    ...metadata
  } = input;
  assertRequirements(metadata.id, metadata.requires, source.requires);
  const traces = new WeakMap<HarmonyAnalysis, ObligationRuntimeTraceEntry[]>();
  const appendTrace = (
    analysis: HarmonyAnalysis,
    entry: ObligationRuntimeTraceEntry,
  ) => {
    const entries = traces.get(analysis) ?? [];
    entries.push(entry);
    if (entries.length > 4096) entries.splice(0, entries.length - 4096);
    traces.set(analysis, entries);
  };

  const definition = defineStatefulRule({
    ...metadata,
    process(context, incoming, config) {
      if (context.sliceIndex === 0 && incoming.length === 0)
        traces.set(context.analysis, []);
      const moment = analysisMoment(context);
      const diagnostics: RuleDiagnostic[] = [];
      const outgoing: RuleStateEnvelope[] = [];
      const recordTrace = (
        obligation: ObligationView<Payload>,
        outcome: ObligationOutcome,
        reason: string,
      ) =>
        appendTrace(context.analysis, {
          ruleId: metadata.id,
          obligationId: obligation.id,
          partitionKey: obligation.partitionKey,
          tick: moment.tick,
          outcome,
          reason,
        });

      for (const state of incoming) {
        const environment: ObligationEnvironment<Payload> = {
          context,
          moment,
          config,
          obligation: obligationView<Payload>(state),
        };
        const decision = transition(environment);
        if (!decision) {
          if (onNoDecision === "continue") outgoing.push(state);
          else recordTrace(environment.obligation, "cancel", "no-decision");
          continue;
        }
        recordTrace(environment.obligation, decision.outcome, decision.reason);
        if (
          decision.outcome === "continue" ||
          decision.outcome === "indeterminate"
        ) {
          outgoing.push(
            appendHistory<Payload>(state, {
              tick: moment.tick,
              outcome: decision.outcome,
              reason: decision.reason,
            }),
          );
        } else if (decision.outcome === "violate") {
          const violation = reportViolation(environment, decision);
          if (violation) diagnostics.push(violation);
        }
      }

      const candidates = source.collect({ context, moment, config });
      const partitions = existingPartitions<Payload>(outgoing);
      candidates.forEach((candidate, ordinal) => {
        const existing = partitions.get(candidate.partitionKey) ?? [];
        if (existing.length > 0) {
          if (retrigger === "retain-existing") return;
          if (retrigger === "reject")
            throw new Error(`义务分区重复触发：“${candidate.partitionKey}”`);
          if (retrigger === "refresh-source") {
            for (const state of existing) {
              const obligation = obligationView<Payload>(state);
              recordTrace(
                obligation,
                "cancel",
                "obligation-source-refreshed",
              );
              const index = outgoing.indexOf(state);
              if (index >= 0) outgoing.splice(index, 1);
            }
            partitions.delete(candidate.partitionKey);
          }
        }
        const envelope = makeEnvelope(metadata.id, context, candidate, ordinal);
        outgoing.push(envelope);
        recordTrace(
          obligationView<Payload>(envelope),
          "continue",
          "obligation-opened",
        );
        const group = partitions.get(candidate.partitionKey) ?? [];
        group.push(envelope);
        partitions.set(candidate.partitionKey, group);
      });

      return { diagnostics, outgoing };
    },
    finalize(context, remaining) {
      if (context && onEnd === "cancel") {
        for (const state of remaining) {
          const obligation = obligationView<Payload>(state);
          appendTrace(context.analysis, {
            ruleId: metadata.id,
            obligationId: obligation.id,
            partitionKey: obligation.partitionKey,
            tick: context.analysis.project.lengthTicks,
            outcome: "cancel",
            reason: "project-ended",
          });
        }
      }
      return { diagnostics: [] };
    },
  });
  return Object.freeze({
    ...definition,
    inspectTrace(analysis: HarmonyAnalysis) {
      return Object.freeze([...(traces.get(analysis) ?? [])]);
    },
  });
}

function diagnosticRefs(refs: SubjectRefs): DiagnosticSubjectRefs {
  return {
    ...(refs.voiceIds ? { voiceIds: [...refs.voiceIds] } : {}),
    ...(refs.noteIds ? { noteIds: [...refs.noteIds] } : {}),
    ...(refs.chordIds ? { chordIds: [...refs.chordIds] } : {}),
    ...(refs.spanIds ? { spanIds: [...refs.spanIds] } : {}),
  };
}

export function mergeDiagnosticEvidence(
  ...groups: readonly (readonly DiagnosticEvidence[])[]
) {
  const result: DiagnosticEvidence[] = [];
  const keys = new Set<string>();
  for (const item of groups.flat()) {
    const key = `${item.kind}:${item.id ?? ""}:${item.label}:${item.value}`;
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(item);
  }
  return result;
}

export function obligationDiagnosticContext<Payload extends JsonValue>(
  environment: ObligationEnvironment<Payload>,
  decision: ObligationDecision,
): {
  readonly subjects: DiagnosticSubjects;
  readonly trace: DiagnosticTraceEntry[];
  readonly evidence: DiagnosticEvidence[];
} {
  return {
    subjects: {
      origin: diagnosticRefs(environment.obligation.openedBy),
      failure: diagnosticRefs(decision.subjectRefs ?? {}),
    },
    trace: [
      ...environment.obligation.history,
      {
        tick: environment.moment.tick,
        outcome: decision.outcome,
        reason: decision.reason,
      },
    ],
    evidence: [...(decision.evidence ?? [])],
  };
}
