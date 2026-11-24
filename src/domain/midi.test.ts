import { parseMidi } from "midi-file";
import { describe, expect, it } from "vitest";
import {
  buildMidi,
  fromMidiString,
  midiFileName,
  toMidiString,
  type MidiExportLayout,
} from "./midi";
import { createChordRegion } from "./chords";
import { addAuxiliaryTrack } from "./editing";
import { createEmptyProject, PPQ } from "./project";

const layoutTrackCounts = [
  ["satb-separate", 5],
  ["piano-grand-staff", 3],
  ["single-track", 2],
] as const satisfies readonly (readonly [MidiExportLayout, number])[];

function projectWithAuxiliaryTracks(count: number) {
  let project = createEmptyProject();
  for (let index = 0; index < count; index++) {
    ({ project } = addAuxiliaryTrack(project, { name: `额外声部 ${index + 1}` }));
    project.auxiliaryTracks[index].notes.push({
      id: `aux-note-${index}`,
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "D", alter: 0, octave: 4 },
      velocity: 80,
      locked: false,
      spellingSource: "manual",
    });
  }
  return project;
}

describe("MIDI Type 1 导出", () => {
  it("支持 UTF-8 文本二进制安全无损转换", () => {
    const text = "女高音 (Soprano) · 调性 C";
    const binary = toMidiString(text);
    expect(fromMidiString(binary)).toBe(text);
  });

  it("分轨总谱模式：导出规范的四声部轨名、标准乐器名称与低音声部谱号识别标识", () => {
    const project = createEmptyProject();
    project.tempoEvents.push({ id: "tempo-2", tick: PPQ * 4, bpm: 96 });
    project.satbTracks[0].notes.push({
      id: "s-1",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "C", alter: 0, octave: 5 },
      velocity: 90,
      locked: false,
      spellingSource: "manual",
    });
    project.satbTracks[2].notes.push({
      id: "t-1",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "F", alter: 0, octave: 3 },
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    });

    const parsed = parseMidi(
      Array.from(buildMidi(project, { layout: "satb-separate", timbre: "piano" })),
    );
    expect(parsed.header.format).toBe(1);
    expect(parsed.header.ticksPerBeat).toBe(PPQ);
    expect(parsed.tracks).toHaveLength(5); // 1 global + 4 SATB

    // Global track
    expect(
      parsed.tracks[0].filter((event) => event.type === "setTempo"),
    ).toHaveLength(2);
    expect(
      parsed.tracks[0].some((event) => event.type === "timeSignature"),
    ).toBe(true);
    expect(
      parsed.tracks[0].some((event) => event.type === "keySignature"),
    ).toBe(true);

    // Track 1 (Soprano)
    const sopranoTrackName = parsed.tracks[1].find((e) => e.type === "trackName");
    const sopranoInstName = parsed.tracks[1].find((e) => e.type === "instrumentName");
    expect(fromMidiString((sopranoTrackName as { text: string }).text)).toBe("女高音");
    expect(fromMidiString((sopranoInstName as { text: string }).text)).toBe("Soprano");

    // Track 3 (Tenor)
    const tenorTrackName = parsed.tracks[3].find((e) => e.type === "trackName");
    const tenorInstName = parsed.tracks[3].find((e) => e.type === "instrumentName");
    expect(fromMidiString((tenorTrackName as { text: string }).text)).toBe("男高音");
    expect(fromMidiString((tenorInstName as { text: string }).text)).toBe("Tenor");

    // Track 4 (Bass)
    const bassTrackName = parsed.tracks[4].find((e) => e.type === "trackName");
    const bassInstName = parsed.tracks[4].find((e) => e.type === "instrumentName");
    expect(fromMidiString((bassTrackName as { text: string }).text)).toBe("男低音");
    expect(fromMidiString((bassInstName as { text: string }).text)).toBe("Bass");

    // Timbre program is piano (0)
    expect(
      parsed.tracks[1].some(
        (e) => e.type === "programChange" && e.programNumber === 0,
      ),
    ).toBe(true);
  });

  it("合唱人声音色选项统一四个声部的 GM Program 52", () => {
    const project = createEmptyProject();
    const parsed = parseMidi(
      Array.from(buildMidi(project, { layout: "satb-separate", timbre: "choir" })),
    );
    for (let i = 1; i <= 4; i++) {
      expect(
        parsed.tracks[i].some(
          (e) => e.type === "programChange" && e.programNumber === 52,
        ),
      ).toBe(true);
    }
  });

  it("钢琴大谱表模式：合并为右手（高音谱表SA）与左手（低音谱表TB）双轨结构", () => {
    const project = createEmptyProject();
    project.satbTracks[0].notes.push({
      id: "s-1",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "C", alter: 0, octave: 5 },
      velocity: 90,
      locked: false,
      spellingSource: "manual",
    });
    project.satbTracks[1].notes.push({
      id: "a-1",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "G", alter: 0, octave: 4 },
      velocity: 85,
      locked: false,
      spellingSource: "manual",
    });
    project.satbTracks[2].notes.push({
      id: "t-1",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "E", alter: 0, octave: 4 },
      velocity: 85,
      locked: false,
      spellingSource: "manual",
    });
    project.satbTracks[3].notes.push({
      id: "b-1",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "C", alter: 0, octave: 3 },
      velocity: 90,
      locked: false,
      spellingSource: "manual",
    });

    const parsed = parseMidi(
      Array.from(
        buildMidi(project, {
          layout: "piano-grand-staff",
          timbre: "piano",
          includeChords: false,
        }),
      ),
    );

    // 1 global track + 1 right hand track + 1 left hand track = 3 tracks
    expect(parsed.tracks).toHaveLength(3);

    // Upper staff (Right Hand)
    const rhTrackName = parsed.tracks[1].find((e) => e.type === "trackName");
    expect(fromMidiString((rhTrackName as { text: string }).text)).toBe("钢琴");
    const rhNotes = parsed.tracks[1].filter((e) => e.type === "noteOn");
    expect(rhNotes).toHaveLength(2);
    // Channel 0 (Soprano C5=72 and Alto G4=67 on shared channel)
    expect(rhNotes.some((n) => n.channel === 0 && n.noteNumber === 72)).toBe(true);
    expect(rhNotes.some((n) => n.channel === 0 && n.noteNumber === 67)).toBe(true);

    // Lower staff (Left Hand)
    const lhTrackName = parsed.tracks[2].find((e) => e.type === "trackName");
    expect(fromMidiString((lhTrackName as { text: string }).text)).toBe("钢琴");
    const lhNotes = parsed.tracks[2].filter((e) => e.type === "noteOn");
    expect(lhNotes).toHaveLength(2);
    // Channel 0 (Tenor E4=64 and Bass C3=48 on shared channel)
    expect(lhNotes.some((n) => n.channel === 0 && n.noteNumber === 64)).toBe(true);
    expect(lhNotes.some((n) => n.channel === 0 && n.noteNumber === 48)).toBe(true);
  });

  it("仅在和弦轨非空且 includeChords=true 时创建和弦标记轨", () => {
    const project = createEmptyProject();
    project.chordTrack.regions.push(
      createChordRegion(
        project,
        0,
        PPQ,
        {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          source: "manual",
          confidence: "certain",
        },
        "chord-1",
      ),
    );

    const parsed = parseMidi(Array.from(buildMidi(project, true)));
    expect(parsed.tracks).toHaveLength(6);
    const chordTrack = parsed.tracks[5];
    const markerI = chordTrack.find(
      (e) => e.type === "marker" && fromMidiString(e.text) === "I",
    );
    expect(markerI).toBeDefined();

    const withoutChords = parseMidi(
      Array.from(buildMidi(project, { includeChords: false })),
    );
    expect(withoutChords.tracks).toHaveLength(5);
  });

  it("把辅助轨作为独立 MIDI 轨导出", () => {
    const project = createEmptyProject();
    project.auxiliaryTracks.push({
      id: "aux-midi",
      kind: "auxiliary",
      role: "midi-import",
      name: "导入 MIDI",
      shortName: "MIDI",
      notes: [
        {
          id: "aux-note",
          startTick: 0,
          durationTicks: PPQ,
          pitch: { step: "D", alter: -1, octave: 4 },
          velocity: 84,
          locked: false,
          spellingSource: "midi-inferred",
        },
      ],
      participatesInHarmony: false,
      monophonic: false,
      visible: true,
      muted: false,
      solo: false,
      locked: false,
      volume: 0.8,
      pan: 0,
      program: 10,
    });

    const parsed = parseMidi(Array.from(buildMidi(project)));
    expect(parsed.tracks).toHaveLength(6);
    expect(
      parsed.tracks[5].some(
        (event) => event.type === "noteOn" && event.noteNumber === 61,
      ),
    ).toBe(true);
  });

  it.each(layoutTrackCounts)("%s 按工程顺序选择独立的额外声部轨", (layout, baseCount) => {
    const project = projectWithAuxiliaryTracks(3);
    const [first, , last] = project.auxiliaryTracks;
    const all = parseMidi(buildMidi(project, { layout, includeAuxiliaryTracks: true }));
    expect(all.tracks).toHaveLength(baseCount + 3);

    const selected = parseMidi(buildMidi(project, {
      layout,
      auxiliaryTrackIds: [last.id, "unknown-track", first.id, last.id],
    }));
    expect(selected.tracks).toHaveLength(baseCount + 2);
    expect(selected.tracks.slice(baseCount).map((events) => {
      const name = events.find((event) => event.type === "trackName");
      return name && fromMidiString(name.text);
    })).toEqual([first.name, last.name]);

    for (const options of [
      { includeAuxiliaryTracks: false, auxiliaryTrackIds: [first.id] },
      { includeAuxiliaryTracks: true, auxiliaryTrackIds: [] },
    ]) {
      const excluded = parseMidi(buildMidi(project, { layout, ...options }));
      expect(excluded.tracks).toHaveLength(baseCount);
      expect(excluded.tracks.flat().some((event) => event.type === "noteOn")).toBe(false);
    }
  });

  it.each(layoutTrackCounts)("%s 循环使用全部 15 个非鼓轨通道", (layout, baseCount) => {
    const project = projectWithAuxiliaryTracks(20);
    const { tracks } = parseMidi(buildMidi(project, { layout }));
    const auxiliaryTracks = tracks.slice(baseCount);
    const expectedChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
    const offset = layout === "satb-separate" ? 4 : 1;
    expect(auxiliaryTracks).toHaveLength(20);
    auxiliaryTracks.forEach((events, index) => {
      const channel = expectedChannels[(offset + index) % expectedChannels.length];
      expect(events.filter((event) => "channel" in event)).toEqual([
        expect.objectContaining({ type: "programChange", channel }),
        expect.objectContaining({ type: "noteOn", channel }),
        expect.objectContaining({ type: "noteOff", channel }),
      ]);
    });
  });

  it("单轨布局只在额外声部自己的轨道中写入其音符", () => {
    const project = projectWithAuxiliaryTracks(1);
    project.satbTracks[0].notes.push({
      ...project.auxiliaryTracks[0].notes[0],
      id: "soprano-note",
      pitch: { step: "C", alter: 0, octave: 5 },
    });
    const { tracks } = parseMidi(buildMidi(project, { layout: "single-track" }));
    expect(tracks.map((events) => events
      .filter((event) => event.type === "noteOn" || event.type === "noteOff")
      .map(({ type, noteNumber }) => [type, noteNumber]),
    )).toEqual([
      [],
      [["noteOn", 72], ["noteOff", 72]],
      [["noteOn", 62], ["noteOff", 62]],
    ]);
  });

  it("正确生成不同排版模式的文件名后缀", () => {
    const project = createEmptyProject("我的和声练习");
    expect(midiFileName(project, "single-track")).toBe("我的和声练习（单轨）");
    expect(midiFileName(project, "satb-separate")).toBe("我的和声练习（分轨总谱）");
    expect(midiFileName(project, "piano-grand-staff")).toBe("我的和声练习（大谱表）");
  });

  it("支持单轨合并模式导出", () => {
    const project = createEmptyProject();
    project.satbTracks[0].notes.push({
      id: "s1",
      startTick: 0,
      durationTicks: 480,
      pitch: { step: "C", alter: 0, octave: 5 },
      velocity: 80,
      locked: false,
      spellingSource: "manual",
    });
    project.satbTracks[3].notes.push({
      id: "b1",
      startTick: 0,
      durationTicks: 480,
      pitch: { step: "C", alter: 0, octave: 3 },
      velocity: 80,
      locked: false,
      spellingSource: "manual",
    });

    const parsed = parseMidi(
      Array.from(buildMidi(project, { layout: "single-track" })),
    );
    // Global track + 1 content track
    expect(parsed.tracks).toHaveLength(2);
  });
});
