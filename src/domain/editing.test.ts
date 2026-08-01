import { describe, expect, it } from "vitest";
import { addNote, deleteNotes, transformNotes, updateNote } from "./editing";
import { createEmptyProject, PPQ, type NoteEvent } from "./model";

function note(id: string, startTick: number): NoteEvent {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    pitch: { step: "C", alter: 0, octave: 4 },
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

describe("练习锁定约束", () => {
  it("阻止在锁定时间区间新增音符", () => {
    const project = createEmptyProject();
    project.exercise.editableRanges = [
      {
        id: "range-1",
        voiceIds: ["soprano"],
        fromTick: 0,
        toTick: PPQ * 2,
        editable: false,
      },
    ];

    const result = addNote(project, "soprano", note("note-1", PPQ));
    expect(result.project).toBe(project);
    expect(result.error).toContain("锁定");
  });

  it("阻止音符移入锁定区间，也阻止删除区间内的给定音符", () => {
    const project = createEmptyProject();
    project.exercise.editableRanges = [
      {
        id: "range-1",
        voiceIds: ["bass"],
        fromTick: 0,
        toTick: PPQ * 2,
        editable: false,
      },
    ];
    project.satbTracks.find((track) => track.id === "bass")!.notes = [
      note("given", 0),
      note("answer", PPQ * 3),
    ];

    expect(
      updateNote(project, "bass", "answer", { startTick: PPQ }).error,
    ).toContain("锁定");
    expect(deleteNotes(project, new Set(["given"])).error).toContain(
      "没有可删除",
    );
    expect(
      project.satbTracks.find((track) => track.id === "bass")!.notes,
    ).toHaveLength(2);
  });
});

describe("音符数值边界", () => {
  it("拒绝越界音高和非有限时值", () => {
    const project = createEmptyProject();

    expect(
      addNote(project, "soprano", {
        ...note("high", 0),
        pitch: { step: "C", alter: 0, octave: 10 },
      }).error,
    ).toContain("参数无效");
    expect(
      addNote(project, "soprano", {
        ...note("nan", 0),
        durationTicks: Number.NaN,
      }).error,
    ).toContain("参数无效");
  });

  it("拒绝属性编辑产生非法力度", () => {
    const project = createEmptyProject();
    project.satbTracks[0].notes = [note("existing", 0)];

    expect(
      updateNote(project, "soprano", "existing", { velocity: 0 }).error,
    ).toContain("参数无效");
  });
});

describe("辅助轨编辑能力", () => {
  it("允许辅助轨重叠，并让批量移动与删除覆盖辅助轨音符", () => {
    const project = createEmptyProject();
    project.auxiliaryTracks.push({
      id: "aux-reference",
      kind: "auxiliary",
      role: "reference",
      name: "参考材料",
      shortName: "Ref",
      notes: [note("aux-1", 0)],
      participatesInHarmony: false,
      monophonic: false,
      visible: true,
      muted: false,
      solo: false,
      locked: false,
      volume: 0.8,
      pan: 0,
      program: 0,
    });

    const added = addNote(project, "aux-reference", note("aux-2", 0));
    expect(added.error).toBeUndefined();
    expect(added.project.auxiliaryTracks[0].notes).toHaveLength(2);

    const moved = transformNotes(
      added.project,
      new Set(["aux-1", "aux-2"]),
      (item) => ({ ...item, startTick: PPQ }),
    );
    expect(moved.error).toBeUndefined();
    expect(
      moved.project.auxiliaryTracks[0].notes.map((item) => item.startTick),
    ).toEqual([PPQ, PPQ]);

    const deleted = deleteNotes(moved.project, new Set(["aux-1", "aux-2"]));
    expect(deleted.error).toBeUndefined();
    expect(deleted.project.auxiliaryTracks[0].notes).toEqual([]);
  });
});
