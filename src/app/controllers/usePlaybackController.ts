import { useCallback, useEffect, useRef, useState } from "react";
import { audioEngine, type AudioEngineState } from "../../audio/audioEngine";
import {
  soundFontId,
  soundFontLoadKey,
  type SoundFontReference,
} from "../../audio/soundFontIdentity";
import { replaceProject } from "../../domain/editing";
import type { ProjectDocument } from "../../domain/project";
import { nearestGridTick } from "../../domain/time";
import {
  loadDefaultSoundFont,
  loadPreparedDesktopSoundFont,
  loadUserSoundFont,
  MAX_SOUNDFONT_BYTES,
  readSoundFontBuffer,
  type SoundFontLoadProgress,
} from "../../services/desktop";
import { createSingleFlight } from "./singleFlight";

interface ProjectHistoryCommitter {
  commit(project: ProjectDocument): void;
}

interface PlaybackControllerOptions {
  project: ProjectDocument;
  history: ProjectHistoryCommitter;
  soundFont?: ProjectDocument["audio"]["soundFont"];
  onSoundFontChange?(soundFont: ProjectDocument["audio"]["soundFont"]): void;
  preloadSoundFont?: boolean;
  gridTicks: number;
  showNotice(message: string): void;
  playheadTick?: number;
  onPlayheadChange?(tick: number): void;
}

function soundFontProgressMessage(progress: SoundFontLoadProgress) {
  if (progress.phase === "parsing") return "正在解析 SoundFont";
  const percent =
    progress.totalBytes > 0
      ? Math.floor((progress.completedBytes / progress.totalBytes) * 100)
      : 0;
  return `正在读取并校验 SoundFont ${percent}%`;
}

async function ensureSoundFontLoaded(
  soundFontConfig: SoundFontReference,
  generation: number,
  onProgress?: (progress: SoundFontLoadProgress) => void,
) {
  const targetSoundFontId = soundFontId(soundFontConfig);
  if (audioEngine.isSoundFontLoaded(targetSoundFontId))
    return "already-loaded" as const;
  if (!audioEngine.isSoundFontChangeCurrent(generation)) return;
  // 大音色加载前先释放旧音色，避免旧采样与新文件缓冲区同时占据峰值内存。
  if (!(await audioEngine.unloadSoundFont(generation))) return;
  const soundFont =
    soundFontConfig.kind === "default"
      ? await loadDefaultSoundFont(onProgress)
      : await loadUserSoundFont(soundFontConfig.path ?? "", onProgress);
  if (!audioEngine.isSoundFontChangeCurrent(generation)) return;
  if (
    soundFontConfig.kind === "user" &&
    soundFontConfig.hash &&
    soundFont.hash !== soundFontConfig.hash
  ) {
    throw new Error("工程引用的 SoundFont 文件已被替换");
  }
  onProgress?.({
    phase: "parsing",
    completedBytes: soundFont.sizeBytes,
    totalBytes: soundFont.sizeBytes,
    fileSizeBytes: soundFont.sizeBytes,
    requiredMemoryBytes: soundFont.requiredMemoryBytes,
    availableMemoryBytes: soundFont.availableMemoryBytes,
  });
  if (
    !(await audioEngine.loadSoundFont(
      soundFont.buffer,
      targetSoundFontId,
      generation,
    ))
  )
    return;
  return soundFont;
}

type SoundFontLoadResult = Awaited<
  ReturnType<typeof ensureSoundFontLoaded>
>;

interface SoundFontLoadRequest {
  id: string;
  loadKey: string;
  generation?: number;
  promise: Promise<SoundFontLoadResult>;
}

let activeSoundFontLoad: SoundFontLoadRequest | undefined;

