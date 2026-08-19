import type { DesktopApi } from "../../../shared/desktop";
import type { RuleTestCaseStore } from "./port";

export function createDesktopRuleTestCaseStore(
  api: Pick<DesktopApi, "ruleTestCases">,
): RuleTestCaseStore {
  return {
    async open() {
      const result = await api.ruleTestCases.open();
      if (result.canceled) return undefined;
      if (result.document === undefined)
        throw new Error("桌面端未返回规则测试用例内容");
      return {
        document: result.document,
        filePath: result.filePath,
        displayName: result.filePath?.split(/[\\/]/).at(-1),
      };
    },

    async save(request) {
      const result = await api.ruleTestCases.save({
        currentPath: request.currentPath,
        forceDialog: request.forceDialog,
        json: request.json,
      });
      return result.canceled ? undefined : { filePath: result.filePath };
    },
  };
}
