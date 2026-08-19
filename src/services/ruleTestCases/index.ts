import { createBrowserRuleTestCaseStore } from "./browser";
import { createDesktopRuleTestCaseStore } from "./desktop";

export * from "./port";
export * from "./browser";
export * from "./desktop";
export * from "./library";

export function createRuleTestCaseStore() {
  return typeof window !== "undefined" && window.desktop
    ? createDesktopRuleTestCaseStore(window.desktop)
    : createBrowserRuleTestCaseStore();
}
