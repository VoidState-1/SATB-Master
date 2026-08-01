import { describe, expect, it } from "vitest";
import {
  formatDeveloperFieldValue,
  inspectChordRegion,
  inspectNoteEvent,
} from "./developerInspection";
import { createEmptyProject, type NoteEvent } from "./model";
import { spellMidi } from "./pitch";

function paths(rows: ReturnType<typeof inspectNoteEvent>["rows"]) {
  return rows.map((item) => item.path);
}

describe("开发者事件检查投影", () => {
  it("音符会列出全部基础、拼写、角色和 MIDI 来源字段", () => {
    const note: NoteEvent = {
      id: "note-debug",
      startTick: 120,
      durationTicks: 480,
      pitch: spellMidi(66),
      velocity: 92,
      locked: false,
      spellingSource: "manual",
    };
    const result = inspectNoteEvent("soprano", note);

    expect(result.modelName).toBe("NoteEvent");
    expect(paths(result.rows)).toEqual([
      "id",
      "startTick",
      "durationTicks",
      "pitch.step",
      "pitch.alter",
      "pitch.octave",
      "velocity",
      "locked",
      "spellingSource",
      "nonChordToneRole",
      "importOrigin",
      "importOrigin.importId",
      "importOrigin.sourceTrack",
      "importOrigin.channel",
      "importOrigin.sourceStartTick",
      "importOrigin.sourceDurationTicks",
      "importOrigin.sourceMidiNote",
    ]);
    expect(
      result.rows.find((item) => item.path === "importOrigin.importId")?.value,
    ).toBeUndefined();
    expect(result.rawJson).toContain('"id": "note-debug"');
  });

  it("和弦即使没有功能分析也会列出全部可选功能字段", () => {
    const chord = {
      id: "chord-debug",
      startTick: 0,
      durationTicks: 960,
      identity: {
        root: { step: "C" as const, alter: 0 as const },
        quality: "major" as const,
        extensions: [9 as const],
        alterations: [{ degree: 9 as const, alter: 1 as const }],
        bass: { step: "E" as const, alter: 0 as const },
      },
      locked: false,
    };
    const result = inspectChordRegion(chord);
    const resultPaths = paths(result.rows);

    expect(resultPaths).toEqual(
      expect.arrayContaining([
        "identity.extensions[0]",
        "identity.alterations[0].degree",
        "identity.alterations[0].alter",
        "function.localKey.tonic.step",
        "function.applied.targetDegree",
        "function.cadenceRole",
        "function.source",
      ]),
    );
    expect(
      result.rows.find((item) => item.path === "function")?.value,
    ).toBeUndefined();
  });

  it("未设置值与布尔值使用明确的调试文本", () => {
    expect(formatDeveloperFieldValue(undefined)).toBe("未设置（undefined）");
    expect(formatDeveloperFieldValue(false)).toBe("false");
  });

  it("投影不会修改工程事件", () => {
    const project = createEmptyProject();
    const chord = {
      id: "tonic",
      startTick: 0,
      durationTicks: 960,
      identity: {
        root: { step: "C" as const, alter: 0 as const },
        quality: "major" as const,
        extensions: [],
        alterations: [],
        bass: { step: "C" as const, alter: 0 as const },
      },
      locked: false,
    };
    project.chordTrack.regions.push(chord);
    const before = JSON.stringify(project);
    inspectChordRegion(chord);
    expect(JSON.stringify(project)).toBe(before);
  });
});
