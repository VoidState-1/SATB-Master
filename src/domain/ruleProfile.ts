import {
  HARMONY_RULE_DEFINITIONS,
  HARMONY_RULE_DEFINITION_BY_ID,
  HARMONY_RULE_CATALOG_REVISION,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
} from "./harmony/rules/catalog";
import {
  type HarmonyRuleSeverity,
  type RuleConfig,
  type RuleExceptionPolicy,
  type RuleInstanceSettings,
} from "./harmony/rules/types";
import {
  createDefaultRuleProfile,
  defaultVoiceRange,
  defaultVoiceRanges,
  VOICE_ORDER,
  type ProjectDocument,
  type RuleProfile,
  type SharedHarmonySettings,
  type VoiceId,
} from "./project";
import {
  externalRuleReferenceKey,
  normalizeExternalRuleConfig,
  type InstalledExternalRulePackage,
} from "./harmony/external/api";
import {
  MAX_RULE_CONFIG_ENTRIES,
  CLOSED_PHRASE_SYNCOPATION,
  EQUAL_K46_ACCENT,
  INNER_LEADING_DESCENT,
  normalizeExceptionPolicy,
  normalizeRuleConfig,
  parseRuleConfig as parseRuleConfigMap,
  parseRuleConfigValue,
  parseRuleExceptionPolicy,
} from "./harmony/rules/configSchema";
import {
  CONTENT_HASH_PATTERN,
  STABLE_ID_PATTERN,
  VERSION_PATTERN,
} from "../../shared/external-rules";

export const PORTABLE_RULE_PROFILE_KIND = "satb-rule-profile";
export const PORTABLE_RULE_PROFILE_VERSION = 2;
export const TEACHING_PRESETS = { strict: "严格作业", textbook: "教材分析" } as const;
export type TeachingPreset = keyof typeof TEACHING_PRESETS;

const teachingOptions = [
  ["cadence.cadential64-metric-position", EQUAL_K46_ACCENT],
  ["rhythm.harmonic-syncopation", CLOSED_PHRASE_SYNCOPATION],
  ["resolution.leading-tone", INNER_LEADING_DESCENT],
] as const;

export interface PortableRuleProfile {
  kind: typeof PORTABLE_RULE_PROFILE_KIND;
  formatVersion: typeof PORTABLE_RULE_PROFILE_VERSION;
  catalogRevision: number;
  title: string;
  shared: SharedHarmonySettings;
  builtin: Record<string, RuleInstanceSettings>;
  external: Array<{
    packageId: string;
    version: string;
    contentHash: string;
    ruleId: string;
    settings: RuleInstanceSettings;
  }>;
}

export interface RuleProfileImportReport {
  addedRuleIds: string[];
  changedRuleIds: string[];
  removedRuleIds: string[];
  unknownBuiltinRuleIds: string[];
  missingExternalRuleKeys: string[];
  repairedSettings: Array<{ ruleId: string; keys: string[] }>;
}

export interface PreparedRuleProfileImport {
  portable: PortableRuleProfile;
  profile: RuleProfile;
  report: RuleProfileImportReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}


function parseRuleConfig(value: unknown, label: string): RuleConfig {
  const config = parseRuleConfigValueMap(value);
  if (!config)
    throw new Error(`${label}的 config 无效`);
  return config;
}

function parseRuleConfigValueMap(value: unknown): RuleConfig | undefined {
  return parseRuleConfigMap(value, {
    keyPattern: STABLE_ID_PATTERN,
    maximumEntries: MAX_RULE_CONFIG_ENTRIES,
  });
}

function parseExceptionPolicy(value: unknown, label: string) {
  const policy = parseRuleExceptionPolicy(value);
  if (!policy) throw new Error(`${label}的 exceptions 无效`);
  return policy;
}

function parseRuleInstance(
  value: unknown,
  label: string,
): RuleInstanceSettings {
  if (
    !isRecord(value) ||
    !["error", "warning", "suggestion", "off"].includes(
      value.severity as HarmonyRuleSeverity,
    ) ||
    !Number.isInteger(value.configVersion) ||
    (value.configVersion as number) < 1
  )
    throw new Error(`${label}的设置无效`);
  return {
    severity: value.severity as HarmonyRuleSeverity,
    configVersion: value.configVersion as number,
    config: parseRuleConfig(value.config, label),
    exceptions: parseExceptionPolicy(value.exceptions, label),
  };
}

