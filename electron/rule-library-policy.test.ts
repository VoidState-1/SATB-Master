import { describe, expect, it } from 'vitest'
import {
  MAX_RULE_BYTES,
  assertRuleHash,
  hashRuleSource,
  isRuleMetadataFileName,
  validateInstalledRuleMetadata,
  validateRuleManifest,
} from './rule-library-policy'

const manifest = {
  apiVersion: 2,
  packageId: 'org.example.rules',
  version: '1.0.0',
  rules: [
    {
      id: 'example-rule',
      label: '示例规则',
      description: '用于验证私有规则库边界。',
      group: 'custom',
      defaultSeverity: 'warning',
      dependencyScope: 'project',
    },
  ],
}

describe('外置规则私有库策略', () => {
  it('接受完整 manifest，并拒绝重复或越界标识', () => {
    expect(validateRuleManifest(manifest)).toEqual(manifest)
    expect(() =>
      validateRuleManifest({ ...manifest, rules: [...manifest.rules, ...manifest.rules] }),
    ).toThrow('重复')
    expect(() =>
      validateRuleManifest({ ...manifest, packageId: '../escape' }),
    ).toThrow('packageId')
  })

  it('使用 SHA-256 摘要作为唯一私有文件名', () => {
    const hash = hashRuleSource('SATB_RULE.register({});')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(() => assertRuleHash('../escape')).toThrow('摘要')
    expect(isRuleMetadataFileName(`${hash}.json`)).toBe(true)
    expect(isRuleMetadataFileName('../escape.json')).toBe(false)
  })

  it('拒绝超过 512 KiB 的本机元数据记录', () => {
    expect(() =>
      validateInstalledRuleMetadata({
        manifest,
        contentHash: 'a'.repeat(64),
        sizeBytes: MAX_RULE_BYTES + 1,
        installedAt: '2026-08-01T00:00:00.000Z',
      }),
    ).toThrow('大小')
  })
})
