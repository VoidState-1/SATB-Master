// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { addAuxiliaryTrack, addNote } from "../../../domain/editing";
import { createEmptyProject, type NoteEvent } from "../../../domain/project";
import type { HarmonyDiagnostic } from "../../../domain/harmony";
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