function parseSharedSettings(value: unknown): SharedHarmonySettings {
  if (
    !isRecord(value) ||
    !isRecord(value.voiceRanges) ||
    typeof value.strictFourPartTexture !== "boolean"
  )
    throw new Error("配置档案的共享设置无效");
  const voiceRanges = {} as SharedHarmonySettings["voiceRanges"];
  for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const) {
    const range = parseRuleConfigValue(value.voiceRanges[voiceId]);
    if (!range || typeof range !== "object" || !("minMidi" in range))
      throw new Error(`配置档案的${voiceId}音域无效`);
    voiceRanges[voiceId] = range;
  }
  return { voiceRanges, strictFourPartTexture: value.strictFourPartTexture };
}

export function parsePortableRuleProfile(value: unknown): PortableRuleProfile {
  if (
    !isRecord(value) ||
    value.kind !== PORTABLE_RULE_PROFILE_KIND ||
    value.formatVersion !== PORTABLE_RULE_PROFILE_VERSION ||
    !Number.isInteger(value.catalogRevision) ||
    (value.catalogRevision as number) < 1 ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 120 ||
    !isRecord(value.builtin) ||
    !Array.isArray(value.external) ||
    Object.keys(value.builtin).length > 256 ||
    value.external.length > 256
  )
    throw new Error("所选文件不是受支持的规则配置档案");

  const builtin: Record<string, RuleInstanceSettings> = {};
  for (const [ruleId, settings] of Object.entries(value.builtin)) {
    if (!STABLE_ID_PATTERN.test(ruleId))
      throw new Error("配置档案包含无效规则 ID");
    builtin[ruleId] = parseRuleInstance(settings, `内置规则“${ruleId}”`);
  }

  const externalKeys = new Set<string>();
  const external = value.external.map((candidate, index) => {
    if (!isRecord(candidate))
      throw new Error(`第 ${index + 1} 项外置规则引用无效`);
    const packageId = candidate.packageId;
    const version = candidate.version;
    const contentHash = candidate.contentHash;
    const ruleId = candidate.ruleId;
    if (
      typeof packageId !== "string" ||
      !STABLE_ID_PATTERN.test(packageId) ||
      typeof ruleId !== "string" ||
      !STABLE_ID_PATTERN.test(ruleId) ||
      typeof version !== "string" ||
      !VERSION_PATTERN.test(version) ||
      typeof contentHash !== "string" ||
      !CONTENT_HASH_PATTERN.test(contentHash)
    )
      throw new Error(`第 ${index + 1} 项外置规则标识无效`);
    const key = externalRuleReferenceKey({
      packageId,
      version,
      contentHash,
      ruleId,
    });
    if (externalKeys.has(key)) throw new Error(`外置规则引用“${key}”重复`);
    externalKeys.add(key);
    return {
      packageId,
      version,
      contentHash,
      ruleId,
      settings: parseRuleInstance(candidate.settings, `外置规则“${ruleId}”`),
    };
  });

  return {
    kind: PORTABLE_RULE_PROFILE_KIND,
    formatVersion: PORTABLE_RULE_PROFILE_VERSION,
    catalogRevision: value.catalogRevision as number,
    title: value.title,
    shared: parseSharedSettings(value.shared),
    builtin,
    external,
  };
}

export interface ResolvedBuiltinRuleProfile {
  severities: HarmonyRuleSeverities;
  configs: Record<HarmonyRuleId, RuleConfig>;
  exceptions: Record<HarmonyRuleId, RuleExceptionPolicy>;
  shared: SharedHarmonySettings;
  addedRuleIds: HarmonyRuleId[];
  unknownBuiltinRuleIds: string[];
  profileUpgradeRequired: boolean;
}

function definitionOf(ruleId: HarmonyRuleId) {
  const definition = HARMONY_RULE_DEFINITION_BY_ID.get(ruleId);
  if (!definition) throw new Error(`未知内置规则：${ruleId}`);
  return definition;
}

function defaultInstance(ruleId: HarmonyRuleId): RuleInstanceSettings {
  const definition = definitionOf(ruleId);
  return {
    severity: definition.defaultSeverity,
    configVersion: definition.configVersion,
    config: structuredClone(definition.defaultConfig),
    exceptions: { ...definition.defaultExceptionPolicies },
  };
}

