import { createHash } from 'node:crypto'
import {
  assertExternalRuleContentHash,
  isExternalRuleMetadataFileName,
  MAX_EXTERNAL_RULE_BYTES,
  parseExternalRuleManifest,
  validateExternalRulePackageMetadata,
  type ExternalRuleManifest,
  type ExternalRuleManifestRule,
  type InstalledExternalRulePackage,
} from '../shared/external-rules.js'

export const MAX_RULE_BYTES = MAX_EXTERNAL_RULE_BYTES
export type RuleManifest = ExternalRuleManifest
export type RuleManifestEntry = ExternalRuleManifestRule
export type InstalledRulePackage = InstalledExternalRulePackage

export const validateRuleManifest = parseExternalRuleManifest
export const validateInstalledRuleMetadata = validateExternalRulePackageMetadata
export const assertRuleHash: (
  value: unknown,
) => asserts value is string = assertExternalRuleContentHash
export const isRuleMetadataFileName = isExternalRuleMetadataFileName

export function hashRuleSource(source: string) {
  return createHash('sha256').update(source, 'utf8').digest('hex')
}
