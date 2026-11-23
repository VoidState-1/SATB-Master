import { version as appVersion } from "../../../package.json";
import {
  APP_ERROR_CODES,
  MAX_RECENT_LOGS,
  sanitizeContext,
  sanitizePath,
  serializeError,
  type AppErrorCode,
  type BreadcrumbEntry,
  type DiagnosticBundle,
  type LogEntry,
  type LogLevel,
  type LogScope,
  type LogValue,
  type SerializedError,
} from "../../../shared/logging";
import {
  appendDesktopLogBatch,
  getDesktopLogSessionId,
  getRecentDesktopLogs,
  hasDesktopLogging,
} from "../desktop";

const MAX_BREADCRUMBS = 100;
const FLUSH_INTERVAL_MS = 1000;
const rendererId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
let entryNumber = 0;

interface LogDetails {
  code?: AppErrorCode;
  error?: unknown;
  context?: unknown;
}

interface DiagnosticBundleOptions {
  redactPaths?: boolean;
  recentLimit?: number;
  project?: unknown;
  harmonySummary?: unknown;
}

function pushRecent<T>(buffer: T[], value: T, capacity: number) {
  buffer.push(value);
  if (buffer.length > capacity) buffer.shift();
}

function redactError(error: SerializedError): SerializedError {
  return {
    name: sanitizePath(error.name),
    message: sanitizePath(error.message),
    stack: error.stack === undefined ? undefined : sanitizePath(error.stack),
    code: error.code === undefined ? undefined : sanitizePath(error.code),
    cause: error.cause && redactError(error.cause),
  };
}

function redactSnapshot(value: LogValue): LogValue {
  if (typeof value === "string") return sanitizePath(value);
  if (Array.isArray(value)) return value.map(redactSnapshot);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [sanitizePath(key), redactSnapshot(item)]));
}

function copySnapshot(value: unknown, options: DiagnosticBundleOptions): LogValue | undefined {
  if (value === undefined) return undefined;
  try {
    const snapshot = JSON.parse(JSON.stringify(value)) as LogValue;
    return options.redactPaths ? redactSnapshot(snapshot) : snapshot;
  } catch {
    return sanitizeContext(value, options);
  }
}

export class RendererLogger {
  private entries: LogEntry[] = [];
  private breadcrumbs: BreadcrumbEntry[] = [];
  private listeners = new Set<() => void>();
  private notifying = false;
  private pending: LogEntry[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<unknown>;

  debug(scope: LogScope, message: string, details?: LogDetails) {
    return this.log("debug", scope, message, details);
  }

  info(scope: LogScope, message: string, details?: LogDetails) {
    return this.log("info", scope, message, details);
  }

  warn(scope: LogScope, message: string, details?: LogDetails) {
    return this.log("warn", scope, message, details);
  }

  error(scope: LogScope, message: string, details?: LogDetails) {
    return this.log("error", scope, message, details);
  }

  fatal(scope: LogScope, code: AppErrorCode, details: LogDetails & { message?: string } = {}) {
    return this.log("fatal", scope, details.message ?? code, { ...details, code });
  }

  private log(level: LogLevel, scope: LogScope, message: string, details?: LogDetails): LogEntry {
    const error = details && "error" in details ? serializeError(details.error) : undefined;
    const entry: LogEntry = {
      id: rendererId + "-" + ++entryNumber,
      timestamp: new Date().toISOString(),
      level,
      scope,
      process: "renderer",
      message: sanitizeContext(message),
      code: details?.code ?? APP_ERROR_CODES.find((code) => code === error?.code),
      error,
      context: details?.context === undefined ? undefined : sanitizeContext(details.context),
    };
    pushRecent(this.entries, entry, MAX_RECENT_LOGS);
    if (hasDesktopLogging()) {
      pushRecent(this.pending, entry, MAX_RECENT_LOGS);
      if (level === "error" || level === "fatal") {
        void this.flush();
      } else {
        this.timer ??= setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS);
      }
    }
    this.notify();
    return entry;
  }

  recordBreadcrumb(scope: LogScope, message: string, context?: unknown) {
    pushRecent(this.breadcrumbs, {
      timestamp: new Date().toISOString(),
      scope,
      message: sanitizeContext(message),
      context: context === undefined ? undefined : sanitizeContext(context),
    }, MAX_BREADCRUMBS);
    this.notify();
  }

