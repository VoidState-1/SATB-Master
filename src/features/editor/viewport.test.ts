import { describe, expect, it } from "vitest";
import {
  HEADER_HEIGHT,
  MAX_MIDI,
  MIN_MIDI,
  PIANO_WIDTH,
  ROW_HEIGHT,
  createViewportMetrics,
  durationToWidth,
  midiToY,
  scrollLeftForZoom,
  tickToX,
  xToTick,
  yToMidi,
} from "./viewport";

describe("editor viewport geometry", () => {
  it("keeps tick and x conversions aligned at the canvas boundaries", () => {
    expect(tickToX(0, 480, 80)).toBe(PIANO_WIDTH);
    expect(xToTick(PIANO_WIDTH - 20, 480, 80, 3840)).toBe(0);
    expect(xToTick(tickToX(3840, 480, 80), 480, 80, 3840)).toBe(3840);
    expect(xToTick(PIANO_WIDTH + 40, 480, 80, 3840)).toBe(240);
  });

  it("maps the complete MIDI range to stable rows", () => {
    expect(midiToY(MAX_MIDI)).toBe(HEADER_HEIGHT);
    expect(midiToY(MIN_MIDI)).toBe(
      HEADER_HEIGHT + (MAX_MIDI - MIN_MIDI) * ROW_HEIGHT,
    );
    expect(yToMidi(midiToY(60) + ROW_HEIGHT / 2)).toBe(60);
    expect(yToMidi(-100)).toBe(MAX_MIDI);
    expect(yToMidi(Number.MAX_SAFE_INTEGER)).toBe(MIN_MIDI);
  });

  it("preserves the tick under the zoom anchor", () => {
    const previousPixelsPerBeat = 80;
    const nextPixelsPerBeat = 120;
    const ppq = 480;
    const viewportX = 300;
    const scrollLeft = 500;
    const nextScrollLeft = scrollLeftForZoom({
      scrollLeft,
      viewportX,
      previousPixelsPerBeat,
      nextPixelsPerBeat,
      ppq,
    });
    const previousTick = xToTick(
      scrollLeft + viewportX,
      ppq,
      previousPixelsPerBeat,
      Number.MAX_SAFE_INTEGER,
    );
    const nextTick = xToTick(
      nextScrollLeft + viewportX,
      ppq,
      nextPixelsPerBeat,
      Number.MAX_SAFE_INTEGER,
    );
    expect(nextTick).toBeCloseTo(previousTick, 8);
  });

  it("does not produce a negative rendered duration", () => {
    expect(durationToWidth(0, 480, 80, 2)).toBe(0);
    expect(durationToWidth(480, 480, 80, 2)).toBe(78);
  });

  it("reports stable canvas dimensions for a project", () => {
    const metrics = createViewportMetrics(3840, 480, 80);
    expect(metrics.rollHeight).toBe((MAX_MIDI - MIN_MIDI + 1) * ROW_HEIGHT);
    expect(metrics.timelineWidth).toBe(920);
    expect(metrics.totalWidth).toBe(920 + PIANO_WIDTH);
    expect(metrics.totalHeight).toBe(metrics.rollHeight + HEADER_HEIGHT);
  });
});
