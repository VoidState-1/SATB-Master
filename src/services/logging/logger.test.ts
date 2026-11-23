import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../../../shared/logging";
import { installGlobalErrorHandlers, logger, RendererLogger } from "./logger";

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  logger.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function desktopWindow(overrides: Record<string, unknown> = {}) {
  const appendBatch = vi.fn().mockResolvedValue({ written: 1 });
  const target = Object.assign(new EventTarget(), {
    desktop: { log: { appendBatch, sessionId: "desktop-session", ...overrides } },
  });
  vi.stubGlobal("window", target);
  return { appendBatch, target };
}

describe("renderer logger", () => {
  it("keeps bounded browser buffers, isolates subscribers and clears its local history", async () => {
    vi.stubGlobal("window", undefined);
    const bus = new RendererLogger();
    const listener = vi.fn();
    bus.subscribe(() => { throw new Error("broken subscriber"); });
    const unsubscribe = bus.subscribe(listener);
    for (let index = 0; index < 1002; index++) bus.info("app", String(index));
    for (let index = 0; index < 102; index++) bus.recordBreadcrumb("editor", String(index));
    expect(bus.getEntries()).toHaveLength(1000);
    expect(bus.getEntries()[0].message).toBe("2");
    expect(bus.getBreadcrumbs()).toHaveLength(100);
    expect(bus.getBreadcrumbs()[0].message).toBe("2");
    expect(listener).toHaveBeenCalledTimes(1104);
    unsubscribe();
    bus.clear();
    expect(bus.getEntries()).toEqual([]);
    expect(bus.getBreadcrumbs()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1104);
    await expect(bus.flush()).resolves.toBeUndefined();
  });

  it("batches after one second and flushes immediately for errors and fatals", async () => {
    vi.useFakeTimers();
    const { appendBatch } = desktopWindow();
    const bus = new RendererLogger();
    const first = bus.info("app", "one");
    const second = bus.warn("ui", "two");
    await vi.advanceTimersByTimeAsync(999);
    expect(appendBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(appendBatch).toHaveBeenNthCalledWith(1, { entries: [first, second] });

    const queued = bus.debug("app", "queued");
    const error = bus.error("app", "urgent");
    await bus.flush();
    expect(appendBatch).toHaveBeenNthCalledWith(2, { entries: [queued, error] });

    const fatal = bus.fatal("ui", "RENDER_CRASH");
    await bus.flush();
    expect(appendBatch).toHaveBeenNthCalledWith(3, { entries: [fatal] });
  });

  it("serializes overlapping flushes and keeps local history if IPC rejects", async () => {
    const { appendBatch } = desktopWindow();
    let failFirst!: (reason: unknown) => void;
    appendBatch.mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }));
    const bus = new RendererLogger();
    const first = bus.error("app", "first");
    await Promise.resolve();
    const second = bus.fatal("ui", "RENDER_CRASH");
    const done = bus.flush();
    expect(appendBatch).toHaveBeenCalledTimes(1);
    failFirst(new Error("transport offline"));
    await done;
    expect(appendBatch).toHaveBeenNthCalledWith(2, { entries: [second] });
    expect(bus.getEntries()).toEqual([first, second]);
  });

  it("returns original sync and async results and rethrows failures with timing logs", async () => {
    const bus = new RendererLogger();
    const failure = new Error("broken");
    expect(bus.span("editor", "sync", () => 42, { phase: "layout" })).toBe(42);
    await expect(bus.span("editor", "async", async () => "value")).resolves.toBe("value");
    expect(() => bus.span("file", "sync failure", () => { throw failure; })).toThrow(failure);
    await expect(bus.span("file", "async failure", async () => { throw failure; })).rejects.toBe(failure);
    expect(bus.getEntries().map((entry) => entry.level)).toEqual(["debug", "debug", "error", "error"]);
    expect(bus.getEntries()[0].context).toMatchObject({
      durationMs: expect.any(Number),
      details: { phase: "layout" },
    });
    expect(bus.getEntries()[3].error?.message).toBe("broken");
  });

  it("installs global hooks once, protects against reentry and supports uninstall", async () => {
    const { target } = desktopWindow();
    const rejection = Object.assign(new Event("unhandledrejection"), { reason: { problem: "sample" } });
    const listener = logger.subscribe(() => target.dispatchEvent(rejection));
    uninstall = installGlobalErrorHandlers();
    expect(installGlobalErrorHandlers()).toBe(uninstall);
    target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("script failed") }));
    target.dispatchEvent(rejection);
    uninstall();
    target.dispatchEvent(rejection);
    listener();
    await logger.flush();
    expect(logger.getEntries().map((entry) => entry.code)).toEqual(["UNCAUGHT_EXCEPTION", "UNHANDLED_REJECTION"]);
    expect(logger.getEntries()[1].error?.message).toBe('{"problem":"sample"}');
  });

  it("merges by id and timestamp, redacts paths when requested and degrades without main logs", async () => {
    const remote: LogEntry = {
      id: "main-entry",
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "info",
      scope: "file",
      process: "main",
      message: "opened /home/bob/score",
    };
    const getRecent = vi.fn();
    desktopWindow({ getRecent });
    const bus = new RendererLogger();
    const local = bus.error("file", "failed", { error: new Error("C:\\Users\\alice\\bad.satb") });
    bus.recordBreadcrumb("editor", "opened", { path: "/Users/alice/local.satb" });
    getRecent.mockResolvedValueOnce({ entries: [local, remote] });
    const bundle = await bus.buildDiagnosticBundle({
      redactPaths: true,
      project: { path: "/Users/alice/project", notes: Array.from({ length: 70 }, (_, index) => index) },
      harmonySummary: { errors: 1 },
    });
    expect(bundle).toMatchObject({
      schemaVersion: 1,
      appVersion: expect.any(String),
      platform: expect.any(String),
      sessionId: "desktop-session",
      project: { path: "<USER_HOME>/project" },
      harmonySummary: { errors: 1 },
    });
    expect(bundle.project).toMatchObject({ notes: Array.from({ length: 70 }, (_, index) => index) });
    expect(bundle.logs.map((entry) => entry.id)).toEqual([remote.id, local.id]);
    expect(JSON.stringify(bundle)).not.toMatch(/alice|bob/);
    getRecent.mockRejectedValueOnce(new Error("offline"));
    expect((await bus.buildDiagnosticBundle()).logs).toEqual([local]);
    await bus.flush();
  });
});
