import {
  HARMONY_RULE_DEFINITIONS,
  HARMONY_RULE_DEFINITION_BY_ID,
  RULE_EXCEPTION_CONTEXTS,
  defaultHarmonyRuleSeverities,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
  type HarmonyRuleSeverity,
  type RuleConfig,
  type RuleConfigValue,
  type RuleExceptionContext,
  type RuleExceptionMode,
  type RuleExceptionPolicy,
  type RuleInstanceSettings,
} from "./harmonyRules";
import {
  createDefaultRuleProfile,
  type ProjectDocument,
  type RuleProfile,
  type SharedHarmonySettings,
  type VoiceId,
} from "./project";
import {
  externalRuleReferenceKey,
  normalizeExternalRuleConfig,
  type InstalledExternalRulePackage,
} from "./externalRules";
import { normalizeRuleConfig } from "./rules/configSchema";

export const PORTABLE_RULE_PROFILE_KIND = "satb-rule-profile";
export const PORTABLE_RULE_PROFILE_VERSION = 1;
const NEW_PROJECT_RULE_PROFILE_KEY = "satb-master-new-project-rule-profile-v1";

export interface PortableRuleProfile {
  kind: typeof PORTABLE_RULE_PROFILE_KIND;
  formatVersion: typeof PORTABLE_RULE_PROFILE_VERSION;
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

const VALID_SEVERITIES = new Set<HarmonyRuleSeverity>([
  "error",
  "warning",
  "suggestion",
  "off",
]);
const VALID_EXCEPTION_MODES = new Set<RuleExceptionMode>([
  "exempt",
  "downgrade",
  "strict",
]);
const STABLE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const VERSION_PATTERN = /^[0-9A-Za-z](?:[0-9A-Za-z.+-]{0,62}[0-9A-Za-z])?$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function parseConfigValue(value: unknown): RuleConfigValue | undefined {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (!isRecord(value)) return undefined;
  if (
    Number.isInteger(value.minMidi) &&
    Number.isInteger(value.maxMidi) &&
    (value.minMidi as number) >= 0 &&
    (value.maxMidi as number) <= 127 &&
    (value.minMidi as number) <= (value.maxMidi as number)
  )
    return {
      minMidi: value.minMidi as number,
      maxMidi: value.maxMidi as number,
    };
  if (
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    ["ticks", "beats", "measures"].includes(String(value.unit))
  )
    return {
      value: value.value,
      unit: value.unit as "ticks" | "beats" | "measures",
    };
  return undefined;
}

function parseRuleConfig(value: unknown, label: string): RuleConfig {
  if (!isRecord(value) || Object.keys(value).length > 64)
    throw new Error(`${label}的 config 无效`);
  const config: RuleConfig = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!STABLE_ID_PATTERN.test(key)) throw new Error(`${label}包含无效配置键`);
    const parsed = parseConfigValue(candidate);
    if (parsed === undefined) throw new Error(`${label}的配置项“${key}”无效`);
    config[key] = parsed;
  }
  return config;
}

