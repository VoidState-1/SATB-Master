// @vitest-environment jsdom

import { writeMidi } from "midi-file";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChordRegion, defaultChordDraftAtTick } from "../../domain/chords";
import { addAuxiliaryTrack } from "../../domain/editing";
import { toMidiString } from "../../domain/midi";
import { parseMidiForImport } from "../../domain/midiImport";
import { createEmptyProject, PPQ, type NoteEvent } from "../../domain/project";
import { MidiImportDialog } from "./MidiImportDialog";

const parsed = parseMidiForImport(Uint8Array.from(writeMidi({
  header: { format: 0, numTracks: 1, ticksPerBeat: PPQ },
  tracks: [[
    { type: "trackName", deltaTime: 0, text: toMidiString("练习") },
    { type: "setTempo", deltaTime: 0, microsecondsPerBeat: 500_000 },
    { type: "timeSignature", deltaTime: 0, numerator: 3, denominator: 4, metronome: 24, thirtyseconds: 8 },
    { type: "keySignature", deltaTime: 0, key: 1, scale: 0 },
    { type: "noteOn", deltaTime: 0, channel: 0, noteNumber: 60, velocity: 80 },
    { type: "noteOn", deltaTime: 0, channel: 0, noteNumber: 79, velocity: 80 },
    { type: "noteOn", deltaTime: 0, channel: 9, noteNumber: 36, velocity: 80 },
    { type: "noteOff", deltaTime: PPQ, channel: 0, noteNumber: 60, velocity: 0 },
    { type: "noteOff", deltaTime: 0, channel: 0, noteNumber: 79, velocity: 0 },
    { type: "endOfTrack", deltaTime: 0 },
  ]],
})), "练习.mid");

describe("MIDI 导入确认弹窗", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();
  const onConfirm = vi.fn();

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

  function render(project = createEmptyProject(), file = parsed) {
    act(() => root.render(
      <MidiImportDialog
        parsed={file}
        project={project}
        playheadTick={5 * PPQ}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    ));
  }

  function dialog() {
    return document.querySelector<HTMLElement>('[role="dialog"]')!;
  }

  function button(name: string) {
    return [...dialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((element) => element.textContent?.trim() === name);
  }

  function input(label: string) {
    const element = [...dialog().querySelectorAll<HTMLLabelElement>("label")]
      .find((element) => element.textContent?.trim().startsWith(label));
    return element!.control as HTMLInputElement;
  }

  function selection() {
    return [...dialog().querySelectorAll<HTMLInputElement>(".midi-import-track-list input")]
      .map((element) => element.checked);
  }

  it("显示源文件摘要、复音音域、打击乐通道和解析提示", () => {
    render();
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(dialog().querySelector(".midi-import-summary")?.textContent).toEqual(
      expect.stringMatching(/练习\.mid.*1 条源轨道.*3 个音符.*初始速度 120 BPM.*初始拍号 3\/4.*初始调号 G 大调/),
    );
    const rows = [...dialog().querySelectorAll(".midi-import-track-row")].map((row) => row.textContent);
    expect(rows[0]).toMatch(/练习.*2 个音符.*C4–G5.*复音/);
    expect(rows[1]).toContain("打击乐 (Ch 10)");
    expect(dialog().querySelector("summary")?.textContent).toBe("1 条 MIDI 解析提示");
    expect(dialog().querySelector("details li")?.textContent).toContain("已补齐 1 个未闭合音符");
    expect(selection()).toEqual([true, false]);
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe("已选 1/2 轨 · 2 个音符");
  });

  it("支持全选、仅旋律轨、取消全选和逐轨选择", () => {
    render();
    act(() => button("全选")!.click());
    expect(selection()).toEqual([true, true]);
    act(() => button("仅旋律轨")!.click());
    expect(selection()).toEqual([true, false]);
    act(() => button("取消全选")!.click());
    expect(selection()).toEqual([false, false]);
    const submit = button("导入为额外声部（0 轨）")!;
    expect(submit.disabled).toBe(true);
    act(() => submit.click());
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => input("练习 (Ch 10").click());
    expect(selection()).toEqual([false, true]);
  });

  it("纯打击乐文件默认全选且不显示仅旋律轨快捷操作", () => {
    render(createEmptyProject(), { ...parsed, tracks: parsed.tracks.filter((track) => track.isPercussion) });
    expect(selection()).toEqual([true]);
    expect(button("仅旋律轨")).toBeUndefined();
  });

  it("空工程即使已有空的额外声部，也默认应用时间事件并从工程起点插入", () => {
    render(addAuxiliaryTrack(createEmptyProject()).project);
    expect(input("应用 MIDI 的速度、拍号与调号").checked).toBe(true);
    expect(input("从工程起点").checked).toBe(true);
    expect(input("同时在五线谱预览中显示").checked).toBe(false);
    act(() => button("导入为额外声部（1 轨）")!.click());
    expect(onConfirm).toHaveBeenCalledWith({
      selectedTrackKeys: [parsed.tracks[0].key],
      applyTimingEvents: true,
      showInScorePreview: false,
      startTickOffset: 0,
    });
  });

  it.each(["SATB 音符", "额外声部音符", "和弦区域"] as const)(
    "工程已有%s时默认关闭时间线同步",
    (content) => {
      const empty = createEmptyProject();
      const project = content === "额外声部音符" ? addAuxiliaryTrack(empty).project : empty;
      const note: NoteEvent = {
        id: "existing-note",
        startTick: 0,
        durationTicks: PPQ,
        pitch: { step: "C", alter: 0, octave: 4 },
        velocity: 80,
        locked: false,
        spellingSource: "manual",
      };
      if (content === "SATB 音符") project.satbTracks[0].notes.push(note);
      if (content === "额外声部音符") project.auxiliaryTracks[0].notes.push(note);
      if (content === "和弦区域") {
        project.chordTrack.regions.push(createChordRegion(project, 0, PPQ, defaultChordDraftAtTick(project, 0), "existing-chord"));
      }

      render(project);
      expect(input("应用 MIDI 的速度、拍号与调号").checked).toBe(false);
    },
  );

  it("确认时传入勾选的轨道、时间线、五线谱预览和播放头偏移", () => {
    render();
    const atPlayhead = input("从当前播放头位置");
    expect(atPlayhead.closest("label")?.textContent).toContain("2:2:000");
    act(() => {
      button("全选")!.click();
      atPlayhead.click();
      input("应用 MIDI 的速度、拍号与调号").click();
      input("同时在五线谱预览中显示").click();
    });
    expect(input("从工程起点").checked).toBe(false);
    act(() => button("导入为额外声部（2 轨）")!.click());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith({
      selectedTrackKeys: parsed.tracks.map(({ key }) => key),
      applyTimingEvents: false,
      showInScorePreview: true,
      startTickOffset: 5 * PPQ,
    });
  });

  it("支持 Escape 和点击遮罩关闭，弹窗内部的点击不关闭", () => {
    render();
    act(() => dialog().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    act(() => dialog().parentElement!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
