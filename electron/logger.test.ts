import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../shared/logging.js";
import { initializeMainLogger, logMain, MainLogger, registerLoggingIpc } from "./logger.js";
import { registerProjectIpc } from "./project-ipc.js";
import { handleDesktop, setDesktopIpcReporter } from "./typed-ipc.js";

const { handlers, openPath, showSaveDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (event: object, request?: unknown) => unknown>(),
  openPath: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => directory },
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  dialog: { showSaveDialog },
  shell: { openPath },
  ipcMain: { handle: (channel: string, handler: () => unknown) => handlers.set(channel, handler) },
}));

const MiB = 1024 * 1024;
let directory: string;

function entry(id: string, message = id): LogEntry {
  return {
    id,
    timestamp: "2026-11-22T00:00:00.000Z",
    level: "info",
    scope: "app",
    process: "main",
    message,
  };
}

function logFiles() {
  return readdirSync(directory).filter((name) => name.endsWith(".jsonl"));
}

function seedArchive(index: number, size = 0) {
  const name = "session-20260101-000000-" + index + ".jsonl";
  const file = path.join(directory, name);
  writeFileSync(file, "");
  truncateSync(file, size);
  utimesSync(file, index, index);
  return name;
}

function invoke(channel: string, request?: unknown) {
  return handlers.get(channel)!({ sender: {} }, request);
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "satb-log-test-"));
  handlers.clear();
  openPath.mockReset();
  showSaveDialog.mockReset();
});

afterEach(() => {
  setDesktopIpcReporter();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("MainLogger", () => {
  it("serializes errors reported by main-process adapters", async () => {
    const logger = initializeMainLogger(directory);
    logMain("warn", "file", "读取失败", {
      code: "FILE_READ_FAILED",
      error: new Error("permission denied"),
      context: { kind: "project" },
    });
    expect(logger.getRecent()).toMatchObject([
      {
        level: "warn", scope: "file", process: "main", code: "FILE_READ_FAILED",
        error: { name: "Error", message: "permission denied" },
        context: { kind: "project" },
      },
    ]);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(readFileSync(logger.logFilePath!, "utf8")).toContain("FILE_READ_FAILED");
  });

  it("exports an emergency .satb copy and preserves the automatic recovery file", async () => {
    registerProjectIpc();
    const recoveryPath = path.join(directory, "recovery.json");
    writeFileSync(recoveryPath, "existing recovery");
    const selection = path.join(directory, "emergency");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: selection });
    const project = { schemaVersion: 3, satbTracks: [{}, {}, {}, {}], title: "紧急备份" };

    await expect(invoke("project:export-backup", { project, defaultName: "紧急备份" }))
      .resolves.toEqual({ canceled: false, filePath: selection + ".satb" });
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "紧急备份.satb" }));
    expect(JSON.parse(readFileSync(selection + ".satb", "utf8"))).toEqual(project);
    expect(readFileSync(recoveryPath, "utf8")).toBe("existing recovery");
  });

  it("writes UTF-8 JSONL, drains pending writes before a synchronous fatal and serves recent logs", async () => {
    const logger = new MainLogger(directory);
    const pending = logger.appendBatch([entry("a", "启动\n完成"), entry("b")]);
    const fatal = { ...entry("c"), level: "fatal" } as const;
    expect(logger.appendSync(fatal)).toBe(1);
    expect(await pending).toBe(2);
    expect(path.basename(logger.logFilePath!)).toMatch(/^session-\d{8}-\d{6}-\d+\.jsonl$/);
    expect(readFileSync(logger.logFilePath!, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line))).toEqual([
      entry("a", "启动\n完成"), entry("b"), fatal,
    ]);
    expect(logger.getRecent(2)).toEqual([entry("b"), fatal]);
    expect(logger.getRecent(0)).toEqual([]);
  });

  it("keeps newer session files and leaves unrelated files in place during initialization", () => {
    for (let index = 1; index <= 17; index++) seedArchive(index);
    writeFileSync(path.join(directory, "notes.txt"), "keep");
    new MainLogger(directory);
    const files = logFiles();
    expect(files).toHaveLength(15);
    expect(files).not.toContain("session-20260101-000000-3.jsonl");
    expect(files).toContain("session-20260101-000000-4.jsonl");
    expect(readFileSync(path.join(directory, "notes.txt"), "utf8")).toBe("keep");
  });

  it("rotates at 5 MiB and enforces the total byte budget even between rotations", async () => {
    seedArchive(1, 6 * MiB);
    for (let index = 2; index <= 4; index++) seedArchive(index, 5 * MiB);
    const logger = new MainLogger(directory);
    const sumBytes = () => logFiles().reduce((total, file) => total + statSync(path.join(directory, file)).size, 0);
    expect(sumBytes()).toBe(15 * MiB);

    const first = logger.logFilePath;
    const message = "文".repeat(Math.floor(MiB / 3));
    const batch = Array.from({ length: 6 }, (_, index) => entry(String(index), message));
    expect(await logger.appendBatch(batch)).toBe(6);
    expect(logger.logFilePath).not.toBe(first);
    expect(logFiles().every((file) => statSync(path.join(directory, file)).size <= 5 * MiB)).toBe(true);
    expect(sumBytes()).toBeLessThanOrEqual(20 * MiB);
    const lines = [first!, logger.logFilePath!].flatMap((file) => readFileSync(file, "utf8").trimEnd().split("\n"));
    expect(lines.map((line) => JSON.parse(line).id)).toEqual(batch.map((item) => item.id));
  });

  it("keeps a bounded recent buffer when the directory is unusable", async () => {
    const blockedPath = path.join(directory, "not-a-directory");
    writeFileSync(blockedPath, "");
    const logger = new MainLogger(blockedPath);
    expect(await logger.appendBatch(Array.from({ length: 1001 }, (_, index) => entry(String(index))))).toBe(0);
    expect(logger.appendSync(entry("fatal"))).toBe(0);
    expect(logger.getRecent()).toHaveLength(1000);
    expect(logger.getRecent(1)).toEqual([entry("fatal")]);
  });
});

