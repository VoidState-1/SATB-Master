import { describe, expect, it } from "vitest";
import { checkHarmony } from "../registry";
import { createEmptyProject, PPQ } from "../../project";
import { note, setNotes, fSharpMajorRegion } from "../testing/fixtures/writtenPitchProject";

describe("Phase B v1 书写与和弦金样本", () => {
  it("相同输入生成稳定诊断 ID，并归并连续同根因区间", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      {
        ...fSharpMajorRegion(),
        durationTicks: PPQ * 2,
      },
    ];
    setNotes(project, "soprano", [
      note("held-g-flat", 0, PPQ * 2, { step: "G", alter: -1, octave: 4 }),
    ]);
    setNotes(project, "alto", [
      note("boundary-1", 0, PPQ, { step: "C", alter: 1, octave: 4 }),
      note("boundary-2", PPQ, PPQ, { step: "C", alter: 1, octave: 4 }),
    ]);
    const first = checkHarmony(project).diagnostics.filter(
      (item) =>
        item.ruleId === "chord.unclassified-nonchord-tone" &&
        item.noteIds.includes("held-g-flat"),
    );
    const second = checkHarmony(project).diagnostics.filter(
      (item) =>
        item.ruleId === "chord.unclassified-nonchord-tone" &&
        item.noteIds.includes("held-g-flat"),
    );
    expect(first).toHaveLength(1);
    expect(first[0].endTick).toBe(PPQ * 2);
    expect(second[0].id).toBe(first[0].id);
  });
});
