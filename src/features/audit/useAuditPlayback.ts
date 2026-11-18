import { useCallback, useLayoutEffect, useRef } from "react";
import { usePlaybackController } from "../../app/controllers/usePlaybackController";

type Options = Parameters<typeof usePlaybackController>[0] & {
  playheadTick: number;
  onPlayheadChange(tick: number): void;
};

/** Stop the current audition if a different evidence view or beat control seeks manually. */
export function useAuditPlayback(options: Options) {
  const { playheadTick, onPlayheadChange } = options;
  const lastReported = useRef(playheadTick);
  const previousCursor = useRef(playheadTick);
  const length = options.project.lengthTicks;
  const reportPosition = useCallback((tick: number) => {
    lastReported.current = Math.max(0, Math.min(Math.round(tick), length - 1));
    onPlayheadChange(lastReported.current);
  }, [length, onPlayheadChange]);
  const playback = usePlaybackController({ ...options, onPlayheadChange: reportPosition });
  useLayoutEffect(() => {
    if (playback.isPlaying && previousCursor.current !== playheadTick && lastReported.current !== playheadTick) {
      playback.handleStop();
    }
    previousCursor.current = playheadTick;
  }, [playheadTick, playback.isPlaying, playback.handleStop]);
  return playback;
}
