// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../../../shared/logging";
import type { HarmonyCheckResult } from "../../domain/harmony";
import { createEmptyProject } from "../../domain/project";
import { logger } from "../../services/logging";
import { LogsPanel, type LogFocus } from "./LogsPanel";
import { useSessionLogErrors } from "./useSessionLogErrors";

const project = createEmptyProject();
const harmonyResult: HarmonyCheckResult = {
  diagnostics: [],
  skippedRuleIds: ["test-rule"],
  skippedRules: [],
  revision: 8,
  superseded: false,
  invalidationRanges: [],
};

let root: Root;
let container: HTMLDivElement;

function logEntry(id: string, fields: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    level: "error",
    message: id,
    process: "main",
    scope: "file",
    timestamp: "2030-01-01T00:00:00.000Z",
    ...fields,
  };
}

function desktopLog(initialEntries: LogEntry[] = []) {
  const getRecent = vi.fn().mockResolvedValue({ entries: initialEntries });
  const exportBundle = vi.fn().mockResolvedValue({ canceled: false });
  const openDirectory = vi.fn().mockResolvedValue({ opened: true });
  let listener: ((entry: LogEntry) => void) | undefined;
  vi.stubGlobal("desktop", {
    log: {
      getRecent, exportBundle, openDirectory,
      onErrorEntry(callback: (entry: LogEntry) => void) {
        listener = callback;
        return () => { listener = undefined; };
      },
    },
  });
  return { getRecent, exportBundle, openDirectory, push: (entry: LogEntry) => listener?.(entry) };
}

function button(label: string) {
  const match = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function change(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  if (field instanceof HTMLInputElement) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    await act(() => field.dispatchEvent(new Event("input", { bubbles: true })));
  } else {
    field.value = value;
    await act(() => field.dispatchEvent(new Event("change", { bubbles: true })));
  }
}

const rows = () => [...container.querySelectorAll<HTMLElement>(".logs-row")];

