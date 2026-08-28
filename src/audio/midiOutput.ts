export interface MidiOutputDeviceInfo {
  id: string;
  name: string;
  manufacturer?: string;
  state: "connected" | "disconnected";
}

export type MidiOutputChannelMode = "track-channel" | "single-channel";

export interface MidiOutputConfig {
  enabled: boolean;
  selectedDeviceId?: string;
  channelMode: MidiOutputChannelMode;
  sendProgramChange: boolean;
  sendPreview: boolean;
  muteInternalSynth: boolean;
}

export const DEFAULT_MIDI_OUTPUT_CONFIG: MidiOutputConfig = {
  enabled: false,
  selectedDeviceId: undefined,
  channelMode: "track-channel",
  sendProgramChange: true,
  sendPreview: true,
  muteInternalSynth: false,
};

const STORAGE_KEY = "satb_master_midi_output_config";

function loadSavedConfig(): MidiOutputConfig {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          enabled: Boolean(parsed.enabled),
          selectedDeviceId:
            typeof parsed.selectedDeviceId === "string"
              ? parsed.selectedDeviceId
              : undefined,
          channelMode:
            parsed.channelMode === "single-channel"
              ? "single-channel"
              : "track-channel",
          sendProgramChange:
            typeof parsed.sendProgramChange === "boolean"
              ? parsed.sendProgramChange
              : true,
          sendPreview:
            typeof parsed.sendPreview === "boolean" ? parsed.sendPreview : true,
          muteInternalSynth: Boolean(parsed.muteInternalSynth),
        };
      }
    }
  } catch {
    // Ignore fallback
  }
  return DEFAULT_MIDI_OUTPUT_CONFIG;
}

function saveConfig(config: MidiOutputConfig) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
  } catch {
    // Ignore
  }
}

export class MidiOutputManager {
  private access?: MIDIAccess;
  private accessPromise?: Promise<boolean>;
  private config: MidiOutputConfig = loadSavedConfig();
  private devices: MidiOutputDeviceInfo[] = [];
  private deviceListeners = new Set<(devices: MidiOutputDeviceInfo[]) => void>();
  private configListeners = new Set<(config: MidiOutputConfig) => void>();

  constructor() {
    if (typeof navigator !== "undefined" && "requestMIDIAccess" in navigator) {
      void this.requestAccess();
    }
  }

  isSupported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  getConfig(): Readonly<MidiOutputConfig> {
    return this.config;
  }

  getDevices(): readonly MidiOutputDeviceInfo[] {
    return this.devices;
  }

  isEnabled(): boolean {
    return this.config.enabled && this.isSupported();
  }

  shouldMuteInternalSynth(): boolean {
    return this.isEnabled() && this.config.muteInternalSynth;
  }

  shouldSendPreview(): boolean {
    return this.isEnabled() && this.config.sendPreview;
  }

  onDevicesChange(listener: (devices: MidiOutputDeviceInfo[]) => void) {
    this.deviceListeners.add(listener);
    return () => {
      this.deviceListeners.delete(listener);
    };
  }

  onConfigChange(listener: (config: MidiOutputConfig) => void) {
    this.configListeners.add(listener);
    return () => {
      this.configListeners.delete(listener);
    };
  }

  async requestAccess(): Promise<boolean> {
    if (this.access) return true;
    if (!this.isSupported()) return false;
    if (this.accessPromise) return this.accessPromise;

    this.accessPromise = (async () => {
      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        this.access = access;
        this.refreshDevices();

        access.onstatechange = () => {
          this.refreshDevices();
        };
        return true;
      } catch {
        this.access = undefined;
        return false;
      } finally {
        this.accessPromise = undefined;
      }
    })();

    return this.accessPromise;
  }

  refreshDevices() {
    if (!this.access) {
      this.devices = [];
      this.notifyDevicesChange();
      return;
    }

    const outputs: MidiOutputDeviceInfo[] = [];
    this.access.outputs.forEach((output: MIDIOutput) => {
      outputs.push({
        id: output.id,
        name: output.name ?? `MIDI 设备 (${output.id})`,
        manufacturer: output.manufacturer ?? undefined,
        state: output.state as "connected" | "disconnected",
      });
    });

    this.devices = outputs;

    if (
      outputs.length > 0 &&
      (!this.config.selectedDeviceId ||
        !outputs.some((d) => d.id === this.config.selectedDeviceId))
    ) {
      this.config.selectedDeviceId = outputs[0].id;
      saveConfig(this.config);
      this.notifyConfigChange();
    }

    this.notifyDevicesChange();
  }

  updateConfig(patch: Partial<MidiOutputConfig>) {
    this.config = { ...this.config, ...patch };
    saveConfig(this.config);
    this.notifyConfigChange();

    if (this.config.enabled && !this.access) {
      void this.requestAccess();
    }

    if (!this.config.enabled) {
      this.allNotesOff();
    }
  }

  private notifyDevicesChange() {
    this.deviceListeners.forEach((listener) => listener([...this.devices]));
  }

  private notifyConfigChange() {
    this.configListeners.forEach((listener) => listener({ ...this.config }));
  }

  private getActiveOutput(): MIDIOutput | undefined {
    if (!this.access || !this.config.enabled) return undefined;
    if (this.config.selectedDeviceId) {
      const output = this.access.outputs.get(this.config.selectedDeviceId);
      if (output) return output;
    }
    return this.access.outputs.values().next().value;
  }

  private resolveChannel(channel: number): number {
    if (this.config.channelMode === "single-channel") return 0;
    return Math.max(0, Math.min(15, channel));
  }

  sendNoteOn(channel: number, noteNumber: number, velocity: number) {
    const output = this.getActiveOutput();
    if (!output) return;
    const targetChannel = this.resolveChannel(channel);
    const safeNote = Math.max(0, Math.min(127, Math.round(noteNumber)));
    const safeVelocity = Math.max(0, Math.min(127, Math.round(velocity)));
    output.send([0x90 | targetChannel, safeNote, safeVelocity]);
  }

  sendNoteOff(channel: number, noteNumber: number) {
    const output = this.getActiveOutput();
    if (!output) return;
    const targetChannel = this.resolveChannel(channel);
    const safeNote = Math.max(0, Math.min(127, Math.round(noteNumber)));
    output.send([0x80 | targetChannel, safeNote, 0]);
  }

  sendProgramChange(channel: number, program: number) {
    if (!this.config.sendProgramChange) return;
    const output = this.getActiveOutput();
    if (!output) return;
    const targetChannel = this.resolveChannel(channel);
    const safeProgram = Math.max(0, Math.min(127, Math.round(program)));
    output.send([0xc0 | targetChannel, safeProgram]);
  }

  sendControlChange(channel: number, controller: number, value: number) {
    const output = this.getActiveOutput();
    if (!output) return;
    const targetChannel = this.resolveChannel(channel);
    const safeController = Math.max(0, Math.min(127, Math.round(controller)));
    const safeValue = Math.max(0, Math.min(127, Math.round(value)));
    output.send([0xb0 | targetChannel, safeController, safeValue]);
  }

  allNotesOff() {
    const output = this.getActiveOutput();
    if (!output) return;
    for (let ch = 0; ch < 16; ch++) {
      output.send([0xb0 | ch, 123, 0]);
      output.send([0xb0 | ch, 120, 0]);
    }
  }
}

export const midiOutputManager = new MidiOutputManager();
