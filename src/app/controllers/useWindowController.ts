import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { isTextInput, usesNativeMacWindow } from "../../shortcuts/keyboardPlatform";
import type { ConfirmationState } from "./useConfirmationController";

interface WindowControllerOptions {
  isDirty: boolean;
  filePath?: string;
  beforeClose?(): Promise<boolean>;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
}

export function useWindowController({
  isDirty,
  filePath,
  beforeClose,
  requestConfirmation,
}: WindowControllerOptions) {
  const [isMaximized, setIsMaximized] = useState(false);
  const closeInProgress = useRef(false);

  useEffect(() => {
    const controls = window.desktop?.windowControls;
    if (!controls) return;
    void controls.isMaximized().then(setIsMaximized);
    return controls.onMaximizedChange(setIsMaximized);
  }, []);

  const toggleMaximize = useCallback(async () => {
    const maximized = await window.desktop?.windowControls.toggleMaximize();
    if (typeof maximized === "boolean") setIsMaximized(maximized);
  }, []);

  const close = useCallback(async (quit = false) => {
    if (closeInProgress.current) return;
    closeInProgress.current = true;
    try {
      if (isDirty && !(await requestConfirmation({
        title: quit ? "退出 SATB Master" : "关闭工程",
        message: quit ? "当前工程尚未保存，仍要退出吗？" : "当前工程尚未保存，仍要关闭吗？",
        confirmLabel: quit ? "仍要退出" : "仍要关闭",
        cancelLabel: "取消",
      }))) return;
      if (beforeClose && !(await beforeClose())) return;
      await window.desktop?.windowControls.close(quit);
    } finally {
      closeInProgress.current = false;
    }
  }, [beforeClose, isDirty, requestConfirmation]);

  const closeNativeWindow = useEffectEvent((quit: boolean) => void close(quit));
  useEffect(() => {
    if (!usesNativeMacWindow) return;
    return window.desktop?.windowControls.onCloseRequest((quit) => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && isTextInput(focused)) focused.blur();
      // Fields such as the project title commit their draft on blur.
      window.setTimeout(() => closeNativeWindow(quit), 0);
    });
  }, []);

  useEffect(() => {
    if (usesNativeMacWindow) void window.desktop?.windowControls.setDocument(filePath, isDirty);
  }, [filePath, isDirty]);

  return { isMaximized, toggleMaximize, close } as const;
}
