import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ } from "./model";
import {
  buildTimelineRulerTicks,
  buildTimingMarkerGroups,
} from "./timelineRuler";

describe("timeline ruler", () => {
  it("groups simultaneous timing changes and keeps absent types out of the marker", () => {
    const project = createEmptyProject();
    project.tempoEvents.push({ id: "tempo-2", tick: PPQ * 4, bpm: 96 });
    project.meterEvents.push({
      id: "meter-2",
      tick: PPQ * 4,
      numerator: 3,
      denominator: 4,
    });
    project.keyEvents.push({
      id: "key-2",
      tick: PPQ * 8,
      tonic: 7,
      mode: "major",
    });

    const groups = buildTimingMarkerGroups(project);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      tick: PPQ * 4,
      tempo: { id: "tempo-2" },
      meter: { id: "meter-2" },
    });
    expect(groups[0].key).toBeUndefined();
    expect(groups[1]).toMatchObject({ tick: PPQ * 8, key: { id: "key-2" } });
  });

  it("builds beat and quarter-beat ticks without duplicating measure starts", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 4;

    const ticks = buildTimelineRulerTicks(project);
    expect(
      ticks.filter((tick) => tick.kind === "beat").map((tick) => tick.tick),
    ).toEqual([PPQ, PPQ * 2, PPQ * 3]);
    expect(ticks.filter((tick) => tick.kind === "subdivision")).toHaveLength(
      12,
    );
    expect(ticks.some((tick) => tick.tick === 0)).toBe(false);
  });
});
