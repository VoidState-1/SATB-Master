// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SatbAudioEngine } from "./audioEngine";
import { midiOutputManager } from "./midiOutput";

describe("音符预听通道和音色", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(midiOutputManager, "shouldSendPreview").mockReturnValue(true);
    vi.spyOn(midiOutputManager, "shouldMuteInternalSynth").mockReturnValue(true);
    vi.spyOn(midiOutputManager, "sendProgramChange").mockImplementation(() => {});
    vi.spyOn(midiOutputManager, "sendNoteOn").mockImplementation(() => {});
    vi.spyOn(midiOutputManager, "sendNoteOff").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("循环使用 15 个非鼓通道，保持 SATB 通道和旧时长参数", async () => {
    const engine = new SatbAudioEngine();
    await engine.previewNote(70, "tenor", 0.12);
    await engine.previewNote(71, "bass", { trackIndex: 27, program: 11 });
    expect(midiOutputManager.sendNoteOn).toHaveBeenNthCalledWith(1, 2, 70, 92);
    expect(midiOutputManager.sendNoteOn).toHaveBeenNthCalledWith(2, 3, 71, 92);
    expect(midiOutputManager.sendProgramChange).toHaveBeenCalledExactlyOnceWith(3, 11);
    vi.advanceTimersByTime(120);
    expect(midiOutputManager.sendNoteOff).toHaveBeenCalledExactlyOnceWith(2, 70);
    vi.mocked(midiOutputManager.sendNoteOn).mockClear();

    for (let trackIndex = 4; trackIndex < 34; trackIndex += 1) {
      await engine.previewNote(64, `aux-${trackIndex}`, { trackIndex });
    }
    const channels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
    expect(vi.mocked(midiOutputManager.sendNoteOn).mock.calls.map(([channel]) => channel))
      .toEqual([...channels.slice(4), ...channels, ...channels.slice(0, 4)]);
  });

  it("在发送 MIDI 和内置音源的 Note On 之前设置额外声部音色", async () => {
    const engine = new SatbAudioEngine();
    vi.mocked(midiOutputManager.shouldMuteInternalSynth).mockReturnValue(false);
    const synth = { programChange: vi.fn(), noteOn: vi.fn(), noteOff: vi.fn() };
    vi.spyOn(engine, "resume").mockImplementation(async () => {
      Object.assign(engine, { context: {}, synth, soundBankId: "test-sf2" });
    });
    await engine.previewNote(65, "aux-test", { trackIndex: 9, program: 42 });
    expect(midiOutputManager.sendProgramChange).toHaveBeenCalledExactlyOnceWith(10, 42);
    expect(midiOutputManager.sendNoteOn).toHaveBeenCalledExactlyOnceWith(10, 65, 92);
    expect(synth.programChange).toHaveBeenCalledExactlyOnceWith(10, 42);
    expect(synth.noteOn).toHaveBeenCalledExactlyOnceWith(10, 65, 92);
    expect(midiOutputManager.sendProgramChange).toHaveBeenCalledBefore(vi.mocked(midiOutputManager.sendNoteOn));
    expect(synth.programChange).toHaveBeenCalledBefore(synth.noteOn);
    vi.advanceTimersByTime(350);
    expect(midiOutputManager.sendNoteOff).toHaveBeenCalledExactlyOnceWith(10, 65);
    expect(synth.noteOff).toHaveBeenCalledExactlyOnceWith(10, 65);
  });
});