function ensureInstance(project: ProjectDocument, ruleId: HarmonyRuleId) {
  return (project.ruleProfile.builtin[ruleId] ??= defaultInstance(ruleId));
}

function sharedVoiceRangeConfig(shared: SharedHarmonySettings): RuleConfig {
  return Object.fromEntries(
    Object.entries(shared.voiceRanges).map(([voiceId, range]) => [
      voiceId,
      { ...range },
    ]),
  );
}

/**
 * 将工程 profile 解析成一次检查使用的不可变快照。目录升级后缺失的规则在内存
 * 中保持关闭，直到用户确认升级工程快照，避免新版默认值静默改变旧工程结果。
 */
export function resolveBuiltinRuleProfile(
  project: ProjectDocument,
): ResolvedBuiltinRuleProfile {
  const severities = {} as HarmonyRuleSeverities;
  const configs = {} as Record<HarmonyRuleId, RuleConfig>;
  const exceptions = {} as Record<HarmonyRuleId, RuleExceptionPolicy>;
  const addedRuleIds: HarmonyRuleId[] = [];

  HARMONY_RULE_DEFINITIONS.forEach((definition) => {
    const ruleId = definition.id;
    const stored = project.ruleProfile.builtin[ruleId];
    if (!stored) addedRuleIds.push(ruleId);
    severities[ruleId] = stored?.severity ?? "off";
    const sourceConfig =
      ruleId === "voice.range"
        ? sharedVoiceRangeConfig(project.ruleProfile.shared)
        : stored?.config;
    configs[ruleId] = normalizeRuleConfig(definition, sourceConfig).config;
    exceptions[ruleId] = stored
      ? normalizeExceptionPolicy(
          definition.supportedExceptionContexts,
          stored.exceptions,
        )
      : {};
  });

  const knownRuleIds = new Set(HARMONY_RULE_DEFINITIONS.map(({ id }) => id));
  const unknownBuiltinRuleIds = Object.keys(project.ruleProfile.builtin).filter(
    (ruleId) => !knownRuleIds.has(ruleId as HarmonyRuleId),
  );

  return {
    severities,
    configs,
    exceptions,
    shared: structuredClone(project.ruleProfile.shared),
    addedRuleIds,
    unknownBuiltinRuleIds,
    profileUpgradeRequired:
      project.ruleProfile.catalogRevision !== HARMONY_RULE_CATALOG_REVISION ||
      addedRuleIds.length > 0,
  };
}

/** 用户确认目录升级后，才把缺失规则写入工程；新增项始终保持关闭。 */
export function upgradeBuiltinRuleProfileSnapshot(project: ProjectDocument) {
  for (const definition of HARMONY_RULE_DEFINITIONS) {
    const stored = project.ruleProfile.builtin[definition.id];
    if (stored) continue;
    project.ruleProfile.builtin[definition.id] = {
      ...defaultInstance(definition.id),
      severity: "off",
    };
  }
  project.ruleProfile.profileVersion = 2;
  project.ruleProfile.catalogRevision = HARMONY_RULE_CATALOG_REVISION;
}

export function setBuiltinRuleSeverity(
  project: ProjectDocument,
  ruleId: HarmonyRuleId,
  severity: HarmonyRuleSeverities[HarmonyRuleId],
) {
  ensureInstance(project, ruleId).severity = severity;
}

export function setBuiltinRuleConfig(
  project: ProjectDocument,
  ruleId: HarmonyRuleId,
  patch: RuleConfig,
) {
  const definition = definitionOf(ruleId);
  if (ruleId === "voice.range") {
    const normalized = normalizeRuleConfig(definition, {
      ...sharedVoiceRangeConfig(project.ruleProfile.shared),
      ...patch,
    }).config;
    for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const) {
      const range = normalized[voiceId];
      if (
        range &&
        typeof range === "object" &&
        "minMidi" in range &&
        "maxMidi" in range
      )
        project.ruleProfile.shared.voiceRanges[voiceId] = { ...range };
    }
    return;
  }
  const instance = ensureInstance(project, ruleId);
  instance.config = normalizeRuleConfig(definition, {
    ...instance.config,
    ...patch,
  }).config;
  instance.configVersion = definition.configVersion;
}

export function setBuiltinRuleException(
  project: ProjectDocument,
  ruleId: HarmonyRuleId,
  policy: RuleExceptionPolicy | undefined,
) {
  const definition = definitionOf(ruleId);
  const normalized = normalizeExceptionPolicy(
    definition.supportedExceptionContexts,
    policy,
  );
  ensureInstance(project, ruleId).exceptions = normalized;
}

