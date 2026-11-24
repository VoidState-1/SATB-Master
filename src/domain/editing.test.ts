import { describe, expect, it } from "vitest";
import {
  addAuxiliaryTrack,
  addCadenceAnnotation,
  addNote,
  addPhraseBoundary,
  deleteAuxiliaryTrack,
  deleteCadenceAnnotation,
  deletePhraseBoundary,
  deleteNotes,
  splitNote,
  transformNotes,
  updateCadenceAnnotation,
  updateNote,
  updateTrack,
  type AddAuxiliaryTrackOptions,
  type TrackPatch,
} from "./editing";
import { createChordRegion } from "./chords";
import { checkHarmony } from "./harmony/registry";
import { spellMidi } from "./pitch";
import { AUXILIARY_COLOR_PALETTE, createEmptyProject, PPQ, validateProject, type NoteEvent } from "./project";

function note(id: string, startTick: number, midi = 60): NoteEvent {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    pitch: spellMidi(midi),
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

describe("额外声部轨道命令", () => {
  it("分配唯一 ID、递增的默认名称与循环色板，并使用默认控件值", () => {
    const original = createEmptyProject();
    let project = original;
    for (let index = 0; index <= AUXILIARY_COLOR_PALETTE.length; index += 1) {
      const result = addAuxiliaryTrack(project);
      expect(result.error).toBeUndefined();
      project = result.project;
      expect(result.trackId).toMatch(/^aux-/);
      expect(project.auxiliaryTracks[index]).toMatchObject({
        id: result.trackId,
        name: "额外声部 " + (index + 1),
        shortName: "E" + (index + 1),
        color: AUXILIARY_COLOR_PALETTE[index % AUXILIARY_COLOR_PALETTE.length],
      });
    }
    expect(project.auxiliaryTracks[0]).toMatchObject({
      kind: "auxiliary",
      role: "other",
      notes: [],
      participatesInHarmony: false,
      monophonic: false,
      visible: true,
      muted: false,
      solo: false,
      locked: false,
      volume: 0.85,
      pan: 0,
      program: 0,
      showInScorePreview: false,
    });
    expect(original.auxiliaryTracks).toEqual([]);
    expect(validateProject(project)).toBe(true);
  });

  it("保留合法自定义设置并跳过已使用的名称和颜色", () => {
    const original = createEmptyProject();
    const color = AUXILIARY_COLOR_PALETTE[0].toUpperCase();
    const custom = addAuxiliaryTrack(original, {
      name: " 额外声部 1 ",
      shortName: "  Ref.1  ",
      color,
      role: "reference",
      program: 127,
      showInScorePreview: true,
    });
    expect(custom.error).toBeUndefined();
    expect(custom.project.auxiliaryTracks[0]).toMatchObject({
      name: "额外声部 1",
      shortName: "Ref.",
      color,
      role: "reference",
      program: 127,
      showInScorePreview: true,
    });

    const second = addAuxiliaryTrack(custom.project, {
      name: "  piano  ",
      color: AUXILIARY_COLOR_PALETTE[1],
    });
    expect(second.project.auxiliaryTracks[1]).toMatchObject({ name: "piano", shortName: "PI" });
    delete second.project.auxiliaryTracks[1].color;
    const automatic = addAuxiliaryTrack(second.project);
    expect(automatic.project.auxiliaryTracks[2]).toMatchObject({
      name: "额外声部 2",
      color: AUXILIARY_COLOR_PALETTE[2],
    });
  });

  it.each([
    { options: { name: " \t" }, error: "轨道名称不能为空" },
    { options: { shortName: " " }, error: "轨道短名称不能为空" },
    { options: { color: "#f00" }, error: "轨道颜色格式无效" },
    { options: { program: 128 }, error: "轨道音色" },
    { options: { showInScorePreview: "true" }, error: "五线谱预览" },
    { options: { role: "invalid" }, error: "额外声部角色无效" },
  ])("新增额外声部时拒绝无效选项 $options", ({ options, error }) => {
    const project = createEmptyProject();
    const result = addAuxiliaryTrack(project, options as AddAuxiliaryTrackOptions);

    expect(result.error).toContain(error);
    expect(result.project).toBe(project);
    expect(result.trackId).toBeUndefined();
  });

  it("更新 SATB 的通用控件字段", () => {
    const project = createEmptyProject();
    const patch = {
      visible: false, muted: true, solo: true, locked: true,
      volume: 0, pan: -1, program: 127,
    };
    const result = updateTrack(project, "soprano", patch);

    expect(result.error).toBeUndefined();
    expect(result.project.satbTracks[0]).toEqual({ ...project.satbTracks[0], ...patch });
    expect(project.satbTracks[0].locked).toBe(false);
    expect(validateProject(result.project)).toBe(true);
  });

  it.each([
    { name: "女声" }, { shortName: "So" }, { color: "#123456" }, { showInScorePreview: false },
  ])("拒绝修改 SATB 固定属性 %j", (patch) => {
    const project = createEmptyProject();
    const result = updateTrack(project, "soprano", { ...patch, muted: true });

    expect(result.project).toBe(project);
    expect(result.error).toContain("主声部");
  });

  it("更新额外声部的自定义设置并在重命名时同步短名", () => {
    const { project, trackId } = addAuxiliaryTrack(createEmptyProject());
    const patch = {
      name: "  钢琴伴奏 ", color: "#Ab1234", showInScorePreview: true,
      volume: 1, pan: 1, program: 12, locked: true,
    };
    const result = updateTrack(project, trackId!, patch);
    expect(result.error).toBeUndefined();
    expect(result.project.auxiliaryTracks[0]).toMatchObject({
      ...patch, name: "钢琴伴奏", shortName: "钢琴",
    });
    const renamed = updateTrack(result.project, trackId!, {
      name: "例奏", shortName: "  参考旋律声部  ", showInScorePreview: false, locked: false,
    });
    expect(renamed.error).toBeUndefined();
    expect(renamed.project.auxiliaryTracks[0]).toMatchObject({
      name: "例奏", shortName: "参考旋律", showInScorePreview: false, locked: false,
    });
    expect(validateProject(renamed.project)).toBe(true);
  });

  it.each([
    { patch: { name: " \t" }, error: "轨道名称不能为空" },
    { patch: { shortName: "" }, error: "轨道短名称不能为空" },
    { patch: { color: "red" }, error: "轨道颜色格式无效" },
    { patch: { showInScorePreview: "false" }, error: "五线谱预览" },
    { patch: { locked: 0 }, error: "轨道开关" },
    { patch: { volume: NaN }, error: "轨道音量" },
    { patch: { volume: 1.01 }, error: "轨道音量" },
    { patch: { pan: Infinity }, error: "轨道声像" },
    { patch: { pan: -1.01 }, error: "轨道声像" },
    { patch: { program: 2.5 }, error: "轨道音色" },
    { patch: { program: -1 }, error: "轨道音色" },
  ])("拒绝无效轨道设置 $patch", ({ patch, error }) => {
    const { project, trackId } = addAuxiliaryTrack(createEmptyProject());
    const result = updateTrack(project, trackId!, { muted: true, ...patch } as TrackPatch);

    expect(result.project).toBe(project);
    expect(result.error).toContain(error);
  });

  it("删除额外声部及其音符，保护主声部和锁定声部", () => {
    const { project, trackId } = createProjectWithAuxiliaryTrack([note("aux-note", 0)]);
    const locked = updateTrack(project, trackId, { locked: true }).project;
    const lockedDeletion = deleteAuxiliaryTrack(locked, trackId);
    expect(lockedDeletion.project).toBe(locked);
    expect(lockedDeletion.error).toContain("请先解锁");
    expect(deleteAuxiliaryTrack(project, "soprano")).toEqual({
      project, error: "无法删除四部和声主声部",
    });
    expect(deleteAuxiliaryTrack(project, "missing")).toEqual({
      project, error: "找不到要删除的额外声部",
    });
    expect(updateTrack(project, "missing", { muted: true })).toEqual({
      project, error: "找不到要编辑的轨道",
    });

    const unlocked = updateTrack(locked, trackId, { locked: false }).project;
    const deleted = deleteAuxiliaryTrack(unlocked, trackId);
    expect(deleted.error).toBeUndefined();
    expect(deleted.project.auxiliaryTracks).toEqual([]);
    expect(deleted.project.satbTracks).toEqual(project.satbTracks);
    expect(unlocked.auxiliaryTracks[0].notes).toHaveLength(1);
  });
});

function createProjectWithAuxiliaryTrack(notes: NoteEvent[]) {
  const { project, trackId } = addAuxiliaryTrack(createEmptyProject());
  project.auxiliaryTracks[0].notes = notes;
  return { project, trackId: trackId! };
}

describe("额外声部音符编辑", () => {
  it("允许异音高重叠与同音高交错，拒绝同 MIDI 音高且起止相同的音符", () => {
    const { project, trackId } = createProjectWithAuxiliaryTrack([note("original", 0)]);
    const chord = addNote(project, trackId, note("third", 0, 64));
    expect(chord.error).toBeUndefined();
    const staggered = addNote(chord.project, trackId, note("staggered", PPQ / 2));
    expect(staggered.error).toBeUndefined();
    const shorter = addNote(staggered.project, trackId, {
      ...note("shorter", 0),
      durationTicks: PPQ / 2,
    });
    expect(shorter.error).toBeUndefined();
    expect(shorter.project.auxiliaryTracks[0].notes).toHaveLength(4);

    const rejected = addNote(shorter.project, trackId, {
      ...note("duplicate", 0),
      pitch: { step: "B", alter: 1, octave: 3 },
    });
    expect(rejected.project).toBe(shorter.project);
    expect(rejected.error).toContain("完全重叠");
  });

  it("保持 SATB 对不同音高之间的时间重叠限制", () => {
    const project = createEmptyProject();
    project.satbTracks[0].notes = [note("original", 0)];
    expect(addNote(project, "soprano", note("third", PPQ / 2, 64)).error).toContain("重叠");
  });

  it("拒绝属性编辑将交错的同音高音符变为完全重叠", () => {
    const { project, trackId } = createProjectWithAuxiliaryTrack([
      note("original", 0),
      note("shifted", PPQ / 2),
      { ...note("shorter", 0), durationTicks: PPQ / 2 },
    ]);

    for (const result of [
      updateNote(project, trackId, "shifted", { startTick: 0 }),
      updateNote(project, trackId, "shorter", { durationTicks: PPQ }),
    ]) {
      expect(result.project).toBe(project);
      expect(result.error).toContain("完全重叠");
    }
    expect(updateNote(project, trackId, "original", { velocity: 80 }).error).toBeUndefined();
  });

  it.each([
    { noteIds: ["shifted"], startTick: 0 },
    { noteIds: ["original", "shifted"], startTick: PPQ },
  ])("原子拒绝批量变换中的完全重叠 $noteIds", ({ noteIds, startTick }) => {
    const { project, trackId } = createProjectWithAuxiliaryTrack([
      note("original", 0), note("third", 0, 64), note("shifted", PPQ / 2),
    ]);
    project.satbTracks[0].notes = [note("satb", 0)];
    const before = structuredClone(project);
    const result = transformNotes(project, new Set([...noteIds, "satb"]), (item) => ({
      ...item, startTick,
    }));

    expect(result.project).toBe(project);
    expect(result.error).toBe("批量操作会造成完全重叠的相同音符");
    expect(project).toEqual(before);
  });

  it("批量修改时值也拒绝完全重叠", () => {
    const { project } = createProjectWithAuxiliaryTrack([
      note("original", 0), { ...note("shorter", 0), durationTicks: PPQ / 2 },
    ]);
    const result = transformNotes(project, new Set(["shorter"]), (item) => ({
      ...item, durationTicks: PPQ,
    }));
    expect(result.project).toBe(project);
    expect(result.error).toContain("完全重叠");
  });

  it.each([0, PPQ / 2])("拒绝切分生成与已有音符完全重叠的片段（%i）", (startTick) => {
    const { project, trackId } = createProjectWithAuxiliaryTrack([
      note("original", 0), { ...note("existing", startTick), durationTicks: PPQ / 2 },
    ]);
    const result = splitNote(project, trackId, "original", PPQ / 2);

    expect(result.project).toBe(project);
    expect(result.error).toContain("完全重叠");
  });

  it("允许移动和切分不同音高的重叠音符，并支持批量删除", () => {
    const { project, trackId } = createProjectWithAuxiliaryTrack([
      note("original", 0), note("third", PPQ, 64),
    ]);
    const moved = transformNotes(project, new Set(["original", "third"]),
      (item) => ({ ...item, startTick: PPQ }));
    expect(moved.error).toBeUndefined();
    const split = splitNote(moved.project, trackId, "original", PPQ * 1.5);
    expect(split.error).toBeUndefined();
    const notes = split.project.auxiliaryTracks[0].notes;
    expect(notes.map((item) => [item.startTick, item.durationTicks])).toEqual(
      [[PPQ, PPQ / 2], [PPQ, PPQ], [PPQ * 1.5, PPQ / 2]],
    );
    const deleted = deleteNotes(split.project, new Set(notes.map((item) => item.id)));
    expect(deleted.error).toBeUndefined();
    expect(deleted.project.auxiliaryTracks[0].notes).toEqual([]);
  });

  it("旧工程已有重复音符时仍可修改同轨无关音符", () => {
    const { project } = createProjectWithAuxiliaryTrack([
      note("legacy-1", 0), note("legacy-2", 0), note("independent", 0, 64),
    ]);
    expect(validateProject(project)).toBe(true);
    const result = transformNotes(project, new Set(["independent"]), (item) => ({
      ...item, startTick: PPQ,
    }));
    expect(result.error).toBeUndefined();
    expect(result.project.auxiliaryTracks[0].notes[2].startTick).toBe(PPQ);
  });

  it("额外声部的冲突音和连续平行五八度不改变和声诊断", () => {
    const { project, trackId } = createProjectWithAuxiliaryTrack([]);
    project.satbTracks[0].notes = [note("s-1", 0, 67), note("s-2", PPQ, 69)];
    project.satbTracks[3].notes = [note("b-1", 0, 48), note("b-2", PPQ, 50)];
    const baseline = checkHarmony(project).diagnostics;
    expect(baseline.map((item) => item.ruleId)).toContain("voice-leading.parallel-fifths");

    let withAuxiliaryNotes = project;
    for (let beat = 0; beat < 16; beat += 1) {
      const root = beat % 2 === 0 ? 36 : 38;
      for (const interval of [0, 1, 6, 7, 12, 84]) {
        const added = addNote(withAuxiliaryNotes, trackId,
          note("aux-" + beat + "-" + interval, beat * PPQ, root + interval));
        expect(added.error).toBeUndefined();
        withAuxiliaryNotes = added.project;
      }
    }
    expect(withAuxiliaryNotes.auxiliaryTracks[0].notes).toHaveLength(96);
    expect(checkHarmony(withAuxiliaryNotes).diagnostics).toEqual(baseline);
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

  it("支持通过更新音符书写音高完成同音异名转换", () => {
    const project = createEmptyProject();
    const originalNote: NoteEvent = {
      id: "note-eb",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "E", alter: -1, octave: 4 },
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    };
    project.satbTracks.find((t) => t.id === "soprano")!.notes = [originalNote];

    const updated = updateNote(project, "soprano", "note-eb", {
      pitch: { step: "D", alter: 1, octave: 4 },
      spellingSource: "manual",
    });

    expect(updated.error).toBeUndefined();
    const updatedNote = updated.project.satbTracks
      .find((t) => t.id === "soprano")!
      .notes.find((n) => n.id === "note-eb")!;
    expect(updatedNote.pitch).toEqual({ step: "D", alter: 1, octave: 4 });
  });
});
