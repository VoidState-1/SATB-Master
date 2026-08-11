import type {
  DiagnosticEvidence,
  DiagnosticSubjectRefs,
  DiagnosticSubjects,
  DiagnosticTraceEntry,
  JsonValue,
} from "../../runtime";
import type { PredicateEvaluation } from "./facts";
import type { ObligationDecision, ObligationEnvironment } from "./obligation";
import type { SubjectRefs } from "./facts";

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
  decision: ObligationDecision<Payload>,
): {
  readonly subjects: DiagnosticSubjects;
  readonly trace: DiagnosticTraceEntry[];
  readonly evidence: DiagnosticEvidence[];
} {
  return {
    subjects: {
      origin: diagnosticRefs(environment.obligation.openedBy),
      failure: diagnosticRefs(decision.selected.evaluation.result.subjectRefs),
    },
    trace: [
      ...environment.obligation.history,
      {
        tick: environment.moment.tick,
        outcome: decision.selected.row.outcome,
        reason: decision.selected.row.reason,
      },
    ],
    evidence: [...decision.selected.evaluation.result.evidence],
  };
}

export function constraintDiagnosticContext(assertion: PredicateEvaluation): {
  readonly subjects: DiagnosticSubjects;
  readonly evidence: DiagnosticEvidence[];
} {
  return {
    subjects: {
      failure: diagnosticRefs(assertion.result.subjectRefs),
    },
    evidence: [...assertion.result.evidence],
  };
}
