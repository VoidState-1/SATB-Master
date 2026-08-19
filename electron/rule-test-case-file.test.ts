import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_RULE_TEST_CASE_BYTES } from "../shared/desktop";
import {
  assertRuleTestCaseJson,
  parseRuleTestCaseBytes,
  writeRuleTestCaseAtomic,
} from "./rule-test-case-file";

describe("规则测试用例文件策略", () => {
  it("严格拒绝非 UTF-8 与非法 JSON", () => {
    expect(() => parseRuleTestCaseBytes(new Uint8Array([0xc3, 0x28]))).toThrow(
      "UTF-8",
    );
    expect(() => parseRuleTestCaseBytes(new TextEncoder().encode("{"))).toThrow();
  });

  it("拒绝超过 20 MB 的保存内容", () => {
    expect(() =>
      assertRuleTestCaseJson(" ".repeat(MAX_RULE_TEST_CASE_BYTES + 1)),
    ).toThrow("20 MB");
  });

  it("替换失败时保留原文件并清理临时文件", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "satb-rule-case-"));
    const filePath = path.join(directory, "case.satb-rule-case.json");
    await writeFile(filePath, '{"before":true}\n', "utf8");
    const temporaryPaths: string[] = [];

    try {
      await expect(
        writeRuleTestCaseAtomic(filePath, '{"after":true}\n', {
          async write(temporaryPath, value) {
            temporaryPaths.push(temporaryPath);
            await writeFile(temporaryPath, value, "utf8");
          },
          async replace() {
            throw new Error("replace failed");
          },
          async remove(temporaryPath) {
            await rm(temporaryPath, { force: true });
          },
        }),
      ).rejects.toThrow("replace failed");
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        '{"before":true}\n',
      );
      await expect(readFile(temporaryPaths[0], "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
