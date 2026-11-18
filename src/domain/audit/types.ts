import type { ProjectDocument, VoiceId } from "../project";

export const AUDIT_CATEGORIES = ["transcription", "chord", "cadence", "diagnostic", "policy", "proposal"] as const;
export type AuditCategory = typeof AUDIT_CATEGORIES[number];
export const AUDIT_SEVERITIES = ["error", "warning", "suggestion", "info"] as const;
export type AuditSeverity = typeof AUDIT_SEVERITIES[number];
export const AUDIT_DECISIONS = ["pending", "answered", "accept", "reject", "needs-evidence"] as const;
export type AuditDecision = typeof AUDIT_DECISIONS[number];
export const AUDIT_ATTRIBUTIONS = ["uncertain", "program", "transcription", "reference", "policy", "context", "none"] as const;
export type AuditAttribution = typeof AUDIT_ATTRIBUTIONS[number];

export interface AuditEvidence {
  title: string;
  locator?: string;
  content?: string;
  url?: string;
}
export type AuditAnswer = string | string[];
export interface AuditQuestion {
  id: string;
  label: string;
  type: "single" | "multiple" | "text";
  options?: { id: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  suggested?: AuditAnswer;
}
export interface AuditAnswerRecord { id: string; value: AuditAnswer }
/** 已在整张原图上核对的拍点及所在谱行, 所有坐标均为 0..1 比例。 */
export interface AuditBeatAnchor {
  position: string;
  x: number;
  top: number;
  bottom: number;
}
export interface AuditItem {
  id: string;
  title: string;
  category: AuditCategory;
  severity: AuditSeverity;
  range: [string, string];
  voices?: VoiceId[];
  model: { conclusion: string; reason: string };
  program?: { conclusion: string; ruleId?: string; run?: string };
  evidence?: AuditEvidence[];
  question?: string;
  questions?: AuditQuestion[];
  /** 独立标注或特定程序运行的原始结果。范围左闭右开。 */
  annotations?: AuditAnnotation[];
  /** v2 包中必须附带本条独立的原始工程快照。 */
  project?: ProjectDocument;
  /** 相对于原图宽高的比例, 用于可选框选; 不代替音乐位置。 */
  sourceRegion?: { x: number; y: number; width: number; height: number };
}
export interface AuditAnnotation {
  source: "model" | "program";
  kind: "chord" | "cadence";
  range: [string, string];
  label: string;
  context?: string;
}
export interface AuditCase {
  id: string;
  title: string;
  score?: string;
  project?: ProjectDocument;
  source: { title: string; locator?: string; image?: string; beatAnchors?: AuditBeatAnchor[] };
  items: AuditItem[];
}
export interface AuditPackage {
  format: "satb-audit-package";
  formatVersion: 1 | 2;
  id: string;
  title: string;
  cases: AuditCase[];
}
export interface ReviewRecord {
  decision: AuditDecision;
  attribution: AuditAttribution;
  comment: string;
  updatedAt?: string;
}
export interface AuditItemReview extends ReviewRecord {
  id: string;
  fingerprint: string;
  answers?: AuditAnswerRecord[];
  /** 人工编辑的条目副本; 不修改模型提交的 project。 */
  project?: ProjectDocument;
}
export type AuditReviewPatch = Partial<Pick<AuditItemReview, "decision" | "attribution" | "comment" | "answers" | "project">>;
export interface AuditCaseReview {
  id: string;
  fingerprint: string;
  source: ReviewRecord;
  items: AuditItemReview[];
}
export interface AuditFeedback {
  format: "satb-audit-feedback";
  formatVersion: 1 | 2;
  packageId: string;
  reviewer: string;
  cases: AuditCaseReview[];
}
export interface BoundAuditItem {
  item: AuditItem;
  fingerprint: string;
  fromTick: number;
  toTick: number;
  annotations?: (AuditAnnotation & { fromTick: number; toTick: number })[];
  noteIds: ReadonlySet<string>;
  project: ProjectDocument;
}
export interface BoundAuditCase {
  data: AuditCase;
  fingerprint: string;
  project: ProjectDocument;
  items: BoundAuditItem[];
}
export interface BoundAuditPackage {
  data: AuditPackage;
  fingerprint: string;
  cases: BoundAuditCase[];
}
