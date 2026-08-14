import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ } from "./project";
import {
  buildMeasures,
  secondsToTick,
  snapTickBackward,
  snapTickForward,
  tickToPosition,
  tickToSeconds,
  ticksForMeasures,
  durationToTicksAt,
  measureAtTick,
  nearestGridTick,
  orderedEvents,
} from "./time";

describe("音乐时间轴", () => {
  it("在变拍号后按新的小节长度计算位置", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 7;
    project.meterEvents = [
      { id: "meter-1", tick: 0, numerator: 4, denominator: 4 },
      { id: "meter-2", tick: PPQ * 4, numerator: 3, denominator: 4 },
    ];

    const measures = buildMeasures(project);
    expect(measures).toHaveLength(2);
    expect(measures[1]).toMatchObject({
      number: 2,
      startTick: PPQ * 4,
      endTick: PPQ * 7,
      numerator: 3,
    });
    expect(tickToPosition(project, PPQ * 6 + 240)).toEqual({
      measure: 2,
      beat: 3,
      tick: 240,
    });
  });

  it("变速前后的 tick 与秒数可以往返换算", () => {
    const project = createEmptyProject();
    project.tempoEvents = [
      { id: "tempo-1", tick: 0, bpm: 120 },
      { id: "tempo-2", tick: PPQ * 2, bpm: 60 },
    ];

    expect(tickToSeconds(project, PPQ * 4)).toBeCloseTo(3);
    expect(secondsToTick(project, 3)).toBe(PPQ * 4);
  });

  it("点击网格后半段仍向前吸附到当前格起点", () => {
    expect(snapTickBackward(0, 480, 1_920)).toBe(0);
    expect(snapTickBackward(400, 480, 1_920)).toBe(0);
    expect(snapTickBackward(479, 480, 1_920)).toBe(0);
    expect(snapTickBackward(480, 480, 1_920)).toBe(480);
    expect(snapTickBackward(959, 480, 1_920)).toBe(480);
  });

  it("音符结束位置向后吸附到下一条网格线", () => {
    expect(snapTickForward(0, 480, 1_920)).toBe(0);
    expect(snapTickForward(1, 480, 1_920)).toBe(480);
    expect(snapTickForward(400, 480, 1_920)).toBe(480);
    expect(snapTickForward(480, 480, 1_920)).toBe(480);
    expect(snapTickForward(481, 480, 1_920)).toBe(960);
    expect(snapTickForward(2_100, 480, 1_920)).toBe(1_920);
  });

  it("converts measure counts to ticks across meter changes", () => {
    const project = createEmptyProject();
    project.meterEvents = [
      { id: "meter-1", tick: 0, numerator: 4, denominator: 4 },
      { id: "meter-2", tick: PPQ * 4, numerator: 3, denominator: 4 },
    ];

    expect(ticksForMeasures(project, 1)).toBe(PPQ * 4);
    expect(ticksForMeasures(project, 2)).toBe(PPQ * 7);
    expect(ticksForMeasures(project, 3)).toBe(PPQ * 10);
  });

  it("converts duration units from the active meter instead of assuming 4/4", () => {
    const project = createEmptyProject();
    project.meterEvents = [
      { id: "meter-1", tick: 0, numerator: 4, denominator: 4 },
      { id: "meter-2", tick: PPQ * 4, numerator: 3, denominator: 8 },
    ];

    expect(
      durationToTicksAt(project, PPQ * 4, { value: 1, unit: "beats" }),
    ).toBe(PPQ / 2);
    expect(
      durationToTicksAt(project, PPQ * 4, { value: 1, unit: "measures" }),
    ).toBe((PPQ / 2) * 3);
  });

  it("sorts timed events stably without mutating the source", () => {
    const source = [
      { id: "late", tick: PPQ },
      { id: "first", tick: 0 },
      { id: "second", tick: 0 },
    ];
    const ordered = orderedEvents(source);

    expect(ordered.map((event) => event.id)).toEqual([
      "first",
      "second",
      "late",
    ]);
    expect(source.map((event) => event.id)).toEqual([
      "late",
      "first",
      "second",
    ]);
    expect(Object.isFrozen(ordered)).toBe(true);
  });

  it("locates measures with half-open boundaries", () => {
    const project = createEmptyProject();
    const measures = buildMeasures(project);

    expect(measureAtTick(measures, 0)?.number).toBe(1);
    expect(measureAtTick(measures, measures[0].endTick)?.number).toBe(2);
    expect(measureAtTick(measures, project.lengthTicks)).toBeUndefined();
    expect(measureAtTick(measures, Number.NaN)).toBeUndefined();
  });

  it("snaps to the nearest grid and clamps to explicit bounds", () => {
    expect(nearestGridTick(239, 480)).toBe(0);
    expect(nearestGridTick(240, 480)).toBe(480);
    expect(nearestGridTick(2_100, 480, { maximum: 1_920 })).toBe(1_920);
    expect(nearestGridTick(-100, 480, { minimum: 240 })).toBe(240);
    expect(() => nearestGridTick(1, 0)).toThrow();
    expect(() =>
      nearestGridTick(1, 480, { minimum: 10, maximum: 0 }),
    ).toThrow();
  });
});
