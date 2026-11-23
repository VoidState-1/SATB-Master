import { BrowserWindow, shell } from "electron";
import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, statSync, truncateSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DESKTOP_CHANNELS } from "../shared/desktop.js";
import {
  APP_ERROR_CODES,
  LOG_LEVELS,
  LOG_SCOPES,
  MAX_DIAGNOSTIC_BUNDLE_BYTES,
  MAX_RECENT_LOGS,
  sanitizeContext,
  serializeError,
  type LogEntry,
} from "../shared/logging.js";
import { showExclusiveSaveDialog } from "./dialog-coordinator.js";
import { handleDesktop } from "./typed-ipc.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DIRECTORY_BYTES = 20 * 1024 * 1024;
const MAX_SESSION_FILES = 15;
const SESSION_FILE = /^session-\d{8}-\d{6}-\d+(?:-\d+)?\.jsonl$/;

interface SessionFile {
  filePath: string;
  size: number;
  modifiedAt: number;
}

interface PendingBatch {
  entries: readonly LogEntry[];
  resolve: (written: number) => void;
}

export class MainLogger {
  private readonly baseName = "session-" + new Date().toISOString().slice(0, 19)
    .replaceAll("-", "").replaceAll(":", "").replace("T", "-") + "-" + process.pid;
  private active?: SessionFile;
  private sequence = 0;
  private archives: SessionFile[] = [];
  private recent: LogEntry[] = [];
  private pending: PendingBatch[] = [];
  private scheduled?: ReturnType<typeof setImmediate>;

  constructor(readonly directory: string) {
    try {
      this.rotate();
    } catch {
      // Keep the memory buffer available even if the log directory is inaccessible.
    }
  }

  get logFilePath() {
    return this.active?.filePath;
  }

  getRecent(limit = MAX_RECENT_LOGS): LogEntry[] {
    const count = Number.isFinite(limit)
      ? Math.max(0, Math.min(MAX_RECENT_LOGS, Math.floor(limit)))
      : MAX_RECENT_LOGS;
    return this.recent.slice(Math.max(0, this.recent.length - count));
  }

  append(entry: LogEntry): Promise<number> {
    return this.appendBatch([entry]);
  }

  appendBatch(entries: readonly LogEntry[]): Promise<number> {
    this.remember(entries);
    if (entries.length === 0) return Promise.resolve(0);
    return new Promise((resolve) => {
      this.pending.push({ entries: [...entries], resolve });
      this.scheduled ??= setImmediate(() => this.drain());
    });
  }

  appendSync(entry: LogEntry): number {
    this.remember([entry]);
    this.drain();
    return this.persist([entry]);
  }

  private remember(entries: readonly LogEntry[]) {
    this.recent = this.recent.concat(entries).slice(-MAX_RECENT_LOGS);
  }

  private drain() {
    if (this.scheduled) clearImmediate(this.scheduled);
    this.scheduled = undefined;
    // Keep writes and rotation on one synchronous path so a crash can drain it immediately.
    const pending = this.pending;
    this.pending = [];
    for (const batch of pending) batch.resolve(this.persist(batch.entries));
  }

  private rotate() {
    this.active = undefined;
    mkdirSync(this.directory, { recursive: true });
    this.archives = readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && SESSION_FILE.test(entry.name))
      .map((entry) => {
        const filePath = path.join(this.directory, entry.name);
        const stat = statSync(filePath);
        return { filePath, size: stat.size, modifiedAt: stat.mtimeMs };
      })
      .sort((left, right) => left.modifiedAt - right.modifiedAt ||
        left.filePath.localeCompare(right.filePath, undefined, { numeric: true }));
    this.prune(0);

