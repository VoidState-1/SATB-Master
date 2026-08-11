import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ } from "../project";
import {
  buildMetricTimeline,
  compareMetricStrength,
  metricPositionAt,
  metricPositionsBetween,
  strongestMetricPositionBetween,
} from "./metric";

describe("节拍度量时间线", () => {
  it("清晰区分 4/4 的下拍、次强拍、弱拍和细分位置", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 4;
    const timeline = buildMetricTimeline(project);

    expect(metricPositionAt(timeline, 0)).toMatchObject({
      role: "downbeat",
      level: 3,
      confidence: "certain",
    });
    expect(metricPositionAt(timeline, PPQ)).toMatchObject({
      role: "weak-beat",
      level: 1,
    });
    expect(metricPositionAt(timeline, PPQ * 2)).toMatchObject({
      role: "secondary-accent",
      level: 2,
    });
    expect(metricPositionAt(timeline, PPQ / 2)).toMatchObject({
      role: "subdivision",
      level: 0,
    });
  });

  it("按复拍子拍组识别 6/8 的第二个附点四分音符重音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.meterEvents = [
      { id: "meter-6-8", tick: 0, numerator: 6, denominator: 8 },
    ];
    const timeline = buildMetricTimeline(project);

    expect(metricPositionAt(timeline, (PPQ / 2) * 3)).toMatchObject({
      role: "secondary-accent",
      level: 2,
      confidence: "certain",
    });
  });

  it("没有拍组的 5/8 返回歧义，显式 2+3 后可以确定比较", () => {
    const project = createEmptyProject();
    project.lengthTicks = (PPQ / 2) * 5;
    project.meterEvents = [
      { id: "meter-5-8", tick: 0, numerator: 5, denominator: 8 },
    ];
    const ambiguous = buildMetricTimeline(project);
    const ambiguousPosition = metricPositionAt(ambiguous, PPQ);

    expect(ambiguousPosition).toMatchObject({ confidence: "ambiguous" });
    expect(
      compareMetricStrength(
        ambiguousPosition,
        metricPositionAt(ambiguous, PPQ / 2),
      ),
    ).toBe("unknown");

    project.meterEvents[0] = {
      ...project.meterEvents[0],
      beatGrouping: [2, 3],
    };
    const grouped = buildMetricTimeline(project);
    const groupAccent = metricPositionAt(grouped, PPQ);
    const weakBeat = metricPositionAt(grouped, PPQ / 2);

    expect(groupAccent).toMatchObject({
      role: "secondary-accent",
      level: 2,
      confidence: "certain",
    });
    expect(compareMetricStrength(groupAccent, weakBeat)).toBe("stronger");
  });

  it("区间查询显式遵循开区间边界并返回最强位置", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    const timeline = buildMetricTimeline(project);
    const positions = metricPositionsBetween(
      timeline,
      PPQ * 3,
      PPQ * 6,
      { boundaries: "open" },
    );

    expect(positions.map((position) => position.tick)).toEqual([
      PPQ * 4,
      PPQ * 5,
    ]);
    expect(
      strongestMetricPositionBetween(timeline, PPQ * 3, PPQ * 6),
    ).toMatchObject({ tick: PPQ * 4, role: "downbeat", level: 3 });
  });
});
