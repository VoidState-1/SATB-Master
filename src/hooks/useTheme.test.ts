// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  readThemePreference,
  resolveTheme,
} from "./useTheme";

describe("useTheme utilities", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.theme = "";
    document.documentElement.style.colorScheme = "";
  });

  it("defaults to system preference when storage is empty or invalid", () => {
    expect(readThemePreference()).toBe("system");
    window.localStorage.setItem(THEME_STORAGE_KEY, "invalid");
    expect(readThemePreference()).toBe("system");
  });

  it("reads explicit light and dark preferences", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readThemePreference()).toBe("dark");
    expect(resolveTheme("dark")).toBe("dark");

    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readThemePreference()).toBe("light");
    expect(resolveTheme("light")).toBe("light");
  });

  it("applies resolved theme to document root and dispatches change event", () => {
    const listener = vi.fn();
    window.addEventListener(THEME_CHANGE_EVENT, listener);

    applyResolvedTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(listener).toHaveBeenCalledTimes(1);

    applyResolvedTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(listener).toHaveBeenCalledTimes(2);

    window.removeEventListener(THEME_CHANGE_EVENT, listener);
  });
});
