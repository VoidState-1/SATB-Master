import { describe, expect, it } from "vitest";
import {
  EXTERNAL_RULE_API_VERSION,
  type InstalledExternalRulePackage,
} from "./harmony/external/api";
import { HARMONY_RULE_DEFINITIONS } from "./harmony/ruleTypes";
import { createDefaultRuleProfile } from "./project";
import {
  createPortableRuleProfile,
  parsePortableRuleProfile,
  prepareRuleProfileImport,
  resetAllBuiltinRules,
  resetBuiltinRule,
  resolveBuiltinRuleProfile,
  setBuiltinRuleSeverity,
  upgradeBuiltinRuleProfileSnapshot,
} from "./ruleProfile";

const CONTENT_HASH = "a".repeat(64);

function installedPackage(): InstalledExternalRulePackage {
  return {
    manifest: {
      apiVersion: EXTERNAL_RULE_API_VERSION,
      packageId: "org.example.profile",
      version: "1.0.0",
      rules: [
        {
          id: "org.example.threshold",
          label: "阈值示例",
          description: "测试外置配置归一化。",
          group: "custom",
          defaultSeverity: "warning",
          dependencyScope: "note",
          configVersion: 2,
          options: [
            {
              kind: "number",
              key: "threshold",
              label: "阈值",
              description: "测试阈值。",
              section: "threshold",
              required: true,
              defaultValue: 4,
              min: 1,
              max: 8,
              step: 1,
            },
          ],
          supportedExceptionContexts: ["same-harmony"],
          defaultExceptionPolicies: { "same-harmony": "downgrade" },
        },
      ],
    },
    contentHash: CONTENT_HASH,
    sizeBytes: 128,
    installedAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("规则配置档案", () => {
  it("新工程保存完整目录快照，未实现规则默认关闭", () => {
    const profile = createDefaultRuleProfile();
    expect(profile.profileVersion).toBe(2);
    expect(profile.catalogRevision).toBe(2);
    expect(Object.keys(profile.builtin)).toHaveLength(81);
    for (const definition of HARMONY_RULE_DEFINITIONS) {
      expect(profile.builtin[definition.id]).toBeDefined();
      if (!definition.implemented)
        expect(profile.builtin[definition.id].severity).toBe("off");
    }
  });

  it("缺失目录项只在用户确认后写回，并始终保持关闭", () => {
    const project = createDefaultRuleProfile();
    delete project.builtin["voice.range"];
    const projectDocument = { ruleProfile: project } as Parameters<
      typeof resolveBuiltinRuleProfile
    >[0];
    const resolved = resolveBuiltinRuleProfile(projectDocument);
    expect(resolved.profileUpgradeRequired).toBe(true);
    expect(resolved.addedRuleIds).toContain("voice.range");
    expect(resolved.severities["voice.range"]).toBe("off");

    upgradeBuiltinRuleProfileSnapshot(projectDocument);
    expect(projectDocument.ruleProfile.builtin["voice.range"].severity).toBe("off");
    expect(resolveBuiltinRuleProfile(projectDocument).profileUpgradeRequired).toBe(false);
  });

  it("恢复默认会写入完整实例而不是删除目录项", () => {
    const projectDocument = {
      ruleProfile: createDefaultRuleProfile(),
    } as Parameters<typeof resetBuiltinRule>[0];
    setBuiltinRuleSeverity(projectDocument, "voice.range", "suggestion");
    resetBuiltinRule(projectDocument, "voice.range");
    expect(projectDocument.ruleProfile.builtin["voice.range"].severity).toBe("warning");

    delete projectDocument.ruleProfile.builtin["melody.large-leap"];
    resetAllBuiltinRules(projectDocument);
    expect(Object.keys(projectDocument.ruleProfile.builtin)).toHaveLength(81);
  });

  it("导出时展开全部内置规则并保留共享音域", () => {
    const profile = createDefaultRuleProfile();
    profile.shared.voiceRanges.soprano = { minMidi: 61, maxMidi: 82 };
    const portable = createPortableRuleProfile(profile);

    expect(Object.keys(portable.builtin)).toHaveLength(
      HARMONY_RULE_DEFINITIONS.length,
    );
    expect(portable.builtin["voice.range"].config.soprano).toEqual({
      minMidi: 61,
      maxMidi: 82,
    });
    expect(parsePortableRuleProfile(portable)).toEqual(portable);
  });

  it("报告未知内置规则并按当前 schema 修复已知配置", () => {
    const current = createDefaultRuleProfile();
    const portable = createPortableRuleProfile(current);
    portable.builtin["future.rule"] = {
      severity: "warning",
      configVersion: 1,
      config: {},
      exceptions: {},
    };
    portable.builtin["voice-leading.cross-relation-successive"].config = {
      window: { value: 99, unit: "beats" },
    };

    const prepared = prepareRuleProfileImport(portable, current);

    expect(prepared.report.unknownBuiltinRuleIds).toEqual(["future.rule"]);
    expect(prepared.report.repairedSettings).toContainEqual({
      ruleId: "voice-leading.cross-relation-successive",
      keys: ["window"],
    });
    expect(
      prepared.profile.builtin["voice-leading.cross-relation-successive"].config
        .window,
    ).toEqual({ value: 1, unit: "beats" });
    expect(prepared.profile.builtin["future.rule"]).toEqual(
      portable.builtin["future.rule"],
    );
  });

  it("缺失外置包时保留引用，匹配包存在时修复配置", () => {
    const current = createDefaultRuleProfile();
    const portable = createPortableRuleProfile(current);
    portable.external.push({
      packageId: "org.example.profile",
      version: "1.0.0",
      contentHash: CONTENT_HASH,
      ruleId: "org.example.threshold",
      settings: {
        severity: "error",
        configVersion: 1,
        config: { threshold: 99 },
        exceptions: { "same-harmony": "exempt" },
      },
    });

    const missing = prepareRuleProfileImport(portable, current);
    expect(missing.report.missingExternalRuleKeys).toHaveLength(1);
    expect(missing.profile.external[0]).toMatchObject({
      enabled: true,
      severity: "error",
      config: { threshold: 99 },
    });

    const installed = prepareRuleProfileImport(portable, current, [
      installedPackage(),
    ]);
    expect(installed.report.missingExternalRuleKeys).toEqual([]);
    expect(installed.profile.external[0]).toMatchObject({
      configVersion: 2,
      config: { threshold: 4 },
      exceptions: { "same-harmony": "exempt" },
    });
  });

  it("拒绝结构错误和未知格式版本", () => {
    expect(() => parsePortableRuleProfile({ kind: "satb-rule-profile" })).toThrow(
      "不是受支持",
    );
    expect(() =>
      parsePortableRuleProfile({
        ...createPortableRuleProfile(createDefaultRuleProfile()),
        formatVersion: 3,
      }),
    ).toThrow("不是受支持");
  });
});
