/**
 * 规则运行时的资源与结构限制。所有内置、外置和 sandbox 边界必须引用这里，
 * 避免相同概念在不同入口形成不兼容的上限。
 */
export const RULE_RUNTIME_LIMITS = Object.freeze({
  diagnosticsPerRule: 512,
  diagnosticTitleLength: 120,
  diagnosticMessageLength: 600,
  diagnosticMessageKeyLength: 120,
  diagnosticEvidenceItems: 16,
  diagnosticEvidenceIdLength: 240,
  diagnosticEvidenceLabelLength: 120,
  diagnosticEvidenceValueLength: 240,
  diagnosticTraceItems: 64,
  diagnosticTraceReasonLength: 120,
  diagnosticStructuredRefs: 32,
  diagnosticStructuredRefLength: 240,
  subjectVoiceIds: 8,
  subjectNoteIds: 32,
  subjectChordIds: 16,
  subjectSpanIds: 16,
  ruleStates: 512,
  ruleStateIdLength: 128,
  ruleStatePayloadBytes: 16 * 1024,
} as const);

export {
  CONTENT_HASH_PATTERN,
  STABLE_ID_PATTERN,
  VERSION_PATTERN,
} from "../../../../../shared/external-rules";
