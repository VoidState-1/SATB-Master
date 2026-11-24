// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAuxiliaryTrack } from "../../domain/editing";
import { createEmptyProject, PPQ } from "../../domain/project";
import { ExportDialog } from "./ExportDialog";

const MIDI_STORAGE_KEY = "satb_master_midi_export_options";
const MUSICXML_STORAGE_KEY = "satb_master_musicxml_export_options";

function projectWithAuxiliaryTracks() {
  const first = addAuxiliaryTrack(createEmptyProject(), {
    name: "长笛",
    color: "#6677aa",
  });
  const { project } = addAuxiliaryTrack(first.project, {
    name: "大提琴",
    showInScorePreview: true,
  });
  project.auxiliaryTracks[0].notes.push({
    id: "flute-note",
    startTick: 0,
    durationTicks: PPQ,
    pitch: { step: "C", alter: 0, octave: 5 },
    velocity: 80,
    locked: false,
    spellingSource: "manual",
  });
  return project;
}

describe("导出弹窗额外声部", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onExportMidi = vi.fn();
  const onExportMusicXml = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  function render(project = createEmptyProject()) {
    act(() => root.render(
      <ExportDialog
        project={project}
        onClose={onClose}
        onExportMidi={onExportMidi}
        onExportMusicXml={onExportMusicXml}
      />,
    ));
  }

  function button(name: string) {
    const element = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent?.trim() === name);
    expect(element).toBeDefined();
    return element!;
  }

  function click(name: string) {
    act(() => button(name).click());
  }

  function includeCheckbox() {
    return document.querySelector<HTMLInputElement>('section[aria-labelledby="export-auxiliary-title"] .export-auxiliary-controls input')!;
  }

  function rows() {
    return Array.from(document.querySelectorAll<HTMLLabelElement>(".export-auxiliary-row"));
  }

  function trackCheckboxes() {
    return rows().map((row) => row.querySelector<HTMLInputElement>("input")!);
  }

  it("工程没有额外声部时，两种格式均隐藏配置区", () => {
    render();
    expect(includeCheckbox()).toBeNull();
    click("MIDI 序列 (.mid)");
    expect(includeCheckbox()).toBeNull();
  });

  it("MusicXML 默认全选，支持逐轨筛选并传递轨道 ID", () => {
    const project = projectWithAuxiliaryTracks();
    localStorage.setItem(MUSICXML_STORAGE_KEY, '{"layout":"single-staff","includeChords":false}');
    render(project);
    expect(includeCheckbox().checked).toBe(true);
    expect(rows().map((row) => row.textContent)).toEqual(["长笛1 个音符", "大提琴0 个音符"]);
    expect(rows()[0].querySelector<HTMLElement>(".export-auxiliary-swatch")?.style.backgroundColor)
      .toBe("rgb(102, 119, 170)");
    expect(trackCheckboxes().map((input) => input.checked)).toEqual([true, true]);
    expect(button("全选").disabled).toBe(true);

    click("取消全选");
    expect(trackCheckboxes().map((input) => input.checked)).toEqual([false, false]);
    expect(button("取消全选").disabled).toBe(true);
    click("全选");
    expect(trackCheckboxes().map((input) => input.checked)).toEqual([true, true]);
    act(() => trackCheckboxes()[0].click());
    click("导出 MusicXML 乐谱");
    expect(onExportMusicXml).toHaveBeenCalledWith({
      layout: "single-staff",
      includeChords: false,
      includeRomanNumerals: true,
      includeAuxiliaryTracks: true,
      auxiliaryTrackIds: [project.auxiliaryTracks[1].id],
    });
    expect(onExportMidi).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(MUSICXML_STORAGE_KEY)!))
      .not.toHaveProperty("auxiliaryTrackIds");
  });

  it("MIDI 逐轨选择独立于 MusicXML，空白名单按关闭提交", () => {
    const project = projectWithAuxiliaryTracks();
    localStorage.setItem(MIDI_STORAGE_KEY, '{"layout":"single-track","timbre":"choir"}');
    render(project);
    act(() => trackCheckboxes()[0].click());
    click("MIDI 序列 (.mid)");
    expect(includeCheckbox().checked).toBe(true);
    expect(trackCheckboxes().map((input) => input.checked)).toEqual([true, true]);

    click("取消全选");
    click("全选");
    act(() => trackCheckboxes()[1].click());
    click("导出 MIDI");
    expect(onExportMidi).toHaveBeenLastCalledWith({
      layout: "single-track",
      timbre: "choir",
      includeChords: true,
      includeAuxiliaryTracks: true,
      auxiliaryTrackIds: [project.auxiliaryTracks[0].id],
    });

    click("取消全选");
    click("导出 MIDI");
    expect(onExportMidi).toHaveBeenLastCalledWith(expect.objectContaining({
      includeAuxiliaryTracks: false,
      auxiliaryTrackIds: [],
    }));
    expect(JSON.parse(localStorage.getItem(MIDI_STORAGE_KEY)!))
      .toHaveProperty("includeAuxiliaryTracks", true);
    click("MusicXML 乐谱 (.musicxml)");
    expect(trackCheckboxes().map((input) => input.checked)).toEqual([false, true]);
    expect(onExportMusicXml).not.toHaveBeenCalled();
  });

  it("分别记忆两种格式的总开关，每次重新打开默认勾选全部轨道", () => {
    const project = projectWithAuxiliaryTracks();
    render(project);

    act(() => includeCheckbox().click());
    expect(rows()).toHaveLength(0);
    click("导出 MusicXML 乐谱");
    expect(onExportMusicXml).toHaveBeenCalledWith(expect.objectContaining({
      includeAuxiliaryTracks: false,
      auxiliaryTrackIds: [],
    }));

    click("MIDI 序列 (.mid)");
    expect(includeCheckbox().checked).toBe(true);
    act(() => includeCheckbox().click());
    expect(rows()).toHaveLength(0);
    click("导出 MIDI");
    expect(onExportMidi).toHaveBeenLastCalledWith(expect.objectContaining({
      includeAuxiliaryTracks: false,
      auxiliaryTrackIds: [],
    }));

    act(() => root.render(null));
    render(project);
    expect(includeCheckbox().checked).toBe(false);
    act(() => includeCheckbox().click());
    expect(trackCheckboxes().map((input) => input.checked)).toEqual([true, true]);
    click("MusicXML 乐谱 (.musicxml)");
    expect(includeCheckbox().checked).toBe(false);
    act(() => includeCheckbox().click());
    expect(trackCheckboxes().map((input) => input.checked)).toEqual([true, true]);
  });
});
