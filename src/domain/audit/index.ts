import { compileScore, parseScoreText, positionTick } from "../scoreText";
import { buildMeasures } from "../time";
import { missingAuditQuestions, validateAuditAnswers } from "./questions";
import type { AuditFeedback, AuditItemReview, AuditPackage, AuditReviewPatch, BoundAuditPackage, ReviewRecord } from "./types";
export * from "./types";
export { parseAuditPackage, parseAuditFeedback, parseAuditProject } from "./parse";
export * from "./questions";

/** 排除对象字段顺序差异; 内容变化会产生新指纹, 不使用不稳定的工程/DOM ID。 */
export function canonicalAuditJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAuditJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => `${JSON.stringify(k)}:${canonicalAuditJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function atAuditLocation<T>(location: string, action: () => T): T {
  try { return action(); }
  catch (error) { throw new Error(`${location}: ${error instanceof Error ? error.message : "审计输入无效"}`); }
}

export async function bindAuditPackage(pkg: AuditPackage, hash: (text: string) => Promise<string>): Promise<BoundAuditPackage> {
  const cases = await Promise.all(pkg.cases.map(async (c) => {
    // 参考层只用于独立判断, 不能注入谱面或依赖尚未核准的推导/规则修复。
    const project = atAuditLocation(c.id, () => c.project ? structuredClone(c.project) : compileScore({ ...parseScoreText(c.score!), reference: [], referenceComplete: [] }).project);
    const fingerprint = await hash(canonicalAuditJson(c.project ? { id: c.id, project: c.project, source: c.source } : { id: c.id, score: c.score, source: c.source }));
    const items = await Promise.all(c.items.map(async (item) => {
      const itemProject = structuredClone(item.project ?? project);
      const measures = buildMeasures(itemProject);
      const fromTick = atAuditLocation(`${c.id}/${item.id}`, () => positionTick(item.range[0], measures));
      const toTick = atAuditLocation(`${c.id}/${item.id}`, () => positionTick(item.range[1], measures));
      if (fromTick >= toTick || fromTick < 0 || toTick > itemProject.lengthTicks) throw new Error(`${c.id}/${item.id}: 审计范围越界或为空`);
      const tracks = itemProject.satbTracks.filter((track) => !item.voices?.length || item.voices.includes(track.voice));
      const noteIds = new Set(tracks.flatMap((track) => track.notes.filter((note) => note.startTick < toTick && fromTick < note.startTick + note.durationTicks).map((note) => note.id)));
      if (item.voices?.length && !noteIds.size) throw new Error(`${c.id}/${item.id}: 指定声部在审计范围内没有音符`);
      return { item, project: itemProject, fromTick, toTick, noteIds, fingerprint: await hash(canonicalAuditJson({ fingerprint, item })) };
    }));
    return { data: c, fingerprint, project, items };
  }));
  return { data: pkg, cases, fingerprint: await hash(canonicalAuditJson(pkg)) };
}

export function blankReview(): ReviewRecord { return { decision: "pending", attribution: "uncertain", comment: "" }; }
export function createAuditFeedback(bound: BoundAuditPackage): AuditFeedback {
  return { format: "satb-audit-feedback", formatVersion: 2, packageId: bound.data.id, reviewer: "", cases: bound.cases.map((c) => ({ id: c.data.id, fingerprint: c.fingerprint, source: blankReview(), items: c.items.map((i) => ({ id: i.item.id, fingerprint: i.fingerprint, ...blankReview() })) })) };
}
export function hasAuditOpinion(record: ReviewRecord & Partial<Pick<AuditItemReview, "answers" | "project">>) { return record.decision !== "pending" || Boolean(record.comment.trim()) || Boolean(record.answers?.length) || Boolean(record.project); }

/** 恢复意见只读取匹配版本; 模型包本身没有填写人工意见的入口。 */
export function restoreAuditFeedback(bound: BoundAuditPackage, incoming: AuditFeedback, previous?: AuditFeedback): { feedback: AuditFeedback; restored: number; stale: number } {
  if (incoming.packageId !== bound.data.id) throw new Error("意见文件属于其他审计包");
  const feedback = previous ? restoreAuditFeedback(bound, previous).feedback : createAuditFeedback(bound);
  let restored = 0;
  let stale = 0;
  if (incoming.reviewer) feedback.reviewer = incoming.reviewer;
  for (const old of incoming.cases) {
    const current = feedback.cases.find((c) => c.id === old.id && c.fingerprint === old.fingerprint);
    if (!current) { stale += Number(hasAuditOpinion(old.source)) + old.items.filter(hasAuditOpinion).length; continue; }
    if (hasAuditOpinion(old.source) || old.source.updatedAt) current.source = { ...old.source };
    restored += Number(hasAuditOpinion(old.source));
    for (const item of old.items) {
      const index = current.items.findIndex((i) => i.id === item.id && i.fingerprint === item.fingerprint);
      if (index < 0) { stale += Number(hasAuditOpinion(item)); continue; }
      const definition = bound.cases.find((c) => c.data.id === current.id)!.items.find((i) => i.item.id === item.id)!;
      atAuditLocation(`${current.id}/${item.id}`, () => {
        validateAuditAnswers(definition.item.questions, item.answers);
        if (item.decision === "accept" && missingAuditQuestions(definition.item.questions, item.answers).length) throw new Error("批准意见缺少必填预审回答");
      });
      if (hasAuditOpinion(item) || item.updatedAt) current.items[index] = structuredClone(item);
      restored += Number(hasAuditOpinion(item));
    }
  }
  return { feedback, restored, stale };
}

export function updateAuditReview(feedback: AuditFeedback, caseId: string, itemId: string | undefined, patch: AuditReviewPatch, updatedAt: string): AuditFeedback {
  if (itemId === undefined && ("answers" in patch || "project" in patch)) throw new Error("工程副本与预审回答只能保存到具体审计条目");
  const nextPatch = structuredClone(patch);
  return { ...feedback, formatVersion: 2, cases: feedback.cases.map((c) => c.id !== caseId ? c : itemId === undefined ? { ...c, source: { ...c.source, ...nextPatch, updatedAt } } : { ...c, items: c.items.map((i) => i.id === itemId ? { ...i, ...nextPatch, ...(("project" in patch || "answers" in patch) ? { decision: "pending" as const } : {}), updatedAt } : i) }) };
}
