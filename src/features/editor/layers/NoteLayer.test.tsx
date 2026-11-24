// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../../../domain/project";
import { NoteLayer } from "./NoteLayer";

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
