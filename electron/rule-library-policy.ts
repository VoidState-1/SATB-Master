import { createHash } from 'node:crypto'

export const MAX_RULE_BYTES = 512 * 1024
const HASH_PATTERN = /^[a-f0-9]{64}$/
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/
const VERSION_PATTERN = /^[0-9A-Za-z](?:[0-9A-Za-z.+-]{0,62}[0-9A-Za-z])?$/
const VALID_GROUPS = new Set(['voice', 'melody', 'voiceLeading', 'chord', 'custom'])
const VALID_SEVERITIES = new Set(['error', 'warning', 'suggestion'])
const VALID_SCOPES = new Set(['note', 'slice', 'chord', 'phrase', 'project'])

export interface RuleManifestEntry {
  id: string
  label: string
  description: string
  group: string
  defaultSeverity: string
  dependencyScope: string
}

export interface RuleManifest {
  apiVersion: 1
  packageId: string
  version: string
  rules: RuleManifestEntry[]
}

export interface InstalledRulePackage {
  manifest: RuleManifest
  contentHash: string
  sourcePath?: string
  sizeBytes: number
  installedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, label: string, max: number, pattern?: RegExp) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    (pattern && !pattern.test(value))
  ) throw new Error(`${label} 无效`)
  return value
}

export function validateRuleManifest(value: unknown): RuleManifest {
  if (!isRecord(value) || value.apiVersion !== 1) throw new Error('规则包 manifest 无效')
  const packageId = requiredString(value.packageId, 'packageId', 128, ID_PATTERN)
  const version = requiredString(value.version, 'version', 64, VERSION_PATTERN)
  if (!Array.isArray(value.rules) || value.rules.length < 1 || value.rules.length > 64) {
    throw new Error('规则包必须声明 1 到 64 条规则')
  }
  const seen = new Set<string>()
  const rules = value.rules.map((entry, index): RuleManifestEntry => {
    if (!isRecord(entry)) throw new Error(`第 ${index + 1} 条规则声明无效`)
    const id = requiredString(entry.id, '规则 ID', 128, ID_PATTERN)
    if (seen.has(id)) throw new Error(`规则 ID“${id}”重复`)
    seen.add(id)
    const group = requiredString(entry.group, '规则分组', 32)
    const defaultSeverity = requiredString(entry.defaultSeverity, '默认严重程度', 16)
    const dependencyScope = requiredString(entry.dependencyScope, '依赖范围', 16)
    if (!VALID_GROUPS.has(group)) throw new Error(`规则“${id}”的分组无效`)
    if (!VALID_SEVERITIES.has(defaultSeverity)) throw new Error(`规则“${id}”的默认严重程度无效`)
    if (!VALID_SCOPES.has(dependencyScope)) throw new Error(`规则“${id}”的依赖范围无效`)
    return {
      id,
      label: requiredString(entry.label, '规则名称', 120),
      description: requiredString(entry.description, '规则说明', 400),
      group,
      defaultSeverity,
      dependencyScope,
    }
  })
  return { apiVersion: 1, packageId, version, rules }
}

export function validateInstalledRuleMetadata(value: unknown): InstalledRulePackage {
  if (!isRecord(value)) throw new Error('规则包元数据无效')
  const contentHash = requiredString(value.contentHash, '内容摘要', 64, HASH_PATTERN)
  if (
    !Number.isInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 1 ||
    (value.sizeBytes as number) > MAX_RULE_BYTES
  ) throw new Error('规则包大小无效')
  return {
    manifest: validateRuleManifest(value.manifest),
    contentHash,
    sourcePath:
      typeof value.sourcePath === 'string' && value.sourcePath.length <= 2048
        ? value.sourcePath
        : undefined,
    sizeBytes: value.sizeBytes as number,
    installedAt: requiredString(value.installedAt, '安装时间', 64),
  }
}

export function assertRuleHash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) throw new Error('规则包内容摘要无效')
}

export function isRuleMetadataFileName(value: string) {
  return value.endsWith('.json') && HASH_PATTERN.test(value.slice(0, -'.json'.length))
}

export function hashRuleSource(source: string) {
  return createHash('sha256').update(source, 'utf8').digest('hex')
}