    while (!this.active) {
      const suffix = this.sequence === 0 ? "" : "-" + (this.sequence + 1);
      const filePath = path.join(this.directory, this.baseName + suffix + ".jsonl");
      this.sequence++;
      try {
        closeSync(openSync(filePath, "wx"));
        this.active = { filePath, size: 0, modifiedAt: Date.now() };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  }

  private prune(activeBytes: number) {
    let bytes = this.archives.reduce((total, file) => total + file.size, activeBytes);
    while (this.archives.length >= MAX_SESSION_FILES || bytes > MAX_DIRECTORY_BYTES) {
      const oldest = this.archives[0];
      try {
        unlinkSync(oldest.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      this.archives.shift();
      bytes -= oldest.size;
    }
  }

  private persist(entries: readonly LogEntry[]): number {
    let written = 0;
    let lines: string[] = [];
    let bytes = 0;

    const commit = (file: SessionFile) => {
      if (lines.length === 0) return;
      this.prune(file.size + bytes);
      try {
        appendFileSync(file.filePath, lines.join(""), "utf8");
      } catch (error) {
        try {
          truncateSync(file.filePath, file.size);
        } catch {
          this.active = undefined;
        }
        throw error;
      }
      file.size += bytes;
      written += lines.length;
      lines = [];
      bytes = 0;
    };

    try {
      for (const entry of entries) {
        const line = JSON.stringify(entry) + "\n";
        const size = Buffer.byteLength(line, "utf8");
        if (size > MAX_FILE_BYTES) continue;
        if (!this.active) this.rotate();
        const file = this.active!;
        if (file.size + bytes + size > MAX_FILE_BYTES) {
          commit(file);
          this.rotate();
        }
        lines.push(line);
        bytes += size;
      }
      if (this.active) commit(this.active);
    } catch {
      // Logging must never report its own failure through the logging pipeline.
    }
    return written;
  }
}

function normalizeRendererEntry(value: LogEntry): LogEntry | undefined {
  if (!value || typeof value.id !== "string" || typeof value.timestamp !== "string" ||
      !LOG_LEVELS.includes(value.level) || !LOG_SCOPES.includes(value.scope) ||
      typeof value.message !== "string" || !Number.isFinite(Date.parse(value.timestamp))) {
    return undefined;
  }
  return {
    id: value.id.slice(0, 128),
    timestamp: new Date(value.timestamp).toISOString(),
    level: value.level,
    scope: value.scope,
    process: value.process === "worker" ? "worker" : "renderer",
    message: value.message.slice(0, 4001),
    code: value.code && APP_ERROR_CODES.includes(value.code) ? value.code : undefined,
    error: value.error === undefined ? undefined : serializeError(value.error),
    context: value.context === undefined ? undefined : sanitizeContext(value.context),
  };
}

export function registerLoggingIpc(logger: MainLogger) {
  handleDesktop(DESKTOP_CHANNELS.logAppendBatch, async (_event, request) => {
    if (!Array.isArray(request?.entries) || request.entries.length > MAX_RECENT_LOGS) {
      throw new Error("无效的日志批次");
    }
    const entries = request.entries.flatMap((entry) => {
      const normalized = normalizeRendererEntry(entry);
      return normalized ? [normalized] : [];
    });
    const written = await logger.appendBatch(entries);
    return { written };
  });

  handleDesktop(DESKTOP_CHANNELS.logGetRecent, (_event, request) => ({
    entries: logger.getRecent(request?.limit),
    logFilePath: logger.logFilePath,
    logDirectory: logger.directory,
  }));

  handleDesktop(DESKTOP_CHANNELS.logOpenDirectory, async () => {
    const error = await shell.openPath(logger.directory);
    return { opened: error === "", directory: logger.directory };
  });

  handleDesktop(DESKTOP_CHANNELS.logExportBundle, async (event, request) => {
    if (typeof request?.bundleJson !== "string" || !request.bundleJson ||
        Buffer.byteLength(request.bundleJson, "utf8") > MAX_DIAGNOSTIC_BUNDLE_BYTES) {
      throw new Error("排错包必须为非空 JSON 且大小不超过 20 MB");
    }
    JSON.parse(request.bundleJson);
    const name = (typeof request.defaultName === "string" ? request.defaultName : "")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().slice(0, 120) || "satb-diagnostic";
    const defaultPath = /\.json$/i.test(name) ? name : name + ".json";
    const result = await showExclusiveSaveDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined, {
      title: "导出排错包",
      defaultPath,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, request.bundleJson, "utf8");
    return { canceled: false, filePath: result.filePath };
  });
}
