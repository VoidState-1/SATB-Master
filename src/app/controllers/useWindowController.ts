import { useCallback, useEffect, useState } from "react";
import type { ConfirmationState } from "./useConfirmationController";

interface WindowControllerOptions {
  isDirty: boolean;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
}

export function useWindowController({
  isDirty,
  requestConfirmation,
}: WindowControllerOptions) {
  const [isMaximized, setIsMaximized] = useState(false);

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

  const close = useCallback(async () => {
    if (
      isDirty &&
      !(await requestConfirmation({
        title: "关闭工程",
        message: "当前工程尚未保存，仍要关闭吗？",
        confirmLabel: "仍要关闭",
        cancelLabel: "取消",
      }))
    )
      return;
    void window.desktop?.windowControls.close();
  }, [isDirty, requestConfirmation]);

  return { isMaximized, toggleMaximize, close } as const;
}
