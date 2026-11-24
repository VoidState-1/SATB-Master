// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAuxiliaryTrack, updateTrack } from "../../domain/editing";
import { AUXILIARY_COLOR_PALETTE, createEmptyProject, VOICE_ORDER } from "../../domain/project";
import { TrackSidebar } from "./TrackSidebar";

describe("TrackSidebar 额外声部", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onSetActive = vi.fn();
  const onUpdateTrack = vi.fn();
  const onAddAuxiliaryTrack = vi.fn();
  const onDeleteAuxiliaryTrack = vi.fn();
  const name = "额外声部 1";

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function render(project = createEmptyProject(), activeVoice = "soprano") {
    act(() => root.render(
      <TrackSidebar
        project={project}
        activeVoice={activeVoice}
        onSetActive={onSetActive}
        onUpdateTrack={onUpdateTrack}
        onAddAuxiliaryTrack={onAddAuxiliaryTrack}
        onDeleteAuxiliaryTrack={onDeleteAuxiliaryTrack}
      />,
    ));
  }

  function button(label: string, container: ParentNode = host) {
    return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  }

  function setInput(input: HTMLInputElement, value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("保留四个固定声部并提供额外声部添加入口", () => {
    render();
    expect(host.querySelectorAll(".voice-track")).toHaveLength(VOICE_ORDER.length);
    expect(host.querySelector(".auxiliary-track-count")?.textContent).toBe("0");
    expect(host.querySelector(".auxiliary-track-empty")?.textContent).toContain("自由复音");
    act(() => button("添加额外声部").click());
    expect(onAddAuxiliaryTrack).toHaveBeenCalledWith();
    expect(button("赞助作者")).toBeTruthy();

    const { project, trackId } = addAuxiliaryTrack(createEmptyProject());
    render(project, trackId);
    const track = host.querySelector<HTMLElement>(".auxiliary-track")!;
    expect(host.querySelectorAll(".voice-track")).toHaveLength(5);
    expect(track.textContent).toContain("E1");
    expect(track.textContent).toContain("自由复音 · 0 音符");
    expect(track.style.getPropertyValue("--voice-color")).toBe(AUXILIARY_COLOR_PALETTE[0]);
    expect(host.querySelector(".auxiliary-track-count")?.textContent).toBe("1");
    expect(host.querySelector(".sidebar-footnote")?.textContent).toBe(`当前输入：${name}`);
    act(() => track.querySelector<HTMLButtonElement>(".auxiliary-track-name")!.click());
    expect(onSetActive).toHaveBeenCalledWith(trackId);
  });

  it("支持内联改名、快捷配色、取色和 Esc 取消", () => {
    const { project, trackId } = addAuxiliaryTrack(createEmptyProject());
    render(project, trackId);
    const edit = button(`编辑 ${name}`);
    act(() => edit.click());
    const form = host.querySelector<HTMLFormElement>(".auxiliary-track-edit")!;
    const nameInput = form.querySelector<HTMLInputElement>("input[required]")!;
    setInput(nameInput, "弦乐");
    act(() => button(`使用颜色 ${AUXILIARY_COLOR_PALETTE[1]}`, form).click());
    expect(form.querySelector<HTMLInputElement>('[type="color"]')?.value).toBe(AUXILIARY_COLOR_PALETTE[1]);
    act(() => nameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(onUpdateTrack).toHaveBeenLastCalledWith(trackId, {
      name: "弦乐",
      color: AUXILIARY_COLOR_PALETTE[1],
    });

    act(() => edit.click());
    const colorInput = host.querySelector<HTMLInputElement>('.auxiliary-track-edit [type="color"]')!;
    setInput(colorInput, "#224466");
    act(() => host.querySelector<HTMLButtonElement>('.auxiliary-track-edit button[type="submit"]')!.click());
    expect(onUpdateTrack).toHaveBeenLastCalledWith(trackId, { color: "#224466" });

    act(() => edit.click());
    const draftInput = host.querySelector<HTMLInputElement>(".auxiliary-track-edit input[required]")!;
    setInput(draftInput, "取消的名称");
    act(() => draftInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onUpdateTrack).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".auxiliary-track-edit")).toBeNull();
    expect(document.activeElement).toBe(edit);
  });

  it("提供混音、显隐、锁定控件并禁止删除已锁定的声部", () => {
    const { project, trackId } = addAuxiliaryTrack(createEmptyProject());
    render(project, trackId);
    const card = host.querySelector(".auxiliary-track")!;
    act(() => button("静音", card).click());
    act(() => button(`${name}独奏`, card).click());
    act(() => button("隐藏声部", card).click());
    act(() => button("锁定声部", card).click());
    const volume = card.querySelector<HTMLInputElement>('[type="range"]')!;
    expect([volume.min, volume.max]).toEqual(["0", "1"]);
    setInput(volume, "0.42");
    expect(onUpdateTrack.mock.calls).toEqual([
      [trackId, { muted: true }],
      [trackId, { solo: true }],
      [trackId, { visible: false }],
      [trackId, { locked: true }],
      [trackId, { volume: 0.42 }],
    ]);

    const deletion = button(`删除 ${name}`, card);
    act(() => deletion.click());
    expect(onDeleteAuxiliaryTrack).toHaveBeenCalledWith(trackId);
    render(updateTrack(project, trackId!, { locked: true }).project, trackId);
    expect(deletion.disabled).toBe(true);
    expect(deletion.title).toBe("请先解锁再删除");
    act(() => deletion.click());
    expect(onDeleteAuxiliaryTrack).toHaveBeenCalledTimes(1);
    act(() => button("解锁声部", card).click());
    expect(onUpdateTrack).toHaveBeenLastCalledWith(trackId, { locked: false });
  });
});
