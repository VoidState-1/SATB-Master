// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as harmonization from "../../domain/harmony/harmonization";
import { checkHarmony } from "../../domain/harmony/registry";
import { createEmptyProject, type ProjectDocument } from "../../domain/project";
import { compileScoreText } from "../../domain/scoreText";
import { AutoHarmonizationDialog } from "./AutoHarmonizationDialog";

function exercise(voice: "S" | "B" = "S") {
  const bars = voice === "S"
    ? "| E4/4 G4/4 F4/4 B4/4 | C5/1 |"
    : "| C3/4 E3/4 F3/4 G2/4 | C3/1 |";
  return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
S: ${voice === "S" ? bars : "empty"}
A: empty
T: empty
B: ${voice === "B" ? bars : "empty"}
}
`).project;
}

describe("自动和声弹窗", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // jsdom 没有实现原生对话框的打开和关闭。
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount(project: ProjectDocument, props: Partial<React.ComponentProps<typeof AutoHarmonizationDialog>> = {}) {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const onAudition = vi.fn<React.ComponentProps<typeof AutoHarmonizationDialog>["onAudition"]>()
      .mockResolvedValue(undefined);
    act(() => root.render(
      <AutoHarmonizationDialog
        project={project}
        playheadTick={0}
        selectedNoteIds={new Set()}
        selectedChordIds={new Set()}
        onApply={onApply}
        onClose={onClose}
        onAudition={onAudition}
        {...props}
      />,
    ));
    return { onApply, onClose, onAudition };
  }

  function button(label: string) {
    const match = [...host.querySelectorAll("button")].find(node =>
      node.textContent === label || node.getAttribute("aria-label") === label,
    );
    if (!match) throw new Error(`未找到按钮 ${label}`);
    return match;
  }

  function click(element: HTMLElement) {
    act(() => element.click());
  }

  function checkbox(label: string) {
    const match = [...host.querySelectorAll("label")].find(node => node.textContent === label);
    const input = match?.querySelector("input");
    if (!input) throw new Error(`未找到复选框 ${label}`);
    return input;
  }

  it.each([
    ["S", "soprano", "S 轨 5 个音符 · B 轨 0 个音符"],
    ["B", "bass", "S 轨 0 个音符 · B 轨 5 个音符"],
  ] as const)("按 %s 轨音符侦测给定声部并显示音符数量", (voice, expected, counts) => {
    mount(exercise(voice));
    const [givenVoice, range, style] = host.querySelectorAll("select");
    expect(givenVoice.value).toBe(expected);
    expect(range.value).toBe("project");
    expect(range.querySelector('[value="selection"]')).toBeNull();
    expect(style.value).toBe("textbook-standard");
    expect(host.textContent).toContain(counts);
    expect(document.activeElement).toBe(givenVoice);
  });

  it.each([true, false])("将锁定开关 %s 透传给求解器和原子写回回调", respectLockedConstraints => {
    const generate = vi.spyOn(harmonization, "autoHarmonize");
    const { onApply } = mount(exercise());
    const locked = checkbox("保留并围绕已锁定的和弦与音符生成");
    expect(locked.checked).toBe(true);
    expect(checkbox("识别弱拍经过音与辅助音").checked).toBe(false);
    expect(checkbox("同步写入和弦轨").checked).toBe(true);
    expect(checkbox("同步写入乐句与终止式").checked).toBe(true);
    if (!respectLockedConstraints) click(locked);

    click(button("生成和声方案"));
    expect(generate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      givenVoice: "soprano", style: "textbook-standard", respectLockedConstraints,
      allowPassingAndNeighborMelodies: false,
    }));
    const result = generate.mock.results[0].value as harmonization.AutoHarmonizationResult;
    click(button("应用所选方案"));
    expect(onApply).toHaveBeenCalledWith(result.solutions[0], {
      respectLockedConstraints, writeChords: true, writePhrasesAndCadences: true,
    });
  });

  it("显示实际和声检查结果，切换方案时停止试听，并应用所选方案", () => {
    const generate = vi.spyOn(harmonization, "autoHarmonize");
    const project = exercise();
    const before = structuredClone(project);
    const { onApply, onAudition } = mount(project);
    click(checkbox("同步写入和弦轨"));
    click(checkbox("同步写入乐句与终止式"));
    click(button("生成和声方案"));

    const result = generate.mock.results[0].value as harmonization.AutoHarmonizationResult;
    const cards = [...host.querySelectorAll("article")];
    expect(cards).toHaveLength(result.solutions.length);
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.length).toBeLessThanOrEqual(3);
    expect(cards[0].textContent).toContain("0 错误");
    expect(cards[0].textContent).toContain("全终止");
    expect(cards[0].querySelector(".auto-harmonization-summary dd")?.textContent).toContain("→");
    expect(host.textContent).toContain("生成耗时");
    for (const [index, solution] of result.solutions.entries()) {
      const { diagnostics } = checkHarmony(solution.project);
      const errors = diagnostics.filter(item => item.severity === "error").length;
      const warnings = diagnostics.filter(item => item.severity === "warning").length;
      expect(cards[index].textContent).toContain(solution.label);
      expect(cards[index].textContent).toContain(`${errors} 错误 · ${warnings} 警告`);
    }

    const [first, second] = host.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const auditionButtons = cards.map(card => card.querySelector("button")!);
    expect(first.checked).toBe(true);
    click(auditionButtons[0]);
    expect(cards[0].dataset.playing).toBe("true");
    expect(auditionButtons[0].textContent).toBe("停止");
    const [firstCandidate, firstSignal] = onAudition.mock.calls[0];
    expect(firstCandidate.project).toBe(result.solutions[0].project);

    click(second);
    expect(second.checked).toBe(true);
    expect(first.checked).toBe(false);
    expect(firstSignal.aborted).toBe(true);
    expect(auditionButtons[0].textContent).toBe("试听");

    click(auditionButtons[1]);
    const [, secondSignal, secondEnded] = onAudition.mock.calls[1];
    act(() => secondEnded());
    expect(auditionButtons[1].textContent).toBe("试听");
    expect(secondSignal.aborted).toBe(false);

    click(auditionButtons[1]);
    const [, thirdSignal] = onAudition.mock.calls[2];
    click(auditionButtons[1]);
    expect(thirdSignal.aborted).toBe(true);

    click(auditionButtons[1]);
    const [, fourthSignal] = onAudition.mock.calls[3];
    click(button("应用所选方案"));
    expect(fourthSignal.aborted).toBe(true);
    expect(onApply).toHaveBeenCalledExactlyOnceWith(result.solutions[1], {
      writeChords: false, writePhrasesAndCadences: false, respectLockedConstraints: true,
    });
    expect(project).toEqual(before);
  });

  it("返回调整时停止试听并保留参数，原生 Escape 取消时停止试听", () => {
    const project = exercise();
    const { onClose, onAudition } = mount(project, {
      selectedNoteIds: new Set([project.satbTracks[0].notes[0].id]),
    });
    expect(host.querySelector('option[value="selection"]')).not.toBeNull();
    click(checkbox("识别弱拍经过音与辅助音"));
    click(button("生成和声方案"));
    click(host.querySelector("article button")!);
    click(button("返回修改"));
    expect(onAudition.mock.calls[0][1].aborted).toBe(true);
    expect(checkbox("识别弱拍经过音与辅助音").checked).toBe(true);

    click(button("生成和声方案"));
    click(host.querySelector("article button")!);
    const dialog = host.querySelector("dialog")!;
    act(() => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(onAudition.mock.calls[1][1].aborted).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["selection", "current-measure"] as const)("生成时使用 %s 的半开范围", rangeMode => {
    const generate = vi.spyOn(harmonization, "autoHarmonize");
    const project = exercise();
    const note = project.satbTracks[0].notes[1];
    mount(project, { playheadTick: 4 * project.ppq, selectedNoteIds: new Set([note.id]) });
    const range = host.querySelectorAll("select")[1];
    act(() => {
      range.value = rangeMode;
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button("生成和声方案"));
    const bounds = rangeMode === "selection"
      ? { fromTick: note.startTick, toTick: note.startTick + note.durationTicks }
      : { fromTick: 4 * project.ppq, toTick: 8 * project.ppq };
    expect(generate).toHaveBeenCalledWith(project, expect.objectContaining(bounds));
  });

  it("在高音轨和低音轨为空时说明如何开始并禁止生成", () => {
    const generate = vi.spyOn(harmonization, "autoHarmonize");
    mount(createEmptyProject());
    expect(host.querySelector('[role="status"]')?.textContent).toContain("请先录入高音或低音题");
    expect(button("生成和声方案").disabled).toBe(true);
    click(button("生成和声方案"));
    expect(generate).not.toHaveBeenCalled();
  });
});

