import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PAUSE_PLAYHEAD_BEHAVIOR,
  PAUSE_PLAYHEAD_STORAGE_KEY,
  readStoredPausePlayheadBehavior,
} from "./usePausePlayheadBehavior";

describe("usePausePlayheadBehavior", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("returns default 'current' when window is undefined", () => {
    // @ts-expect-error 模拟 node 运行时
    delete globalThis.window;
    expect(readStoredPausePlayheadBehavior()).toBe(
      DEFAULT_PAUSE_PLAYHEAD_BEHAVIOR,
    );
  });

  it("returns default 'current' when localStorage has no entry", () => {
    const map = new Map<string, string>();
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, val: string) => map.set(key, val),
      },
    } as unknown as Window & typeof globalThis;
    expect(readStoredPausePlayheadBehavior()).toBe(
      DEFAULT_PAUSE_PLAYHEAD_BEHAVIOR,
    );
  });

  it("reads stored valid values correctly", () => {
    const map = new Map<string, string>();
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, val: string) => map.set(key, val),
      },
    } as unknown as Window & typeof globalThis;

    map.set(PAUSE_PLAYHEAD_STORAGE_KEY, "playback-start");
    expect(readStoredPausePlayheadBehavior()).toBe("playback-start");

    map.set(PAUSE_PLAYHEAD_STORAGE_KEY, "loop-start");
    expect(readStoredPausePlayheadBehavior()).toBe("loop-start");

    map.set(PAUSE_PLAYHEAD_STORAGE_KEY, "current");
    expect(readStoredPausePlayheadBehavior()).toBe("current");
  });

  it("falls back to default when invalid value is in localStorage", () => {
    const map = new Map<string, string>();
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, val: string) => map.set(key, val),
      },
    } as unknown as Window & typeof globalThis;

    map.set(PAUSE_PLAYHEAD_STORAGE_KEY, "invalid-option");
    expect(readStoredPausePlayheadBehavior()).toBe(
      DEFAULT_PAUSE_PLAYHEAD_BEHAVIOR,
    );
  });
});
