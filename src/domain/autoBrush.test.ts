import { describe, expect, it } from "vitest";
import { applyAutoBrushNote, planAutoBrushNote, type AutoBrushNoteDraft } from "./autoBrush";
import { addAuxiliaryTrack } from "./editing";
import { spellMidi, toMidi } from "./pitch";
import {
  createEmptyProject,
  getSatbTrack,
  PPQ,
  validateProject,
  VOICE_ORDER,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "./project";

function note(id: string, midi: number, startTick = 0, durationTicks = PPQ): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: spellMidi(midi),
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function voicing(project: ProjectDocument) {
  return VOICE_ORDER.map((voice) => {
    const first = getSatbTrack(project, voice).notes[0];
    return first && toMidi(first.pitch);
  });
}

function expectValidSatb(project: ProjectDocument) {
  expect(validateProject(project)).toBe(true);
  for (const { notes } of project.satbTracks) {
    notes.slice(1).forEach((current, index) => {
      const previous = notes[index];
      expect(previous.startTick + previous.durationTicks).toBeLessThanOrEqual(current.startTick);
    });
  }
}

describe("自动笔刷", () => {
  it.each([
    ["C3", 48, "bass"],
    ["C5", 72, "soprano"],
    ["G4", 67, "alto"],
    ["E3", 52, "bass"],
  ] satisfies [string, number, VoiceId][])("空拍的 %s 按音域落位", (id, midi, voice) => {
    const project = createEmptyProject();
    const pitch = spellMidi(midi);
    expect(planAutoBrushNote(project, { startTick: 0, durationTicks: PPQ, pitch })).toEqual({
      ok: true,
      assignedVoice: voice,
      reassignments: [],
      fixedVoices: [],
    });
    const result = applyAutoBrushNote(project, note(id, midi));
    expect(result.assignedVoice).toBe(voice);
    expect(getSatbTrack(result.project, voice).notes).toEqual([note(id, midi)]);
  });

  it("采用工程音域，并为缺失的声部配置使用默认音域", () => {
    const project = createEmptyProject();
    project.ruleProfile.shared.voiceRanges.tenor = { minMidi: 64, maxMidi: 70 };
    const draft = note("g4", 67);
    expect(planAutoBrushNote(project, draft)).toMatchObject({ ok: true, assignedVoice: "tenor" });
    Reflect.deleteProperty(project.ruleProfile.shared.voiceRanges, "tenor");
    expect(planAutoBrushNote(project, draft)).toMatchObject({ ok: true, assignedVoice: "alto" });
  });

  it.each([
    [{ startTick: 0.5 }, "音符参数无效"],
    [{ durationTicks: Number.NaN }, "音符参数无效"],
    [{ durationTicks: 0 }, "音符参数无效"],
    [{ pitch: { step: "C", alter: 0, octave: 10 } }, "音符参数无效"],
    [{ velocity: 0 }, "音符参数无效"],
    [{ velocity: 127.5 }, "音符参数无效"],
    [{ velocity: 128 }, "音符参数无效"],
    [{ startTick: -1 }, "音符超出工程时间范围"],
  ] satisfies [Partial<AutoBrushNoteDraft>, string][])("拒绝无效草稿 %j", (patch, error) => {
    const project = createEmptyProject();
    expect(planAutoBrushNote(project, { ...note("draft", 60), ...patch })).toEqual({
      ok: false,
      error,
    });
  });

  it("允许音符恰好结束在工程边界，拒绝越过边界", () => {
    const project = createEmptyProject();
    const last = note("end", 60, project.lengthTicks - PPQ);
    expect(planAutoBrushNote(project, last)).toMatchObject({ ok: true });
    expect(applyAutoBrushNote(project, { ...last, durationTicks: PPQ + 1 })).toEqual({
      project,
      error: "音符超出工程时间范围",
      reassignments: [],
    });
  });

  it("依次填入外声部和内声部，每一步都保持保序与合理落位", () => {
    let project = createEmptyProject();
    const steps = [
      { id: "c3", midi: 48, voice: "bass", expected: [undefined, undefined, undefined, 48] },
      { id: "c5", midi: 72, voice: "soprano", expected: [72, undefined, undefined, 48] },
      { id: "g4", midi: 67, voice: "alto", expected: [72, 67, undefined, 48] },
      { id: "e4", midi: 64, voice: "tenor", expected: [72, 67, 64, 48] },
    ];
    for (const { id, midi, voice, expected } of steps) {
      const result = applyAutoBrushNote(project, note(id, midi));
      expect(result.error).toBeUndefined();
      expect(result.assignedVoice).toBe(voice);
      expect(result.reassignments).toEqual([]);
      project = result.project;
      expect(voicing(project)).toEqual(expected);
      expectValidSatb(project);
    }
  });

  it("乱序补音时同次移开两条轨道的音符，完整保留拼写及元数据", () => {
    const initial = createEmptyProject();
    const e4: NoteEvent = {
      ...note("fb4", 64),
      pitch: { step: "F", alter: -1, octave: 4 },
      velocity: 75,
      nonChordToneRole: "passing",
    };
    const g4: NoteEvent = {
      ...note("abb4", 67),
      pitch: { step: "A", alter: -2, octave: 4 },
      spellingSource: "midi-inferred",
      importOrigin: {
        importId: "import",
        sourceTrack: 2,
        channel: 0,
        sourceStartTick: 0,
        sourceDurationTicks: PPQ,
        sourceMidiNote: 67,
      },
    };
    const first = applyAutoBrushNote(initial, e4);
    expect(voicing(first.project)).toEqual([undefined, 64, undefined, undefined]);
    const second = applyAutoBrushNote(first.project, g4);
    expect(voicing(second.project)).toEqual([67, 64, undefined, undefined]);

    const third = applyAutoBrushNote(second.project, note("c5", 72));
    expect(third.reassignments).toEqual([
      { noteId: g4.id, fromVoice: "soprano", toVoice: "alto" },
      { noteId: e4.id, fromVoice: "alto", toVoice: "tenor" },
    ]);
    expect(voicing(second.project)).toEqual([67, 64, undefined, undefined]);
    expect(voicing(third.project)).toEqual([72, 67, 64, undefined]);
    const fourth = applyAutoBrushNote(third.project, note("c3", 48));
    expect(voicing(fourth.project)).toEqual([72, 67, 64, 48]);
    expect(getSatbTrack(fourth.project, "alto").notes).toEqual([g4]);
    expect(getSatbTrack(fourth.project, "tenor").notes).toEqual([e4]);
    expectValidSatb(fourth.project);
  });

  it("把较高的已有音符移到上方声部", () => {
    const project = createEmptyProject();
    getSatbTrack(project, "tenor").notes = [note("g4", 67)];
    const result = applyAutoBrushNote(project, note("e4", 64));
    expect(result.reassignments).toEqual([
      { noteId: "g4", fromVoice: "tenor", toVoice: "soprano" },
    ]);
    expect(voicing(result.project)).toEqual([67, 64, undefined, undefined]);
  });

  it("允许同度齐奏，代价相同时尽量保留原声部", () => {
    const first = applyAutoBrushNote(createEmptyProject(), note("first-c4", 60));
    expect(first.assignedVoice).toBe("tenor");
    const second = applyAutoBrushNote(first.project, note("second-c4", 60));
    expect(second.assignedVoice).toBe("alto");
    expect(second.reassignments).toEqual([]);
    expect(voicing(second.project)).toEqual([undefined, 60, 60, undefined]);
    expect(getSatbTrack(second.project, "tenor").notes[0].id).toBe("first-c4");
    expectValidSatb(second.project);
  });

  it("完全平局时按声部顺序稳定决胜", () => {
    const project = createEmptyProject();
    for (const voice of VOICE_ORDER) {
      project.ruleProfile.shared.voiceRanges[voice] = { minMidi: 60, maxMidi: 60 };
    }
    const draft = note("c4", 60);
    const expected = { ok: true, assignedVoice: "soprano", reassignments: [], fixedVoices: [] };
    expect(planAutoBrushNote(project, draft)).toEqual(expected);
    expect(planAutoBrushNote(project, draft)).toEqual(expected);
  });

  it("四声部占满时拒绝第五音且保留原工程", () => {
    const project = createEmptyProject();
    VOICE_ORDER.forEach((voice, i) => {
      getSatbTrack(project, voice).notes = [note(voice, [72, 67, 64, 48][i])];
    });
    const before = structuredClone(project);
    const result = applyAutoBrushNote(project, note("fifth", 60));
    expect(result.error).toBe("该时间位置四声部已满");
    expect(result.assignedVoice).toBeUndefined();
    expect(result.reassignments).toEqual([]);
    expect(result.project).toBe(project);
    expect(project).toEqual(before);
  });

  it.each(["轨道", "音符"])("固定锁定的高音题干（%s），允许其余声部补音", (lock) => {
    let project = createEmptyProject();
    const soprano = getSatbTrack(project, "soprano");
    const given = { ...note("given-c5", 72), locked: lock === "音符" };
    soprano.locked = lock === "轨道";
    soprano.notes = [given];

    const above = note("above-c5", 74);
    expect(planAutoBrushNote(project, above)).toEqual({
      ok: true, assignedVoice: "alto", reassignments: [], fixedVoices: ["soprano"],
    });
    const crossed = applyAutoBrushNote(project, above);
    expect(voicing(crossed.project)).toEqual([72, 74, undefined, undefined]);
    expect(getSatbTrack(crossed.project, "soprano").notes).toEqual([given]);

    for (const [id, midi] of [["c3", 48], ["e4", 64], ["g4", 67]] as const) {
      const result = applyAutoBrushNote(project, note(id, midi));
      expect(result.error).toBeUndefined();
      project = result.project;
      if (id === "g4") expect(result.reassignments).toEqual([
        { noteId: "e4", fromVoice: "alto", toVoice: "tenor" },
      ]);
    }
    expect(voicing(project)).toEqual([72, 67, 64, 48]);
    expect(getSatbTrack(project, "soprano").notes).toEqual([given]);
    expectValidSatb(project);
  });

  it("优先减少与所有固定片段的交叉，保留跨区间的短音符", () => {
    const project = createEmptyProject();
    const alto = getSatbTrack(project, "alto");
    alto.notes = [
      note("c3", 48),
      note("c5", 72, PPQ),
      note("d5", 74, PPQ * 2),
      note("e5", 76, PPQ * 3),
    ];
    const draft = note("g4", 67, 0, PPQ * 4);
    expect(planAutoBrushNote(project, draft)).toEqual({
      ok: true, assignedVoice: "tenor", reassignments: [], fixedVoices: ["alto"],
    });
    const result = applyAutoBrushNote(project, draft);
    expect(getSatbTrack(result.project, "alto").notes).toEqual(alto.notes);
    expectValidSatb(result.project);
  });

  it("固定练习锁定区间内的音符并跳过空的锁定区间", () => {
    const project = createEmptyProject();
    const given = note("given", 72);
    getSatbTrack(project, "soprano").notes = [given];
    project.exercise.editableRanges = [
      { id: "exercise", voiceIds: ["soprano", "alto"], fromTick: 0, toTick: PPQ, editable: false },
    ];

    const draft = note("g4", 67);
    expect(planAutoBrushNote(project, draft)).toEqual({
      ok: true, assignedVoice: "tenor", reassignments: [], fixedVoices: ["soprano"],
    });
    const result = applyAutoBrushNote(project, draft);
    expect(getSatbTrack(result.project, "soprano").notes).toEqual([given]);
    expect(getSatbTrack(result.project, "alto").notes).toEqual([]);
    expectValidSatb(result.project);
  });

  it("空声部的部分练习锁定只限制与锁定区间重叠的音符", () => {
    const project = createEmptyProject();
    getSatbTrack(project, "soprano").locked = true;
    getSatbTrack(project, "bass").locked = true;
    const short = note("short-e4", 64);
    getSatbTrack(project, "tenor").notes = [short];
    project.exercise.editableRanges = [
      { id: "next-beat", voiceIds: ["alto"], fromTick: PPQ, toTick: PPQ * 2, editable: false },
    ];

    const draft = note("long-c4", 60, 0, PPQ * 2);
    expect(planAutoBrushNote(project, draft)).toEqual({
      ok: true,
      assignedVoice: "tenor",
      reassignments: [{ noteId: short.id, fromVoice: "tenor", toVoice: "alto" }],
      fixedVoices: ["soprano", "bass"],
    });
    expectValidSatb(applyAutoBrushNote(project, draft).project);
  });

  it.each([false, true])("隐藏声部受到保护（已有音符 %s）", (occupied) => {
    const project = createEmptyProject();
    const alto = getSatbTrack(project, "alto");
    alto.visible = false;
    if (occupied) alto.notes = [note("hidden-e4", 64)];

    const draft = note("g4", 67);
    expect(planAutoBrushNote(project, draft)).toEqual({
      ok: true, assignedVoice: "soprano", reassignments: [], fixedVoices: ["alto"],
    });
    const result = applyAutoBrushNote(project, draft);
    expect(getSatbTrack(result.project, "alto")).toEqual(alto);
    expectValidSatb(result.project);
  });

  it("没有空的可用声部时报告锁定错误", () => {
    const project = createEmptyProject();
    getSatbTrack(project, "soprano").locked = true;
    getSatbTrack(project, "alto").visible = false;
    project.exercise.editableRanges = [
      { id: "exercise", voiceIds: ["tenor", "bass"], fromTick: 0, toTick: PPQ, editable: false },
    ];
    expect(applyAutoBrushNote(project, note("g4", 67))).toEqual({
      project,
      error: "该时间位置没有可用的未锁定声部",
      reassignments: [],
    });
  });

  it("长低音避开后续拍子的冲突，优先选择安全的替代声部", () => {
    const project = createEmptyProject();
    const c3 = note("long-c3", 48, 0, PPQ * 4);
    const e4 = note("next-beat-e4", 64, PPQ);
    getSatbTrack(project, "bass").notes = [c3];
    getSatbTrack(project, "tenor").notes = [e4];

    const draft = note("g2", 43);
    expect(planAutoBrushNote(project, draft)).toEqual({
      ok: true,
      assignedVoice: "bass",
      reassignments: [{ noteId: c3.id, fromVoice: "bass", toVoice: "alto" }],
      fixedVoices: [],
    });
    const result = applyAutoBrushNote(project, draft);
    expect(getSatbTrack(result.project, "alto").notes).toEqual([c3]);
    expect(getSatbTrack(result.project, "tenor").notes).toEqual([e4]);
    expect(getSatbTrack(result.project, "bass").notes).toEqual([draft]);
    expectValidSatb(result.project);
  });

  it("全量重排不可行时只固定必要的长音", () => {
    const project = createEmptyProject();
    getSatbTrack(project, "soprano").locked = true;
    const c3 = note("long-c3", 48, 0, PPQ * 4);
    const e4 = note("long-e4", 64, 0, PPQ * 2);
    const laterAlto = note("later-alto", 67, PPQ * 2);
    const laterTenor = note("later-tenor", 60, PPQ * 2);
    getSatbTrack(project, "bass").notes = [c3];
    getSatbTrack(project, "alto").notes = [laterAlto];
    getSatbTrack(project, "tenor").notes = [e4, laterTenor];

    const draft = note("g2", 43);
    expect(planAutoBrushNote(project, draft)).toEqual({
      ok: true,
      assignedVoice: "tenor",
      reassignments: [{ noteId: e4.id, fromVoice: "tenor", toVoice: "alto" }],
      fixedVoices: ["soprano", "bass"],
    });
    const result = applyAutoBrushNote(project, draft);
    expect(getSatbTrack(result.project, "tenor").notes).toEqual([draft, laterTenor]);
    expect(getSatbTrack(result.project, "bass").notes).toEqual([c3]);
    expect(getSatbTrack(result.project, "alto").notes).toEqual([e4, laterAlto]);
    expectValidSatb(result.project);
  });

  it("换轨检查长音完整时值内的练习锁定", () => {
    const project = createEmptyProject();
    getSatbTrack(project, "soprano").locked = true;
    getSatbTrack(project, "alto").locked = true;
    const long = note("long-c3", 48, 0, PPQ * 4);
    getSatbTrack(project, "bass").notes = [long];
    project.exercise.editableRanges = [
      { id: "next-beat", voiceIds: ["tenor"], fromTick: PPQ, toTick: PPQ * 2, editable: false },
    ];

    const result = applyAutoBrushNote(project, note("g2", 43));
    expect(result.assignedVoice).toBe("tenor");
    expect(result.reassignments).toEqual([]);
    expect(getSatbTrack(result.project, "bass").notes).toEqual([long]);
    expectValidSatb(result.project);
  });

  it("应用时发现其他位置已有同声部重叠，拒绝提交", () => {
    const project = createEmptyProject();
    getSatbTrack(project, "alto").notes = [
      note("later", 65, PPQ * 2),
      note("earlier", 64, PPQ, PPQ * 2),
    ];
    const draft = note("c3", 48);
    expect(planAutoBrushNote(project, draft)).toMatchObject({ ok: true });
    expect(applyAutoBrushNote(project, draft)).toEqual({
      project,
      error: "自动笔刷会造成同声部音符重叠",
      reassignments: [],
    });
    expect(getSatbTrack(project, "bass").notes).toEqual([]);
  });

  it("规划和应用均与多条额外复音声部隔离", () => {
    const base = createEmptyProject();
    base.updatedAt = "2020-01-01T00:00:00.000Z";
    const added = addAuxiliaryTrack(base).project;
    const project = addAuxiliaryTrack(added).project;
    project.updatedAt = base.updatedAt;
    project.auxiliaryTracks.forEach((track, index) => {
      track.notes = [45, 54, 63, 72, 81].map((midi) => note(`aux-${index}-${midi}`, midi));
    });
    const originalAuxiliary = structuredClone(project.auxiliaryTracks);
    const draft = note("g4", 67);
    expect(planAutoBrushNote(project, draft)).toEqual(planAutoBrushNote(base, draft));

    const result = applyAutoBrushNote(project, draft);
    const expected = applyAutoBrushNote(base, draft);
    expect(result.assignedVoice).toBe(expected.assignedVoice);
    expect(result.reassignments).toEqual(expected.reassignments);
    expect(result.project.satbTracks).toEqual(expected.project.satbTracks);
    expect(result.project.auxiliaryTracks).toBe(project.auxiliaryTracks);
    expect(result.project.auxiliaryTracks).toEqual(originalAuxiliary);
    expect(result.project.updatedAt).not.toBe(project.updatedAt);
    expectValidSatb(result.project);
  });
});