  span<T>(scope: LogScope, message: string, fn: () => PromiseLike<T>, context?: unknown): Promise<T>;
  span<T>(scope: LogScope, message: string, fn: () => T, context?: unknown): T;
  span<T>(scope: LogScope, message: string, fn: () => T | PromiseLike<T>, context?: unknown): T | Promise<T> {
    const start = performance.now();
    const spanContext = () => ({
      durationMs: performance.now() - start,
      ...(context === undefined ? {} : { details: context }),
    });
    const fail = (error: unknown): never => {
      this.error(scope, message, { error, context: spanContext() });
      throw error;
    };

    try {
      const result = fn();
      if (result != null && typeof (result as PromiseLike<T>).then === "function") {
        return Promise.resolve(result).then((value) => {
          this.debug(scope, message, { context: spanContext() });
          return value;
        }, fail);
      }
      this.debug(scope, message, { context: spanContext() });
      return result as T;
    } catch (error) {
      return fail(error);
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  getBreadcrumbs(): BreadcrumbEntry[] {
    return [...this.breadcrumbs];
  }

  clear() {
    this.entries = [];
    this.breadcrumbs = [];
    this.pending = [];
    this.cancelTimer();
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    if (this.notifying) return;
    this.notifying = true;
    try {
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          // Diagnostic listeners cannot interrupt logging or start a failure loop.
        }
      }
    } finally {
      this.notifying = false;
    }
  }

  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  async flush(): Promise<void> {
    this.cancelTimer();
    if (this.inFlight) {
      await this.inFlight;
      if (this.pending.length > 0) await this.flush();
      return;
    }
    if (this.pending.length === 0) return;

    const entries = this.pending;
    this.pending = [];
    this.inFlight = Promise.resolve().then(() => appendDesktopLogBatch(entries)).catch(() => {
      // A failed transport still leaves the entries available in the renderer buffer.
    });
    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  async buildDiagnosticBundle(options: DiagnosticBundleOptions = {}): Promise<DiagnosticBundle> {
    const recent = await getRecentDesktopLogs(options.recentLimit).catch(() => ({ entries: [] }));
    const logs = [...new Map(
      [...recent.entries, ...this.entries].map((entry) => [entry.id, entry]),
    ).values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const cleanContext = (context: unknown) =>
      context === undefined ? undefined : sanitizeContext(context, options);

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      appVersion,
      platform: typeof navigator === "undefined" ? "unknown" : navigator.platform || navigator.userAgent,
      sessionId: getDesktopLogSessionId() ?? rendererId,
      breadcrumbs: this.breadcrumbs.map((entry) => options.redactPaths ? {
        ...entry,
        message: sanitizePath(entry.message),
        context: cleanContext(entry.context),
      } : entry),
      logs: options.redactPaths ? logs.map((entry) => ({
        ...entry,
        message: sanitizePath(entry.message),
        error: entry.error && redactError(entry.error),
        context: cleanContext(entry.context),
      })) : logs,
      project: copySnapshot(options.project, options),
      harmonySummary: copySnapshot(options.harmonySummary, options),
    };
  }
}

export const logger = new RendererLogger();

export function buildDiagnosticBundle(options?: DiagnosticBundleOptions) {
  return logger.buildDiagnosticBundle(options);
}

let uninstallGlobalErrorHandlers: (() => void) | undefined;

export function installGlobalErrorHandlers(): () => void {
  if (typeof window === "undefined") return () => {};
  if (uninstallGlobalErrorHandlers) return uninstallGlobalErrorHandlers;

  const target = window;
  let handling = false;
  const capture = (message: string, code: AppErrorCode, error: unknown) => {
    if (handling) return;
    handling = true;
    try {
      logger.error("app", message, { code, error });
    } finally {
      handling = false;
    }
  };
  const onError = (event: ErrorEvent) =>
    capture("页面发生未捕获异常", "UNCAUGHT_EXCEPTION", event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) =>
    capture("页面存在未处理的 Promise 拒绝", "UNHANDLED_REJECTION", event.reason);
  const onPageHide = () => void logger.flush();

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  target.addEventListener("pagehide", onPageHide);
  const uninstall = () => {
    if (uninstallGlobalErrorHandlers !== uninstall) return;
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener("pagehide", onPageHide);
    uninstallGlobalErrorHandlers = undefined;
  };
  uninstallGlobalErrorHandlers = uninstall;
  return uninstall;
}
