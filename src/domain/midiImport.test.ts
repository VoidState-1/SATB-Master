import { writeMidi, type MidiEvent, type MidiHeader } from "midi-file";
import { describe, expect, it } from "vitest";
import { createChordRegion } from "./chords";
import { addAuxiliaryTrack } from "./editing";
import { checkHarmony } from "./harmony/registry";
import { buildMidi, toMidiString } from "./midi";
import { importMidiToAuxiliaryTracks, parseMidiForImport } from "./midiImport";
import { isSupportedKeySignature, keySignatureFifths, spellMidi, toMidi } from "./pitch";
import {
  AUXILIARY_COLOR_PALETTE,
  PPQ,
  createEmptyProject,
  deriveAuxiliaryShortName,
  validateProject,
  type NoteEvent,
} from "./project";
import { buildMeasures } from "./time";

function midiBytes(tracks: MidiEvent[][], header: Partial<MidiHeader> = {}) {
  return Uint8Array.from(writeMidi({
    header: { format: tracks.length === 1 ? 0 : 1, numTracks: tracks.length, ticksPerBeat: PPQ, ...header },
    tracks: tracks.map((track) => [...track, endOfTrack()]),
  }));
}

function endOfTrack(deltaTime = 0): MidiEvent {
  return { type: "endOfTrack", deltaTime };
}

function on(noteNumber: number, deltaTime = 0, channel = 0, velocity = 90): MidiEvent {
  return { type: "noteOn", noteNumber, velocity, deltaTime, channel };
}

function off(noteNumber: number, deltaTime = 0, channel = 0): MidiEvent {
  return { type: "noteOff", noteNumber, velocity: 0, deltaTime, channel };
}

function name(text: string): MidiEvent {
  return { type: "trackName", deltaTime: 0, text: toMidiString(text) };
}

function program(channel: number, programNumber: number): MidiEvent {
  return { type: "programChange", deltaTime: 0, channel, programNumber };
}

function tempo(microsecondsPerBeat: number, deltaTime = 0): MidiEvent {
  return { type: "setTempo", deltaTime, microsecondsPerBeat };
}

function meter(numerator: number, denominator: number, deltaTime = 0): MidiEvent {
  return { type: "timeSignature", deltaTime, numerator, denominator, metronome: 24, thirtyseconds: 8 };
}

function key(fifths: number, scale = 0, deltaTime = 0): MidiEvent {
  return { type: "keySignature", deltaTime, key: fifths, scale };
}

function projectNote(id: string, midi: number, startTick: number, durationTicks = PPQ): NoteEvent {
  return {
    id, startTick, durationTicks, pitch: spellMidi(midi),
    velocity: 80, locked: false, spellingSource: "manual",
  };
}

function noteValues(note: NoteEvent) {
  return [toMidi(note.pitch), note.startTick, note.durationTicks, note.velocity];
}

function withoutId<T extends { id: string }>(events: readonly T[]) {
  return events.map(({ id: _id, ...event }) => event);
}

