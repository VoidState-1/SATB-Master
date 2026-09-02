import { afterEach, describe, expect, it } from "vitest";
import {
  FOLLOW_PLAYHEAD_STORAGE_KEY,
  readStoredFollowPlayhead,
} from "./useFollowPlayhead";

describe("useFollowPlayhead", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("returns default true when window is undefined", () => {
    // @ts-expect-error 模拟 node 运行时
    delete globalThis.window;
    expect(readStoredFollowPlayhead()).toBe(true);
  });

  it("returns default true when localStorage has no entry", () => {
    const map = new Map<string, string>();
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, val: string) => map.set(key, val),
      },
    } as unknown as Window & typeof globalThis;
    expect(readStoredFollowPlayhead()).toBe(true);
  });

  it("reads stored boolean values correctly", () => {
    const map = new Map<string, string>();
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, val: string) => map.set(key, val),
      },
    } as unknown as Window & typeof globalThis;

    map.set(FOLLOW_PLAYHEAD_STORAGE_KEY, "false");
    expect(readStoredFollowPlayhead()).toBe(false);

    map.set(FOLLOW_PLAYHEAD_STORAGE_KEY, "true");
    expect(readStoredFollowPlayhead()).toBe(true);
  });
});