async function mount(focus?: LogFocus, currentProject = project) {
  await act(() => root.render(<LogsPanel project={currentProject} harmonyResult={harmonyResult} focus={focus} />));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  logger.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LogsPanel", () => {
  it("merges, sorts and deduplicates logs, then filters by level, scope, process and keyword", async () => {
    const info = logger.info("app", "应用已启动");
    logger.warn("audio", "回退音色");
    logger.error("inference", "推导异常", { code: "INFERENCE_FAILED" });
    desktopLog([
      info,
      logEntry("打开工程失败", { code: "FILE_READ_FAILED", context: { durationMs: 47.8 } }),
      logEntry("规则工作线程异常", { process: "worker", scope: "external-rule" }),
    ]);

    await mount();
    expect(rows()).toHaveLength(5);
    expect(rows()[0].textContent).toContain("规则工作线程异常");
    expect(rows().find(row => row.textContent?.includes("FILE_READ_FAILED"))?.textContent).toContain("48 ms");
    await change("日志级别", "warn");
    expect(rows()).toHaveLength(4);
    await change("日志级别", "error");
    expect(rows()).toHaveLength(3);
    await change("日志模块", "external-rule");
    expect(rows()).toHaveLength(1);
    await change("日志进程", "renderer");
    expect(rows()).toHaveLength(0);
    await change("日志进程", "worker");
    expect(rows()).toHaveLength(1);
    await change("日志进程", "all");
    await change("日志模块", "all");
    await change("搜索日志", "file_read_failed");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("打开工程失败");
  });

  it("finds a stack keyword, expands context and jumps to the requested entry through active filters", async () => {
    const entry = logger.error("file", "打开失败", {
      error: new Error("stack-only diagnostic"),
      context: { operation: "read", attempt: 2 },
    });
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    try {
      await mount();
      await change("搜索日志", "STACK-ONLY");
      expect(rows()).toHaveLength(1);
      await act(() => rows()[0].click());
      expect(container.querySelector('[aria-label="错误堆栈"]')?.textContent).toContain("Error: stack-only diagnostic");
      expect(container.querySelector('[aria-label="日志上下文"]')?.textContent).toContain('"attempt": 2');
      await act(() => button("复制 JSON").click());
      expect(JSON.parse(clipboard.mock.calls[0][0])).toMatchObject({ id: entry.id });
      await act(() => button("复制文本").click());
      expect(clipboard.mock.calls[1][0]).toContain("Error: stack-only diagnostic");

      await change("日志模块", "audio");
      expect(rows()).toHaveLength(0);
      await mount({ entryId: entry.id });
      expect(rows()[0].closest("li")?.className).toBe("logs-highlight");
      expect(rows()[0].getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(rows()[0]);
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("refreshes desktop logs and clears the view without deleting buffered logs", async () => {
    const first = logger.info("app", "已有记录");
    const desktop = desktopLog([first]);
    await mount();
    await act(() => button("清空当前视图").click());
    expect(rows()).toHaveLength(0);
    expect(logger.getEntries()).toContain(first);
    desktop.getRecent.mockResolvedValue({ entries: [first, logEntry("新增主进程记录")] });
    await act(() => button("刷新主进程日志").click());
    expect(rows().map(row => row.textContent)).toEqual([expect.stringContaining("新增主进程记录")]);
    await act(() => { logger.info("app", "新增渲染记录"); });
    expect(rows()).toHaveLength(2);
    await act(() => button("打开日志目录").click());
    expect(desktop.openDirectory).toHaveBeenCalledOnce();
  });

  it("redacts paths by default and saves the full project and harmony result only when selected", async () => {
    const personalPath = "C:\\Users\\Alice\\private.sf2";
    logger.error("audio", `无法打开 ${personalPath}`, { context: { filePath: personalPath } });
    const { exportBundle } = desktopLog();
    const currentProject = {
      ...project,
      audio: { ...project.audio, soundFont: { kind: "user" as const, name: "private", path: personalPath } },
    };
    await mount(undefined, currentProject);
    await act(() => button("导出排错包").click());
    const options = () => [...container.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')];
    expect(options().map(field => field.checked)).toEqual([true, false]);
    await act(() => button("确认导出 JSON").click());

    const [first] = exportBundle.mock.calls[0];
    expect(first.defaultName).toBe("satb-diagnostic.json");
    expect(first.bundleJson).not.toContain("Alice");
    expect(first.bundleJson).toContain("<USER_HOME>");
    const defaultBundle = JSON.parse(first.bundleJson);
    expect(defaultBundle).not.toHaveProperty("project");
    expect(defaultBundle).not.toHaveProperty("harmonySummary");

    await act(() => button("导出排错包").click());
    await act(() => options()[1].click());
    await act(() => button("确认导出 JSON").click());
    const attached = JSON.parse(exportBundle.mock.calls[1][0].bundleJson);
    expect(attached.project).toEqual({
      ...currentProject,
      audio: { ...currentProject.audio, soundFont: { ...currentProject.audio.soundFont, path: "<USER_HOME>/private.sf2" } },
    });
    expect(attached.harmonySummary).toEqual(harmonyResult);

    await act(() => button("导出排错包").click());
    expect(options().map(field => field.checked)).toEqual([true, false]);
    await act(() => { options()[0].click(); options()[1].click(); });
    await act(() => button("确认导出 JSON").click());
    const fullBundle = JSON.parse(exportBundle.mock.calls[2][0].bundleJson);
    expect(fullBundle.project).toEqual(currentProject);
  });

  it("downloads one JSON file when running in a browser", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:satb-diagnostic");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    await mount();
    await act(() => button("导出排错包").click());
    await act(() => button("确认导出 JSON").click());
    expect(downloads).toEqual(["satb-diagnostic.json"]);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0].type).toBe("application/json;charset=utf-8");
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:satb-diagnostic"));
  });

  it("shows ordinary-mode logs only after errors and keeps developer logs available", async () => {
    const desktop = desktopLog();
    function Harness({ developerMode = false, reading = false }) {
      const { hasErrors, unreadErrorCount } = useSessionLogErrors(reading);
      return developerMode || hasErrors ? <output>日志 <span>{unreadErrorCount}</span></output> : null;
    }

    await act(() => root.render(<Harness />));
    await act(() => { logger.warn("audio", "只能用回退音色"); });
    expect(container.textContent).toBe("");
    await act(() => root.render(<Harness developerMode />));
    expect(container.textContent).toBe("日志 0");
    await act(() => root.render(<Harness />));
    expect(container.textContent).toBe("");
    const fatal = logEntry("主进程异常", { level: "fatal" });
    await act(() => { desktop.push(fatal); desktop.push(fatal); });
    expect(container.textContent).toBe("日志 1");
    await act(() => { logger.error("file", "保存失败"); });
    expect(container.textContent).toBe("日志 2");
    await act(() => root.render(<Harness reading />));
    await act(() => root.render(<Harness />));
    expect(container.textContent).toBe("日志 0");
  });
});
