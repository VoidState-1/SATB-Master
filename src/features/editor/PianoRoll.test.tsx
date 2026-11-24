// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAuxiliaryTrack, addNote, updateTrack } from "../../domain/editing";
import { spellMidi } from "../../domain/pitch";
import { createEmptyProject, type NoteEvent } from "../../domain/project";
import { PianoRoll } from "./PianoRoll";
import type { PianoRollProps } from "./types";
import { midiToY, ROW_HEIGHT, tickToX } from "./viewport";

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

describe("PianoRoll", () => {
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

  function auxiliaryRoll() {
    const props = createProps(vi.fn());
    props.isPlaying = false;
    const added = addAuxiliaryTrack(props.project);
    const id = added.trackId!;
    const note: NoteEvent = {
      id: "satb-note",
      startTick: 0,
      durationTicks: props.project.ppq,
      pitch: spellMidi(60, props.project.keyEvents[0]),
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    };
    props.project = addNote(added.project, "soprano", note).project;
    props.project = addNote(props.project, id, { ...note, id: "aux-low" }).project;
    props.project = addNote(props.project, id, {
      ...note,
      id: "aux-high",
      pitch: spellMidi(64, props.project.keyEvents[0]),
    }).project;
    props.activeVoice = id;
    return { props, id };
  }

  function interactWithRoll(props: PianoRollProps) {
    act(() => root.render(<PianoRoll {...props} />));
    const canvas = host.querySelector<HTMLCanvasElement>(".roll-canvas")!;
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    return (type: string, tick: number, midi: number, offsetX = 0) => {
      act(() => canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: tickToX(tick, props.project.ppq, props.pixelsPerBeat) + offsetX,
        clientY: midiToY(midi) + ROW_HEIGHT / 2,
      })));
    };
  }

  it("优先命中活跃额外声部，支持选中、移动预听和边缘调整时值", () => {
    const { props, id } = auxiliaryRoll();
    const pointer = interactWithRoll(props);
    const grid = props.gridTicks;
    pointer("pointerdown", 0, 60, 8);
    expect(props.onSelectNotes).toHaveBeenLastCalledWith(new Set(["aux-low"]));
    pointer("pointermove", grid, 61, 8);
    pointer("pointerup", grid, 61, 8);
    expect(props.onPreviewNote).toHaveBeenCalledWith(id, 61);
    expect(props.onMoveNotes).toHaveBeenCalledWith(new Set(["aux-low"]), grid, 1);

    pointer("pointerdown", props.project.ppq, 60, -4);
    pointer("pointermove", props.project.ppq + grid, 60, -4);
    pointer("pointerup", props.project.ppq + grid, 60, -4);
    expect(props.onUpdateNote).toHaveBeenCalledWith(id, "aux-low", {
      durationTicks: props.project.ppq + grid,
    });

    pointer("dblclick", 0, 60, 8);
    expect(props.onSetActiveVoice).toHaveBeenCalledWith("soprano");
    const hidden = updateTrack(props.project, id, { visible: false }).project;
    interactWithRoll({ ...props, project: hidden })("pointerdown", 0, 60, 8);
    expect(props.onSelectNotes).toHaveBeenLastCalledWith(new Set(["satb-note"]));
  });

  it("在额外声部上拖绘不同音高或错位同音高，并将重复音符交给领域命令校验", () => {
    const { props, id } = auxiliaryRoll();
    const pointer = interactWithRoll({ ...props, tool: "pencil" });
    const grid = props.gridTicks;
    pointer("pointerdown", 0, 62, 2);
    pointer("pointermove", grid * 2, 62, -2);
    pointer("pointerup", grid * 2, 62, -2);
    expect(props.onAddNote).toHaveBeenLastCalledWith(id, 0, 62, grid * 2);

    pointer("pointerdown", grid, 60, 2);
    pointer("pointerup", grid, 60, 2);
    expect(props.onAddNote).toHaveBeenLastCalledWith(id, grid, 60, grid);

    pointer("pointerdown", 0, 60, 2);
    pointer("pointermove", grid * 2, 60, -2);
    pointer("pointerup", grid * 2, 60, -2);
    expect(props.onAddNote).toHaveBeenLastCalledWith(id, 0, 60, grid * 2);
  });

  it("支持额外声部的框选、擦除与切分，锁定后仍可选中且无法编辑", () => {
    const { props, id } = auxiliaryRoll();
    const grid = props.gridTicks;
    let pointer = interactWithRoll(props);
    pointer("pointerdown", 0, 66, 1);
    pointer("pointermove", grid * 2, 59);
    pointer("pointerup", grid * 2, 59);
    expect(props.onSelectNotes).toHaveBeenLastCalledWith(new Set(["satb-note", "aux-low", "aux-high"]));

    pointer = interactWithRoll({ ...props, tool: "split" });
    pointer("pointerdown", grid, 64, 2);
    expect(props.onSplitNote).toHaveBeenCalledWith(id, "aux-high", grid);

    pointer = interactWithRoll({ ...props, tool: "eraser" });
    pointer("pointerdown", 0, 60, 8);
    pointer("pointermove", 0, 64, 8);
    pointer("pointerup", 0, 64, 8);
    expect(props.onDeleteNotes).toHaveBeenCalledWith(new Set(["aux-low", "aux-high"]));

    const locked = updateTrack(props.project, id, { locked: true }).project;
    for (const tool of ["pencil", "split", "eraser", "select"] as const) {
      pointer = interactWithRoll({ ...props, project: locked, tool });
      pointer("pointerdown", grid, 64, 2);
      pointer("pointermove", grid * 2, 65);
      pointer("pointerup", grid * 2, 65);
    }
    expect(props.onAddNote).not.toHaveBeenCalled();
    expect(props.onMoveNotes).not.toHaveBeenCalled();
    expect(props.onSplitNote).toHaveBeenCalledTimes(1);
    expect(props.onDeleteNotes).toHaveBeenCalledTimes(1);
    expect(props.onSelectNotes).toHaveBeenLastCalledWith(new Set(["aux-high"]));
  });

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
