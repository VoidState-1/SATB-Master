import { describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../../../shared/desktop";
import { createBrowserRuleTestCaseStore } from "./browser";
import { createDesktopRuleTestCaseStore } from "./desktop";

function browserFile(
  name = "case.satb-rule-case.json",
  text = '{"format":"satb-rule-test-case"}',
) {
  return {
    name,
    size: new TextEncoder().encode(text).byteLength,
    text: async () => text,
  };
}

describe("规则测试用例存储端口", () => {
  it("浏览器打开取消时不返回文档", async () => {
    const store = createBrowserRuleTestCaseStore({
      chooseFile: async () => undefined,
    });

    await expect(store.open()).resolves.toBeUndefined();
  });

  it("浏览器打开 JSON 并保留显示文件名", async () => {
    const store = createBrowserRuleTestCaseStore({
      chooseFile: async () => browserFile(),
    });

    await expect(store.open()).resolves.toEqual({
      document: { format: "satb-rule-test-case" },
      displayName: "case.satb-rule-case.json",
    });
  });

  it("浏览器拒绝错误扩展名和非法 JSON", async () => {
    const wrongExtension = createBrowserRuleTestCaseStore({
      chooseFile: async () => browserFile("case.json"),
    });
    const invalidJson = createBrowserRuleTestCaseStore({
      chooseFile: async () => browserFile("case.satb-rule-case.json", "{"),
    });

    await expect(wrongExtension.open()).rejects.toThrow(
      ".satb-rule-case.json",
    );
    await expect(invalidJson.open()).rejects.toThrow();
  });

  it("浏览器保存使用规范扩展名并传递原始 canonical JSON", async () => {
    const download = vi.fn();
    const store = createBrowserRuleTestCaseStore({ download });
    const json = '{"format":"satb-rule-test-case"}\n';

    await expect(
      store.save({
        forceDialog: false,
        json,
        defaultName: "leading-tone",
      }),
    ).resolves.toEqual({});
    expect(download).toHaveBeenCalledWith(
      json,
      "leading-tone.satb-rule-case.json",
    );
  });

  it("桌面打开、取消、保存和另存为均透传专用 API", async () => {
    const open = vi
      .fn()
      .mockResolvedValueOnce({ canceled: true })
      .mockResolvedValueOnce({
        canceled: false,
        filePath: "C:\\cases\\sample.satb-rule-case.json",
        document: { format: "satb-rule-test-case" },
      });
    const save = vi
      .fn()
      .mockResolvedValueOnce({
        canceled: false,
        filePath: "C:\\cases\\sample.satb-rule-case.json",
      })
      .mockResolvedValueOnce({ canceled: true });
    const api = { ruleTestCases: { open, save } } as unknown as Pick<
      DesktopApi,
      "ruleTestCases"
    >;
    const store = createDesktopRuleTestCaseStore(api);

    await expect(store.open()).resolves.toBeUndefined();
    await expect(store.open()).resolves.toMatchObject({
      filePath: "C:\\cases\\sample.satb-rule-case.json",
      displayName: "sample.satb-rule-case.json",
    });
    await expect(
      store.save({
        currentPath: "C:\\cases\\sample.satb-rule-case.json",
        forceDialog: false,
        json: "{}\n",
        defaultName: "sample",
      }),
    ).resolves.toEqual({
      filePath: "C:\\cases\\sample.satb-rule-case.json",
    });
    await expect(
      store.save({
        forceDialog: true,
        json: "{}\n",
        defaultName: "sample-copy",
      }),
    ).resolves.toBeUndefined();
    expect(save).toHaveBeenNthCalledWith(1, {
      currentPath: "C:\\cases\\sample.satb-rule-case.json",
      forceDialog: false,
      json: "{}\n",
    });
    expect(save).toHaveBeenNthCalledWith(2, {
      currentPath: undefined,
      forceDialog: true,
      json: "{}\n",
    });
  });
});
