import { WorkletSynthesizer } from "spessasynth_lib";
import {
  VOICE_ORDER,
  getAllPlayableTracks,
  type ProjectDocument,
  type VoiceId,
} from "../domain/project";
import { toMidi } from "../domain/pitch";
import {
  buildMeasures,
  eventAtTick,
  secondsToTick,
  ticksPerBeat,
  tickToSeconds,
} from "../domain/time";
import { installExclusiveSoundFont } from "./soundFontLifecycle";

export type AudioEngineState =
  "idle" | "loading" | "ready-sf2" | "ready-fallback" | "playing" | "error";

interface PlayOptions {
  startTick: number;
  endTick?: number;
  metronome?: boolean;
  onPosition(tick: number): void;
  onStop(): void;
}

interface FallbackVoice {
  oscillator: OscillatorNode;
  gain: GainNode;
}

interface ScheduledSynthEvent {
  time: number;
  action(): void;
}

function channelForTrack(trackIndex: number) {
  return trackIndex < 9 ? trackIndex : (trackIndex + 1) % 16;
}

export class SatbAudioEngine {
  private context?: AudioContext;
  private initializePromise?: Promise<void>;
  private synth?: WorkletSynthesizer;
  private soundBankId?: string;
  private soundFontLoadQueue: Promise<void> = Promise.resolve();
  private soundFontChangeGeneration = 0;
  private output?: GainNode;
  private analyser?: AnalyserNode;
  private analyserSamples?: Float32Array<ArrayBuffer>;
  private fallbackVoices = new Set<FallbackVoice>();
  private scheduledSynthEvents: ScheduledSynthEvent[] = [];
  private scheduledSynthEventIndex = 0;
  private synthSchedulerTimer?: number;
  private previewTimers = new Set<number>();
  private synthScheduleGeneration = 0;
  private animationFrame?: number;
  private stopTimer?: number;
  private stateListeners = new Set<
    (state: AudioEngineState, message?: string) => void
  >();

