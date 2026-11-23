// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../services/logging";
import { AppErrorBoundary } from "./AppErrorBoundary";

let container: HTMLDivElement;
let root: Root;

function Crash(): never {
  throw new Error("不能渲染 /home/alice/score");
}

function button(text: string) {
  const element = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);
  if (!element) throw new Error("Missing action: " + text);
  return element;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container, { onCaughtError: () => {} });
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, "desktop");
  Reflect.deleteProperty(navigator, "clipboard");
  logger.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("passes through healthy children", async () => {
    await act(() => root.render(<AppErrorBoundary><p>工程已打开</p></AppErrorBoundary>));
    expect(container.textContent).toBe("工程已打开");
    expect(logger.getEntries()).toEqual([]);
  });

  it("focuses the recovery heading, records a fatal and exposes redacted technical details and copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(() => root.render(<AppErrorBoundary><Crash /></AppErrorBoundary>));

    expect(document.activeElement?.textContent).toBe("界面意外停止");
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.querySelector("summary")?.textContent).toContain("RENDER_CRASH");
    expect(container.querySelector("pre")?.textContent).toContain("<USER_HOME>/score");
    expect(button("重新加载界面")).toBeDefined();
    expect(logger.getEntries()).toEqual([
      expect.objectContaining({
        level: "fatal",
        scope: "ui",
        code: "RENDER_CRASH",
        error: expect.objectContaining({ message: "不能渲染 /home/alice/score" }),
        context: expect.objectContaining({ componentStack: expect.stringContaining("Crash") }),
      }),
    ]);

    await act(() => button("复制错误信息").click());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("RENDER_CRASH\n"));
    expect(writeText.mock.calls[0][0]).not.toContain("/home/alice");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("已复制错误信息");
  });

  it("exports a redacted desktop bundle even when reading main logs fails", async () => {
    const exportBundle = vi.fn().mockResolvedValue({ canceled: false });
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        log: {
          appendBatch: vi.fn().mockResolvedValue({ written: 1 }),
          getRecent: vi.fn().mockRejectedValue(new Error("offline")),
          exportBundle,
        },
      },
    });
    await act(() => root.render(<AppErrorBoundary><Crash /></AppErrorBoundary>));
    await act(() => button("导出排错包").click());
    const request = exportBundle.mock.calls[0][0];
    expect(request.defaultName).toBe("satb-diagnostic.json");
    expect(request.bundleJson).not.toContain("/home/alice");
    expect(JSON.parse(request.bundleJson)).toMatchObject({
      schemaVersion: 1,
      logs: [expect.objectContaining({ code: "RENDER_CRASH" })],
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("已导出排错包");
  });

  it("downloads the bundle in browser mode and runs emergency backup once", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:diagnostic");
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("satb-diagnostic.json");
    });
    const backup = vi.fn().mockRejectedValue(new Error("permission denied"));
    await act(() => root.render(<AppErrorBoundary onEmergencyBackup={backup}><Crash /></AppErrorBoundary>));
    expect(backup).toHaveBeenCalledTimes(1);
    expect(logger.getEntries()[1].code).toBe("RECOVERY_FAILED");
    await act(() => button("导出排错包").click());
    expect(backup).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "application/json;charset=utf-8" }));
    expect(download).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("未能备份当前工程");
  });
});