export function resetBuiltinRule(
  project: ProjectDocument,
  ruleId: HarmonyRuleId,
) {
  project.ruleProfile.builtin[ruleId] = defaultInstance(ruleId);
  if (ruleId === "voice.range") {
    project.ruleProfile.shared.voiceRanges = defaultVoiceRanges();
  }
}

export function resetAllBuiltinRules(project: ProjectDocument) {
  const defaults = createDefaultRuleProfile();
  project.ruleProfile.builtin = structuredClone(defaults.builtin);
  project.ruleProfile.shared = defaults.shared;
  project.ruleProfile.catalogRevision = defaults.catalogRevision;
}

/** Switch just the four teaching rules. The profile title and other instances belong to the project. */
export function applyTeachingPreset(project: ProjectDocument, preset: TeachingPreset) {
  const textbook = preset === "textbook";
  for (const [id, option] of teachingOptions) {
    resetBuiltinRule(project, id);
    setBuiltinRuleConfig(project, id, { [option.key]: textbook });
  }
  resetBuiltinRule(project, "voice.range");
  if (textbook) setBuiltinRuleSeverity(project, "voice.range", "suggestion");
}

export function currentTeachingPreset(profile: ResolvedBuiltinRuleProfile): TeachingPreset | undefined {
  for (const voice of VOICE_ORDER) {
    const actual = profile.shared.voiceRanges[voice];
    const range = defaultVoiceRange(voice);
    if (actual.minMidi !== range.minMidi || actual.maxMidi !== range.maxMidi) return;
  }
  const severity = profile.severities["voice.range"];
  if (severity !== "warning" && severity !== "suggestion") return;
  const textbook = severity === "suggestion";
  if (teachingOptions.every(([id, option]) =>
    profile.severities[id] === definitionOf(id).defaultSeverity &&
    Object.keys(profile.exceptions[id]).length === 0 &&
    profile.configs[id][option.key] === textbook)) return textbook ? "textbook" : "strict";
}

export function setSharedVoiceRange(
  project: ProjectDocument,
  voiceId: VoiceId,
  range: { minMidi: number; maxMidi: number },
) {
  if (
    !Number.isInteger(range.minMidi) ||
    !Number.isInteger(range.maxMidi) ||
    range.minMidi < 0 ||
    range.maxMidi > 127 ||
    range.minMidi > range.maxMidi
  )
    return;
  project.ruleProfile.shared.voiceRanges[voiceId] = { ...range };
}

function completeBuiltinSettings(profile: RuleProfile) {
  return Object.fromEntries(
    HARMONY_RULE_DEFINITIONS.map((definition) => {
      const stored = profile.builtin[definition.id];
      const config =
        definition.id === "voice.range"
          ? sharedVoiceRangeConfig(profile.shared)
          : normalizeRuleConfig(definition, stored?.config).config;
      return [
        definition.id,
        {
          severity: stored?.severity ?? "off",
          configVersion: definition.configVersion,
          config,
          exceptions: stored ? { ...stored.exceptions } : {},
        } satisfies RuleInstanceSettings,
      ];
    }),
  );
}

/** 导出的档案始终展开全部已知内置规则，避免依赖应用版本的隐式默认值。 */
export function createPortableRuleProfile(
  profile: RuleProfile,
): PortableRuleProfile {
  return {
    kind: PORTABLE_RULE_PROFILE_KIND,
    formatVersion: PORTABLE_RULE_PROFILE_VERSION,
    catalogRevision: HARMONY_RULE_CATALOG_REVISION,
    title: profile.title,
    shared: structuredClone(profile.shared),
    builtin: completeBuiltinSettings(profile),
    external: profile.external.map((reference) => ({
      packageId: reference.packageId,
      version: reference.version,
      contentHash: reference.contentHash,
      ruleId: reference.ruleId,
      settings: {
        // 便携格式只有一个启用维度；未启用引用以 off 保存，避免导入后意外执行。
        severity: reference.enabled ? reference.severity : "off",
        configVersion: reference.configVersion,
        config: structuredClone(reference.config),
        exceptions: { ...reference.exceptions },
      },
    })),
  };
}

