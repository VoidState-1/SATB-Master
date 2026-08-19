import { dialog } from "electron";
import path from "node:path";
import { DESKTOP_CHANNELS } from "../shared/desktop.js";
import {
  rememberDialogDirectory,
  rememberedDefaultPath,
} from "./project-ipc.js";
import {
  ensureRuleTestCasePath,
  readRuleTestCaseDocument,
  RULE_TEST_CASE_EXTENSION,
  withRuleTestCaseExtension,
  writeRuleTestCaseAtomic,
} from "./rule-test-case-file.js";
import { handleDesktop } from "./typed-ipc.js";

const e2eDirectory = process.env.SATB_MASTER_E2E_DIRECTORY;

export function registerRuleTestCaseIpc() {
  handleDesktop(DESKTOP_CHANNELS.ruleTestCaseOpen, async () => {
    let filePath: string;
    if (e2eDirectory) {
      filePath = path.join(
        e2eDirectory,
        `rule-case${RULE_TEST_CASE_EXTENSION}`,
      );
    } else {
      const selection = await dialog.showOpenDialog({
        title: "打开规则测试用例",
        defaultPath: await rememberedDefaultPath("rule-test-case"),
        properties: ["openFile"],
        filters: [
          { name: "SATB Master 规则测试用例", extensions: ["json"] },
        ],
      });
      if (selection.canceled || !selection.filePaths[0])
        return { canceled: true };
      filePath = selection.filePaths[0];
      ensureRuleTestCasePath(filePath);
      await rememberDialogDirectory("rule-test-case", filePath);
    }

    return {
      canceled: false,
      filePath,
      document: await readRuleTestCaseDocument(filePath),
    };
  });

  handleDesktop(DESKTOP_CHANNELS.ruleTestCaseSave, async (_event, request) => {
    let filePath = e2eDirectory
      ? path.join(e2eDirectory, `rule-case${RULE_TEST_CASE_EXTENSION}`)
      : request.currentPath;
    if (!e2eDirectory && (!filePath || request.forceDialog)) {
      const selection = await dialog.showSaveDialog({
        title: "保存规则测试用例",
        defaultPath:
          filePath ??
          (await rememberedDefaultPath(
            "rule-test-case",
            `未命名规则用例${RULE_TEST_CASE_EXTENSION}`,
          )),
        filters: [
          { name: "SATB Master 规则测试用例", extensions: ["json"] },
        ],
      });
      if (selection.canceled || !selection.filePath)
        return { canceled: true };
      filePath = withRuleTestCaseExtension(selection.filePath);
      await rememberDialogDirectory("rule-test-case", filePath);
    }

    if (!filePath) throw new Error("没有可用的规则测试用例保存路径");
    await writeRuleTestCaseAtomic(filePath, request.json);
    return { canceled: false, filePath };
  });
}
