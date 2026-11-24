// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../../domain/project";
import { PianoRoll } from "./PianoRoll";
import type { PianoRollProps } from "./types";

function createProps(onDisengageFollow: () => void): PianoRollProps {
  const project = createEmptyProject();
  return {
    project,
    activeVoice: "soprano",
    tool: "select",
    gridTicks: project.ppq / 2,
    pixelsPerBeat: 80,
    selectedNoteIds: new Set(),
    selectedChordIds: new Set(),
    chordBrush: {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      source: "manual",
      confidence: "certain",
    },
    diagnostics: [],
    playheadTick: 0,
    isPlaying: true,
    followPlayhead: true,
    onDisengageFollow,
    loopEnabled: false,
    loopStartTick: 0,
    loopEndTick: project.ppq * 4,
    cancelRequest: 0,
    onSetPlayhead: vi.fn(),
    onSetPixelsPerBeat: vi.fn(),
    onSetActiveVoice: vi.fn(),
    onSetEditorDomain: vi.fn(),
    onInteractionActiveChange: vi.fn(),
    onSelectNotes: vi.fn(),
    onPreviewNote: vi.fn(),
    onSelectChords: vi.fn(),
    onAddNote: vi.fn(),
    onUpdateNote: vi.fn(),
    onMoveNotes: vi.fn(),
    onDeleteNotes: vi.fn(),
    onSplitNote: vi.fn(),
    onAddChord: vi.fn(),
    onUpdateChord: vi.fn(),
    onMoveChords: vi.fn(),
    onDeleteChords: vi.fn(),
    onSplitChord: vi.fn(),
    onAddTimingEvent: vi.fn(),
    onUpdateTimingEvent: vi.fn(),
    onDeleteTimingEvent: vi.fn(),
    onSetLoopBoundary: vi.fn(),
  };
}

describe("PianoRoll followPlayhead wheel and scroll exemptions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
    const noop = vi.fn();
    const canvasContextProxy = new Proxy(
      {
        measureText: vi.fn(() => ({ width: 20 })),
      } as Record<string | symbol, unknown>,
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          return noop;
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        },
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContextProxy as unknown as CanvasRenderingContext2D,
    );

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  function renderRoll(onDisengageFollow = vi.fn()) {
    act(() => {
      root.render(<PianoRoll {...createProps(onDisengageFollow)} />);
    });
    const scrollEl = host.querySelector<HTMLDivElement>(".piano-roll");
    if (!scrollEl) {
      throw new Error("Expected .piano-roll element to render");
    }
    return { scrollEl, onDisengageFollow };
  }

  it("does not disengage followPlayhead on vertical mouse wheel or vertical-only scroll", () => {
    const { scrollEl, onDisengageFollow } = renderRoll();

    act(() => {
      scrollEl.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120, deltaX: 0 }),
      );
      scrollEl.scrollTop = 240;
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
    });

    expect(onDisengageFollow).not.toHaveBeenCalled();
  });

  it("disengages followPlayhead on horizontal wheel, shift+wheel, ctrl+wheel, and horizontal scroll", () => {
    const { scrollEl, onDisengageFollow } = renderRoll();

    act(() => {
      scrollEl.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 0, deltaX: 80 }),
      );
    });
    expect(onDisengageFollow).toHaveBeenCalledTimes(1);

    act(() => {
      scrollEl.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120, shiftKey: true }),
      );
    });
    expect(onDisengageFollow).toHaveBeenCalledTimes(2);

    act(() => {
      scrollEl.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, ctrlKey: true }),
      );
    });
    expect(onDisengageFollow).toHaveBeenCalledTimes(3);

    act(() => {
      scrollEl.scrollLeft = 180;
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(onDisengageFollow).toHaveBeenCalledTimes(4);
  });
});
