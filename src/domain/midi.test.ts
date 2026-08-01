import { parseMidi } from "midi-file";
import { describe, expect, it } from "vitest";
import { buildMidi } from "./midi";
import { createChordRegion } from "./chords";
import { createEmptyProject, PPQ } from "./model";

describe("MIDI Type 1 导出", () => {
  it("导出全局轨与四条声部轨，并保留速度、拍号和调号", () => {
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

    const parsed = parseMidi(Array.from(buildMidi(project)));
    expect(parsed.header.format).toBe(1);
    expect(parsed.header.ticksPerBeat).toBe(PPQ);
    expect(parsed.tracks).toHaveLength(5);
    expect(
      parsed.tracks[0].filter((event) => event.type === "setTempo"),
    ).toHaveLength(2);
    expect(
      parsed.tracks[0].some((event) => event.type === "timeSignature"),
    ).toBe(true);
    expect(
      parsed.tracks[0].some((event) => event.type === "keySignature"),
    ).toBe(true);
    expect(
      parsed.tracks[1].some(
        (event) => event.type === "noteOn" && event.noteNumber === 72,
      ),
    ).toBe(true);
  });

  it("仅在和弦轨非空时创建 Chords 标记轨", () => {
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
        },
        "chord-1",
      ),
    );

    const parsed = parseMidi(Array.from(buildMidi(project)));
    expect(parsed.tracks).toHaveLength(6);
    expect(
      parsed.tracks[5].some(
        (event) => event.type === "marker" && event.text === "I",
      ),
    ).toBe(true);
    expect(
      parsed.tracks[5].some(
        (event) => event.type === "marker" && event.text === "N.C.",
      ),
    ).toBe(true);
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
});