  onState(listener: (state: AudioEngineState, message?: string) => void) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: AudioEngineState, message?: string) {
    this.stateListeners.forEach((registeredListener) =>
      registeredListener(state, message),
    );
  }

  async initialize() {
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.initializeAudio();
    return this.initializePromise;
  }

  private async initializeAudio() {
    this.setState("loading", "正在初始化音频引擎");
    this.context = new AudioContext({ latencyHint: "interactive" });
    this.output = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyserSamples = new Float32Array(
      new ArrayBuffer(this.analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
    );
    this.output.connect(this.analyser).connect(this.context.destination);

    try {
      const processorUrl = new URL(
        "spessasynth_processor.min.js",
        window.location.href,
      ).toString();
      await this.context.audioWorklet.addModule(processorUrl);
      this.synth = await this.createWorkletSynth();
      this.setState("ready-fallback", "SF2 尚未加载，使用回退音色");
    } catch (error) {
      console.warn(
        "SF2 AudioWorklet 初始化失败，将使用 Web Audio 回退音色。",
        error,
      );
      this.synth = undefined;
      this.setState("ready-fallback", "SF2 引擎不可用，使用回退音色");
    }
  }

  private async createWorkletSynth() {
    if (!this.context || !this.output) throw new Error("音频输出尚未初始化");
    const synth = new WorkletSynthesizer(this.context);
    await synth.isReady;
    // WorkletSynthesizer 不会自动连接系统输出；悬空时 API 状态正常但 SF2 完全静音。
    synth.connect(this.output);
    synth.setLogLevel(false, true, false);
    return synth;
  }

  private async ensureWorkletSynth() {
    await this.initialize();
    if (!this.synth) this.synth = await this.createWorkletSynth();
    return this.synth;
  }

  beginSoundFontChange() {
    this.soundFontChangeGeneration += 1;
    return this.soundFontChangeGeneration;
  }

  isSoundFontChangeCurrent(generation: number) {
    return generation === this.soundFontChangeGeneration;
  }

  async loadSoundFont(
    buffer: ArrayBuffer,
    id: string,
    generation = this.beginSoundFontChange(),
  ) {
    await this.ensureWorkletSynth();
    if (!this.isSoundFontChangeCurrent(generation)) return false;
    if (!this.synth) throw new Error("当前环境无法初始化 SF2 AudioWorklet");
    // 启动预载、播放和手动换音色可能并发到达；队列与代次检查共同保证最后一次选择生效。
    const operation = this.soundFontLoadQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.isSoundFontChangeCurrent(generation)) return false;
        if (this.soundBankId === id) return true;
        this.setState("loading", "正在解析 SoundFont");
        try {
          let synth = this.synth;
          if (!synth) {
            synth = await this.createWorkletSynth();
            this.synth = synth;
          }
          if (this.soundBankId) this.stop(false);
          const installed = await installExclusiveSoundFont(
            synth,
            this.soundBankId,
            buffer,
            id,
            async () => {
              this.synth = undefined;
              this.soundBankId = undefined;
              const replacement = await this.createWorkletSynth();
              this.synth = replacement;
              return replacement;
            },
          );
          this.synth = installed.synth;
          this.soundBankId = id;
          if (!this.isSoundFontChangeCurrent(generation)) return false;
          this.setState("ready-sf2", "SoundFont 已就绪");
          return true;
        } catch (error) {
          this.synth?.destroy();
          this.synth = undefined;
          this.soundBankId = undefined;
          if (this.isSoundFontChangeCurrent(generation)) {
            this.setState("ready-fallback", "SoundFont 加载失败，使用回退音色");
          }
          throw error;
        }
      });
    this.soundFontLoadQueue = operation.then(() => undefined);
    return operation;
  }

  isSoundFontLoaded(id: string) {
    return this.soundBankId === id;
  }

  async unloadSoundFont(generation = this.beginSoundFontChange()) {
    await this.soundFontLoadQueue.catch(() => undefined);
    if (!this.isSoundFontChangeCurrent(generation)) return false;
    this.stop(false);
    if (this.synth && this.soundBankId) {
      this.synth.destroy();
      this.synth = undefined;
    }
    this.soundBankId = undefined;
    this.setState("ready-fallback", "使用内置回退音色");
    return true;
  }

  async resume() {
    await this.initialize();
    if (this.context?.state === "suspended") await this.context.resume();
    this.setOutputEnabled(true);
  }

  getOutputLevel() {
    if (!this.analyser || !this.analyserSamples) return 0;
    this.analyser.getFloatTimeDomainData(this.analyserSamples);
    let peak = 0;
    for (const sample of this.analyserSamples)
      peak = Math.max(peak, Math.abs(sample));
    return Math.min(1, peak);
  }

  async previewNote(midiNote: number, voiceId: VoiceId, duration = 0.35) {
    await this.resume();
    if (!this.context) return;
    const channel = VOICE_ORDER.indexOf(voiceId);
    if (this.synth && this.soundBankId) {
      this.synth.noteOn(channel, midiNote, 92);
      const timer = window.setTimeout(() => {
        this.previewTimers.delete(timer);
        this.synth?.noteOff(channel, midiNote);
      }, duration * 1000);
      this.previewTimers.add(timer);
      return;
    }

    this.scheduleFallback(
      midiNote,
      this.context.currentTime,
      duration,
      0.08,
      0,
    );
  }

  async playProject(project: ProjectDocument, options: PlayOptions) {
    await this.resume();
    if (!this.context) return;
    this.stop(false);
    this.setOutputEnabled(true);
    const context = this.context;
    const startDelay = 0.06;
    const contextStart = context.currentTime + startDelay;
    const projectStartSeconds = tickToSeconds(project, options.startTick);
    const projectEndTick = Math.max(
      options.startTick,
      Math.min(project.lengthTicks, options.endTick ?? project.lengthTicks),
    );
    const playableTracks = getAllPlayableTracks(project);
    const soloed = playableTracks.some((track) => track.solo);

    playableTracks.forEach((track, trackIndex) => {
      if (track.muted || (soloed && !track.solo)) return;
      const channel = channelForTrack(trackIndex);
      if (this.synth && this.soundBankId) {
        this.synth.programChange(channel, track.program);
        this.synth.sendMessage([
          0xb0 | channel,
          7,
          Math.round(project.audio.masterVolume * track.volume * 127),
        ]);
        this.synth.sendMessage([
          0xb0 | channel,
          10,
          Math.round((track.pan + 1) * 63.5),
        ]);
      }

      track.notes.forEach((note) => {
        const midiNote = toMidi(note.pitch);
        const noteEnd = note.startTick + note.durationTicks;
        if (noteEnd <= options.startTick || note.startTick >= projectEndTick)
          return;
        const startTick = Math.max(note.startTick, options.startTick);
        const endTick = Math.min(noteEnd, projectEndTick);
        const startSeconds =
          tickToSeconds(project, startTick) - projectStartSeconds;
        const endSeconds =
          tickToSeconds(project, endTick) - projectStartSeconds;
        const eventStart = contextStart + Math.max(0, startSeconds);
        const eventEnd = contextStart + Math.max(0.02, endSeconds);

        if (this.synth && this.soundBankId) {
          // Worklet 的未来事件队列没有取消 API；改用可清理定时任务，暂停时不会遗留后续音符。
          this.scheduleSynthEvent(eventStart, () =>
            this.synth?.noteOn(channel, midiNote, note.velocity),
          );
          this.scheduleSynthEvent(eventEnd, () =>
            this.synth?.noteOff(channel, midiNote),
          );
        } else {
          this.scheduleFallback(
            midiNote,
            eventStart,
            Math.max(0.02, eventEnd - eventStart),
            project.audio.masterVolume * track.volume * 0.085,
            track.pan,
          );
        }
      });
    });
    this.startSynthScheduler();

    if (options.metronome) {
      const measureStarts = new Set(
        buildMeasures(project).map((measure) => measure.startTick),
      );
      let clickTick = options.startTick;
      const initialMeter = eventAtTick(project.meterEvents, clickTick);
      const initialBeatTicks = ticksPerBeat(
        project.ppq,
        initialMeter.denominator,
      );
      clickTick = Math.ceil(clickTick / initialBeatTicks) * initialBeatTicks;
      while (clickTick < projectEndTick) {
        const clickTime =
          contextStart +
          tickToSeconds(project, clickTick) -
          projectStartSeconds;
        this.scheduleMetronomeClick(clickTime, measureStarts.has(clickTick));
        const currentMeter = eventAtTick(project.meterEvents, clickTick);
        clickTick += ticksPerBeat(project.ppq, currentMeter.denominator);
      }
    }

    this.setState("playing");
    const totalSeconds =
      tickToSeconds(project, projectEndTick) - projectStartSeconds;
    const updatePosition = () => {
      const elapsed = Math.max(0, context.currentTime - contextStart);
      const tick = Math.min(
        projectEndTick,
        secondsToTick(project, projectStartSeconds + elapsed),
      );
      options.onPosition(tick);
      if (elapsed < totalSeconds)
        this.animationFrame = requestAnimationFrame(updatePosition);
    };
    this.animationFrame = requestAnimationFrame(updatePosition);
    this.stopTimer = window.setTimeout(
      () => {
        this.stop(false);
        options.onPosition(projectEndTick);
        options.onStop();
      },
      Math.max(0, totalSeconds + startDelay) * 1000,
    );
  }

  stop(notify = true) {
    this.synthScheduleGeneration += 1;
    if (this.synthSchedulerTimer) window.clearTimeout(this.synthSchedulerTimer);
    this.synthSchedulerTimer = undefined;
    this.scheduledSynthEvents = [];
    this.scheduledSynthEventIndex = 0;
    this.previewTimers.forEach((timer) => window.clearTimeout(timer));
    this.previewTimers.clear();
    // 暂停既要取消未来 MIDI，也要立即截断效果器残响；下次播放或预听由 resume 重新开启。
    this.setOutputEnabled(false);
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    if (this.stopTimer) window.clearTimeout(this.stopTimer);
    this.animationFrame = undefined;
    this.stopTimer = undefined;
    this.synth?.stopAll(true);
    this.fallbackVoices.forEach(({ oscillator, gain }) => {
      try {
        gain.gain.cancelScheduledValues(0);
        gain.gain.setValueAtTime(0, this.context?.currentTime ?? 0);
        oscillator.stop();
      } catch {
        // 已结束的 Oscillator 再次 stop 会抛错，停止流程无需传播该异常。
      }
    });
    this.fallbackVoices.clear();
    if (notify)
      this.setState(this.soundBankId ? "ready-sf2" : "ready-fallback");
  }

  private setOutputEnabled(enabled: boolean) {
    if (!this.context || !this.output) return;
    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.setValueAtTime(enabled ? 1 : 0, this.context.currentTime);
  }

  private scheduleSynthEvent(audioTime: number, action: () => void) {
    this.scheduledSynthEvents.push({ time: audioTime, action });
  }

  private startSynthScheduler() {
    if (!this.context || this.scheduledSynthEvents.length === 0) return;
    const generation = this.synthScheduleGeneration;
    this.scheduledSynthEvents.sort((left, right) => left.time - right.time);
    this.scheduledSynthEventIndex = 0;

    const dispatch = () => {
      this.synthSchedulerTimer = undefined;
      if (!this.context || generation !== this.synthScheduleGeneration) return;
      const dueTime = this.context.currentTime + 0.001;
      while (
        this.scheduledSynthEventIndex < this.scheduledSynthEvents.length &&
        this.scheduledSynthEvents[this.scheduledSynthEventIndex].time <= dueTime
      ) {
        this.scheduledSynthEvents[this.scheduledSynthEventIndex].action();
        this.scheduledSynthEventIndex += 1;
      }
      const next = this.scheduledSynthEvents[this.scheduledSynthEventIndex];
      if (!next) {
        this.scheduledSynthEvents = [];
        this.scheduledSynthEventIndex = 0;
        return;
      }
      const delay = Math.max(0, (next.time - this.context.currentTime) * 1000);
      this.synthSchedulerTimer = window.setTimeout(dispatch, delay);
    };

    dispatch();
  }

  private scheduleFallback(
    midiNote: number,
    start: number,
    duration: number,
    volume: number,
    pan: number,
  ) {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((midiNote - 69) / 12);
    panner.pan.value = pan;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, volume),
      start + 0.015,
    );
    gain.gain.setValueAtTime(
      Math.max(0.0002, volume),
      Math.max(start + 0.015, start + duration - 0.06),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator
      .connect(gain)
      .connect(panner)
      .connect(this.output ?? this.context.destination);
    const voice = { oscillator, gain };
    this.fallbackVoices.add(voice);
    oscillator.onended = () => this.fallbackVoices.delete(voice);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private scheduleMetronomeClick(start: number, accent: boolean) {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = accent ? 1320 : 880;
    gain.gain.setValueAtTime(accent ? 0.075 : 0.045, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.035);
    oscillator.connect(gain).connect(this.output ?? this.context.destination);
    const voice = { oscillator, gain };
    this.fallbackVoices.add(voice);
    oscillator.onended = () => this.fallbackVoices.delete(voice);
    oscillator.start(start);
    oscillator.stop(start + 0.04);
  }
}

export const audioEngine = new SatbAudioEngine();
