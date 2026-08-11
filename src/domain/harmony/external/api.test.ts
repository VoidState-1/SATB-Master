import { describe, expect, it } from "vitest";
import { buildHarmonyAnalysis } from "../analysis";
import { createChordRegion } from "../../chords";
import {
  buildExternalRuleContext,
  mergeExternalRuleResult,
  normalizeExternalRuleDiagnostics,
  parseExternalRuleManifest,
  type InstalledExternalRulePackage,
} from "./api";
import {
  evaluateExternalRuleSource,
  inspectExternalRuleSource,
} from "./sandbox";
import { createEmptyProject, PPQ } from "../../project";
import { checkHarmony } from "../registry";

const EXAMPLE_SOURCE = `
SATB_RULE.register({
  manifest: {
    apiVersion: 3,
    packageId: "org.example.safe",
    version: "1.0.0",
    rules: [{ id: "safe-rule", label: "安全示例", group: "custom", configVersion: 1 }],
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
      apiVersion: 3,
      packageId: "org.example.safe",
      version: "1.0.0",
      rules: [
        {
          id: "safe-rule",
          label: "安全示例",
          group: "custom",
          configVersion: 1,
        },
      ],
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
      apiVersion: 3,
      packageId: "org.example.rules",
      version: "1.2.0",
      rules: [
        { id: "example", label: "示例", group: "custom", configVersion: 1 },
      ],
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

  it("直接拒绝旧 API 规则包", () => {
    expect(() =>
      parseExternalRuleManifest({
        apiVersion: 1,
        packageId: "org.example.legacy",
        version: "1.0.0",
        rules: [
          { id: "legacy", label: "旧规则", group: "custom", configVersion: 1 },
        ],
      }),
    ).toThrow("API v3");
  });

  it("校验声明式特例上下文和默认策略", () => {
    const manifest = parseExternalRuleManifest({
      apiVersion: 3,
      packageId: "org.example.exceptions",
      version: "1.0.0",
      rules: [
        {
          id: "exception-rule",
          label: "特例规则",
          group: "custom",
          configVersion: 1,
          supportedExceptionContexts: ["same-harmony"],
          defaultExceptionPolicies: { "same-harmony": "downgrade" },
        },
      ],
    });
    expect(manifest.rules[0]).toMatchObject({
      supportedExceptionContexts: ["same-harmony"],
      defaultExceptionPolicies: { "same-harmony": "downgrade" },
    });
    expect(() =>
      parseExternalRuleManifest({
        ...manifest,
        rules: [
          {
            ...manifest.rules[0],
            supportedExceptionContexts: [],
            defaultExceptionPolicies: { "same-harmony": "exempt" },
          },
        ],
      }),
    ).toThrow("默认特例策略");
  });
});

describe("Phase C QuickJS 沙箱", () => {
  it("API v3 暴露完整 identity、语义、span 和连接事实", () => {
    const project = createEmptyProject();
    project.chordTrack.regions = [
      createChordRegion(
        project,
        0,
        PPQ,
        {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          source: "manual",
          confidence: "certain",
        },
        "legacy-compatible",
      ),
      createChordRegion(
        project,
        PPQ,
        PPQ,
        {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          extensions: [9],
          inversion: 0,
          source: "manual",
          confidence: "certain",
        },
        "d9-new-structure",
      ),
    ];
    const context = buildExternalRuleContext(buildHarmonyAnalysis(project, 2));

    expect(context.project.chordTrack.regions).toHaveLength(2);
    expect(context.project.chordTrack.regions[0].identity).toMatchObject({
      structure: { kind: "tertian", quality: "major", extensions: [] },
    });
    expect(context.project.chordTrack.regions[0].semantics).toMatchObject({
      interpretations: [{ degree: 1, degreeAlteration: 0 }],
    });
    expect(
      context.slices.some((slice) => slice.chord?.id === "d9-new-structure"),
    ).toBe(true);
    expect(context.harmonySpans).toHaveLength(2);
    expect(context.connections).toHaveLength(1);
    expect(context.sharedSettings).toBeDefined();
  });

  it("复用音乐分析时仍向外置规则提供当前工程的共享设置", () => {
    const project = createEmptyProject();
    const analysis = buildHarmonyAnalysis(project, 4);
    const profileOnly = structuredClone(project);
    profileOnly.ruleProfile.shared.strictFourPartTexture = false;
    profileOnly.ruleProfile.shared.voiceRanges.soprano.maxMidi = 84;

    const context = buildExternalRuleContext(analysis, profileOnly);

    expect(context.revision).toBe(4);
    expect(context.sharedSettings.strictFourPartTexture).toBe(false);
    expect(context.sharedSettings.voiceRanges.soprano.maxMidi).toBe(84);
  });

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
      manifest: { apiVersion: 3, packageId: "org.example.loop", version: "1", rules: [{ id: "loop", label: "循环", group: "custom", configVersion: 1 }] },
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
      manifest: { apiVersion: 3, packageId: "org.example.memory", version: "1", rules: [{ id: "memory", label: "内存", group: "custom", configVersion: 1 }] },
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
        apiVersion: 3,
        packageId: "org.example.safe",
        version: "1.0.0",
        rules: [{ id: "safe-rule", label: "状态示例", group: "custom", configVersion: 1 }],
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
        analysis: buildHarmonyAnalysis(project, 7),
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
      analysis: buildHarmonyAnalysis(project, 1),
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
        analysis: buildHarmonyAnalysis(project, 1),
        package: packageMetadata,
        rule: packageMetadata.manifest.rules[0],
        severity: "warning",
      }),
    ).toThrow("不存在的音符");
  });

  it("由宿主事实执行外置规则特例的降级与豁免", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      createChordRegion(
        project,
        0,
        PPQ * 2,
        {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          source: "manual",
          confidence: "certain",
        },
        "same-tonic",
      ),
    ];
    project.satbTracks.find((track) => track.id === "soprano")!.notes = [
      {
        id: "same-c",
        startTick: 0,
        durationTicks: PPQ,
        pitch: { step: "C", alter: 0, octave: 5 },
        velocity: 88,
        locked: false,
        spellingSource: "manual",
      },
      {
        id: "same-e",
        startTick: PPQ,
        durationTicks: PPQ,
        pitch: { step: "E", alter: 0, octave: 5 },
        velocity: 88,
        locked: false,
        spellingSource: "manual",
      },
    ];
    const analysis = buildHarmonyAnalysis(project, 1);
    const packageMetadata = installedPackage();
    const rule = {
      ...packageMetadata.manifest.rules[0],
      supportedExceptionContexts: ["same-harmony"] as const,
      defaultExceptionPolicies: { "same-harmony": "downgrade" as const },
    };
    const diagnostic = {
      tick: 0,
      endTick: PPQ * 2,
      title: "特例诊断",
      message: "同和弦语境",
      noteIds: ["same-c", "same-e"],
      chordIds: ["same-tonic"],
      voiceIds: ["soprano"],
    };

    expect(
      normalizeExternalRuleDiagnostics({
        value: [diagnostic],
        analysis,
        package: packageMetadata,
        rule,
        severity: "error",
      })[0].severity,
    ).toBe("warning");
    expect(
      normalizeExternalRuleDiagnostics({
        value: [diagnostic],
        analysis,
        package: packageMetadata,
        rule,
        severity: "error",
        exceptionPolicy: { "same-harmony": "exempt" },
      }),
    ).toEqual([]);
  });

  it("拒绝脚本伪造公共特例、严重程度或覆盖引用", () => {
    const project = createEmptyProject();
    const analysis = buildHarmonyAnalysis(project, 1);
    const packageMetadata = installedPackage();
    const base = {
      tick: 0,
      title: "非法字段",
      message: "脚本不能决定宿主策略",
      noteIds: [],
      chordIds: [],
      voiceIds: [],
    };
    for (const patch of [
      { exceptionContexts: ["same-harmony"] },
      { severity: "suggestion" },
      { coverageRefs: ["resolution.leading-tone"] },
    ]) {
      expect(() =>
        normalizeExternalRuleDiagnostics({
          value: [{ ...base, ...patch }],
          analysis,
          package: packageMetadata,
          rule: packageMetadata.manifest.rules[0],
          severity: "warning",
        }),
      ).toThrow();
    }
  });

  it("只接受当前分析快照内的结构化 causeRefs 并进行命名空间隔离", () => {
    const project = createEmptyProject();
    const analysis = buildHarmonyAnalysis(project, 1);
    const packageMetadata = installedPackage();
    const normalized = normalizeExternalRuleDiagnostics({
      value: [
        {
          tick: 0,
          title: "本地根因",
          message: "结构化引用",
          noteIds: [],
          chordIds: [],
          voiceIds: [],
          causeRefs: [{ kind: "local", id: "first-cause" }],
        },
      ],
      analysis,
      package: packageMetadata,
      rule: packageMetadata.manifest.rules[0],
      severity: "warning",
    });
    expect(normalized[0].causeRefs?.[0]).toContain(
      "external:org.example.safe:",
    );
    expect(() =>
      normalizeExternalRuleDiagnostics({
        value: [
          {
            tick: 0,
            title: "非法根因",
            message: "不存在的连接",
            noteIds: [],
            chordIds: [],
            voiceIds: [],
            causeRefs: [{ kind: "connection", id: "connection:missing" }],
          },
        ],
        analysis,
        package: packageMetadata,
        rule: packageMetadata.manifest.rules[0],
        severity: "warning",
      }),
    ).toThrow("无效分析对象");
  });
});
