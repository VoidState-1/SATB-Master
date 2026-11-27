import { describe, expect, it } from "vitest";
import { importNoteTracks } from "./midiImport";
import { toMidi } from "./pitch";
import { createEmptyProject, PPQ } from "./project";
import { parseSvpForImport } from "./svpImport";

const quarter = 705_600_000;
const encode = (source: unknown) => new TextEncoder().encode(JSON.stringify(source) + "\0\n");

describe("导入 Synthesizer V 工程", () => {
  it("按链接实例应用时间偏移、移调和裁剪，保留速度与拍号", () => {
    const parsed = parseSvpForImport(encode({
      time: {
        tempo: [{ position: 0, bpm: 110 }, { position: 3 * quarter, bpm: 125 }],
        meter: [{ index: 0, numerator: 3, denominator: 4 }, { index: 1, numerator: 4, denominator: 4 }],
      },
      library: [{ uuid: "phrase", notes: [{ onset: 0, duration: quarter, pitch: 62 }] }],
      tracks: [{
        name: "主旋律",
        mainGroup: { notes: [{ onset: 0, duration: quarter, pitch: 60 }] },
        groups: [
          { groupID: "phrase", blickOffset: quarter, pitchOffset: 2 },
          { groupID: "phrase", blickOffset: 3 * quarter, blickAbsoluteEnd: 3.5 * quarter, pitchOffset: -2 },
        ],
      }],
    }), "sample.svp");
    expect(parsed.tracks[0].notes.map(({ midiNote, startTick, durationTicks }) => [midiNote, startTick, durationTicks]))
      .toEqual([[60, 0, PPQ], [64, PPQ, PPQ], [60, 3 * PPQ, PPQ / 2]]);
    const result = importNoteTracks(createEmptyProject(), parsed, { applyTimingEvents: true, satbDestinations: { "svp-0": "soprano" } });
    expect(result.error).toBeUndefined();
    expect(result.project.tempoEvents[1]).toMatchObject({ tick: 3 * PPQ, bpm: 125 });
    expect(result.project.meterEvents[1]).toMatchObject({ tick: 3 * PPQ, numerator: 4, denominator: 4 });
    expect(result.project.satbTracks[0].notes.map(({ pitch }) => toMidi(pitch))).toEqual([60, 64, 60]);
  });

  it("忽略没有歌声音符的文件", () => {
    expect(() => parseSvpForImport(encode({ tracks: [{ groups: [{ isInstrumental: true }] }] }), "empty.svp"))
      .toThrow("没有可导入的歌声音符");
  });
});
