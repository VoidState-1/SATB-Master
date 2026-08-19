import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_RULE_TEST_CASE_BYTES } from "../shared/desktop.js";

export const RULE_TEST_CASE_EXTENSION = ".satb-rule-case.json";

interface AtomicFileOperations {
  write(filePath: string, value: string): Promise<void>;
  replace(sourcePath: string, destinationPath: string): Promise<void>;
  remove(filePath: string): Promise<void>;
}

const defaultFileOperations: AtomicFileOperations = {
  async write(filePath, value) {
    await writeFile(filePath, value, "utf8");
  },
  async replace(sourcePath, destinationPath) {
    await rename(sourcePath, destinationPath);
  },
  async remove(filePath) {
    await rm(filePath, { force: true });
  },
};

export function ensureRuleTestCasePath(filePath: string) {
  if (
    !path.isAbsolute(filePath) ||
    !filePath.toLowerCase().endsWith(RULE_TEST_CASE_EXTENSION)
  )
    throw new Error("规则测试用例路径或扩展名无效");
  return filePath;
}

export function withRuleTestCaseExtension(filePath: string) {
  return filePath.toLowerCase().endsWith(RULE_TEST_CASE_EXTENSION)
    ? filePath
    : `${filePath}${RULE_TEST_CASE_EXTENSION}`;
}

export function parseRuleTestCaseBytes(bytes: Uint8Array) {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RULE_TEST_CASE_BYTES)
    throw new Error("规则测试用例必须小于等于 20 MB 且不能为空");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("规则测试用例不是有效的 UTF-8 文本");
  }
  return JSON.parse(text) as unknown;
}

export function assertRuleTestCaseJson(json: unknown): asserts json is string {
  if (typeof json !== "string") throw new Error("规则测试用例内容必须是文本");
  const sizeBytes = Buffer.byteLength(json, "utf8");
  if (sizeBytes < 1 || sizeBytes > MAX_RULE_TEST_CASE_BYTES)
    throw new Error("规则测试用例必须小于等于 20 MB 且不能为空");
  JSON.parse(json);
}

export async function readRuleTestCaseDocument(filePath: string) {
  ensureRuleTestCasePath(filePath);
  const info = await stat(filePath);
  if (info.size < 1 || info.size > MAX_RULE_TEST_CASE_BYTES)
    throw new Error("规则测试用例必须小于等于 20 MB 且不能为空");
  return parseRuleTestCaseBytes(await readFile(filePath));
}

export async function writeRuleTestCaseAtomic(
  filePath: string,
  json: string,
  operations: AtomicFileOperations = defaultFileOperations,
) {
  ensureRuleTestCasePath(filePath);
  assertRuleTestCaseJson(json);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await operations.write(temporaryPath, json);
    await operations.replace(temporaryPath, filePath);
  } finally {
    await operations.remove(temporaryPath);
  }
}
