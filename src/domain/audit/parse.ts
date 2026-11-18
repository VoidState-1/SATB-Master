import { validateProject, type ProjectDocument } from "../project";
import { validateAuditAnswers } from "./questions";
import { AUDIT_ATTRIBUTIONS, AUDIT_CATEGORIES, AUDIT_DECISIONS, AUDIT_SEVERITIES, type AuditAnswer, type AuditAnswerRecord, type AuditFeedback, type AuditPackage, type AuditQuestion, type ReviewRecord } from "./types";

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "应为对象");
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, max = 20_000, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) fail(path, "文本为空或长度无效");
  return value;
}
function optional(value: unknown, path: string) { return value === undefined ? undefined : text(value, path); }
function id(value: unknown, path: string) {
  const result = text(value, path, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(result)) fail(path, "ID 仅使用字母、数字、点、横线和下划线, 并以字母或数字开头");
  return result;
}
function choice<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (!choices.includes(value as T)) fail(path, `应为 ${choices.join(" / ")}`);
  return value as T;
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, "列表无效或过长");
  return value;
}
function unique<T extends { id: string }>(values: T[], path: string): T[] {
  if (new Set(values.map((v) => v.id)).size !== values.length) fail(path, "存在重复 ID");
  return values;
}
function envelope(value: unknown, format: string) {
  const result = object(value, format);
  if (result.format !== format || (result.formatVersion !== 1 && result.formatVersion !== 2)) fail(format, "格式或版本不受支持");
  return result;
}
export function parseAuditProject(value: unknown, path = "project"): ProjectDocument {
  if (!validateProject(value)) fail(path, "需要有效的 schema v3 SATB 工程文件");
  return structuredClone(value);
}
function answerValue(value: unknown, path: string): AuditAnswer {
  if (Array.isArray(value)) return list(value, path, 50).map((v) => id(v, path));
  return text(value, path, 20_000, true);
}
function questions(value: unknown, path: string): AuditQuestion[] | undefined {
  if (value === undefined) return undefined;
  return unique(list(value, path, 100).map((value, index) => {
    const p = `${path}[${index}]`;
    const q = object(value, p);
    const type = choice(q.type, ["single", "multiple", "text"] as const, `${p}.type`);
    const options = q.options === undefined ? undefined : unique(list(q.options, `${p}.options`, 50).map((value) => {
      const option = object(value, `${p}.options[]`);
      return { id: id(option.id, `${p}.options.id`), label: text(option.label, `${p}.options.label`, 1000) };
    }), `${p}.options`);
    if (type !== "text" && !options?.length) fail(p, "单选/多选题必须提供选项");
    if (type === "text" && options?.length) fail(p, "输入题不能带选项");
    if (q.required !== undefined && typeof q.required !== "boolean") fail(p, "required 应为布尔值");
    const result: AuditQuestion = { id: id(q.id, `${p}.id`), label: text(q.label, `${p}.label`, 1000), type, options, required: q.required as boolean | undefined, placeholder: optional(q.placeholder, `${p}.placeholder`), suggested: q.suggested === undefined ? undefined : answerValue(q.suggested, `${p}.suggested`) };
    if (result.suggested !== undefined) {
      try { validateAuditAnswers([result], [{ id: result.id, value: result.suggested }]); }
      catch (error) { fail(p, error instanceof Error ? error.message : "预填值无效"); }
    }
    return result;
  }), path);
}
function image(value: unknown, path: string) {
  if (value === undefined) return undefined;
  const result = text(value, path, 24 * 1024 * 1024);
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(result)) fail(path, "原图须为内嵌 PNG/JPEG/WebP, 请用 audit pack 打包本地图片");
  return result;
}

