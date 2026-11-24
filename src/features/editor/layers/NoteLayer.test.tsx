// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { planAutoBrushNote } from "../../../domain/autoBrush";
import { addAuxiliaryTrack, addNote } from "../../../domain/editing";
import { formatSpelledPitch, spellMidi, toMidi } from "../../../domain/pitch";
import { createEmptyProject, getSatbTrack, type NoteEvent, type VoiceId } from "../../../domain/project";
import type { HarmonyDiagnostic } from "../../../domain/harmony";
import { THEME_CHANGE_EVENT } from "../../../hooks/useTheme";
import { NoteLayer } from "./NoteLayer";
import { midiToY, ROW_HEIGHT, tickToX } from "../viewport";

describe("NoteLayer progression preview", () => {
  it("positions the non-interactive slot and ghost with the roll coordinate system", () => {
    const project = createEmptyProject();
    const ppq = project.ppq;
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <NoteLayer
        scrollRef={{ current: null }}
        viewportSize={{ width: 800, height: 300 }}
        project={project}
        measures={[]}
        pixelsPerBeat={80}
        rollHeight={2816}
        totalWidth={1000}
        totalHeight={2904}
        activeVoice="soprano"
        selectedNoteIds={new Set()}
        diagnosticsByNote={new Map()}
        noteRects={[]}
        tool="select"
        progressionPreview={{
          slotRange: { fromTick: ppq, toTick: 3 * ppq },
          ghostNotes: [{
            id: "ghost", voice: "soprano", startTick: 2 * ppq, durationTicks: ppq / 2,
            pitch: { step: "E", alter: 0, octave: 5 },
          }],
        }}
        onPointerDown={vi.fn()}
        onPointerMove={vi.fn()}
        onPointerUp={vi.fn()}
        onPointerCancel={vi.fn()}
        onPointerLeave={vi.fn()}
        onDoubleClick={vi.fn()}
      />,
    );
    const overlay = host.querySelector<HTMLElement>(".roll-progression-preview")!;
    expect(overlay.style.pointerEvents).toBe("none");
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    const slot = overlay.querySelector<HTMLElement>(".roll-progression-slot")!;
    expect([slot.style.left, slot.style.top, slot.style.width, slot.style.height])
      .toEqual(["138px", "88px", "160px", "2816px"]);
    const ghost = overlay.querySelector<HTMLElement>(".roll-progression-note")!;
    expect([ghost.style.left, ghost.style.top, ghost.style.width, ghost.style.height])
      .toEqual(["218px", "1212px", "39px", "18px"]);
    expect(ghost.textContent).toBe("E5");
    expect(host.querySelector(".roll-canvas")).not.toBeNull();
  });
});

