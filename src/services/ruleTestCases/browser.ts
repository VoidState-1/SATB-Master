import { MAX_RULE_TEST_CASE_BYTES } from "../../../shared/desktop";
import type {
  RuleTestCaseLibrarySnapshot,
  RuleTestCaseStore,
} from "./port";

interface BrowserRuleTestCaseFile {
  name: string;
  size: number;
  text(): Promise<string>;
  webkitRelativePath?: string;
}

interface BrowserRuleTestCaseStoreOptions {
  chooseFile?: () => Promise<BrowserRuleTestCaseFile | undefined>;
  chooseDirectory?: () => Promise<BrowserRuleTestCaseFile[]>;
  download?: (json: string, fileName: string) => void;
}

function chooseBrowserRuleTestCase() {
  return new Promise<File | undefined>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".satb-rule-case.json,application/json";
    let settled = false;
    const finish = (file?: File) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      resolve(file);
    };
    const handleWindowFocus = () => {
      window.setTimeout(() => finish(input.files?.[0]), 0);
    };
    input.addEventListener("change", () => finish(input.files?.[0]), {
      once: true,
    });
    window.addEventListener("focus", handleWindowFocus, { once: true });
    input.click();
  });
}

function chooseBrowserRuleTestCaseDirectory() {
  return new Promise<BrowserRuleTestCaseFile[]>((resolve) => {
    const input = document.createElement("input") as HTMLInputElement & {
      webkitdirectory?: boolean;
      files: FileList | null;
    };
    input.type = "file";
    input.webkitdirectory = true;
    let settled = false;
    const finish = (files: BrowserRuleTestCaseFile[] = []) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      resolve(files);
    };
    const handleWindowFocus = () => {
      window.setTimeout(() => finish(Array.from(input.files ?? [])), 0);
    };
    input.addEventListener(
      "change",
      () => finish(Array.from(input.files ?? [])),
      { once: true },
    );
    window.addEventListener("focus", handleWindowFocus, { once: true });
    input.click();
  });
}

function normalizeFileName(value: string) {
  const base = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 120) || "未命名规则用例";
  return base.toLowerCase().endsWith(".satb-rule-case.json")
    ? base
    : `${base}.satb-rule-case.json`;
}

function downloadBrowserRuleTestCase(json: string, fileName: string) {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function createBrowserRuleTestCaseStore(
  options: BrowserRuleTestCaseStoreOptions = {},
): RuleTestCaseStore {
  const chooseFile = options.chooseFile ?? chooseBrowserRuleTestCase;
  const chooseDirectory =
    options.chooseDirectory ?? chooseBrowserRuleTestCaseDirectory;
  const download = options.download ?? downloadBrowserRuleTestCase;
  return {
    async open() {
      const file = await chooseFile();
      if (!file) return undefined;
      if (!file.name.toLowerCase().endsWith(".satb-rule-case.json"))
        throw new Error("只支持 .satb-rule-case.json 文件");
      if (file.size < 1 || file.size > MAX_RULE_TEST_CASE_BYTES)
        throw new Error("规则测试用例必须小于等于 20 MB 且不能为空");
      const text = await file.text();
      if (utf8Size(text) > MAX_RULE_TEST_CASE_BYTES)
        throw new Error("规则测试用例超过 20 MB 限制");
      return {
        document: JSON.parse(text) as unknown,
        displayName: file.name,
      };
    },

    async save(request) {
      if (utf8Size(request.json) > MAX_RULE_TEST_CASE_BYTES)
        throw new Error("规则测试用例超过 20 MB 限制");
      JSON.parse(request.json);
      download(request.json, normalizeFileName(request.defaultName));
      return {};
    },

    async openDirectory(): Promise<RuleTestCaseLibrarySnapshot | undefined> {
      const files = await chooseDirectory();
      if (files.length === 0) return undefined;
      const entries = [] as RuleTestCaseLibrarySnapshot["entries"];
      const candidates = files
        .filter((file) =>
          file.name.toLowerCase().endsWith(".satb-rule-case.json"),
        )
        .sort((left, right) =>
          (left.webkitRelativePath ?? left.name).localeCompare(
            right.webkitRelativePath ?? right.name,
            "en",
          ),
        );
      for (const file of candidates) {
        const relativePath = file.webkitRelativePath ?? file.name;
        const base = {
          key: relativePath,
          displayName: file.name,
          relativePath,
        };
        if (!file.name.toLowerCase().endsWith(".satb-rule-case.json"))
          continue;
        if (file.size < 1 || file.size > MAX_RULE_TEST_CASE_BYTES) {
          entries.push({
            ...base,
            error: "规则测试用例必须小于等于 20 MB 且不能为空",
          });
          continue;
        }
        const text = await file.text();
        if (utf8Size(text) > MAX_RULE_TEST_CASE_BYTES) {
          entries.push({ ...base, error: "规则测试用例超过 20 MB 限制" });
          continue;
        }
        try {
          entries.push({ ...base, document: JSON.parse(text) as unknown });
        } catch (error) {
          entries.push({
            ...base,
            error: error instanceof Error ? error.message : "JSON 解析失败",
          });
        }
      }
      const firstPath = files[0].webkitRelativePath?.split(/[\\/]/)[0];
      return { directoryPath: firstPath, entries };
    },
  };
}
