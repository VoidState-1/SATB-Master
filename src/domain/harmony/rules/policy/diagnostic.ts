import type {
  DiagnosticSubjectRefs,
  DiagnosticSubjects,
  RuleDiagnostic,
} from "../../runtime";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import { RULE_RUNTIME_LIMITS } from "./limits";

export interface DiagnosticReferenceIndex {
  readonly maximumTick: number;
  readonly noteIds: ReadonlySet<string> | ReadonlyMap<string, unknown>;
  readonly chordIds: ReadonlySet<string> | ReadonlyMap<string, unknown>;
  readonly spanIds: ReadonlySet<string>;
  readonly voiceIds?: ReadonlySet<string>;
}

export type DiagnosticPolicyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function accepted(): DiagnosticPolicyResult {
  return { ok: true };
}

function rejected(reason: string): DiagnosticPolicyResult {
  return { ok: false, reason };
}

function stable(items: readonly string[]) {
  return [...new Set(items)].sort();
}

function validStructuredRefs(refs: readonly string[] | undefined) {
  return (
    refs === undefined ||
    (refs.length <= RULE_RUNTIME_LIMITS.diagnosticStructuredRefs &&
      refs.every(
        (ref) =>
          typeof ref === "string" &&
          ref.trim().length > 0 &&
          ref.length <= RULE_RUNTIME_LIMITS.diagnosticStructuredRefLength,
      ))
  );
}

function validEvidence(
  evidence: Pick<RuleDiagnostic, "evidence">["evidence"],
) {
  const kinds = new Set(["note", "chord", "interval", "key", "function"]);
  return (
    evidence.length <= RULE_RUNTIME_LIMITS.diagnosticEvidenceItems &&
    evidence.every(
      (item) =>
        kinds.has(item.kind) &&
        (item.id === undefined ||
          (item.id.trim().length > 0 &&
            item.id.length <= RULE_RUNTIME_LIMITS.diagnosticEvidenceIdLength)) &&
        item.label.trim().length > 0 &&
        item.label.length <= RULE_RUNTIME_LIMITS.diagnosticEvidenceLabelLength &&
        item.value.trim().length > 0 &&
        item.value.length <= RULE_RUNTIME_LIMITS.diagnosticEvidenceValueLength,
    )
  );
}

/** 不关心诊断来自内置还是外置，只校验共同的结构契约。 */
export function validateDiagnosticShape(
  item: Pick<
    RuleDiagnostic,
    | "tick"
    | "endTick"
    | "title"
    | "message"
    | "messageKey"
    | "confidence"
    | "evidence"
    | "causeRefs"
    | "coverageRefs"
    | "trace"
  >,
  maximumTick: number,
): DiagnosticPolicyResult {
  if (
    !Number.isInteger(item.tick) ||
    !Number.isInteger(item.endTick) ||
    item.tick < 0 ||
    item.endTick < item.tick ||
    item.endTick > maximumTick
  )
    return rejected("诊断范围无效");
  if (
    !item.title.trim() ||
    item.title.length > RULE_RUNTIME_LIMITS.diagnosticTitleLength ||
    !item.message.trim() ||
    item.message.length > RULE_RUNTIME_LIMITS.diagnosticMessageLength ||
    !item.messageKey.trim() ||
    item.messageKey.length > RULE_RUNTIME_LIMITS.diagnosticMessageKeyLength
  )
    return rejected("诊断文本无效");
  if (
    !Number.isFinite(item.confidence) ||
    item.confidence < 0 ||
    item.confidence > 1 ||
    !validEvidence(item.evidence)
  )
    return rejected("诊断置信度或 evidence 无效");
  if (!validStructuredRefs(item.causeRefs))
    return rejected("诊断 causeRefs 无效");
  if (!validStructuredRefs(item.coverageRefs))
    return rejected("诊断 coverageRefs 无效");
  if (
    item.trace &&
    (item.trace.length > RULE_RUNTIME_LIMITS.diagnosticTraceItems ||
      item.trace.some(
        (entry) =>
          !Number.isInteger(entry.tick) ||
          entry.tick < 0 ||
          entry.tick > maximumTick ||
          !entry.reason.trim() ||
          entry.reason.length >
            RULE_RUNTIME_LIMITS.diagnosticTraceReasonLength,
      ))
  )
    return rejected("诊断 trace 无效");
  return accepted();
}

function validateSubjectRefs(
  refs: DiagnosticSubjectRefs | undefined,
  index: DiagnosticReferenceIndex,
): DiagnosticPolicyResult {
  if (!refs) return accepted();
  if (
    (refs.voiceIds?.length ?? 0) > RULE_RUNTIME_LIMITS.subjectVoiceIds ||
    (refs.noteIds?.length ?? 0) > RULE_RUNTIME_LIMITS.subjectNoteIds ||
    (refs.chordIds?.length ?? 0) > RULE_RUNTIME_LIMITS.subjectChordIds ||
    (refs.spanIds?.length ?? 0) > RULE_RUNTIME_LIMITS.subjectSpanIds
  )
    return rejected("诊断 subject 引用数量超过限制");
  const knownVoices = index.voiceIds ?? new Set<string>(VOICE_ORDER);
  if ((refs.voiceIds ?? []).some((id) => !knownVoices.has(id)))
    return rejected("诊断引用了不存在的声部");
  if ((refs.noteIds ?? []).some((id) => !index.noteIds.has(id)))
    return rejected("诊断引用了不存在的音符");
  if ((refs.chordIds ?? []).some((id) => !index.chordIds.has(id)))
    return rejected("诊断引用了不存在的和弦");
  if ((refs.spanIds ?? []).some((id) => !index.spanIds.has(id)))
    return rejected("诊断引用了不存在的 span");
  return accepted();
}

/** 校验顶层对象引用以及 subjects 中的结构化引用。 */
export function validateDiagnosticReferences(
  item: Pick<RuleDiagnostic, "voiceIds" | "noteIds" | "chordIds" | "subjects">,
  index: DiagnosticReferenceIndex,
): DiagnosticPolicyResult {
  const topLevel = validateSubjectRefs(
    {
      voiceIds: item.voiceIds,
      noteIds: item.noteIds,
      chordIds: item.chordIds,
    },
    index,
  );
  if (!topLevel.ok) return topLevel;
  for (const refs of [
    item.subjects?.origin,
    item.subjects?.failure,
    item.subjects?.context,
  ]) {
    const result = validateSubjectRefs(refs, index);
    if (!result.ok) return result;
  }
  return accepted();
}

function normalizeSubjectRefs(
  refs: DiagnosticSubjectRefs | undefined,
): DiagnosticSubjectRefs | undefined {
  if (!refs) return undefined;
  return {
    voiceIds: stable(refs.voiceIds ?? []) as VoiceId[],
    noteIds: stable(refs.noteIds ?? []),
    chordIds: stable(refs.chordIds ?? []),
    spanIds: stable(refs.spanIds ?? []),
  };
}

export function normalizeDiagnosticSubjects(
  subjects: DiagnosticSubjects | undefined,
): DiagnosticSubjects | undefined {
  if (!subjects) return undefined;
  return {
    ...(subjects.origin
      ? { origin: normalizeSubjectRefs(subjects.origin) }
      : {}),
    ...(subjects.failure
      ? { failure: normalizeSubjectRefs(subjects.failure) }
      : {}),
    ...(subjects.context
      ? { context: normalizeSubjectRefs(subjects.context) }
      : {}),
  };
}
