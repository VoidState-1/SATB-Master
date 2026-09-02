import { useCallback, useState } from "react";

export type PausePlayheadBehavior = "current" | "playback-start" | "loop-start";

export const DEFAULT_PAUSE_PLAYHEAD_BEHAVIOR: PausePlayheadBehavior = "current";
export const PAUSE_PLAYHEAD_STORAGE_KEY = "satb-master-pause-playhead-v1";

export function readStoredPausePlayheadBehavior(): PausePlayheadBehavior {
  if (typeof window === "undefined") return DEFAULT_PAUSE_PLAYHEAD_BEHAVIOR;
  try {
    const stored = window.localStorage.getItem(PAUSE_PLAYHEAD_STORAGE_KEY);
    if (
      stored === "current" ||
      stored === "playback-start" ||
      stored === "loop-start"
    ) {
      return stored;
    }
  } catch {
    // 忽略本地存储异常
  }
  return DEFAULT_PAUSE_PLAYHEAD_BEHAVIOR;
}

export function usePausePlayheadBehavior() {
  const [pausePlayheadBehavior, setBehaviorState] =
    useState<PausePlayheadBehavior>(readStoredPausePlayheadBehavior);

  const setPausePlayheadBehavior = useCallback(
    (next: PausePlayheadBehavior) => {
      setBehaviorState(next);
      try {
        window.localStorage.setItem(PAUSE_PLAYHEAD_STORAGE_KEY, next);
      } catch {
        // 忽略本地存储异常
      }
    },
    [],
  );

  return { pausePlayheadBehavior, setPausePlayheadBehavior };
}
