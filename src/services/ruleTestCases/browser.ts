import { MAX_RULE_TEST_CASE_BYTES } from "../../../shared/desktop";
import type { RuleTestCaseStore } from "./port";

interface BrowserRuleTestCaseFile {
  name: string;
  size: number;
  text(): Promise<string>;
}

interface BrowserRuleTestCaseStoreOptions {
  chooseFile?: () => Promise<BrowserRuleTestCaseFile | undefined>;
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
  };
}
