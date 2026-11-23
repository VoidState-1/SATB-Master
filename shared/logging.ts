export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export const LOG_SCOPES = [
  "app", "ipc", "file", "editor", "audio", "harmony", "inference",
  "harmonization", "external-rule", "ui",
] as const;
export const LOG_PROCESSES = ["main", "renderer", "worker"] as const;
export const APP_ERROR_CODES = [
  "UNKNOWN", "IPC_FAILED", "FILE_READ_FAILED", "FILE_WRITE_FAILED",
  "PROJECT_INVALID", "RECOVERY_FAILED", "SOUNDFONT_LOAD_FAILED",
  "AUDIO_PLAYBACK_FAILED", "EXTERNAL_RULE_FAILED", "HARMONY_CHECK_FAILED",
  "INFERENCE_FAILED", "HARMONIZATION_FAILED", "RENDER_CRASH",
  "UNHANDLED_REJECTION", "UNCAUGHT_EXCEPTION",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogScope = (typeof LOG_SCOPES)[number];
export type LogProcess = (typeof LOG_PROCESSES)[number];

export function isErrorLog(level: LogLevel): boolean {
  return level === "error" || level === "fatal";
}
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];
export type LogValue = null | boolean | number | string | LogValue[] | { [key: string]: LogValue };

export const MAX_DIAGNOSTIC_BUNDLE_BYTES = 20 * 1024 * 1024;
export const MAX_RECENT_LOGS = 1000;

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SerializedError;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  scope: LogScope;
  process: LogProcess;
  message: string;
  code?: AppErrorCode;
  error?: SerializedError;
  context?: LogValue;
}

export interface BreadcrumbEntry {
  timestamp: string;
  scope: LogScope;
  message: string;
  context?: LogValue;
}

export interface DiagnosticBundle {
  schemaVersion: 1;
  generatedAt: string;
  appVersion: string;
  platform: string;
  sessionId: string;
  breadcrumbs: BreadcrumbEntry[];
  logs: LogEntry[];
  project?: LogValue;
  harmonySummary?: LogValue;
}

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    options: { userMessage?: string; context?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.userMessage = options.userMessage ?? message;
    this.context = options.context;
  }

  readonly userMessage: string;
  readonly context?: unknown;
}

const MAX_STRING_LENGTH = 4000;
const MAX_DEPTH = 8;
const MAX_MEMBERS = 50;

function truncate(text: string): string {
  return text.length <= MAX_STRING_LENGTH ? text : text.slice(0, MAX_STRING_LENGTH) + "…";
}

export function sanitizePath(value: string): string {
  const windowsHome = /\b[A-Z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)(?:[^\\/\r\n"'<>:|?*]+(?:\\{1,2}|\/)|[^\\/\s"'<>:|?*()[\]{}]+)/gi;
  const posixHome = /\/(?:Users|home)\/[^/\s"'<>:()[\]{}]+\/?/g;
  const redact = (match: string) => /[\\/]$/.test(match) ? "<USER_HOME>/" : "<USER_HOME>";
  return value.replace(windowsHome, redact).replace(posixHome, redact);
}

export function sanitizeContext(context: string, options?: { redactPaths?: boolean }): string;
export function sanitizeContext(context: unknown, options?: { redactPaths?: boolean }): LogValue;
export function sanitizeContext(
  context: unknown,
  { redactPaths = false }: { redactPaths?: boolean } = {},
): LogValue {
  let remaining = 1000;
  let textBudget = 32_000;
  const ancestors = new Set<object>();
  const clean = (value: string) => {
    const text = redactPaths ? sanitizePath(value) : value;
    const count = Math.min(MAX_STRING_LENGTH, textBudget, text.length);
    textBudget -= count;
    return count < text.length ? text.slice(0, count) + "…" : text;
  };

  function visit(value: unknown, depth: number): LogValue {
    if (--remaining < 0 || depth > MAX_DEPTH) return "[Truncated]";
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object") {
      return typeof value === "function" ? "[Function]" : clean(String(value));
    }
    if (ancestors.has(value)) return "[Circular]";
    ancestors.add(value);
    try {
      if (value instanceof Date) return Date.prototype.toISOString.call(value);
      if (Array.isArray(value)) {
        const items: LogValue[] = [];
        for (let index = 0; index < value.length && index < MAX_MEMBERS && remaining > 0; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, index);
          items.push(descriptor && "value" in descriptor ? visit(descriptor.value, depth + 1) : null);
        }
        if (items.length < value.length) items.push("[Truncated]");
        return items;
      }
      const fields: [string, LogValue][] = [];
      const keys = value instanceof Error ? Object.getOwnPropertyNames(value) : Object.keys(value);
      for (const key of keys) {
        if (fields.length >= MAX_MEMBERS || remaining <= 0) {
          fields.push(["…", "[Truncated]"]);
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        fields.push([
          clean(key),
          descriptor && "value" in descriptor ? visit(descriptor.value, depth + 1) : "[Accessor]",
        ]);
      }
      return Object.fromEntries(fields);
    } catch {
      return "[Uninspectable]";
    } finally {
      ancestors.delete(value);
    }
  }

  return visit(context, 0);
}

function readErrorProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

export function serializeError(error: unknown): SerializedError {
  const seen = new Set<object>();

  function visit(value: unknown, depth: number): SerializedError {
    if (depth > MAX_DEPTH) return { name: "Error", message: "[Truncated cause]" };
    if (!value || typeof value !== "object") {
      const text = sanitizeContext(value);
      return { name: "Error", message: typeof text === "string" ? text : JSON.stringify(text) };
    }
    if (seen.has(value)) return { name: "Error", message: "[Circular cause]" };
    seen.add(value);
    const name = readErrorProperty(value, "name");
    const message = readErrorProperty(value, "message");
    const stack = readErrorProperty(value, "stack");
    const code = readErrorProperty(value, "code");
    const cause = readErrorProperty(value, "cause");
    const result: SerializedError = {
      name: typeof name === "string" ? truncate(name) : "Error",
      message: truncate(typeof message === "string" ? message : JSON.stringify(sanitizeContext(value))),
    };
    if (typeof stack === "string") result.stack = truncate(stack);
    if (typeof code === "string" || typeof code === "number") result.code = truncate(String(code));
    if (cause !== undefined) result.cause = visit(cause, depth + 1);
    return result;
  }

  return visit(error, 0);
}

export function formatLogEntryText(entry: LogEntry): string {
  const code = entry.code ? " " + entry.code : "";
  const lines = [
    entry.timestamp + " [" + entry.level.toUpperCase() + "] " +
      entry.process + "/" + entry.scope + code + " " + entry.message,
  ];
  let error = entry.error;
  while (error) {
    lines.push(error.stack || error.name + ": " + error.message);
    error = error.cause;
    if (error) lines.push("Caused by:");
  }
  if (entry.context !== undefined) lines.push(JSON.stringify(entry.context, null, 2));
  return lines.join("\n");
}
