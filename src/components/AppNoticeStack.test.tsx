// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AppNoticeStack, useAppNotices, type ShowNotice } from "./AppNoticeStack";

it("keeps priority notices in a three-item stack, expires independently and links to the error log", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  const viewLogs = vi.fn();
  let show!: ShowNotice;
  function Harness() {
    const { notices, showNotice, dismissNotice } = useAppNotices();
    show = showNotice;
    return <AppNoticeStack notices={notices} onDismiss={dismissNotice} onViewLogs={viewLogs} />;
  }

  try {
    await act(() => root.render(<Harness />));
    await act(() => {
      show("读取失败", { level: "error", logEntryId: "file-7" });
      show("音色回退", { level: "warn" });
      show("提示一");
      show("提示二");
      show("提示三");
    });
    expect(container.querySelectorAll(".app-notice")).toHaveLength(3);
    expect(container.textContent).toContain("读取失败");
    expect(container.textContent).toContain("音色回退");
    expect(container.textContent).toContain("提示三");
    await act(() => { vi.advanceTimersByTime(3500); });
    expect(container.querySelectorAll(".app-notice")).toHaveLength(2);
    await act(() => { vi.advanceTimersByTime(1500); });
    expect(container.querySelectorAll(".app-notice")).toHaveLength(1);
    const view = container.querySelector<HTMLButtonElement>(".app-notice button")!;
    expect(view.textContent).toBe("查看日志");
    await act(() => view.click());
    expect(viewLogs).toHaveBeenCalledWith("file-7");
    expect(container.querySelector(".app-notice")).toBeNull();

    await act(() => show("保存完成", { level: "success" }));
    await act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭通知"]')!.click());
    expect(container.querySelector(".app-notice")).toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
