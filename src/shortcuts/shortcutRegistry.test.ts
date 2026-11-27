// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useShortcutBindings } from "../hooks/useShortcutBindings";
import {
  SHORTCUT_DEFINITIONS,
  commandForKeyboardEvent,
  defaultShortcutBindings,
  formatShortcutBinding,
  keyboardEventToBinding,
} from "./shortcutRegistry";

const event = (code: string, options: Partial<KeyboardEvent> = {}) => ({
  code,
  key: options.key ?? "",
  ctrlKey: options.ctrlKey ?? false,
  altKey: options.altKey ?? false,
  shiftKey: options.shiftKey ?? false,
  metaKey: options.metaKey ?? false,
});

describe("shortcut registry", () => {
  it("normalizes modifiers in a stable order", () => {
    expect(
      keyboardEventToBinding(
        event("KeyZ", { ctrlKey: true, altKey: true, shiftKey: true }),
      ),
    ).toBe("Ctrl+Alt+Shift+KeyZ");
    expect(
      keyboardEventToBinding(event("ControlLeft", { ctrlKey: true })),
    ).toBeUndefined();
  });

  it("matches default aliases and formats them for display", () => {
    const bindings = defaultShortcutBindings();
    expect(
      commandForKeyboardEvent(
        event("KeyZ", { ctrlKey: true, shiftKey: true }),
        bindings,
      )?.id,
    ).toBe("redo");
    expect(
      commandForKeyboardEvent(event("Tab", { shiftKey: true }), bindings)?.id,
    ).toBe("previousVoice");
    expect(formatShortcutBinding("Ctrl+Shift+KeyS")).toBe("Ctrl+Shift+S");
    expect(formatShortcutBinding("BracketLeft")).toBe("[");
  });

  it("can keep voice switching active while Control is a temporary tool modifier", () => {
    const bindings = defaultShortcutBindings();
    expect(
      commandForKeyboardEvent(event("Tab", { ctrlKey: true }), bindings),
    ).toBeUndefined();
    expect(
      commandForKeyboardEvent(event("Tab", { ctrlKey: true }), bindings, {
        ignoreControl: true,
      })?.id,
    ).toBe("nextVoice");
    expect(
      commandForKeyboardEvent(
        event("Tab", { ctrlKey: true, shiftKey: true }),
        bindings,
        { ignoreControl: true },
      )?.id,
    ).toBe("previousVoice");
  });

  it("uses Command for macOS defaults and keeps physical Control bindable", () => {
    const bindings = defaultShortcutBindings(true);
    const mac = { mac: true };
    expect(commandForKeyboardEvent(event("KeyS", { metaKey: true }), bindings, mac)?.id).toBe("saveProject");
    expect(commandForKeyboardEvent(event("KeyS", { ctrlKey: true }), bindings, mac)).toBeUndefined();
    bindings.saveProject = ["Control+KeyS"];
    expect(commandForKeyboardEvent(event("KeyS", { ctrlKey: true }), bindings, mac)?.id).toBe("saveProject");
    expect(keyboardEventToBinding(event("KeyZ", { ctrlKey: true, metaKey: true, altKey: true, shiftKey: true }), true)).toBe("Ctrl+Control+Alt+Shift+KeyZ");
    expect(commandForKeyboardEvent(event("KeyZ", { metaKey: true, shiftKey: true }), bindings, mac)?.id).toBe("redo");
    expect(commandForKeyboardEvent(event("KeyY", { metaKey: true }), bindings, mac)).toBeUndefined();
    expect(formatShortcutBinding("Ctrl+Shift+KeyS", true)).toBe("⌘⇧S");
    expect(formatShortcutBinding("Control+Alt+Enter", true)).toBe("⌃⌥↩");
  });

  it("recognizes laptop Fn navigation and both Mac Delete keys", () => {
    const bindings = defaultShortcutBindings(true);
    const commands = [
      ["ArrowLeft", "Home", "goToStart"],
      ["ArrowRight", "End", "goToEnd"],
      ["ArrowUp", "PageUp", "previousMeasure"],
      ["ArrowDown", "PageDown", "nextMeasure"],
      ["Backspace", "Delete", "deleteSelection"],
      ["Backspace", "Backspace", "deleteSelection"],
    ];
    for (const [code, key, command] of commands) {
      expect(commandForKeyboardEvent(event(code, { key }), bindings, { mac: true })?.id).toBe(command);
    }
    expect(formatShortcutBinding("Backspace", true)).toBe("⌫");
    expect(formatShortcutBinding("Delete", true)).toBe("⌦");
  });

  it("keeps tools 1–4 and assigns auto brush to 5", () => {
    const bindings = defaultShortcutBindings();
    expect(bindings.autoBrushTool).toEqual(["Digit5"]);
    expect(["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"].map(
      (code) => commandForKeyboardEvent(event(code), bindings)?.id,
    )).toEqual(["selectTool", "pencilTool", "eraserTool", "splitTool", "autoBrushTool"]);
    expect(formatShortcutBinding(bindings.autoBrushTool[0])).toBe("5");
  });

  it("fills the new shortcut when loading preferences saved before auto brush", () => {
    const storageKey = "satb-master-shortcuts-v1";
    localStorage.setItem(storageKey, JSON.stringify({
      selectTool: ["Digit1"], pencilTool: ["KeyP"], eraserTool: ["Digit3"], splitTool: [],
    }));
    try {
      function ShortcutHarness() {
        expect(useShortcutBindings().bindings).toMatchObject({
          selectTool: ["Digit1"],
          pencilTool: ["KeyP"],
          eraserTool: ["Digit3"],
          splitTool: [],
          autoBrushTool: ["Digit5"],
        });
        return null;
      }
      renderToStaticMarkup(createElement(ShortcutHarness));
    } finally {
      localStorage.removeItem(storageKey);
    }
  });

  it("does not ship conflicting default bindings", () => {
    const owners = new Map<string, string>();
    SHORTCUT_DEFINITIONS.forEach((definition) =>
      definition.defaultBindings.forEach((binding) => {
        expect(
          owners.get(binding),
          `${binding} is assigned twice`,
        ).toBeUndefined();
        owners.set(binding, definition.id);
      }),
    );
  });

  it("allows undo and redo to follow keyboard auto-repeat", () => {
    expect(
      SHORTCUT_DEFINITIONS.find((definition) => definition.id === "undo")
        ?.allowRepeat,
    ).toBe(true);
    expect(
      SHORTCUT_DEFINITIONS.find((definition) => definition.id === "redo")
        ?.allowRepeat,
    ).toBe(true);
  });
});
