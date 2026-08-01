import { useCallback, useState } from "react";

const STORAGE_KEY = "satb-master-developer-mode-v1";

function readDeveloperMode() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useDeveloperMode() {
  const [enabled, setEnabledState] = useState(readDeveloperMode);
  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // 调试开关持久化失败不应影响编辑器本身，当前会话状态仍然有效。
    }
  }, []);

  return { enabled, setEnabled };
}
