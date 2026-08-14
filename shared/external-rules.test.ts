import { describe, expect, it } from "vitest";
import {
  EXTERNAL_RULE_API_VERSION,
  parseExternalRuleManifest,
  validateExternalRulePackageMetadata,
} from "./external-rules.js";
import { parseExternalRuleManifest as parseRendererManifest } from "../src/domain/harmony/external/api.js";

const samples: Array<{ name: string; value: unknown; accepted: boolean }> = [
  {
    name: "可选字段采用统一默认值",
    accepted: true,
    value: {
      apiVersion: EXTERNAL_RULE_API_VERSION,
      packageId: "org.example.shared",
      version: "1.0.0",
      rules: [{ id: "shared-rule", label: "共享规则", configVersion: 1 }],
    },
  },
  {
    name: "完整 option 和特例策略",
    accepted: true,
    value: {
      apiVersion: EXTERNAL_RULE_API_VERSION,
      packageId: "org.example.options",
      version: "2.1.0",
      rules: [
        {
          id: "threshold-rule",
          label: "阈值规则",
          configVersion: 2,
          options: [
            {
              key: "window",
              label: "窗口",
              kind: "duration",
              defaultValue: { value: 1, unit: "beats" },
              min: 0,
              max: 4,
            },
          ],
          supportedExceptionContexts: ["same-harmony"],
          defaultExceptionPolicies: { "same-harmony": "downgrade" },
        },
      ],
    },
  },
  {
    name: "非法 option 默认值",
    accepted: false,
    value: {
      apiVersion: EXTERNAL_RULE_API_VERSION,
      packageId: "org.example.invalid-option",
      version: "1.0.0",
      rules: [
        {
          id: "invalid",
          label: "非法规则",
          configVersion: 1,
          options: [
            {
              key: "threshold",
              label: "阈值",
              kind: "integer",
              defaultValue: 1.5,
            },
          ],
        },
      ],
    },
  },
  {
    name: "策略未声明支持",
    accepted: false,
    value: {
      apiVersion: EXTERNAL_RULE_API_VERSION,
      packageId: "org.example.invalid-policy",
      version: "1.0.0",
      rules: [
        {
          id: "invalid",
          label: "非法规则",
          configVersion: 1,
          defaultExceptionPolicies: { "same-harmony": "exempt" },
        },
      ],
    },
  },
  {
    name: "重复规则 ID",
    accepted: false,
    value: {
      apiVersion: EXTERNAL_RULE_API_VERSION,
      packageId: "org.example.duplicate",
      version: "1.0.0",
      rules: [
        { id: "same", label: "A", configVersion: 1 },
        { id: "same", label: "B", configVersion: 1 },
      ],
    },
  },
];

describe("共享外置规则 contract", () => {
  it.each(samples)("renderer 与 contract 对 $name 得到相同结果", ({ value, accepted }) => {
    const parsers = [
      parseExternalRuleManifest,
      parseRendererManifest,
    ];
    const results = parsers.map((parser) => {
      try {
        return { accepted: true, manifest: parser(value) };
      } catch {
        return { accepted: false };
      }
    });
    expect(results.map((result) => result.accepted)).toEqual([accepted, accepted]);
    if (accepted)
      expect(results.map((result) => result.manifest)).toEqual([
        results[0].manifest,
        results[0].manifest,
      ]);
  });

  it("统一校验 installed metadata 的 hash、大小和 manifest", () => {
    const manifest = parseExternalRuleManifest(samples[0].value);
    const metadata = {
      manifest,
      contentHash: "a".repeat(64),
      sizeBytes: 128,
      installedAt: "2026-08-14T00:00:00.000Z",
    };
    expect(validateExternalRulePackageMetadata(metadata)).toEqual(metadata);
    expect(() =>
      validateExternalRulePackageMetadata({
        ...metadata,
        contentHash: "../escape",
      }),
    ).toThrow("摘要");
  });
});
