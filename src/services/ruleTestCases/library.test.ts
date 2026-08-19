import { describe, expect, it } from "vitest";
import { createRuleTestCase } from "../../domain/harmony";
import { createEmptyProject } from "../../domain/project";
import {
  addRecentRuleTestCaseItem,
  buildRuleTestCaseLibraryItems,
  collectRuleTestLibraryTags,
  createRecentRuleTestCaseItem,
  filterRuleTestCaseLibraryItems,
  ruleTestLibraryStatus,
  runRuleTestLibraryBatch,
} from "./library";

function testCase(title: string, tags: string[] = []) {
  const value = createRuleTestCase({
    project: createEmptyProject(title),
    ruleId: "voice.range",
  });
  value.title = title;
  value.tags = tags;
  return value;
}

describe("规则测试用例库模型", () => {
  it("逐条解析目录并保留文件和领域错误", () => {
    const valid = testCase("有效用例");
    const items = buildRuleTestCaseLibraryItems({
      directoryPath: "C:\\cases",
      entries: [
        {
          key: "valid.satb-rule-case.json",
          displayName: "valid.satb-rule-case.json",
          document: valid,
        },
        {
          key: "broken.satb-rule-case.json",
          displayName: "broken.satb-rule-case.json",
          error: "JSON 解析失败",
        },
        {
          key: "invalid.satb-rule-case.json",
          displayName: "invalid.satb-rule-case.json",
          document: { format: "wrong" },
        },
      ],
    });

    expect(items[0].testCase?.title).toBe("有效用例");
    expect(items[1].issues[0].message).toBe("JSON 解析失败");
    expect(items[2].testCase).toBeUndefined();
    expect(items[2].issues.length).toBeGreaterThan(0);
  });

  it("按标题、规则、tag 和聚合状态筛选", () => {
    const passing = createRecentRuleTestCaseItem({
      testCase: testCase("导音解决", ["resolution"]),
    });
    const invalid = {
      key: "invalid",
      displayName: "broken.satb-rule-case.json",
      issues: [{ path: "$", code: "value" as const, message: "错误" }],
    };
    const views = [
      { ...passing, status: "passed" as const },
      { ...invalid, status: "invalid" as const },
    ];

    expect(
      filterRuleTestCaseLibraryItems(views, {
        query: "voice.range",
        tag: "resolution",
        status: "passed",
      }),
    ).toHaveLength(1);
    expect(
      filterRuleTestCaseLibraryItems(views, {
        query: "",
        status: "failed",
      }),
    ).toEqual([views[1]]);
    expect(collectRuleTestLibraryTags(views)).toEqual(["resolution"]);
  });

  it("最近用例按路径去重并把最新条目放在最前", () => {
    const original = createRecentRuleTestCaseItem({
      testCase: testCase("旧标题"),
      filePath: "C:\\cases\\sample.satb-rule-case.json",
    });
    const replacement = createRecentRuleTestCaseItem({
      testCase: testCase("新标题"),
      filePath: original.filePath,
    });
    const result = addRecentRuleTestCaseItem([original], replacement);

    expect(result).toHaveLength(1);
    expect(result[0].testCase?.title).toBe("新标题");
    expect(ruleTestLibraryStatus(result[0])).toBe("idle");
  });

  it("批量运行按稳定顺序执行，单条错误不会中止后续用例", async () => {
    const first = createRecentRuleTestCaseItem({ testCase: testCase("第一") });
    const second = createRecentRuleTestCaseItem({ testCase: testCase("第二") });
    const calls: string[] = [];
    const result = await runRuleTestLibraryBatch(
      [first, second],
      {
        async run(value) {
          calls.push(value.title);
          return {
            status: value.title === "第一" ? "error" : "passed",
            actual: {} as never,
            comparison: {} as never,
            durationMs: 1,
            ...(value.title === "第一"
              ? { error: { code: "rule-error", message: "失败" } }
              : {}),
          } as never;
        },
      },
    );

    expect(calls).toEqual(["第一", "第二"]);
    expect(result.status).toBe("completed");
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(Object.keys(result.results)).toHaveLength(2);
  });
});
