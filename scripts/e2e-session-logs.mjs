import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const levels = new Set(["debug", "info", "warn", "error", "fatal"]);

export async function waitForElectronExit(child, { requireSuccess = true } = {}) {
  const deadline = Date.now() + 12_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await delay(100);
  }
  if (child.exitCode === null && child.signalCode === null) throw new Error("E2E Electron 进程退出超时");
  if (requireSuccess && child.exitCode !== 0) {
    throw new Error(`E2E Electron 异常退出 (${child.signalCode ?? child.exitCode})`);
  }
}

export async function assertCleanSessionLogs(userDataDirectory, { expectedErrorCodes = [] } = {}) {
  const logDirectory = path.join(userDataDirectory, "logs");
  const files = (await readdir(logDirectory, { withFileTypes: true }).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return [];
  })).filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"));
  if (!files.length) throw new Error(`E2E 未生成会话日志文件: ${logDirectory}`);

  const allowedErrors = new Set(expectedErrorCodes);
  const failures = [];
  let entries = 0;
  for (const file of files) {
    const bytes = await readFile(path.join(logDirectory, file.name));
    const lines = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    if (!lines.length) throw new Error(`E2E 会话日志文件为空: ${file.name}`);
    for (const [index, line] of lines.entries()) {
      const location = `${file.name}:${index + 1}`;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (cause) {
        throw new Error(`E2E 会话日志的 JSONL 无效: ${location}`, { cause });
      }
      if (!entry || !levels.has(entry.level) || typeof entry.message !== "string" ||
          typeof entry.id !== "string" || !Number.isFinite(Date.parse(entry.timestamp))) {
        throw new Error(`E2E 会话日志条目无效: ${location}`);
      }
      entries++;
      if (entry.level === "fatal" || (entry.level === "error" && !allowedErrors.has(entry.code))) {
        failures.push(`${location} [${entry.level}] ${entry.process}/${entry.scope} ${entry.code ?? ""} ${entry.message}`);
      }
    }
  }

  if (failures.length) throw new Error(`E2E 出现 ${failures.length} 条未预期的错误日志:\n${failures.join("\n")}`);
  return { files: files.length, entries };
}