function profileRuleMap(profile: RuleProfile) {
  return new Map<string, unknown>([
    ...Object.entries(completeBuiltinSettings(profile)).map(
      ([id, settings]) => [`builtin:${id}`, settings] as const,
    ),
    ...profile.external.map(
      (reference) =>
        [`external:${externalRuleReferenceKey(reference)}`, reference] as const,
    ),
  ]);
}

function diffRuleProfiles(current: RuleProfile, next: RuleProfile) {
  const before = profileRuleMap(current);
  const after = profileRuleMap(next);
  return {
    addedRuleIds: [...after.keys()].filter((key) => !before.has(key)),
    changedRuleIds: [...after.keys()].filter(
      (key) =>
        before.has(key) &&
        JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)),
    ),
    removedRuleIds: [...before.keys()].filter((key) => !after.has(key)),
  };
}

export function prepareRuleProfileImport(
  value: unknown,
  current: RuleProfile,
  packages: readonly InstalledExternalRulePackage[] = [],
): PreparedRuleProfileImport {
  const portable = parsePortableRuleProfile(value);
  const unknownBuiltinRuleIds: string[] = [];
  const repairedSettings: RuleProfileImportReport["repairedSettings"] = [];
  const builtin: RuleProfile["builtin"] = {};

  for (const definition of HARMONY_RULE_DEFINITIONS) {
    const imported = portable.builtin[definition.id];
    const normalized = normalizeRuleConfig(definition, imported?.config);
    if (normalized.repairs.length > 0 && imported)
      repairedSettings.push({
        ruleId: definition.id,
        keys: [...new Set(normalized.repairs.map((repair) => repair.key))],
      });
    builtin[definition.id] = {
      severity: imported?.severity ?? "off",
      configVersion: definition.configVersion,
      config:
        definition.id === "voice.range"
          ? sharedVoiceRangeConfig(portable.shared)
          : normalized.config,
      exceptions: normalizeExceptionPolicy(
        definition.supportedExceptionContexts,
        imported?.exceptions ?? {},
      ),
    };
  }
  for (const ruleId of Object.keys(portable.builtin)) {
    if (!HARMONY_RULE_DEFINITION_BY_ID.has(ruleId as HarmonyRuleId)) {
      unknownBuiltinRuleIds.push(ruleId);
      builtin[ruleId] = structuredClone(portable.builtin[ruleId]);
    }
  }

  const installedByKey = new Map(
    packages.flatMap((installedPackage) =>
      installedPackage.manifest.rules.map(
        (rule) =>
          [
            externalRuleReferenceKey({
              packageId: installedPackage.manifest.packageId,
              version: installedPackage.manifest.version,
              contentHash: installedPackage.contentHash,
              ruleId: rule.id,
            }),
            { installedPackage, rule },
          ] as const,
      ),
    ),
  );
  const missingExternalRuleKeys: string[] = [];
  const external: RuleProfile["external"] = portable.external.map((item) => {
    const key = externalRuleReferenceKey(item);
    const installed = installedByKey.get(key);
    let config = structuredClone(item.settings.config);
    let configVersion = item.settings.configVersion;
    let exceptions = { ...item.settings.exceptions };
    if (installed) {
      const normalized = normalizeExternalRuleConfig(installed.rule, config);
      config = normalized.config;
      configVersion = installed.rule.configVersion;
      exceptions = normalizeExceptionPolicy(
        installed.rule.supportedExceptionContexts,
        exceptions,
      );
      if (normalized.repairs.length > 0)
        repairedSettings.push({
          ruleId: item.ruleId,
          keys: [...new Set(normalized.repairs.map((repair) => repair.key))],
        });
    } else {
      missingExternalRuleKeys.push(key);
    }
    return {
      packageId: item.packageId,
      version: item.version,
      contentHash: item.contentHash,
      ruleId: item.ruleId,
      severity: item.settings.severity,
      enabled: item.settings.severity !== "off",
      configVersion,
      config,
      exceptions,
    };
  });

  const profile: RuleProfile = {
    profileVersion: 2,
    catalogRevision: HARMONY_RULE_CATALOG_REVISION,
    title: portable.title,
    shared: structuredClone(portable.shared),
    builtin,
    external,
  };
  return {
    portable,
    profile,
    report: {
      ...diffRuleProfiles(current, profile),
      unknownBuiltinRuleIds,
      missingExternalRuleKeys,
      repairedSettings,
    },
  };
}
