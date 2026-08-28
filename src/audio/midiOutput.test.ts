import { beforeEach, describe, expect, it, vi } from "vitest";
import { MidiOutputManager } from "./midiOutput";

describe("MidiOutputManager", () => {
  let mockOutput: {
    id: string;
    name: string;
    manufacturer: string;
    state: string;
    send: ReturnType<typeof vi.fn>;
  };
  let mockOutputs: Map<string, typeof mockOutput>;
  let mockAccess: {
    outputs: Map<string, typeof mockOutput>;
    onstatechange: null | (() => void);
  };
  let memoryStore: Record<string, string>;

  beforeEach(() => {
    memoryStore = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memoryStore[key] ?? null,
      setItem: (key: string, value: string) => {
        memoryStore[key] = value;
      },
      removeItem: (key: string) => {
        delete memoryStore[key];
      },
      clear: () => {
        memoryStore = {};
      },
    });

    mockOutput = {
      id: "device-1",
      name: "loopMIDI Port",
      manufacturer: "Tobias Erichsen",
      state: "connected",
      send: vi.fn(),
    };
    mockOutputs = new Map([["device-1", mockOutput]]);
    mockAccess = {
      outputs: mockOutputs,
      onstatechange: null,
    };

    // Mock navigator.requestMIDIAccess
    vi.stubGlobal("navigator", {
      requestMIDIAccess: vi.fn().mockResolvedValue(mockAccess),
    });
  });

  it("正确初始化并请求 Web MIDI Access 列出设备", async () => {
    const manager = new MidiOutputManager();
    expect(manager.isSupported()).toBe(true);

    const success = await manager.requestAccess();
    expect(success).toBe(true);
    expect(manager.getDevices()).toHaveLength(1);
    expect(manager.getDevices()[0].name).toBe("loopMIDI Port");
  });

  it("在开启状态下向选中的 MIDI 输出端口分发 NoteOn / NoteOff 消息", async () => {
    const manager = new MidiOutputManager();
    await manager.requestAccess();

    manager.updateConfig({ enabled: true, selectedDeviceId: "device-1" });

    // Track channel mode: Channel 0 (Soprano)
    manager.sendNoteOn(0, 60, 90);
    expect(mockOutput.send).toHaveBeenCalledWith([0x90, 60, 90]);

    manager.sendNoteOff(0, 60);
    expect(mockOutput.send).toHaveBeenCalledWith([0x80, 60, 0]);

    // Channel 2 (Tenor)
    manager.sendNoteOn(2, 53, 80);
    expect(mockOutput.send).toHaveBeenCalledWith([0x92, 53, 80]);
  });

  it("单通道合并模式将所有声部重定向到 Channel 1 (0x90)", async () => {
    const manager = new MidiOutputManager();
    await manager.requestAccess();

    manager.updateConfig({
      enabled: true,
      selectedDeviceId: "device-1",
      channelMode: "single-channel",
    });

    // Voice with channel 3 (Bass) is routed to 0
    manager.sendNoteOn(3, 40, 85);
    expect(mockOutput.send).toHaveBeenCalledWith([0x90, 40, 85]);

    manager.sendNoteOff(3, 40);
    expect(mockOutput.send).toHaveBeenCalledWith([0x80, 40, 0]);
  });

  it("支持发送 ProgramChange 与 ControlChange", async () => {
    const manager = new MidiOutputManager();
    await manager.requestAccess();

    manager.updateConfig({
      enabled: true,
      selectedDeviceId: "device-1",
      sendProgramChange: true,
    });

    manager.sendProgramChange(0, 52); // Choir Aahs
    expect(mockOutput.send).toHaveBeenCalledWith([0xc0, 52]);

    manager.sendControlChange(0, 7, 100); // Volume CC7
    expect(mockOutput.send).toHaveBeenCalledWith([0xb0, 7, 100]);
  });

  it("allNotesOff 向所有通道发送消音保护信号", async () => {
    const manager = new MidiOutputManager();
    await manager.requestAccess();

    manager.updateConfig({ enabled: true, selectedDeviceId: "device-1" });
    manager.allNotesOff();

    // 16 channels * 2 messages (AllNotesOff 123 + AllSoundOff 120)
    expect(mockOutput.send).toHaveBeenCalledTimes(32);
    expect(mockOutput.send).toHaveBeenCalledWith([0xb0, 123, 0]);
    expect(mockOutput.send).toHaveBeenCalledWith([0xb0, 120, 0]);
    expect(mockOutput.send).toHaveBeenCalledWith([0xbf, 123, 0]);
    expect(mockOutput.send).toHaveBeenCalledWith([0xbf, 120, 0]);
  });

  it("未启用时 sendNoteOn / sendNoteOff 不会触发任何 MIDI 消息", async () => {
    const manager = new MidiOutputManager();
    await manager.requestAccess();

    manager.updateConfig({ enabled: false });
    manager.sendNoteOn(0, 60, 100);
    manager.sendNoteOff(0, 60);

    expect(mockOutput.send).not.toHaveBeenCalled();
  });
});
