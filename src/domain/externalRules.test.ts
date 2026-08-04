import { describe, expect, it } from "vitest";
import { buildHarmonyAnalysis } from "./harmonyAnalysis";
import {
  buildExternalRuleContext,
  mergeExternalRuleResult,
  normalizeExternalRuleDiagnostics,
  parseExternalRuleManifest,
  type InstalledExternalRulePackage,
} from "./externalRules";
import {
  evaluateExternalRuleSource,
  inspectExternalRuleSource,
} from "./externalRuleSandbox";
import { createEmptyProject } from "./model";
import { checkHarmony } from "./harmony";

const EXAMPLE_SOURCE = `
SATB_RULE.register({
  manifest: {
    apiVersion: 2,
    packageId: "org.example.safe",
    version: "1.0.0",
    rules: [{ id: "safe-rule", label: "安全示例", group: "custom" }],
  },
  rules: [{
    id: "safe-rule",
    evaluate(context) {
      return [{
        tick: 0,
        endTick: 0,
        title: "沙箱已运行",
        message: [typeof fetch, typeof process, typeof require, typeof document].join(","),
        noteIds: [], chordIds: [], voiceIds: [], evidence: [], confidence: 1,
      }];
    },
  }],
});
`;

function installedPackage(): InstalledExternalRulePackage {
  return {
    manifest: parseExternalRuleManifest({
      apiVersion: 2,
      packageId: "org.example.safe",
      version: "1.0.0",
      rules: [{ id: "safe-rule", label: "安全示例", group: "custom" }],
    }),
    contentHash: "a".repeat(64),
    sourcePath: "safe.satb-rule.js",
    sizeBytes: 100,
    installedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("Phase C 外置规则 manifest", () => {
  it("补齐可选元数据并拒绝重复规则 ID", () => {
    const manifest = parseExternalRuleManifest({
      apiVersion: 2,
      packageId: "org.example.rules",
      version: "1.2.0",
      rules: [{ id: "example", label: "示例", group: "custom" }],
    });
    expect(manifest.rules[0]).toMatchObject({
      description: "外置检查规则",
      defaultSeverity: "warning",
      dependencyScope: "project",
    });
    expect(() =>
      parseExternalRuleManifest({
        ...manifest,
        rules: [manifest.rules[0], manifest.rules[0]],
      }),
    ).toThrow("重复");
  });

  it("直接拒绝未发布的 API v1 规则包", () => {
    expect(() =>
      parseExternalRuleManifest({
        apiVersion: 1,
        packageId: "org.example.legacy",
        version: "1.0.0",
        rules: [{ id: "legacy", label: "旧规则", group: "custom" }],
      }),
    ).toThrow("API v2");
  });
});

describe("Phase C QuickJS 沙箱", () => {
  it("通过受控注册读取 manifest，并且不暴露宿主 API", async () => {
    const inspection = await inspectExternalRuleSource(EXAMPLE_SOURCE);
    expect(inspection.executableRuleIds).toEqual(["safe-rule"]);

    const project = createEmptyProject();
    const context = buildExternalRuleContext(buildHarmonyAnalysis(project, 3));
    expect(context.project).not.toHaveProperty("auxiliaryTracks");
    expect(context.project).not.toHaveProperty("audio");
    expect(context).toHaveProperty("auxiliarySummary");
    const evaluation = await evaluateExternalRuleSource({
      source: EXAMPLE_SOURCE,
      ruleId: "safe-rule",
      context,
      config: {},
    });
    expect((evaluation.value as Array<{ message: string }>)[0].message).toBe(
      "undefined,undefined,undefined,undefined",
    );
  });

  it("中断超过 CPU 预算的死循环", async () => {
    const source = `SATB_RULE.register({
      manifest: { apiVersion: 2, packageId: "org.example.loop", version: "1", rules: [{ id: "loop", label: "循环", group: "custom" }] },
      rules: [{ id: "loop", evaluate() { while (true) {} } }],
    });`;
    const context = buildExternalRuleContext(
      buildHarmonyAnalysis(createEmptyProject(), 1),
    );
    await expect(
      evaluateExternalRuleSource({
        source,
        ruleId: "loop",
        context,
        config: {},
        timeoutMs: 25,
      }),
    ).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("隔离超过堆限制的规则", async () => {
    const source = `SATB_RULE.register({
      manifest: { apiVersion: 2, packageId: "org.example.memory", version: "1", rules: [{ id: "memory", label: "内存", group: "custom" }] },
      rules: [{ id: "memory", evaluate() { return [new Array(8000000).fill("xxxxxxxx")]; } }],
    });`;
    const context = buildExternalRuleContext(
      buildHarmonyAnalysis(createEmptyProject(), 1),
    );
    await expect(
      evaluateExternalRuleSource({
        source,
        ruleId: "memory",
        context,
        config: {},
      }),
    ).rejects.toMatchObject({
      code: "memory-limit",
    });
  });

  it("按切片传递规则私有状态并返回统一结果对象", async () => {
    const source = `SATB_RULE.register({
      manifest: {
        apiVersion: 2,
        packageId: "org.example.safe",
        version: "1.0.0",
        rules: [{ id: "safe-rule", label: "状态示例", group: "custom" }],
      },
      rules: [{
        id: "safe-rule",
        process(step, incoming) {
          const previous = incoming[0];
          const state = previous
            ? { ...previous, payload: { visited: previous.payload.visited + 1 } }
            : {
                id: "state-1",
                ownerRuleId: "safe-rule",
                createdAt: { tick: step.slice.tick, sliceIndex: step.sliceIndex },
                payload: { visited: 1 },
              };
          return {
            outgoing: [state],
            diagnostics: [{
              tick: step.slice.tick,
              title: "状态规则",
              message: "已处理切片",
              noteIds: [], chordIds: [], voiceIds: [],
            }],
          };
        },
      }],
    });`;
    const project = createEmptyProject();
    const context = buildExternalRuleContext(buildHarmonyAnalysis(project, 7));
    const inspection = await inspectExternalRuleSource(source);
    expect(inspection.statefulRuleIds).toEqual(["safe-rule"]);
    const evaluation = await evaluateExternalRuleSource({
      source,
      ruleId: "safe-rule",
      context,
      config: {},
    });
    const packageMetadata = installedPackage();
    expect(
      normalizeExternalRuleDiagnostics({
        value: evaluation.value,
        project,
        package: packageMetadata,
        rule: packageMetadata.manifest.rules[0],
        severity: "suggestion",
      }),
    ).toHaveLength(context.slices.length);
  });
});

describe("Phase C 外置诊断归一化", () => {
  it("校验对象引用并合并到内置检查结果", () => {
    const project = createEmptyProject();
    const packageMetadata = installedPackage();
    const diagnostics = normalizeExternalRuleDiagnostics({
      value: [
        {
          tick: 0,
          endTick: 0,
          title: "示例诊断",
          message: "来自外置规则",
          noteIds: [],
          chordIds: [],
          voiceIds: [],
          evidence: [],
        },
      ],
      project,
      package: packageMetadata,
      rule: packageMetadata.manifest.rules[0],
      severity: "suggestion",
    });
    expect(diagnostics[0]).toMatchObject({
      source: "external",
      ruleId: "safe-rule",
      severity: "suggestion",
    });

    const builtin = checkHarmony(project);
    const merged = mergeExternalRuleResult(builtin, {
      diagnostics,
      skippedRules: [],
      failures: [],
      revision: builtin.revision,
      superseded: false,
    });
    expect(merged.diagnostics).toContainEqual(diagnostics[0]);
  });

  it("非法音符引用会使整条规则结果失败", () => {
    const project = createEmptyProject();
    const packageMetadata = installedPackage();
    expect(() =>
      normalizeExternalRuleDiagnostics({
        value: [
          {
            tick: 0,
            title: "非法引用",
            message: "不存在的音符",
            noteIds: ["missing"],
            chordIds: [],
            voiceIds: [],
          },
        ],
        project,
        package: packageMetadata,
        rule: packageMetadata.manifest.rules[0],
        severity: "warning",
      }),
    ).toThrow("不存在的音符");
  });
});
