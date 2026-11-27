import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID_TICKS,
  DEFAULT_PIXELS_PER_BEAT,
  GRID_OPTIONS,
  nextGridResolution,
  stepTimelineZoom,
  TIMELINE_ZOOM,
} from "./policy";

describe("编辑器时间策略", () => {
  it("提供稳定的网格顺序和默认值", () => {
    expect(DEFAULT_GRID_TICKS).toBe(480);
    expect(DEFAULT_PIXELS_PER_BEAT).toBe(72);
    expect(GRID_OPTIONS.map((option) => option.ticks)).toEqual([
      960, 480, 320, 240, 160, 120, 80, 60, 40, 30,
    ]);
    expect(nextGridResolution(480, 1)).toBe(320);
    expect(nextGridResolution(30, 1)).toBe(30);
    expect(nextGridResolution(960, -1)).toBe(960);
  });

  it("统一限制时间轴缩放的步长和边界", () => {
    expect(stepTimelineZoom(72, 1)).toBe(82);
    expect(stepTimelineZoom(TIMELINE_ZOOM.min, -1)).toBe(TIMELINE_ZOOM.min);
    expect(stepTimelineZoom(TIMELINE_ZOOM.max, 1)).toBe(TIMELINE_ZOOM.max);
  });
});