function parseExceptionPolicy(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label}的 exceptions 无效`);
  const policy: RuleExceptionPolicy = {};
  for (const [context, mode] of Object.entries(value)) {
    if (
      !RULE_EXCEPTION_CONTEXTS.includes(context as RuleExceptionContext) ||
      !VALID_EXCEPTION_MODES.has(mode as RuleExceptionMode)
    )
      throw new Error(`${label}包含无效特例策略`);
    policy[context as RuleExceptionContext] = mode as RuleExceptionMode;
  }
  return policy;
}

function parseRuleInstance(value: unknown, label: string): RuleInstanceSettings {
  if (
    !isRecord(value) ||
    !VALID_SEVERITIES.has(value.severity as HarmonyRuleSeverity) ||
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
    const range = parseConfigValue(value.voiceRanges[voiceId]);
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
    if (!STABLE_ID_PATTERN.test(ruleId)) throw new Error("配置档案包含无效规则 ID");
    builtin[ruleId] = parseRuleInstance(settings, `内置规则“${ruleId}”`);
  }

  const externalKeys = new Set<string>();
  const external = value.external.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`第 ${index + 1} 项外置规则引用无效`);
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
      !HASH_PATTERN.test(contentHash)
    )
      throw new Error(`第 ${index + 1} 项外置规则标识无效`);
    const key = externalRuleReferenceKey({ packageId, version, contentHash, ruleId });
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
    title: value.title,
    shared: parseSharedSettings(value.shared),
    builtin,
    external,
  };
}

export interface ResolvedBuiltinRuleProfile {
  severities: HarmonyRuleSeverities;
  configs: Partial<Record<HarmonyRuleId, RuleConfig>>;
  exceptions: Partial<Record<HarmonyRuleId, RuleExceptionPolicy>>;
  shared: SharedHarmonySettings;
}

function definitionOf(ruleId: HarmonyRuleId) {
  const definition = HARMONY_RULE_DEFINITIONS.find(
    (candidate) => candidate.id === ruleId,
  );
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
 * 将工程 profile 解析成一次检查使用的不可变快照。目录升级后缺失的规则只在
 * 内存中采用目录默认值，直到用户实际修改时才写入工程，避免无意义文件抖动。
 */
export function resolveBuiltinRuleProfile(
  project: ProjectDocument,
  applicationSeverities = defaultHarmonyRuleSeverities(),
): ResolvedBuiltinRuleProfile {
  const severities = { ...applicationSeverities };
  const configs = {} as Partial<Record<HarmonyRuleId, RuleConfig>>;
  const exceptions = {} as Partial<Record<HarmonyRuleId, RuleExceptionPolicy>>;

  HARMONY_RULE_DEFINITIONS.forEach((definition) => {
    const ruleId = definition.id;
    const stored = project.ruleProfile.builtin[ruleId];
    severities[ruleId] = stored?.severity ?? severities[ruleId];
    const sourceConfig =
      ruleId === "voice.range"
        ? sharedVoiceRangeConfig(project.ruleProfile.shared)
        : stored?.config;
    configs[ruleId] = normalizeRuleConfig(definition, sourceConfig).config;
    exceptions[ruleId] = {
      ...definition.defaultExceptionPolicies,
      ...(stored?.exceptions ?? {}),
    };
  });

  return {
    severities,
    configs,
    exceptions,
    shared: structuredClone(project.ruleProfile.shared),
  };
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
  const supported = new Set<string>(definition.supportedExceptionContexts);
  const normalized = Object.fromEntries(
    Object.entries(policy ?? {}).filter(([context]) => supported.has(context)),
  ) as RuleExceptionPolicy;
  ensureInstance(project, ruleId).exceptions = normalized;
}

export function resetBuiltinRule(
  project: ProjectDocument,
  ruleId: HarmonyRuleId,
) {
  delete project.ruleProfile.builtin[ruleId];
  if (ruleId === "voice.range") {
    project.ruleProfile.shared.voiceRanges = structuredClone(
      createDefaultRuleProfile().shared.voiceRanges,
    );
  }
}

export function resetAllBuiltinRules(project: ProjectDocument) {
  const defaults = createDefaultRuleProfile();
  project.ruleProfile.builtin = {};
  project.ruleProfile.shared = defaults.shared;
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
          severity: stored?.severity ?? definition.defaultSeverity,
          configVersion: definition.configVersion,
          config,
          exceptions: {
            ...definition.defaultExceptionPolicies,
            ...(stored?.exceptions ?? {}),
          },
        } satisfies RuleInstanceSettings,
      ];
    }),
  );
}

/** 导出的档案始终展开全部已知内置规则，避免依赖应用版本的隐式默认值。 */
export function createPortableRuleProfile(profile: RuleProfile): PortableRuleProfile {
  return {
    kind: PORTABLE_RULE_PROFILE_KIND,
    formatVersion: PORTABLE_RULE_PROFILE_VERSION,
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

function normalizeExceptions(
  policy: RuleExceptionPolicy,
  supported: readonly RuleExceptionContext[],
) {
  const supportedSet = new Set<RuleExceptionContext>(supported);
  return Object.fromEntries(
    Object.entries(policy).filter(([context]) =>
      supportedSet.has(context as RuleExceptionContext),
    ),
  ) as RuleExceptionPolicy;
}

function profileRuleMap(profile: RuleProfile) {
  return new Map<string, unknown>([
    ...Object.entries(completeBuiltinSettings(profile)).map(([id, settings]) => [
      `builtin:${id}`,
      settings,
    ] as const),
    ...profile.external.map((reference) => [
      `external:${externalRuleReferenceKey(reference)}`,
      reference,
    ] as const),
  ]);
}

function diffRuleProfiles(current: RuleProfile, next: RuleProfile) {
  const before = profileRuleMap(current);
  const after = profileRuleMap(next);
  return {
    addedRuleIds: [...after.keys()].filter((key) => !before.has(key)),
    changedRuleIds: [...after.keys()].filter(
      (key) => before.has(key) && JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)),
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
      severity: imported?.severity ?? definition.defaultSeverity,
      configVersion: definition.configVersion,
      config:
        definition.id === "voice.range"
          ? sharedVoiceRangeConfig(portable.shared)
          : normalized.config,
      exceptions: normalizeExceptions(
        imported?.exceptions ?? definition.defaultExceptionPolicies,
        definition.supportedExceptionContexts,
      ),
    };
  }
  for (const ruleId of Object.keys(portable.builtin)) {
    if (!HARMONY_RULE_DEFINITION_BY_ID.has(ruleId as HarmonyRuleId))
      unknownBuiltinRuleIds.push(ruleId);
  }

  const installedByKey = new Map(
    packages.flatMap((installedPackage) =>
      installedPackage.manifest.rules.map((rule) => [
        externalRuleReferenceKey({
          packageId: installedPackage.manifest.packageId,
          version: installedPackage.manifest.version,
          contentHash: installedPackage.contentHash,
          ruleId: rule.id,
        }),
        { installedPackage, rule },
      ] as const),
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
      exceptions = normalizeExceptions(
        exceptions,
        installed.rule.supportedExceptionContexts,
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
    profileVersion: 1,
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

export function saveNewProjectRuleProfile(profile: RuleProfile) {
  localStorage.setItem(
    NEW_PROJECT_RULE_PROFILE_KEY,
    JSON.stringify(createPortableRuleProfile(profile)),
  );
}

export function loadNewProjectRuleProfile(): RuleProfile | undefined {
  const raw = localStorage.getItem(NEW_PROJECT_RULE_PROFILE_KEY);
  if (!raw) return undefined;
  try {
    const defaults = createDefaultRuleProfile();
    return prepareRuleProfileImport(JSON.parse(raw), defaults).profile;
  } catch {
    // 损坏的应用级模板不能阻止编辑器启动；保留数据，供用户后续覆盖。
    return undefined;
  }
}
