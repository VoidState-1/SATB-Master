// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BottomPanel } from "./BottomPanel";
import { createEmptyProject } from "../../domain/project";
import type { HarmonyCheckResult, HarmonyDiagnostic } from "../../domain/harmony";

describe("BottomPanel", () => {
  const dummyProject = createEmptyProject();
  const mockDiagnostic: HarmonyDiagnostic = {
    id: "diag-1",
    ruleId: "parallel-fifths",
    source: "builtin",
    severity: "warning",
    tick: 0,
    endTick: 480,
    voiceIds: ["soprano", "bass"],
    noteIds: ["note-1", "note-2"],
    chordIds: [],
    title: "平行五度",
    message: "女高音与男低音形成平行五度",
    messageKey: "parallel_fifths",
    params: {},
    evidence: [],
    confidence: 1,
  };

  const mockHarmonyResult: HarmonyCheckResult = {
    diagnostics: [mockDiagnostic],
    skippedRules: [],
    skippedRuleIds: [],
    revision: 1,
    superseded: false,
    invalidationRanges: [],
  };

  const logTabMarkup = (props: { developerMode?: boolean; showLogs?: boolean; unreadLogErrors?: number } = {}) =>
    renderToStaticMarkup(
      <BottomPanel
        activeTab="diagnostics"
        onTabChange={vi.fn()}
        project={dummyProject}
        harmonyResult={mockHarmonyResult}
        onSelectDiagnostic={vi.fn()}
        onToggleIgnoredDiagnostic={vi.fn()}
        revision={1}
        playheadTick={0}
        {...props}
      />,
    );

  it("hides logs in ordinary mode until a session error or shortcut makes it available", () => {
    expect(logTabMarkup()).not.toContain(">日志<");
    expect(logTabMarkup({ showLogs: true })).toContain(">日志<");
    expect(logTabMarkup({ showLogs: true, unreadLogErrors: 2 }))
      .toContain('class="bottom-tab-badge error" aria-label="2 条未读错误">2<');
  });

  it("shows the developer log tab without an unread badge", () => {
    const html = logTabMarkup({ developerMode: true });
    expect(html).toContain(">日志<");
    expect(html).not.toContain("条未读错误");
  });

  it("renders tab headers with problem count badge", () => {
    const html = renderToStaticMarkup(
      <BottomPanel
        activeTab="diagnostics"
        onTabChange={vi.fn()}
        project={dummyProject}
        harmonyResult={mockHarmonyResult}
        onSelectDiagnostic={vi.fn()}
        onToggleIgnoredDiagnostic={vi.fn()}
        revision={1}
        playheadTick={0}
      />,
    );

    expect(html).toContain('class="bottom-panel"');
    expect(html).toContain("问题");
    expect(html).toContain("五线谱");
    expect(html).toContain('class="bottom-tab-badge warning"');
    expect(html).toContain(">1<");
    expect(html).toContain("平行五度");
  });

  it("switches to the permanent progression tab", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    const onTabChange = vi.fn();
    function TestPanel() {
      const [activeTab, setActiveTab] = useState<React.ComponentProps<typeof BottomPanel>["activeTab"]>("diagnostics");
      return <BottomPanel
        activeTab={activeTab}
        onTabChange={tab => { onTabChange(tab); setActiveTab(tab); }}
        project={dummyProject}
        harmonyResult={mockHarmonyResult}
        onSelectDiagnostic={vi.fn()}
        onToggleIgnoredDiagnostic={vi.fn()}
        revision={1}
        playheadTick={0}
        progression={{
          status: "ready", mode: "single", shortLength: 3, stepPreset: "beat",
          style: "textbook-standard", writeChords: true, onModeChange: vi.fn(),
          onShortLengthChange: vi.fn(), onStepPresetChange: vi.fn(), onStyleChange: vi.fn(),
          onWriteChordsChange: vi.fn(), onRefresh: vi.fn(), onHoverCandidate: vi.fn(),
          onAudition: vi.fn(), onStopAudition: vi.fn(), onApply: vi.fn(),
        }}
      />;
    }
    try {
      act(() => root.render(<TestPanel />));
      expect([...host.querySelectorAll('[role="tab"]')].map(tab => tab.textContent))
        .toEqual(["问题1", "五线谱", "和声连接"]);
      const tab = host.querySelector<HTMLButtonElement>("#bottom-progression-tab")!;
      act(() => tab.click());
      expect(onTabChange).toHaveBeenCalledWith("progression");
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(host.querySelector(".bottom-panel-context .progression-target")?.textContent).toContain("光标右侧暂无空位");
      expect(host.querySelector('[role="tabpanel"] .progression-target')).toBeNull();
      expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain("光标右侧暂无空位");
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("renders score tab controls when activeTab is score", () => {
    const html = renderToStaticMarkup(
      <BottomPanel
        activeTab="score"
        onTabChange={vi.fn()}
        project={dummyProject}
        harmonyResult={mockHarmonyResult}
        onSelectDiagnostic={vi.fn()}
        onToggleIgnoredDiagnostic={vi.fn()}
        revision={1}
        playheadTick={0}
      />,
    );

    expect(html).toContain('class="score-preview-pane"');
    expect(html).toContain("缩小谱面");
    expect(html).toContain("放大谱面");
    expect(html).toContain("跟随走带");
  });
});
