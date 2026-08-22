import { useCallback, useState } from "react";

const STORAGE_KEY = "satb-master-developer-mode-v1";
const RULE_TEST_ENTRY_STORAGE_KEY = "satb-master-rule-test-entry-v1";

function readDeveloperMode() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function readRuleTestEntryVisibility() {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(RULE_TEST_ENTRY_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

export function useDeveloperMode() {
  const [enabled, setEnabledState] = useState(readDeveloperMode);
  const [showRuleTestEntry, setShowRuleTestEntryState] = useState(
    readRuleTestEntryVisibility,
  );
  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // 调试开关持久化失败不应影响编辑器本身，当前会话状态仍然有效。
    }
  }, []);

  const setShowRuleTestEntry = useCallback((next: boolean) => {
    setShowRuleTestEntryState(next);
    try {
      window.localStorage.setItem(RULE_TEST_ENTRY_STORAGE_KEY, String(next));
    } catch {
      // 设置持久化失败不应影响当前会话中的入口可见性。
    }
  }, []);

  return { enabled, setEnabled, showRuleTestEntry, setShowRuleTestEntry };
}
