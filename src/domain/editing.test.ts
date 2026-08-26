import { describe, expect, it } from "vitest";
import {
  addCadenceAnnotation,
  addNote,
  addPhraseBoundary,
  deleteCadenceAnnotation,
  deletePhraseBoundary,
  deleteNotes,
  transformNotes,
  updateCadenceAnnotation,
  updateNote,
} from "./editing";
import { createChordRegion } from "./chords";
import { createEmptyProject, PPQ, type NoteEvent } from "./project";

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

describe("结构与终止式范围编辑", () => {
  it("在播放头添加并删除人工乐句边界", () => {
    const project = createEmptyProject();
    const added = addPhraseBoundary(project, PPQ);
    expect(added.error).toBeUndefined();
    expect(added.project.structure.phraseBoundaries[0].tick).toBe(PPQ);
    expect(
      deletePhraseBoundary(
        added.project,
        added.project.structure.phraseBoundaries[0].id,
      ).error,
    ).toBeUndefined();
  });

  it("在自动边界处添加边界时，将其转换为人工覆盖", () => {
    const project = createEmptyProject();
    project.structure.phraseBoundaries = [
      {
        id: "inferred-boundary",
        tick: PPQ,
        source: "inferred",
        confidence: "probable",
        inferenceFingerprint: "old-input",
        stale: true,
      },
    ];

    const result = addPhraseBoundary(project, PPQ);

    expect(result.error).toBeUndefined();
    expect(result.project.structure.phraseBoundaries).toEqual([
      {
        id: "inferred-boundary",
        tick: PPQ,
        source: "manual",
        confidence: "certain",
      },
    ]);
  });

  it("只用一个范围对象更新终止类型", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.loop.endTick = PPQ * 2;
    project.chordTrack.regions = [
      createChordRegion(project, 0, PPQ, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        source: "manual",
        confidence: "certain",
      }, "source"),
      createChordRegion(project, PPQ, PPQ, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        source: "manual",
        confidence: "certain",
      }, "target"),
    ];
    const added = addCadenceAnnotation(project, {
      id: "cadence-1",
      phraseId: "phrase-0-1920",
      fromTick: 0,
      toTick: PPQ * 2,
      kind: "full",
      form: "authentic",
      source: "manual",
      confidence: "certain",
      locked: false,
    });
    expect(added.error).toBeUndefined();
    const updated = updateCadenceAnnotation(added.project, "cadence-1", {
      kind: "deceptive",
      form: undefined,
    });
    expect(updated.error).toBeUndefined();
    expect(updated.project.chordTrack.cadenceAnnotations).toHaveLength(1);
    expect(updated.project.chordTrack.cadenceAnnotations[0].kind).toBe("deceptive");
    expect(deleteCadenceAnnotation(updated.project, "cadence-1").error).toBeUndefined();
  });
});
