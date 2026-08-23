import { dialog } from "electron";
import { readdir, rm, stat } from "node:fs/promises";
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

async function scanRuleTestCaseDirectory(directoryPath: string) {
  const entries: Array<{
    key: string;
    filePath: string;
    relativePath: string;
    displayName: string;
    document?: unknown;
    error?: string;
  }> = [];
  async function visit(currentPath: string) {
    const children = await readdir(currentPath, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(currentPath, child.name);
      if (child.isDirectory()) {
        await visit(childPath);
        continue;
      }
      if (!child.name.toLowerCase().endsWith(RULE_TEST_CASE_EXTENSION)) continue;
      const relativePath = path.relative(directoryPath, childPath);
      const entry = {
        key: relativePath,
        filePath: childPath,
        relativePath,
        displayName: child.name,
      };
      try {
        entries.push({
          ...entry,
          document: await readRuleTestCaseDocument(childPath),
        });
      } catch (error) {
        entries.push({
          ...entry,
          error: error instanceof Error ? error.message : "规则测试用例读取失败",
        });
      }
    }
  }
  await visit(directoryPath);
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  return entries;
}

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
      const requestedName =
        typeof request.defaultName === "string" && request.defaultName.trim()
          ? request.defaultName
              .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
              .slice(0, 120)
          : "未命名规则用例";
      const selection = await dialog.showSaveDialog({
        title: "保存规则测试用例",
        defaultPath:
          filePath ??
          (await rememberedDefaultPath(
            "rule-test-case",
            `${requestedName}${RULE_TEST_CASE_EXTENSION}`,
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

  handleDesktop(
    DESKTOP_CHANNELS.ruleTestCaseOpenDirectory,
    async (_event, request) => {
      let directoryPath =
        typeof request === "object" && request && typeof request.directoryPath === "string"
          ? request.directoryPath
          : undefined;

      if (!directoryPath) {
        const selection = await dialog.showOpenDialog({
          title: "打开规则测试用例目录",
          defaultPath: await rememberedDefaultPath("rule-test-case"),
          properties: ["openDirectory"],
        });
        if (selection.canceled || !selection.filePaths[0])
          return { canceled: true, entries: [] };
        directoryPath = selection.filePaths[0];
      }

      try {
        const info = await stat(directoryPath);
        if (!info.isDirectory()) throw new Error("规则测试用例目录无效");
        const entries = await scanRuleTestCaseDirectory(directoryPath);
        await rememberDialogDirectory(
          "rule-test-case",
          path.join(directoryPath, "placeholder.satb-rule-case.json"),
        );
        return { canceled: false, directoryPath, entries };
      } catch (error) {
        if (request && typeof request === "object" && request.directoryPath) {
          return { canceled: true, entries: [] };
        }
        throw error;
      }
    },
  );

  handleDesktop(
    DESKTOP_CHANNELS.ruleTestCaseDelete,
    async (_event, request) => {
      if (!request || typeof request.filePath !== "string") {
        throw new Error("无效的用例文件路径");
      }
      ensureRuleTestCasePath(request.filePath);
      await rm(request.filePath, { force: true });
      return { deleted: true };
    },
  );
}
