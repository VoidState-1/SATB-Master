import {
  externalRuleReferenceKey,
  normalizeExternalRuleConfig,
  type ExternalRuleFailure,
  type ExternalRuleManifestRule,
  type InstalledExternalRulePackage,
} from "../../domain/harmony";
import {
  HARMONY_RULE_SEVERITY_OPTIONS,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
  type HarmonyRuleSeverity,
  type RuleConfig,
  type RuleExceptionPolicy,
} from "../../domain/harmony";
import type { RuleProfile } from "../../domain/project";

export interface ExternalRuleEntry {
  key: string;
  installedPackage?: InstalledExternalRulePackage;
  rule?: ExternalRuleManifestRule;
  reference?: RuleProfile["external"][number];
  failure?: ExternalRuleFailure;
}

export function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function severityLabel(severity: HarmonyRuleSeverity) {
  return (
    HARMONY_RULE_SEVERITY_OPTIONS.find((option) => option.value === severity)
      ?.label ?? severity
  );
}

export function sourceName(sourcePath?: string) {
  return sourcePath?.split(/[\\/]/).at(-1) ?? "本机私有副本";
}

export function buildExternalRuleEntries(
  packages: InstalledExternalRulePackage[],
  references: RuleProfile["external"],
  failures: ExternalRuleFailure[],
): ExternalRuleEntry[] {
  const entries: ExternalRuleEntry[] = [];
  const installedKeys = new Set<string>();
  packages.forEach((installedPackage) => {
    installedPackage.manifest.rules.forEach((rule) => {
      const key = externalRuleReferenceKey({
        packageId: installedPackage.manifest.packageId,
        version: installedPackage.manifest.version,
        contentHash: installedPackage.contentHash,
        ruleId: rule.id,
      });
      installedKeys.add(key);
      entries.push({
        key: `external:${key}`,
        installedPackage,
        rule,
        reference: references.find(
          (reference) => externalRuleReferenceKey(reference) === key,
        ),
        failure: failures.find(
          (failure) =>
            failure.packageId === installedPackage.manifest.packageId &&
            failure.version === installedPackage.manifest.version &&
            failure.contentHash === installedPackage.contentHash &&
            failure.ruleId === rule.id,
        ),
      });
    });
  });
  references.forEach((reference) => {
    const key = externalRuleReferenceKey(reference);
    if (installedKeys.has(key)) return;
    entries.push({
      key: `external:${key}`,
      reference,
      failure: failures.find(
        (failure) =>
          failure.packageId === reference.packageId &&
          failure.version === reference.version &&
          failure.contentHash === reference.contentHash &&
          failure.ruleId === reference.ruleId,
      ),
    });
  });
  return entries;
}

export function isBuiltinRuleModified(
  rule: {
    id: HarmonyRuleId;
    implemented: boolean;
    defaultSeverity: HarmonyRuleSeverity;
    defaultConfig: RuleConfig;
    defaultExceptionPolicies: RuleExceptionPolicy;
  },
  severities: HarmonyRuleSeverities,
  configs: Partial<Record<HarmonyRuleId, RuleConfig>>,
  exceptions: Partial<Record<HarmonyRuleId, RuleExceptionPolicy>>,
) {
  return (
    severities[rule.id] !==
      (rule.implemented ? rule.defaultSeverity : "off") ||
    !sameValue(configs[rule.id] ?? {}, rule.defaultConfig) ||
    !sameValue(exceptions[rule.id] ?? {}, rule.defaultExceptionPolicies)
  );
}

export function isExternalRuleModified(entry: ExternalRuleEntry) {
  if (!entry.reference) return false;
  if (!entry.rule) return true;
  const defaults = normalizeExternalRuleConfig(entry.rule, undefined).config;
  return (
    !entry.reference.enabled ||
    entry.reference.severity !== entry.rule.defaultSeverity ||
    !sameValue(entry.reference.config, defaults) ||
    Object.keys(entry.reference.exceptions).length > 0
  );
}
