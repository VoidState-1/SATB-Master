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
        defaultName: request.defaultName,
      });
      return result.canceled ? undefined : { filePath: result.filePath };
    },

    async openDirectory(directoryPath?: string) {
      const result = await api.ruleTestCases.openDirectory(
        directoryPath ? { directoryPath } : undefined,
      );
      if (!result || result.canceled || !result.directoryPath) return undefined;
      return {
        directoryPath: result.directoryPath,
        entries: result.entries,
      };
    },

    async delete(options: { filePath: string }) {
      if (!api?.ruleTestCases || typeof api.ruleTestCases.delete !== "function") {
        throw new Error("桌面端接口尚未加载，请重启应用以载入最新的删除功能接口");
      }
      const result = await api.ruleTestCases.delete(options);
      return Boolean(result?.deleted);
    },
  };
}
