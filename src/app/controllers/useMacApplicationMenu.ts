import { useEffect, useEffectEvent } from "react";
import { DESKTOP_TEXT_EDIT_COMMANDS, MENU_FILE_TRANSFERS, type DesktopFileTransferCommand, type DesktopMenuCommand, type DesktopTextEditCommand } from "../../../shared/desktop";
import { isTextInput, usesNativeMacWindow } from "../../shortcuts/keyboardPlatform";

const TEXT_COMMANDS: Partial<Record<string, DesktopTextEditCommand>> = {
  "a": "selectAll",
  "c": "copySelection",
  "v": "pasteSelection",
  "x": "cutSelection",
  "z": "undo",
  "shift+z": "redo",
  "alt+shift+v": "pasteAndMatchStyle",
};

export function useMacApplicationMenu(openSettings: () => void, runFileTransfer: (command: DesktopFileTransferCommand) => void) {
  const handleCommand = useEffectEvent((command: DesktopMenuCommand) => {
    if (command === "settings") openSettings();
    else if (Object.hasOwn(MENU_FILE_TRANSFERS, command)) runFileTransfer(command as DesktopFileTransferCommand);
    else if (isTextInput(document.activeElement) && Object.hasOwn(DESKTOP_TEXT_EDIT_COMMANDS, command)) {
      void window.desktop?.menu.editText(command as DesktopTextEditCommand);
    }
  });

  useEffect(() => {
    if (!usesNativeMacWindow) return;
    const menu = window.desktop?.menu;
    if (!menu) return;
    const unsubscribe = menu.onCommand((command) => handleCommand(command));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !event.metaKey || event.ctrlKey ||
          !isTextInput(event.target instanceof Element ? event.target : null)) return;
      const key = `${event.altKey ? "alt+" : ""}${event.shiftKey ? "shift+" : ""}${event.key.toLowerCase()}`;
      const command = TEXT_COMMANDS[key];
      if (!command) return;
      event.preventDefault();
      void menu.editText(command);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      unsubscribe();
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
