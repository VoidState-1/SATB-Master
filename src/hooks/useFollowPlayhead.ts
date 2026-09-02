import { useCallback, useState } from "react";

export const FOLLOW_PLAYHEAD_STORAGE_KEY = "satb-master-follow-playhead-v1";

export function readStoredFollowPlayhead(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(FOLLOW_PLAYHEAD_STORAGE_KEY);
    if (stored === null) return true;
    return stored === "true";
  } catch {
    return true;
  }
}

export function useFollowPlayhead() {
  const [followPlayhead, setFollowPlayheadState] =
    useState<boolean>(readStoredFollowPlayhead);

  const setFollowPlayhead = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      setFollowPlayheadState((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        try {
          window.localStorage.setItem(FOLLOW_PLAYHEAD_STORAGE_KEY, String(next));
        } catch {
          // 忽略本地存储异常
        }
        return next;
      });
    },
    [],
  );

  return { followPlayhead, setFollowPlayhead };
}
