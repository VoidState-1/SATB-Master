import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  PPQ,
  type ProjectDocument,
} from "../../project";
import { toMidi } from "../../pitch";
import {
  dematerializeRuleTestProject,
  materializeUnknownRuleTestProject,
  materializeRuleTestProject,
} from "./projectFixture";

function legacyFixture(project: ProjectDocument) {
  return {
    schemaVersion: 2,
    ppq: project.ppq,
    lengthTicks: project.lengthTicks,
    tempoEvents: project.tempoEvents,
    meterEvents: project.meterEvents,
    keyEvents: project.keyEvents.map((event) => ({
      ...event,
      tonic: 0,
    })),
    tracks: project.satbTracks.map((track) => {
      const {
        kind: _kind,
        voice: _voice,
        participatesInHarmony: _participatesInHarmony,
        monophonic: _monophonic,
        ...legacyTrack
      } = track;
      return {
        ...legacyTrack,
        notes: track.notes.map((note) => {
          const { pitch, spellingSource: _spellingSource, ...legacyNote } = note;
          return { ...legacyNote, midiNote: toMidi(pitch) };
        }),
      };
    }),
    chordTrack: {
      ...project.chordTrack,
      displayMode: "both",
    },
  };
}

describe("规则测试工程投影", () => {
  it("往返保留全部规则输入字段并移除普通工程元数据", () => {
    const project = createEmptyProject("需要移除的标题");
    project.author = "作者";
    project.notes = "普通工程备注";
    project.satbTracks[0].notes.push({
      id: "s-note",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "G", alter: 0, octave: 5 },
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    });
    const fixture = dematerializeRuleTestProject(project);

    expect(fixture).not.toHaveProperty("title");
    expect(fixture).not.toHaveProperty("ruleProfile");
    expect(fixture).not.toHaveProperty("audio");
    expect(materializeRuleTestProject(fixture, "恢复标题")).toMatchObject({
      title: "恢复标题",
      satbTracks: project.satbTracks,
      tempoEvents: project.tempoEvents,
      meterEvents: project.meterEvents,
      keyEvents: project.keyEvents,
      chordTrack: project.chordTrack,
    });
  });

  it("用例格式版本不妨碍旧工程 fixture 迁移到当前版本", () => {
    const project = createEmptyProject();
    project.satbTracks[0].notes.push({
      id: "legacy-note",
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "C", alter: 0, octave: 5 },
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    });

    const migrated = materializeUnknownRuleTestProject(
      legacyFixture(project),
      "旧输入",
    );

    expect(migrated?.schemaVersion).toBe(3);
    expect(migrated?.satbTracks[0].notes[0]).toMatchObject({
      id: "legacy-note",
      pitch: { step: "C", alter: 0, octave: 5 },
    });
  });
});