describe("logging IPC", () => {
  it("accepts valid renderer entries and returns directory and recent-log metadata", async () => {
    const logger = new MainLogger(directory);
    registerLoggingIpc(logger);
    expect(await invoke("log:append-batch", { entries: [entry("a"), { level: "invalid" }] })).toEqual({ written: 1 });
    expect(await invoke("log:get-recent", { limit: 1 })).toEqual({
      entries: [{ ...entry("a"), process: "renderer" }],
      logFilePath: logger.logFilePath,
      logDirectory: directory,
    });
    openPath.mockResolvedValue("");
    expect(await invoke("log:open-directory")).toEqual({ opened: true, directory });
    expect(openPath).toHaveBeenCalledWith(directory);
  });

  it("exports JSON through the save dialog and refuses malformed or oversized payloads before prompting", async () => {
    registerLoggingIpc(new MainLogger(directory));
    await expect(invoke("log:export-bundle", { bundleJson: "{" })).rejects.toThrow();
    await expect(invoke("log:export-bundle", { bundleJson: "文".repeat(7 * MiB) })).rejects.toThrow("20 MB");
    expect(showSaveDialog).not.toHaveBeenCalled();

    const bundleJson = '{"message":"排错包"}';
    const filePath = path.join(directory, "diagnostic.json");
    showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await invoke("log:export-bundle", { bundleJson })).toEqual({ canceled: true });
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath });
    expect(await invoke("log:export-bundle", { bundleJson })).toEqual({ canceled: false, filePath });
    expect(showSaveDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "satb-diagnostic.json" }));
    expect(readFileSync(filePath, "utf8")).toBe(bundleJson);
  });

  it("reports only slow successful calls and preserves rejected values, excluding log append", async () => {
    const report = vi.fn();
    setDesktopIpcReporter(report);
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValueOnce(0).mockReturnValueOnce(499)
      .mockReturnValueOnce(0).mockReturnValueOnce(500)
      .mockReturnValueOnce(0).mockReturnValueOnce(20);
    handleDesktop("window:is-focused", () => true);
    expect(await invoke("window:is-focused")).toBe(true);
    expect(report).not.toHaveBeenCalled();
    expect(await invoke("window:is-focused")).toBe(true);
    expect(report).toHaveBeenCalledWith("warn", { channel: "window:is-focused", durationMs: 500 }, undefined);

    const failure = new Error("original");
    handleDesktop("project:open", async () => { throw failure; });
    await expect(invoke("project:open")).rejects.toBe(failure);
    expect(report).toHaveBeenLastCalledWith("error", { channel: "project:open", durationMs: 20 }, failure);

    handleDesktop("log:append-batch", async () => { throw failure; });
    await expect(invoke("log:append-batch", { entries: [] })).rejects.toBe(failure);
    expect(report).toHaveBeenCalledTimes(2);
  });
});