it("绘制额外声部自定义颜色、选中描边和锁定标记，并使用相同颜色预览新音符", () => {
  const added = addAuxiliaryTrack(createEmptyProject(), { color: "#224466" });
  const note: NoteEvent = {
    id: "aux-note",
    startTick: 0,
    durationTicks: added.project.ppq,
    pitch: { step: "C", alter: 0, octave: 4 },
    velocity: 88,
    locked: true,
    spellingSource: "manual",
  };
  const { project } = addNote(added.project, added.trackId!, note);
  const track = project.auxiliaryTracks[0];
  const x = tickToX(0, project.ppq, 80);
  const y = midiToY(60) + 2;
  const width = 79;
  const height = ROW_HEIGHT - 4;
  const fill = vi.fn();
  const fillRect = vi.fn();
  const stroke = vi.fn();
  const fillText = vi.fn();
  const drawing = {
    fillStyle: "",
    strokeStyle: "",
    fill() { fill(this.fillStyle); },
    fillRect(...rect: number[]) { fillRect(this.fillStyle, ...rect); },
    fillText,
    stroke() { stroke(this.strokeStyle); },
    roundRect: vi.fn(),
  };
  const noop = () => {};
  const context = new Proxy(drawing, {
    get(target, key) {
      return Reflect.get(target, key) ?? noop;
    },
  });
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const scroll = document.createElement("div");
  scroll.scrollTop = y - 50;
  const root = createRoot(host);
  try {
    act(() => root.render(
      <NoteLayer
        scrollRef={{ current: scroll }}
        viewportSize={{ width: 800, height: 300 }}
        project={project}
        measures={[]}
        pixelsPerBeat={80}
        rollHeight={2816}
        totalWidth={1000}
        totalHeight={2904}
        activeVoice={track.id}
        selectedNoteIds={new Set([note.id])}
        diagnosticsByNote={new Map([[note.id, [{ severity: "error" } as HarmonyDiagnostic]]])}
        missingExpectedNoteIds={new Set([note.id])}
        noteRects={[{ track, note, midiNote: 60, label: "C4", x, y, width, height }]}
        tool="pencil"
        interaction={{
          kind: "draw", voiceId: track.id, midiNote: 64,
          originRawTick: project.ppq, nextStartTick: project.ppq,
          nextDurationTicks: project.ppq,
        }}
        onPointerDown={noop}
        onPointerMove={noop}
        onPointerUp={noop}
        onPointerCancel={noop}
        onPointerLeave={noop}
        onDoubleClick={noop}
      />,
    ));
    expect(drawing.roundRect).toHaveBeenCalledWith(x, y, width, height, 3);
    expect(fill).toHaveBeenCalledWith("#224466");
    expect(stroke).toHaveBeenLastCalledWith("#171914");
    expect(fillText).toHaveBeenCalledWith("锁", x + width - 15, y + 12);
    expect(fillRect).toHaveBeenCalledWith("#22446670", x + 80, midiToY(64) + 2, width, height);
    expect(fillRect.mock.calls.some(([, left, top, w, h]) =>
      left === x && top === y + height - 3 && w === width && h === 3,
    )).toBe(false);
  } finally {
    act(() => root.unmount());
    getContext.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("自动笔刷预览随主题更新目标声部和换轨颜色，四声部已满时显示危险色虚线", () => {
  const project = createEmptyProject();
  const draft = { startTick: 0, durationTicks: project.ppq, pitch: spellMidi(72) };
  const put = (voice: VoiceId, midi: number) => {
    const track = getSatbTrack(project, voice);
    const note: NoteEvent = {
      ...draft, id: voice, pitch: spellMidi(midi),
      velocity: 88, locked: false, spellingSource: "manual",
    };
    track.notes.push(note);
    return {
      track, note, midiNote: midi, label: formatSpelledPitch(note.pitch),
      x: tickToX(0, project.ppq, 80), y: midiToY(midi) + 2, width: 79, height: ROW_HEIGHT - 4,
    };
  };
  const noteRects = [put("soprano", 67), put("alto", 64)];
  const fill = vi.fn();
  const fillRect = vi.fn();
  const stroke = vi.fn();
  const strokeRect = vi.fn();
  const fillText = vi.fn();
  const setLineDash = vi.fn();
  const drawing = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    fill() { fill(this.fillStyle); },
    fillRect(...rect: number[]) { fillRect(this.fillStyle, this.globalAlpha, ...rect); },
    stroke() { stroke(this.strokeStyle); },
    strokeRect(...rect: number[]) { strokeRect(this.strokeStyle, this.globalAlpha, ...rect); },
    fillText,
    setLineDash,
    measureText: () => ({ width: 35 }),
  };
  const noop = () => {};
  const context = new Proxy(drawing, {
    get: (target, key) => Reflect.get(target, key) ?? noop,
  });
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const scroll = document.createElement("div");
  const x = noteRects[0].x;
  const y = midiToY(toMidi(draft.pitch)) + 2;
  scroll.scrollTop = y - 50;
  const rootStyle = document.documentElement.style;
  const previousStyle = document.documentElement.getAttribute("style");

  const render = () => act(() => root.render(
    <NoteLayer
      scrollRef={{ current: scroll }}
      viewportSize={{ width: 800, height: 300 }}
      project={project}
      measures={[]}
      pixelsPerBeat={80}
      rollHeight={2816}
      totalWidth={1000}
      totalHeight={2904}
      activeVoice="soprano"
      selectedNoteIds={new Set()}
      diagnosticsByNote={new Map()}
      noteRects={noteRects}
      tool="auto-brush"
      interaction={{
        kind: "draw", mode: "auto-brush", midiNote: toMidi(draft.pitch),
        originRawTick: 0, nextStartTick: 0, nextDurationTicks: project.ppq,
      }}
      autoBrushPreview={planAutoBrushNote(project, draft)}
      onPointerDown={noop}
      onPointerMove={noop}
      onPointerUp={noop}
      onPointerCancel={noop}
      onPointerLeave={noop}
      onDoubleClick={noop}
    />,
  ));

  try {
    rootStyle.setProperty("--voice-s", "#7552a3");
    rootStyle.setProperty("--voice-a", "#2d7a68");
    rootStyle.setProperty("--voice-t", "#3f6fa8");
    render();
    expect(fill.mock.calls).toEqual([["#2d7a68b8"], ["#3f6fa8b8"]]);
    expect(stroke.mock.calls.slice(-2)).toEqual([["#2d7a68"], ["#3f6fa8"]]);
    expect(setLineDash).toHaveBeenCalledWith([3, 2]);
    expect(fillRect).toHaveBeenCalledWith("#7552a3", 1, x, y, 79, ROW_HEIGHT - 4);
    expect(fillText).toHaveBeenCalledWith("S · C5", x + 5, y + 12);

    fill.mockClear();
    act(() => {
      rootStyle.setProperty("--voice-s", "#b39adb");
      rootStyle.setProperty("--voice-a", "#6db7a3");
      rootStyle.setProperty("--voice-t", "#77a4d7");
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    });
    expect(fill.mock.calls).toEqual([["#6db7a3b8"], ["#77a4d7b8"]]);
    expect(fillRect).toHaveBeenCalledWith("#b39adb", 1, x, y, 79, ROW_HEIGHT - 4);

    noteRects.push(put("tenor", 60), put("bass", 48));
    rootStyle.setProperty("--danger", "#e4776b");
    fill.mockClear();
    fillText.mockClear();
    setLineDash.mockClear();
    render();
    expect(fill.mock.calls.slice(0, 2)).toEqual([["#b39adb"], ["#6db7a3b8"]]);
    expect(fillRect).toHaveBeenCalledWith("#e4776b", 0.26, x, y, 79, ROW_HEIGHT - 4);
    expect(setLineDash).toHaveBeenCalledWith([4, 3]);
    expect(strokeRect).toHaveBeenCalledWith("#e4776b", 1, x + 0.5, y + 0.5, 78, ROW_HEIGHT - 5);
    expect(fillText).not.toHaveBeenCalledWith("S · C5", x + 5, y + 12);
  } finally {
    act(() => root.unmount());
    if (previousStyle === null) document.documentElement.removeAttribute("style");
    else document.documentElement.setAttribute("style", previousStyle);
    getContext.mockRestore();
    vi.unstubAllGlobals();
  }
});
