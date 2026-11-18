import { bindAuditPackage, parseAuditFeedback, parseAuditPackage, type AuditFeedback, type AuditPackage } from "../domain/audit";
import type { ProjectDocument } from "../domain/project";
import { MAX_AUDIT_FILE_BYTES } from "../../shared/desktop";

export { MAX_AUDIT_FILE_BYTES };
export async function auditHash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}
export async function readAuditJson(file: File): Promise<unknown> {
  if (file.size > MAX_AUDIT_FILE_BYTES) throw new Error("审计文件超过 32 MB, 请拆成较小批次");
  return parseAuditJson(await file.text());
}
export function parseAuditJson(text: string): unknown {
  try { return JSON.parse(text); }
  catch { throw new Error("无法解析审计文件, 需要 UTF-8 JSON"); }
}
export function prepareAuditPackage(value: unknown) { return bindAuditPackage(parseAuditPackage(value), auditHash); }

interface AuditSession { document: AuditPackage; feedback: AuditFeedback }
let database: Promise<IDBDatabase> | undefined;
const storedContent = new Set<string>();
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("本地审计存储不可用, 请导出意见文件")); return; }
    const request = indexedDB.open("satb-master-audit", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions");
    request.onerror = () => reject(request.error ?? new Error("无法打开本地审计存储"));
    request.onblocked = () => reject(new Error("审计存储被其他窗口占用"));
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; storedContent.clear(); };
      resolve(request.result);
    };
  }).catch((error) => { database = undefined; throw error; });
  return database;
}
async function getStored(key: string): Promise<unknown> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const request = transaction.objectStore("sessions").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadAuditSession(packageId?: string): Promise<AuditSession | undefined> {
  const key = await getStored(packageId ? `package:${packageId}` : "last");
  if (typeof key !== "string") return;
  const document = await getStored(`content:${key}`);
  const feedback = await getStored(`feedback:${key}`);
  if (!document || !feedback) return;
  return { document: parseAuditPackage(document), feedback: parseAuditFeedback(feedback) };
}
export async function loadAuditFeedback(packageId: string, fingerprint: string): Promise<AuditFeedback | undefined> {
  const exact = await getStored(`feedback:${fingerprint}`);
  if (exact !== undefined) return parseAuditFeedback(exact);
  return (await loadAuditSession(packageId))?.feedback;
}
/** 每个包内容版本独立保存, 导入新版本不覆盖原版本的谱面和人工意见。 */
export async function saveAuditSession(fingerprint: string, document: AuditPackage, feedback: AuditFeedback): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    const store = transaction.objectStore("sessions");
    // 人工输入只更新小型意见文件, 不反复复制嵌入图片的审计包。
    if (!storedContent.has(fingerprint)) store.put(document, `content:${fingerprint}`);
    store.put(feedback, `feedback:${fingerprint}`);
    store.put(fingerprint, `package:${document.id}`);
    store.put(fingerprint, "last");
    transaction.oncomplete = () => { storedContent.add(fingerprint); resolve(); };
    transaction.onerror = () => reject(transaction.error ?? new Error("审计自动保存失败, 请导出意见文件"));
    transaction.onabort = () => reject(transaction.error ?? new Error("审计保存中断"));
  });
}
function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function downloadAuditFeedback(feedback: AuditFeedback) {
  downloadJson(feedback, `${feedback.packageId}.audit-feedback.json`);
}
export function downloadAuditProject(project: ProjectDocument, name: string) {
  downloadJson(project, `${name}.satb`);
}