export function usePlaybackController({
  project,
  history,
  soundFont: controlledSoundFont,
  onSoundFontChange,
  preloadSoundFont = true,
  gridTicks,
  showNotice,
  playheadTick: controlledPlayheadTick,
  onPlayheadChange,
}: PlaybackControllerOptions) {
  const effectiveSoundFont = controlledSoundFont ?? project.audio.soundFont;
  const loopEnabled = project.loop.enabled;
  const loopStartTick = project.loop.startTick;
  const loopEndTick = project.loop.endTick;
  const [internalPlayheadTick, setInternalPlayheadTick] = useState(0);
  const playheadTick = controlledPlayheadTick ?? internalPlayheadTick;
  const setPlayheadTick = useCallback(
    (tick: number) => {
      onPlayheadChange?.(tick);
      if (controlledPlayheadTick === undefined) setInternalPlayheadTick(tick);
    },
    [controlledPlayheadTick, onPlayheadChange],
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [audioState, setAudioState] = useState<AudioEngineState>("idle");
  const [audioMessage, setAudioMessage] = useState("尚未启动音频");
  const [audioLevel, setAudioLevel] = useState(0);
  const [soundFontProgress, setSoundFontProgress] =
    useState<SoundFontLoadProgress>();
  const [soundFontSizeBytes, setSoundFontSizeBytes] = useState<number>();
  const playSessionRef = useRef(0);
  const playbackStart = useRef(createSingleFlight<void>()).current;

  const reportSoundFontProgress = useCallback(
    (progress: SoundFontLoadProgress) => {
      setSoundFontProgress(progress);
      setAudioState("loading");
      setAudioMessage(soundFontProgressMessage(progress));
    },
    [],
  );

  const requestSoundFontLoad = useCallback(
    (soundFont: SoundFontReference): SoundFontLoadRequest => {
      const id = soundFontId(soundFont);
      const loadKey = soundFontLoadKey(soundFont);
      if (audioEngine.isSoundFontLoaded(id)) {
        return {
          id,
          loadKey,
          promise: Promise.resolve("already-loaded"),
        };
      }
      const pending = activeSoundFontLoad;
      if (
        pending?.id === id &&
        pending.loadKey === loadKey &&
        pending.generation !== undefined &&
        audioEngine.isSoundFontChangeCurrent(pending.generation)
      ) {
        return pending;
      }

      const generation = audioEngine.beginSoundFontChange();
      const reportProgress = (progress: SoundFontLoadProgress) => {
        if (audioEngine.isSoundFontChangeCurrent(generation))
          reportSoundFontProgress(progress);
      };
      const request: SoundFontLoadRequest = {
        id,
        loadKey,
        generation,
        promise: ensureSoundFontLoaded(soundFont, generation, reportProgress),
      };
      activeSoundFontLoad = request;
      const clearRequest = () => {
        if (activeSoundFontLoad === request)
          activeSoundFontLoad = undefined;
      };
      void request.promise.then(clearRequest, clearRequest);
      return request;
    },
    [reportSoundFontProgress],
  );

  const isLoadRequestCurrent = useCallback((request: SoundFontLoadRequest) => {
    return request.generation === undefined
      ? audioEngine.isSoundFontLoaded(request.id)
      : audioEngine.isSoundFontChangeCurrent(request.generation);
  }, []);

  useEffect(() => {
    const unsubscribe = audioEngine.onState((state, message) => {
      setAudioState(state);
      if (message) setAudioMessage(message);
    });
    return () => {
      unsubscribe();
      audioEngine.stop(false);
    };
  }, []);

  const effectiveSoundFontLoadKey = soundFontLoadKey(effectiveSoundFont);

  useEffect(() => {
    if (!preloadSoundFont) return;
    let active = true;
    const request = requestSoundFontLoad(effectiveSoundFont);
    if (!audioEngine.isSoundFontLoaded(request.id))
      setSoundFontSizeBytes(undefined);
    void request.promise
      .then((soundFont) => {
        if (!active || !isLoadRequestCurrent(request)) return;
        if (soundFont && soundFont !== "already-loaded")
          setSoundFontSizeBytes(soundFont.sizeBytes);
      })
      .catch((error) => {
        if (!active || !isLoadRequestCurrent(request)) return;
        console.warn("工程 SoundFont 预加载失败，将使用回退音色。", error);
        showNotice(
          effectiveSoundFont.kind === "default"
            ? "默认音色不可用，已切换到回退音色"
            : "工程引用的音色不可用，已切换到回退音色",
        );
      })
      .finally(() => {
        if (active && isLoadRequestCurrent(request))
          setSoundFontProgress(undefined);
      });
    return () => {
      active = false;
    };
    // 音源引用未变化时不应因工程对象更新而重新加载。
  }, [
    effectiveSoundFontLoadKey,
    isLoadRequestCurrent,
    preloadSoundFont,
    requestSoundFontLoad,
    showNotice,
  ]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setAudioLevel(audioEngine.getOutputLevel()),
      50,
    );
    return () => window.clearInterval(timer);
  }, []);

  const handleChooseSoundFont = useCallback(async () => {
    let generation: number | undefined;
    let reportProgress = reportSoundFontProgress;
    const beginChange = () => {
      generation = audioEngine.beginSoundFontChange();
      reportProgress = (progress) => {
        if (
          generation !== undefined &&
          audioEngine.isSoundFontChangeCurrent(generation)
        ) {
          reportSoundFontProgress(progress);
        }
      };
      return generation;
    };
    try {
      let name: string;
      let path: string | undefined;
      let hash: string | undefined;
      let buffer: ArrayBuffer;
      let sizeBytes: number;
      if (window.desktop) {
        const result = await window.desktop.soundFont.open();
        if (result.canceled) return;
        if (
          !result.name ||
          !result.token ||
          !result.sourceUrl ||
          result.sizeBytes === undefined ||
          result.requiredMemoryBytes === undefined ||
          result.availableMemoryBytes === undefined
        )
          throw new Error("SoundFont 加载信息不完整");
        const change = beginChange();
        if (!(await audioEngine.unloadSoundFont(change))) {
          await window.desktop.soundFont.release(result.token);
          return;
        }
        const loaded = await loadPreparedDesktopSoundFont(
          {
            name: result.name,
            filePath: result.filePath,
            token: result.token,
            sourceUrl: result.sourceUrl,
            sizeBytes: result.sizeBytes,
            requiredMemoryBytes: result.requiredMemoryBytes,
            availableMemoryBytes: result.availableMemoryBytes,
          },
          reportProgress,
        );
        name = loaded.name;
        path = loaded.filePath;
        hash = loaded.hash;
        buffer = loaded.buffer;
        sizeBytes = loaded.sizeBytes;
      } else {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".sf2,.sf3";
        const file = await new Promise<File | undefined>((resolve) => {
          input.onchange = () => resolve(input.files?.[0]);
          input.click();
        });
        if (!file) return;
        if (file.size > MAX_SOUNDFONT_BYTES)
          throw new Error("SoundFont 文件超过 2 GB 限制");
        name = file.name;
        sizeBytes = file.size;
        const change = beginChange();
        if (!(await audioEngine.unloadSoundFont(change))) return;
        const sourceUrl = URL.createObjectURL(file);
        try {
          buffer = await readSoundFontBuffer(
            sourceUrl,
            file.size,
            (completedBytes) => {
              reportProgress({
                phase: "loading",
                completedBytes,
                totalBytes: file.size,
                fileSizeBytes: file.size,
              });
            },
          );
        } finally {
          URL.revokeObjectURL(sourceUrl);
        }
      }

      if (
        generation === undefined ||
        !audioEngine.isSoundFontChangeCurrent(generation)
      )
        return;
      const selection = { kind: "user" as const, name, path, hash };
      reportProgress({
        phase: "parsing",
        completedBytes: sizeBytes,
        totalBytes: sizeBytes,
        fileSizeBytes: sizeBytes,
      });
      if (
        !(await audioEngine.loadSoundFont(
          buffer,
          soundFontId(selection),
          generation,
        ))
      )
        return;
      if (onSoundFontChange) {
        onSoundFontChange(selection);
      } else {
        history.commit(
          replaceProject(project, (draft) => {
            draft.audio.soundFont = selection;
          }),
        );
      }
      setSoundFontSizeBytes(sizeBytes);
      showNotice("SoundFont 已加载");
    } catch (error) {
      if (
        generation === undefined ||
        audioEngine.isSoundFontChangeCurrent(generation)
      ) {
        showNotice(
          error instanceof Error ? error.message : "SoundFont 加载失败",
        );
      }
    } finally {
      if (
        generation !== undefined &&
        audioEngine.isSoundFontChangeCurrent(generation)
      ) {
        setSoundFontProgress(undefined);
      }
    }
  }, [history, onSoundFontChange, project, reportSoundFontProgress, showNotice]);

  const handleUseDefaultSoundFont = useCallback(async () => {
    const defaultSoundFont = {
      kind: "default" as const,
      name: "SATB Master 默认音色",
    };
    if (onSoundFontChange) {
      onSoundFontChange(defaultSoundFont);
    } else {
      history.commit(
        replaceProject(project, (draft) => {
          draft.audio.soundFont = defaultSoundFont;
        }),
      );
    }
    const request = requestSoundFontLoad(defaultSoundFont);
    try {
      const soundFont = await request.promise;
      if (!soundFont) return;
      if (soundFont !== "already-loaded")
        setSoundFontSizeBytes(soundFont.sizeBytes);
      showNotice("默认音色已加载");
    } catch (error) {
      if (isLoadRequestCurrent(request)) {
        showNotice(error instanceof Error ? error.message : "默认音色加载失败");
      }
    } finally {
      if (isLoadRequestCurrent(request))
        setSoundFontProgress(undefined);
    }
  }, [
    history,
    isLoadRequestCurrent,
    onSoundFontChange,
    project,
    requestSoundFontLoad,
    showNotice,
  ]);

  const handleStop = useCallback((returnToStart = false) => {
    playSessionRef.current += 1;
    audioEngine.stop();
    setIsPlaying(false);
    if (returnToStart) setPlayheadTick(0);
  }, []);

  const startPlayback = useCallback(async () => {
    try {
      await audioEngine.resume();
      const soundFontConfig = effectiveSoundFont;
      if (!audioEngine.isSoundFontLoaded(soundFontId(soundFontConfig))) {
        const request = requestSoundFontLoad(soundFontConfig);
        try {
          const soundFont = await request.promise;
          if (!soundFont) return;
          if (soundFont !== "already-loaded")
            setSoundFontSizeBytes(soundFont.sizeBytes);
        } catch (error) {
          if (!isLoadRequestCurrent(request)) return;
          // 音源缺失、摘要变化或安装路径异常时清掉旧音色，防止误用上一个工程的音色。
          await audioEngine.unloadSoundFont();
          setSoundFontProgress(undefined);
          console.warn("工程 SoundFont 加载失败，继续使用回退音色。", error);
          showNotice(
            soundFontConfig.kind === "default"
              ? "默认音色不可用，已切换到回退音色"
              : "工程引用的音色不可用，已切换到回退音色",
          );
        } finally {
          if (isLoadRequestCurrent(request))
            setSoundFontProgress(undefined);
        }
      }
      const session = playSessionRef.current + 1;
      playSessionRef.current = session;
      setIsPlaying(true);
      const playSegment = async (segmentStart: number): Promise<void> => {
        await audioEngine.playProject(project, {
          startTick: segmentStart,
          endTick: loopEnabled ? loopEndTick : project.lengthTicks,
          metronome: metronomeEnabled,
          onPosition: setPlayheadTick,
          onStop: () => {
            if (playSessionRef.current !== session) return;
            if (loopEnabled) {
              setPlayheadTick(loopStartTick);
              void playSegment(loopStartTick);
            } else {
              setIsPlaying(false);
            }
          },
        });
      };
      const requestedStart =
        playheadTick >= project.lengthTicks ? 0 : playheadTick;
      const startTick =
        loopEnabled &&
        (requestedStart < loopStartTick || requestedStart >= loopEndTick)
          ? loopStartTick
          : requestedStart;
      await playSegment(startTick);
    } catch (error) {
      setIsPlaying(false);
      showNotice(error instanceof Error ? error.message : "播放失败");
    }
  }, [
    effectiveSoundFont,
    loopEnabled,
    loopEndTick,
    loopStartTick,
    metronomeEnabled,
    playheadTick,
    project,
    isLoadRequestCurrent,
    requestSoundFontLoad,
    setPlayheadTick,
    showNotice,
  ]);

  const handlePlay = useCallback(() => {
    if (isPlaying) {
      handleStop();
      return Promise.resolve();
    }
    return playbackStart.run(startPlayback);
  }, [handleStop, isPlaying, playbackStart, startPlayback]);

  const toggleLoop = useCallback(() => {
    history.commit(
      replaceProject(project, (draft) => {
        draft.loop.enabled = !draft.loop.enabled;
      }),
    );
  }, [history, project]);

  const setLoopBoundary = useCallback(
    (boundary: "start" | "end", requestedTick = playheadTick) => {
      const tick = nearestGridTick(requestedTick, gridTicks, {
        minimum: 0,
        maximum: project.lengthTicks,
      });
      if (boundary === "start") {
        if (tick >= loopEndTick) return showNotice("循环起点必须早于终点");
        history.commit(
          replaceProject(project, (draft) => {
            draft.loop.startTick = tick;
          }),
        );
      } else {
        if (tick <= loopStartTick) return showNotice("循环终点必须晚于起点");
        history.commit(
          replaceProject(project, (draft) => {
            draft.loop.endTick = tick;
          }),
        );
      }
    },
    [
      gridTicks,
      history,
      loopEndTick,
      loopStartTick,
      playheadTick,
      project,
      showNotice,
    ],
  );

  return {
    soundFont: effectiveSoundFont,
    playheadTick,
    setPlayheadTick,
    isPlaying,
    metronomeEnabled,
    setMetronomeEnabled,
    audioState,
    audioMessage,
    audioLevel,
    soundFontProgress,
    soundFontSizeBytes,
    handleChooseSoundFont,
    handleUseDefaultSoundFont,
    handleStop,
    handlePlay,
    toggleLoop,
    setLoopBoundary,
  } as const;
}

export type PlaybackController = ReturnType<typeof usePlaybackController>;
