import type { HarmonyAnalysis } from "../analysis";
import type { RuleDiagnostic } from "../runtime";
import type {
  HarmonyRuleDefinition,
  RuleDependencyScope,
  RuleExceptionContext,
  RuleExceptionPolicy,
} from "./types";

export interface RuleApplicability {
  ruleId: string;
  scope: RuleDependencyScope;
  targetIds: readonly string[];
  policy: "strict" | "deferred" | "downgraded" | "skip";
  reasonCode?: string;
  confidence: "certain" | "probable" | "ambiguous" | "unknown";
  contexts: readonly RuleExceptionContext[];
}

function confidenceOf(value: number): RuleApplicability["confidence"] {
  if (value >= 0.95) return "certain";
  if (value >= 0.7) return "probable";
  if (value > 0) return "ambiguous";
  return "unknown";
}

function targetIdsOf(diagnostic: RuleDiagnostic) {
  return [
    ...diagnostic.noteIds.map((id) => `note:${id}`),
    ...diagnostic.chordIds.map((id) => `chord:${id}`),
    ...diagnostic.voiceIds.map((id) => `voice:${id}`),
  ].sort();
}

function intersects(left: readonly string[], right: ReadonlySet<string>) {
  return left.some((value) => right.has(value));
}

function transitionIdsFor(
  diagnostic: RuleDiagnostic,
  analysis: HarmonyAnalysis,
) {
  const noteIds = new Set(diagnostic.noteIds);
  const overlapsTick = (tick: number) =>
    diagnostic.tick === diagnostic.endTick
      ? tick === diagnostic.tick
      : diagnostic.tick <= tick && tick < diagnostic.endTick;
  const sliceTransitionIds = analysis.sliceTransitions
    .filter(
      (transition) =>
        overlapsTick(transition.current.tick) ||
        Object.values(transition.previous.notes).some((note) =>
          note ? noteIds.has(note.id) : false,
        ) ||
        Object.values(transition.current.notes).some((note) =>
          note ? noteIds.has(note.id) : false,
        ),
    )
    .map((transition) => transition.id);
  const melodyTransitionIds = analysis.melodyTransitions
    .filter(
      (transition) =>
        overlapsTick(transition.current.startTick) ||
        noteIds.has(transition.previous.id) ||
        noteIds.has(transition.current.id),
    )
    .map((transition) => transition.id);
  return {
    slice: new Set(sliceTransitionIds),
    melody: new Set(melodyTransitionIds),
    all: new Set([...sliceTransitionIds, ...melodyTransitionIds]),
  };
}

function spanIdsFor(diagnostic: RuleDiagnostic, analysis: HarmonyAnalysis) {
  const result = new Set<string>();
  diagnostic.chordIds.forEach((chordId) =>
    analysis.chordSpanIds
      .get(chordId)
      ?.forEach((spanId) => result.add(spanId)),
  );
  analysis.harmonySpans.forEach((span) => {
    const overlaps =
      diagnostic.tick === diagnostic.endTick
        ? span.fromTick <= diagnostic.tick && diagnostic.tick <= span.toTick
        : diagnostic.tick < span.toTick && diagnostic.endTick > span.fromTick;
    if (overlaps)
      result.add(span.id);
  });
  return result;
}

function contextsFor(
  diagnostic: RuleDiagnostic,
  analysis: HarmonyAnalysis,
): RuleExceptionContext[] {
  const transitions = transitionIdsFor(diagnostic, analysis);
  const spanIds = spanIdsFor(diagnostic, analysis);
  const contexts: RuleExceptionContext[] = [];
  const facts = analysis.contextFacts;
  if (intersects(facts.sameHarmonyTransitionIds, transitions.all))
    contexts.push("same-harmony");
  if (intersects(facts.arpeggiationTransitionIds, transitions.melody))
    contexts.push("arpeggiation");
  if (intersects(facts.voiceExchangeTransitionIds, transitions.slice))
    contexts.push("voice-exchange");
  if (intersects(facts.innerVoiceTransitionIds, transitions.slice))
    contexts.push("inner-voices");
  if (intersects(facts.bassStepUpTransitionIds, transitions.slice))
    contexts.push("bass-step-up");
  if (diagnostic.noteIds.some((id) => facts.nonchordToneNoteIds.includes(id)))
    contexts.push("nonchord-tone");
  if (intersects(facts.pedalSpanIds, spanIds)) contexts.push("pedal-point");
  if (intersects(facts.cadenceSpanIds, spanIds)) contexts.push("cadence");
  const referencedConnectionIds = new Set(
    (diagnostic.causeRefs ?? [])
      .flatMap((reference) => reference.split("|"))
      .filter((part) => part.startsWith("connection:")),
  );
  const connectionIds = referencedConnectionIds.size > 0
    ? referencedConnectionIds
    : new Set(
        analysis.connections
          .filter(
            (connection) =>
              spanIds.has(connection.previousSpanId) ||
              spanIds.has(connection.currentSpanId),
          )
          .map((connection) => connection.connectionKey),
      );
  if (intersects(facts.modulationConnectionIds, connectionIds))
    contexts.push("modulation");
  if (
    analysis.harmonySpans.some(
      (span) => spanIds.has(span.id) && span.status === "ambiguous",
    )
  )
    contexts.push("ambiguous-semantics");
  return contexts;
}

/** 将规则声明、工程配置和本次证据上的上下文统一折叠为单一执行策略。 */
export function planRuleApplicability(
  definition: Pick<
    HarmonyRuleDefinition,
    | "id"
    | "dependencyScope"
    | "supportedExceptionContexts"
    | "defaultExceptionPolicies"
  >,
  diagnostic: RuleDiagnostic,
  analysis: HarmonyAnalysis,
  overrides: RuleExceptionPolicy = {},
): RuleApplicability {
  const supported = new Set(definition.supportedExceptionContexts);
  const contexts = [
    ...new Set(
      contextsFor(diagnostic, analysis).filter((context) => supported.has(context)),
    ),
  ];
  const effective = {
    ...definition.defaultExceptionPolicies,
    ...overrides,
  };
  const modes = contexts.map((context) => effective[context] ?? "strict");
  const ambiguous = contexts.includes("ambiguous-semantics");
  const insufficient = contexts.includes("insufficient-context");
  const policy: RuleApplicability["policy"] = modes.includes("exempt")
    ? "skip"
    : insufficient || (ambiguous && diagnostic.confidence <= 0)
      ? "deferred"
      : modes.includes("downgrade")
        ? "downgraded"
        : "strict";
  return Object.freeze({
    ruleId: definition.id,
    scope: definition.dependencyScope,
    targetIds: Object.freeze(targetIdsOf(diagnostic)),
    policy,
    reasonCode:
      policy === "strict"
        ? undefined
        : contexts.find((context) =>
            policy === "downgraded"
              ? effective[context] === "downgrade"
              : policy === "skip"
                ? effective[context] === "exempt"
                : context === "insufficient-context" ||
                  context === "ambiguous-semantics",
          ),
    confidence: confidenceOf(diagnostic.confidence),
    contexts: Object.freeze(contexts),
  });
}