export function parseAuditPackage(value: unknown): AuditPackage {
  const root = envelope(value, "satb-audit-package");
  const cases = unique(list(root.cases, "cases", 200).map((value, i) => {
    const p = `cases[${i}]`;
    const c = object(value, p);
    const source = object(c.source, `${p}.source`);
    return {
      id: id(c.id, `${p}.id`), title: text(c.title, `${p}.title`, 300),
      score: c.score === undefined && root.formatVersion === 2 ? undefined : text(c.score, `${p}.score`, 1_000_000),
      project: c.project === undefined && root.formatVersion === 1 ? undefined : parseAuditProject(c.project, `${p}.project`),
      source: { title: text(source.title, `${p}.source.title`, 1000), locator: optional(source.locator, `${p}.source.locator`), image: image(source.image, `${p}.source.image`) },
      items: unique(list(c.items, `${p}.items`, 1000).map((value, j) => {
        const q = `${p}.items[${j}]`;
        const item = object(value, q);
        const model = object(item.model, `${q}.model`);
        const range = list(item.range, `${q}.range`, 2);
        if (range.length !== 2) fail(`${q}.range`, "需要开始和结束两个位置");
        const program = item.program === undefined ? undefined : object(item.program, `${q}.program`);
        const evidence = item.evidence === undefined ? undefined : list(item.evidence, `${q}.evidence`, 100).map((value, k) => {
          const e = object(value, `${q}.evidence[${k}]`);
          const url = optional(e.url, `${q}.evidence.url`);
          if (url) {
            let parsed;
            try { parsed = new URL(url); } catch { fail(`${q}.evidence.url`, "资料链接不是有效 URL"); }
            if (!["http:", "https:"].includes(parsed.protocol)) fail(`${q}.evidence.url`, "仅支持 http/https 资料链接");
          }
          return { title: text(e.title, `${q}.evidence.title`, 1000), locator: optional(e.locator, `${q}.evidence.locator`), content: optional(e.content, `${q}.evidence.content`), url };
        });
        let sourceRegion;
        if (item.sourceRegion !== undefined) {
          const r = object(item.sourceRegion, `${q}.sourceRegion`);
          const values = [r.x, r.y, r.width, r.height];
          if (!values.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) || !(Number(r.width) > 0 && Number(r.height) > 0) || Number(r.x) + Number(r.width) > 1 || Number(r.y) + Number(r.height) > 1) fail(`${q}.sourceRegion`, "框选须落在原图内, 坐标为 0..1 比例");
          sourceRegion = { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number };
        }
        return {
          id: id(item.id, `${q}.id`), title: text(item.title, `${q}.title`, 300),
          category: choice(item.category, AUDIT_CATEGORIES, `${q}.category`),
          severity: choice(item.severity, AUDIT_SEVERITIES, `${q}.severity`),
          range: [text(range[0], `${q}.range[0]`, 100), text(range[1], `${q}.range[1]`, 100)] as [string, string],
          voices: item.voices === undefined ? undefined : list(item.voices, `${q}.voices`, 4).map((v) => choice(v, ["soprano", "alto", "tenor", "bass"] as const, `${q}.voices`)),
          model: { conclusion: text(model.conclusion, `${q}.model.conclusion`), reason: text(model.reason, `${q}.model.reason`) },
          program: program ? { conclusion: text(program.conclusion, `${q}.program.conclusion`), ruleId: optional(program.ruleId, `${q}.program.ruleId`), run: optional(program.run, `${q}.program.run`) } : undefined,
          question: optional(item.question, `${q}.question`), questions: questions(item.questions, `${q}.questions`),
          project: item.project === undefined && root.formatVersion === 1 ? undefined : parseAuditProject(item.project, `${q}.project`), evidence, sourceRegion,
        };
      }), `${p}.items`),
    };
  }), "cases");
  if (!cases.length) fail("cases", "至少需要一个谱例");
  if (cases.reduce((n, c) => n + c.items.length, 0) > 5000) fail("cases", "条目总数超过 5000");
  return { format: "satb-audit-package", formatVersion: root.formatVersion as 1 | 2, id: id(root.id, "id"), title: text(root.title, "title", 300), cases };
}

function review(value: unknown, path: string): ReviewRecord {
  const r = object(value, path);
  const updatedAt = optional(r.updatedAt, `${path}.updatedAt`);
  if (updatedAt && !Number.isFinite(Date.parse(updatedAt))) fail(path, "意见时间无效");
  return { decision: choice(r.decision, AUDIT_DECISIONS, `${path}.decision`), attribution: choice(r.attribution, AUDIT_ATTRIBUTIONS, `${path}.attribution`), comment: text(r.comment, `${path}.comment`, 20_000, true), updatedAt };
}
function fingerprint(value: unknown, path: string) {
  const result = text(value, path, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) fail(path, "需要 SHA256 内容指纹");
  return result;
}
export function parseAuditFeedback(value: unknown): AuditFeedback {
  const root = envelope(value, "satb-audit-feedback");
  return {
    format: "satb-audit-feedback", formatVersion: root.formatVersion as 1 | 2, packageId: id(root.packageId, "packageId"), reviewer: text(root.reviewer, "reviewer", 300, true),
    cases: unique(list(root.cases, "cases", 200).map((value) => {
      const c = object(value, "cases[]");
      return { id: id(c.id, "case.id"), fingerprint: fingerprint(c.fingerprint, "case.fingerprint"), source: review(c.source, "case.source"),
        items: unique(list(c.items, "case.items", 1000).map((value) => {
          const item = object(value, "case.items[]");
          const answers: AuditAnswerRecord[] | undefined = item.answers === undefined ? undefined : unique(list(item.answers, "item.answers", 100).map((value) => {
            const answer = object(value, "item.answers[]");
            return { id: id(answer.id, "answer.id"), value: answerValue(answer.value, "answer.value") };
          }), "item.answers");
          return { id: id(item.id, "item.id"), fingerprint: fingerprint(item.fingerprint, "item.fingerprint"), ...review(item, "item"), answers, project: item.project === undefined ? undefined : parseAuditProject(item.project, "item.project") };
        }), "case.items"),
      };
    }), "cases"),
  };
}
