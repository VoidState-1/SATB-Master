// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchProgressionCandidates } from "../../domain/harmony/harmonization";
import { createEmptyProject } from "../../domain/project";
import { ProgressionAssistantPanel, type ProgressionAssistantPanelProps } from "./ProgressionAssistantPanel";

const project = createEmptyProject();
const fromTick = 9 * project.ppq;
const result = searchProgressionCandidates(project, { mode: "single", fromTick });
const candidate = result.candidates.find(item => item.variants.length > 1)!;
const partialResult = {
  ...result,
  slot: {
    ...result.slot!,
    kind: "partial" as const,
    fixedVoices: { soprano: { step: "E" as const, alter: 0 as const, octave: 5 } },
    leftAnchor: {
      fromTick: fromTick - project.ppq,
      toTick: fromTick,
      chordLabel: "V6",
      obligations: { heldMetricLevel: 0, bassDirection: 0 as const, sopranoHeldTicks: 0 },
    },
    rightAnchor: { fromTick: fromTick + project.ppq, toTick: fromTick + 2 * project.ppq },
  },
  candidates: [candidate],
};

describe("ProgressionAssistantPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function mount(overrides: Partial<ProgressionAssistantPanelProps> = {}) {
    const props: ProgressionAssistantPanelProps = {
      project, result: partialResult, status: "ready", mode: "single", shortLength: 3,
      stepPreset: "beat", style: "textbook-standard", writeChords: true,
      onModeChange: vi.fn(), onShortLengthChange: vi.fn(), onStepPresetChange: vi.fn(), onStyleChange: vi.fn(),
      onWriteChordsChange: vi.fn(), onRefresh: vi.fn(), onHoverCandidate: vi.fn(),
      onAudition: vi.fn(), onStopAudition: vi.fn(), onApply: vi.fn(), ...overrides,
    };
    const render = (patch: Partial<ProgressionAssistantPanelProps> = {}) =>
      act(() => root.render(<ProgressionAssistantPanel {...props} {...patch} />));
    render();
    return { props, render };
  }

  function button(label: string) {
    const element = [...host.querySelectorAll("button")].find(item =>
      item.textContent === label || item.getAttribute("aria-label") === label,
    );
    if (!element) throw new Error(`未找到按钮 ${label}`);
    return element;
  }

  function click(label: string) {
    act(() => button(label).click());
  }

  function changeSelect(label: string, value: string) {
    const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    act(() => {
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("shows slot, anchors, fixed voices, and the candidate's checked diagnostics", () => {
    const card = {
      ...candidate,
      variants: [{ ...candidate.variants[0], diagnosticSummary: { errorCount: 0, warningCount: 2, suggestionCount: 0 } }],
    };
    mount({ result: { ...partialResult, candidates: [card] } });
    for (const text of ["第 3 小节第 2 拍", "半空", "衔接 V6", "高音固定 E5", card.headline, "0 错误", "2 警告", "S:", "A:", "T:", "B:"]) {
      expect(host.textContent).toContain(text);
    }
  });

  it("wires the mode, bridge, step size, style, and refresh controls", () => {
    const { props, render } = mount();
    expect(button("单和弦").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="短连接步数"]')).toBeNull();
    click("短连接");
    expect(props.onModeChange).toHaveBeenCalledWith("short");
    render({ mode: "short" });
    expect(button("短连接").getAttribute("aria-pressed")).toBe("true");
    expect(button("桥接").classList.contains("can-bridge")).toBe(true);
    click("桥接");
    click("2 拍");
    expect(props.onShortLengthChange).toHaveBeenNthCalledWith(1, "bridge");
    expect(props.onShortLengthChange).toHaveBeenNthCalledWith(2, 2);
    click("单和弦");
    expect(props.onModeChange).toHaveBeenLastCalledWith("single");
    changeSelect("全空位默认步长", "half-bar");
    changeSelect("全空位默认步长", "grid");
    expect(props.onStepPresetChange).toHaveBeenNthCalledWith(1, "half-bar");
    expect(props.onStepPresetChange).toHaveBeenNthCalledWith(2, "grid");
    changeSelect("风格预设", "expressive-secondary");
    expect(props.onStyleChange).toHaveBeenCalledWith("expressive-secondary");
    click("刷新和声连接");
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });

  it("previews on hover and focus, clears on exit, and auditions or writes the chosen voicing", () => {
    const { props, render } = mount();
    const card = host.querySelector<HTMLElement>(".progression-card")!;
    act(() => card.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(props.onHoverCandidate).toHaveBeenLastCalledWith({ candidate, variantIndex: 0 });
    act(() => card.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    expect(props.onHoverCandidate).toHaveBeenLastCalledWith(undefined);
    act(() => card.focus());
    expect(props.onHoverCandidate).toHaveBeenLastCalledWith({ candidate, variantIndex: 0 });
    click(candidate.variants[1].label);
    expect(button(candidate.variants[1].label).getAttribute("aria-pressed")).toBe("true");
    expect(props.onHoverCandidate).toHaveBeenLastCalledWith({ candidate, variantIndex: 1 });
    click("试听");
    expect(props.onAudition).toHaveBeenLastCalledWith(candidate, 1);
    render({ auditioning: { candidate, variantIndex: 1 } });
    click(candidate.variants[0].label);
    expect(props.onAudition).toHaveBeenLastCalledWith(candidate, 0);
    click("停止");
    expect(props.onStopAudition).toHaveBeenCalledOnce();
    const writeChords = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(writeChords.checked).toBe(true);
    act(() => writeChords.click());
    expect(props.onWriteChordsChange).toHaveBeenCalledWith(false);
    render({ writeChords: false });
    click(candidate.variants[1].label);
    click("采纳");
    expect(props.onApply).toHaveBeenCalledWith(candidate, 1, { writeChords: false });
  });

  it("shows the no-slot state", () => {
    mount({ result: { candidates: [], warnings: [], elapsedMs: 0 } });
    expect(host.textContent).toContain("光标右侧暂无空位");
    expect(host.querySelector(".progression-card")).toBeNull();
  });

  it("keeps candidates visible without flicker while refreshing and renders recommendation tier", () => {
    mount({ status: "searching", isRefreshing: true });
    expect(host.querySelector('.progression-body[data-refreshing="true"]')).not.toBeNull();
    expect(host.querySelector(".progression-progress-rail")).not.toBeNull();
    const row = host.querySelector<HTMLElement>(".progression-card")!;
    expect(["high", "medium", "low"]).toContain(row.dataset.tier);
  });

  it("groups candidates by attribute category and allows filtering", () => {
    mount({ result });
    expect(host.querySelector(".progression-table-head")).toBeNull();
    const filterGroup = host.querySelector('[aria-label="按属性筛选"]')!;
    const buttons = [...filterGroup.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(1);
    act(() => buttons[1]!.click());
    expect(buttons[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll(".progression-card").length).toBeLessThan(result.candidates.length);
    act(() => buttons[0]!.click());
    expect(host.querySelectorAll(".progression-card").length).toBe(result.candidates.length);
  });

  it("immediately switches top category tags when changing from single to short during refresh", () => {
    const { render } = mount({ result, mode: "single" });
    render({ mode: "short", isRefreshing: true, status: "searching" });
    const filterText = host.querySelector('[aria-label="按属性筛选"]')?.textContent ?? "";
    expect(filterText).toContain("终止与收束");
    expect(filterText).toContain("平稳推进");
    expect(filterText).toContain("桥接与经过");
  });

  it("auditions a candidate row on double click", () => {
    const { props } = mount();
    const titleCell = host.querySelector<HTMLElement>(".progression-card .progression-card-title")!;
    act(() => titleCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(props.onAudition).toHaveBeenCalledWith(candidate, 0);
  });

  it("places category filters inside the unified toolbar without legend and keeps audition running on hover", () => {
    const other = result.candidates.find(item => item.id !== candidate.id) ?? candidate;
    const { props } = mount({
      result,
      auditioning: { candidate, variantIndex: 0 },
    });
    expect(host.querySelector(".progression-legend")).toBeNull();
    expect(host.querySelector(".progression-toolbar .progression-category-filters")).not.toBeNull();
    expect(host.querySelector(".progression-toolbar .progression-controls")).not.toBeNull();
    const cards = [...host.querySelectorAll<HTMLElement>(".progression-card")];
    const targetCard = cards.find(el => el.getAttribute("aria-label")?.includes(other.headline)) ?? cards[0]!;
    act(() => targetCard.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(props.onStopAudition).not.toHaveBeenCalled();
  });
});