describe("解析 MIDI 导入数据", () => {
  it.each([480, 192])("精确换算源 PPQ %i 的音符与时间事件", (ticksPerBeat) => {
    const parsed = parseMidiForImport(midiBytes([[
      tempo(500_000, 7), on(63, 4), off(63, 17),
    ]], { ticksPerBeat }));
    const scale = PPQ / ticksPerBeat;
    expect(parsed.sourceTicksPerBeat).toBe(ticksPerBeat);
    expect(parsed.tempoEvents).toEqual([{ tick: 7 * scale, bpm: 120 }]);
    expect(parsed.tracks[0].notes).toEqual([{
      sourceStartTick: 11, sourceDurationTicks: 17,
      startTick: 11 * scale, durationTicks: 17 * scale,
      midiNote: 63, velocity: 90, channel: 0, sourceTrack: 0,
    }]);
    expect(parsed.endTick).toBe(28 * scale);
  });

  it("换算两端 tick 并保留不足 1 tick 的音符", () => {
    const parsed = parseMidiForImport(midiBytes([[
      on(60, 1), off(60, 2), on(61), off(61, 1), on(62), off(62),
    ]], { ticksPerBeat: 1920 }));
    expect(parsed.tracks[0].notes).toMatchObject([
      { sourceStartTick: 1, sourceDurationTicks: 2, startTick: 1, durationTicks: 1 },
      { sourceStartTick: 3, sourceDurationTicks: 1, startTick: 2, durationTicks: 1 },
      { sourceStartTick: 4, sourceDurationTicks: 1, startTick: 2, durationTicks: 1 },
    ]);
    expect(parsed.endTick).toBe(3);
  });

  it("多个源 tick 换算到同一工程 tick 时保留时间上最后的事件", () => {
    const parsed = parseMidiForImport(midiBytes([
      [tempo(600_000, 1)],
      [tempo(500_000), on(60), off(60, 4)],
    ], { ticksPerBeat: 3840 }));
    expect(parsed.tempoEvents).toEqual([{ tick: 0, bpm: 100 }]);
  });

  it("按通道升序拆分 Format 0，使用各通道的首个音色", () => {
    const parsed = parseMidiForImport(midiBytes([[
      name("合奏"), program(3, 46), program(3, 6), program(0, 12), program(15, 53),
      on(64, 0, 3), on(60), on(64, 0, 3), on(67, 0, 5),
      off(60, PPQ), off(64, 0, 3), on(64, 0, 3, 0), off(67, 0, 5),
    ]]), "ensemble.mid");
    expect(parsed).toMatchObject({ format: 0, fileName: "ensemble.mid" });
    expect(parsed.tracks).toMatchObject([
      { key: "t0-c0", sourceTrack: 0, channel: 0, name: "合奏 (Ch 1)", program: 12,
        noteCount: 1, hasPolyphony: false, minMidi: 60, maxMidi: 60 },
      { key: "t0-c3", sourceTrack: 0, channel: 3, name: "合奏 (Ch 4)", program: 46,
        noteCount: 2, hasPolyphony: true, minMidi: 64, maxMidi: 64 },
      { key: "t0-c5", sourceTrack: 0, channel: 5, name: "合奏 (Ch 6)", program: 0 },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it("解码旧式拉丁轨名，并依次回退到乐器名、文件名或源轨编号", () => {
    const track: MidiEvent[] = [
      { type: "trackName", deltaTime: 0, text: " \x00Caf\xe9\x7f " },
      { type: "instrumentName", deltaTime: 0, text: "Ignored" },
      on(60), off(60, PPQ),
    ];
    const unnamed = [on(60), off(60, PPQ)];
    const instrument: MidiEvent[] = [
      name(" "),
      { type: "instrumentName", deltaTime: 0, text: "Strings" },
      ...unnamed,
    ];
    const bytes = midiBytes([track, [], instrument, unnamed]);
    expect(parseMidiForImport(bytes, "score.mid").tracks.map((item) => item.name))
      .toEqual(["Café", "Strings", "score.mid"]);
    expect(parseMidiForImport(bytes).tracks[2].name).toBe("MIDI 轨 4");
  });

  it("收集所有源轨的时间事件，钳制速度并报告不支持的拍号和调号", () => {
    const parsed = parseMidiForImport(midiBytes([
      [tempo(15_000_000), meter(3, 32), meter(33, 4), key(8), key(0, 2)],
      [tempo(1), meter(7, 8), key(-7, 1), on(64), off(64, PPQ), tempo(12_000_000)],
    ]));
    expect(parsed.tempoEvents).toEqual([{ tick: 0, bpm: 300 }, { tick: PPQ, bpm: 20 }]);
    expect(parsed.meterEvents).toEqual([{ tick: 0, numerator: 7, denominator: 8 }]);
    expect(parsed.keyEvents).toEqual([{ tick: 0, tonic: { step: "A", alter: -1 }, mode: "minor" }]);
    expect(parsed.warnings).toEqual([
      expect.stringContaining("拍号 3/32"),
      expect.stringContaining("拍号 33/4"),
      expect.stringContaining("升降号数 8"),
      expect.stringContaining("调式 2"),
    ]);
  });

  it.each([0, 1])("Format 2 的 15 个调号与领域调号表一致（调式 %i）", (scale) => {
    const fifths = Array.from({ length: 15 }, (_, index) => index - 7);
    const parsed = parseMidiForImport(midiBytes([[
      ...fifths.map((value) => key(value, scale, 1)), on(64), off(64, PPQ),
    ]], { format: 2 }));
    expect(parsed.format).toBe(2);
    expect(parsed.keyEvents.map(keySignatureFifths)).toEqual(fifths);
    expect(parsed.keyEvents.every(isSupportedKeySignature)).toBe(true);
    expect(parsed.keyEvents.every((event) => event.mode === (scale ? "minor" : "major"))).toBe(true);
  });

  it("将悬挂音符闭合到源轨末尾，末尾同时起音时延长一个源四分音符", () => {
    const parsed = parseMidiForImport(midiBytes([[
      on(60, 10), on(64, 40), on(67, 0, 1),
    ]], { ticksPerBeat: 480 }));
    expect(parsed.tracks[0].notes).toMatchObject([
      { sourceStartTick: 10, sourceDurationTicks: 40, startTick: 20, durationTicks: 80 },
      { sourceStartTick: 50, sourceDurationTicks: 480, startTick: 100, durationTicks: PPQ },
    ]);
    expect(parsed.tracks[1].notes[0].durationTicks).toBe(PPQ);
    expect(parsed.endTick).toBe(100 + PPQ);
    expect(parsed.warnings).toEqual([expect.stringContaining("已补齐 3 个未闭合音符")]);
    expect(importMidiToAuxiliaryTracks(createEmptyProject(), parsed).warnings).toEqual(parsed.warnings);
  });

  it("拒绝空输入、无音符文件、非法或截断文件、零 PPQ 与 SMPTE", () => {
    const invalid = "无法解析 MIDI 文件，请确认文件格式有效";
    expect(() => parseMidiForImport(new Uint8Array())).toThrow("MIDI 文件为空");
    expect(() => parseMidiForImport(midiBytes([[name("空轨"), off(60)]])))
      .toThrow("该 MIDI 文件不包含可导入的音符");
    expect(() => parseMidiForImport(Uint8Array.of(0, 1, 2))).toThrow(invalid);
    const complete = midiBytes([[on(60), off(60, PPQ)]]);
    expect(() => parseMidiForImport(complete.slice(0, -4))).toThrow(invalid);
    complete[12] = 0;
    complete[13] = 0;
    expect(() => parseMidiForImport(complete)).toThrow("每拍 tick 数无效");
    expect(() => parseMidiForImport(midiBytes([[on(60), off(60, PPQ)]], {
      framesPerSecond: 25, ticksPerFrame: 40,
    }))).toThrow("暂不支持 SMPTE 时间码格式的 MIDI 文件");
  });
});

describe("导入 MIDI 到额外声部", () => {
  it("闭环导入 SATB Master Format 1 的中文轨名、音符、音色和时间事件", () => {
    const { project: source } = addAuxiliaryTrack(createEmptyProject("室内乐"), {
      name: "弦乐伴奏", program: 48,
    });
    source.tempoEvents.push({ id: "tempo-change", tick: PPQ, bpm: 96 });
    source.meterEvents.push({ id: "meter-change", tick: PPQ * 4, numerator: 6, denominator: 8 });
    source.keyEvents.push({ id: "key-change", tick: PPQ * 4, tonic: { step: "E", alter: -1 }, mode: "major" });
    source.satbTracks.forEach((track, index) => {
      track.notes.push(projectNote(track.id, 72 - index * 6, 17 * index, 306));
    });
    source.auxiliaryTracks[0].notes.push(
      projectNote("aux-1", 67, PPQ * 4 + 17, 831),
      projectNote("aux-2", 75, PPQ * 4 + 31, 540),
    );
    const parsed = parseMidiForImport(buildMidi(source, { timbre: "project" }), "室内乐.mid");
    const sourceTracks = [...source.satbTracks, ...source.auxiliaryTracks];
    expect(parsed.format).toBe(1);
    expect(parsed.tracks.map((track) => track.name)).toEqual(sourceTracks.map((track) => track.name));
    expect(parsed.tracks.map((track) => track.program)).toEqual(sourceTracks.map((track) => track.program));
    expect(parsed.tracks.map((track) => track.sourceTrack)).toEqual([1, 2, 3, 4, 5]);

    const target = createEmptyProject();
    const result = importMidiToAuxiliaryTracks(target, parsed, { applyTimingEvents: true });
    expect(result).toMatchObject({ importedNoteCount: 6, deduplicatedNoteCount: 0, warnings: [] });
    expect(result.error).toBeUndefined();
    const output = result.project;
    expect(validateProject(output)).toBe(true);
    expect(output.satbTracks).toEqual(target.satbTracks);
    expect(output.auxiliaryTracks.map((track) => track.name)).toEqual([
      "女高音 2", "女低音 2", "男高音 2", "男低音 2", "弦乐伴奏",
    ]);
    expect(result.importedTrackIds).toEqual(output.auxiliaryTracks.map((track) => track.id));
    expect(new Set(result.importedTrackIds).size).toBe(5);
    expect(withoutId(output.tempoEvents)).toEqual(withoutId(source.tempoEvents));
    expect(withoutId(output.meterEvents)).toEqual(withoutId(source.meterEvents));
    expect(withoutId(output.keyEvents)).toEqual(withoutId(source.keyEvents));
    const importId = output.auxiliaryTracks[0].notes[0].importOrigin?.importId;
    expect(importId).toEqual(expect.any(String));
    output.auxiliaryTracks.forEach((track, index) => {
      expect(track.notes.map(noteValues)).toEqual(sourceTracks[index].notes.map(noteValues));
      track.notes.forEach((note) => {
        expect(note.spellingSource).toBe("midi-inferred");
        expect(note.importOrigin).toEqual({
          importId,
          sourceTrack: index + 1,
          channel: index,
          sourceStartTick: note.startTick,
          sourceDurationTicks: note.durationTicks,
          sourceMidiNote: toMidi(note.pitch),
        });
      });
    });
  });

  it("默认略过打击乐，显式选择时可导入，纯打击乐文件默认全选", () => {
    const melodic = [on(60, 0, 2), off(60, PPQ, 2)];
    const drums = [on(36, 0, 9), off(36, PPQ, 9)];
    const parsed = parseMidiForImport(midiBytes([melodic, drums]));
    const project = createEmptyProject();
    expect(parsed.tracks[1]).toMatchObject({
      key: "t1-c9", channel: 9, isPercussion: true, name: "MIDI 轨 2 (Ch 10 打击乐)",
    });
    const defaults = importMidiToAuxiliaryTracks(project, parsed);
    expect(defaults.project.auxiliaryTracks.map((track) => track.notes[0].importOrigin?.channel))
      .toEqual([2]);
    const explicit = importMidiToAuxiliaryTracks(project, parsed, { selectedTrackKeys: ["t1-c9"] });
    expect(explicit.project.auxiliaryTracks.map((track) => track.notes[0].importOrigin?.channel))
      .toEqual([9]);
    const percussionOnly = importMidiToAuxiliaryTracks(
      project, parseMidiForImport(midiBytes([drums, drums])),
    );
    expect(percussionOnly.importedTrackIds).toHaveLength(2);
  });

  it("按 FIFO 配对，只去重同轨的同音高同起止音符", () => {
    const parsed = parseMidiForImport(midiBytes([
      [
        on(60, 0, 0, 71), on(60, 0, 0, 91), on(64),
        on(60, 10), off(60, 20), off(60), off(64), off(60, 10), on(60, 0), off(60, 10),
      ],
      [on(60), off(60, 30)],
    ]));
    expect(parsed.tracks[0]).toMatchObject({
      noteCount: 5, hasPolyphony: true, minMidi: 60, maxMidi: 64,
    });
    const result = importMidiToAuxiliaryTracks(createEmptyProject(), parsed);
    expect(result).toMatchObject({ importedNoteCount: 5, deduplicatedNoteCount: 1 });
    expect(result.project.auxiliaryTracks[0].notes.map(noteValues)).toEqual([
      [60, 0, 30, 71], [64, 0, 30, 90], [60, 10, 30, 90], [60, 40, 10, 90],
    ]);
    expect(result.project.auxiliaryTracks[1].notes.map(noteValues)).toEqual([[60, 0, 30, 90]]);
    expect(validateProject(result.project)).toBe(true);
  });

  it("避免名称与颜色冲突并设置辅助轨的属性", () => {
    const { project } = addAuxiliaryTrack(createEmptyProject(), {
      name: "伴奏", color: AUXILIARY_COLOR_PALETTE[0].toUpperCase(),
    });
    const parsed = parseMidiForImport(midiBytes(AUXILIARY_COLOR_PALETTE.map(
      () => [name("伴奏"), program(0, 31), on(60), off(60, PPQ)],
    )));
    const result = importMidiToAuxiliaryTracks(project, parsed, { showInScorePreview: true });
    const tracks = result.project.auxiliaryTracks.slice(1);
    expect(tracks.map((track) => track.color))
      .toEqual([...AUXILIARY_COLOR_PALETTE.slice(1), AUXILIARY_COLOR_PALETTE[0]]);
    tracks.forEach((track, index) => {
      expect(track).toMatchObject({
        name: "伴奏 " + (index + 2),
        shortName: deriveAuxiliaryShortName(track.name, index + 1),
        kind: "auxiliary", role: "midi-import", program: 31, showInScorePreview: true,
        participatesInHarmony: false, monophonic: false,
        visible: true, muted: false, solo: false, locked: false, volume: 0.85, pan: 0,
      });
    });
    expect(project.auxiliaryTracks).toHaveLength(1);
    expect(validateProject(result.project)).toBe(true);
  });

  it.each([123, 4 * PPQ])("根据当前拍号补齐整小节（导入时值 %i tick）", (duration) => {
    const project = createEmptyProject();
    project.lengthTicks = 16 * PPQ;
    const parsed = parseMidiForImport(midiBytes([
      [on(60, 16 * PPQ), off(60, duration)],
      [on(60, 40 * PPQ), off(60, PPQ)],
    ]));
    const result = importMidiToAuxiliaryTracks(project, parsed, { selectedTrackKeys: ["t0-c0"] });
    expect(result.extendedLengthTicks).toBe(20 * PPQ);
    expect(result.project.lengthTicks).toBe(20 * PPQ);
    expect(buildMeasures(result.project).at(-1)?.startTick).toBe(16 * PPQ);
    expect(project.lengthTicks).toBe(16 * PPQ);
    expect(validateProject(result.project)).toBe(true);
  });

  it("从指定位置插入，按偏移后的 MIDI 拍号扩展并补齐初始事件", () => {
    const project = createEmptyProject();
    project.lengthTicks = 4 * PPQ;
    const parsed = parseMidiForImport(midiBytes([[
      meter(3, 4), tempo(500_000), key(-2), on(70, 3 * PPQ), off(70, 1),
      tempo(400_000, 10 * PPQ), meter(5, 4), key(2),
    ]]));
    const result = importMidiToAuxiliaryTracks(project, parsed, {
      applyTimingEvents: true, startTickOffset: 4 * PPQ,
    });
    expect(result.extendedLengthTicks).toBe(10 * PPQ);
    expect(result.project.meterEvents).toEqual([
      project.meterEvents[0],
      expect.objectContaining({ tick: 4 * PPQ, numerator: 3, denominator: 4 }),
    ]);
    expect(result.project.tempoEvents).toEqual([
      project.tempoEvents[0], expect.objectContaining({ tick: 4 * PPQ, bpm: 120 }),
    ]);
    expect(result.project.keyEvents).toEqual([
      project.keyEvents[0],
      expect.objectContaining({ tick: 4 * PPQ, tonic: { step: "B", alter: -1 }, mode: "major" }),
    ]);
    expect(result.project.auxiliaryTracks[0].notes[0]).toMatchObject({
      startTick: 7 * PPQ,
      durationTicks: 1,
      pitch: { step: "B", alter: -1, octave: 4 },
      importOrigin: { sourceStartTick: 3 * PPQ, sourceDurationTicks: 1 },
    });
    expect(validateProject(result.project)).toBe(true);
  });

  it("仅在明确启用时应用时间事件，保留已锁定的 SATB 和跨调和弦", () => {
    const project = createEmptyProject();
    project.tempoEvents.push({ id: "second-tempo", tick: 4 * PPQ, bpm: 113 });
    project.meterEvents.push({ id: "second-meter", tick: 4 * PPQ, numerator: 2, denominator: 4 });
    project.keyEvents.push({ id: "second-key", tick: 4 * PPQ, tonic: { step: "A", alter: 0 }, mode: "minor" });
    const soprano = project.satbTracks[0];
    soprano.locked = true;
    soprano.notes.push(
      { ...projectNote("later", 72, 2 * PPQ), locked: true },
      projectNote("earlier", 70, 0),
    );
    project.chordTrack.regions.push({
      ...createChordRegion(project, 0, 2 * PPQ, {
        degree: 1, degreeAlteration: 0, quality: "major", inversion: 0,
        source: "manual", confidence: "certain",
      }, "locked-chord"),
      locked: true,
    });
    const before = structuredClone(project);
    const parsed = parseMidiForImport(midiBytes([[
      tempo(500_000), meter(3, 4), key(-2), on(70),
      key(1, 0, PPQ), key(-3, 1, PPQ), off(70, 10),
    ]]));
    const withoutTiming = importMidiToAuxiliaryTracks(project, parsed, { applyTimingEvents: false });
    expect(withoutTiming.project.tempoEvents).toEqual(before.tempoEvents);
    expect(withoutTiming.project.meterEvents).toEqual(before.meterEvents);
    expect(withoutTiming.project.keyEvents).toEqual(before.keyEvents);
    expect(withoutTiming.project.satbTracks).toEqual(before.satbTracks);

    const withTiming = importMidiToAuxiliaryTracks(project, parsed, { applyTimingEvents: true });
    expect(withTiming.error).toBeUndefined();
    expect(withTiming.warnings).toEqual([expect.stringContaining("既有和弦区域内")]);
    expect(withoutId(withTiming.project.tempoEvents)).toEqual(parsed.tempoEvents);
    expect(withoutId(withTiming.project.meterEvents)).toEqual(parsed.meterEvents);
    expect(withoutId(withTiming.project.keyEvents)).toEqual([parsed.keyEvents[0], parsed.keyEvents[2]]);
    expect(withTiming.project.chordTrack.regions).toMatchObject([{
      id: "locked-chord", startTick: 0, durationTicks: 2 * PPQ, locked: true,
      identity: { root: { step: "B", alter: -1 } },
    }]);
    expect(withTiming.project.satbTracks).toEqual(before.satbTracks);
    expect(project).toEqual(before);
    expect(validateProject(withTiming.project)).toBe(true);
  });

  it("MIDI 缺少时间事件时沿用工程的初始事件", () => {
    const project = createEmptyProject();
    project.meterEvents[0] = { id: "opening-meter", tick: 0, numerator: 5, denominator: 8, beatGrouping: [2, 3] };
    const parsed = parseMidiForImport(midiBytes([[on(60), off(60, PPQ)]]));
    const result = importMidiToAuxiliaryTracks(project, parsed, { applyTimingEvents: true });
    expect(result.project.tempoEvents).toEqual(project.tempoEvents);
    expect(result.project.meterEvents).toEqual(project.meterEvents);
    expect(result.project.keyEvents).toEqual(project.keyEvents);
    expect(validateProject(result.project)).toBe(true);
  });

  it("拒绝空选择、无效插入位置和校验失败的导入，原工程不变", () => {
    const project = createEmptyProject();
    const parsed = parseMidiForImport(midiBytes([[on(60), off(60, PPQ)]]));
    for (const selectedTrackKeys of [[], ["unknown"]]) {
      const result = importMidiToAuxiliaryTracks(project, parsed, { selectedTrackKeys });
      expect(result.project).toBe(project);
      expect(result).toMatchObject({ error: "请至少选择一条要导入的轨道", importedTrackIds: [], importedNoteCount: 0 });
    }
    for (const startTickOffset of [-1, 1.5, Number.MAX_SAFE_INTEGER]) {
      const result = importMidiToAuxiliaryTracks(project, parsed, { startTickOffset });
      expect(result.project).toBe(project);
      expect(result.error).toBeDefined();
    }
    const track = { ...parsed.tracks[0], notes: [{ ...parsed.tracks[0].notes[0], velocity: 0 }] };
    const invalid = importMidiToAuxiliaryTracks(project, { ...parsed, tracks: [track] });
    expect(invalid.project).toBe(project);
    expect(invalid).toMatchObject({ error: "MIDI 导入后的工程校验失败", importedNoteCount: 0 });
    expect(project.auxiliaryTracks).toEqual([]);
  });

  it("不协和及平行五八度的辅助轨不影响 SATB 和声检查结果", () => {
    const project = createEmptyProject();
    project.satbTracks.forEach((track, index) => {
      const pitches = [72, 67, 64, 48];
      track.notes.push(
        projectNote(track.id + "-1", pitches[index], 0),
        projectNote(track.id + "-2", pitches[index] + 2, PPQ),
      );
    });
    const before = checkHarmony(project);
    expect(before.diagnostics.length).toBeGreaterThan(0);

    const dissonantParallelChords = Array.from({ length: 12 }, (_, index) => {
      const pitches = [0, 1, 6, 7, 12].map((interval) => 45 + index + interval);
      return [
        ...pitches.map((pitch) => on(pitch)),
        ...pitches.map((pitch, voice) => off(pitch, voice === 0 ? PPQ / 4 : 0)),
      ];
    }).flat();
    const parsed = parseMidiForImport(midiBytes([[name("参考和声"), ...dissonantParallelChords]]));
    const result = importMidiToAuxiliaryTracks(project, parsed);
    expect(result.importedNoteCount).toBe(60);
    expect(result.project.satbTracks).toEqual(project.satbTracks);
    expect(checkHarmony(result.project)).toEqual(before);
  });
});
