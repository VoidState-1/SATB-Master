/**
 * Renderer 与 Electron 共用的外置规则包协议。此文件不得依赖 DOM、React、
 * Electron 或 Node 内建模块，以便两个运行边界对同一输入得到同一解析结果。
 */
export const EXTERNAL_RULE_API_VERSION = 3;
export const MAX_EXTERNAL_RULE_BYTES = 512 * 1024;
export const EXTERNAL_RULE_GROUPS = [
  "voice",
  "melody",
  "voiceLeading",
  "chord",
  "resolution",
  "nonchord",
  "function",
  "connection",
  "rhythm",
  "cadence",
  "tonality",
  "custom",
] as const;
export const EXTERNAL_RULE_SEVERITIES = [
  "error",
  "warning",
  "suggestion",
] as const;
export const RULE_DEPENDENCY_SCOPES = [
  "note",
  "slice",
  "chord",
  "phrase",
  "project",
] as const;
export const RULE_EXCEPTION_CONTEXTS = [
  "same-harmony",
  "arpeggiation",
  "voice-exchange",
  "inner-voices",
  "bass-step-up",
  "sequence",
  "pedal-point",
  "nonchord-tone",
  "cadence",
  "modulation",
  "ambiguous-semantics",
  "insufficient-context",
] as const;
export const RULE_EXCEPTION_MODES = ["exempt", "downgrade", "strict"] as const;
export const RULE_DURATION_UNITS = ["ticks", "beats", "measures"] as const;

export const STABLE_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
export const VERSION_PATTERN =
  /^[0-9A-Za-z](?:[0-9A-Za-z.+-]{0,62}[0-9A-Za-z])?$/;
export const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;

export type ExternalRuleGroupId = (typeof EXTERNAL_RULE_GROUPS)[number];
export type ExternalRuleSeverity = (typeof EXTERNAL_RULE_SEVERITIES)[number];
export type RuleDependencyScope = (typeof RULE_DEPENDENCY_SCOPES)[number];
export type RuleExceptionContext = (typeof RULE_EXCEPTION_CONTEXTS)[number];
export type RuleExceptionMode = (typeof RULE_EXCEPTION_MODES)[number];
export type RuleDurationUnit = (typeof RULE_DURATION_UNITS)[number];
export type RuleExceptionPolicy = Partial<
  Record<RuleExceptionContext, RuleExceptionMode>
>;

interface RuleOptionBase {
  key: string;
  label: string;
  description: string;
  section: "general" | "threshold" | "exceptions";
  required: boolean;
}

export type ExternalRuleOptionDefinition =
  | (RuleOptionBase & { kind: "boolean"; defaultValue: boolean })
  | (RuleOptionBase & {
      kind: "integer" | "number" | "pitch";
      defaultValue: number;
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
    })
  | (RuleOptionBase & {
      kind: "enum";
      defaultValue: string;
      values: readonly { value: string; label: string }[];
    })
  | (RuleOptionBase & {
      kind: "pitch-range";
      defaultValue: { minMidi: number; maxMidi: number };
    })
  | (RuleOptionBase & {
      kind: "duration";
      defaultValue: { value: number; unit: RuleDurationUnit };
      min?: number;
      max?: number;
      step?: number;
    });

export interface ExternalRuleManifestRule {
  id: string;
  label: string;
  description: string;
  group: ExternalRuleGroupId;
  defaultSeverity: ExternalRuleSeverity;
  dependencyScope: RuleDependencyScope;
  configVersion: number;
  options: readonly ExternalRuleOptionDefinition[];
  supportedExceptionContexts: readonly RuleExceptionContext[];
  defaultExceptionPolicies: RuleExceptionPolicy;
}

export interface ExternalRuleManifest {
  apiVersion: typeof EXTERNAL_RULE_API_VERSION;
  packageId: string;
  version: string;
  rules: ExternalRuleManifestRule[];
}

export interface InstalledExternalRulePackage {
  manifest: ExternalRuleManifest;
  contentHash: string;
  sourcePath?: string;
  sizeBytes: number;
  installedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  label: string,
  maximumLength: number,
  pattern?: RegExp,
) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximumLength ||
    (pattern && !pattern.test(value))
  )
    throw new Error(`${label} 无效`);
  return value;
}

function optionalFiniteNumber(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} 必须是有限数值`);
  return value;
}

function parseRuleOptions(
  value: unknown,
  ruleId: string,
): readonly ExternalRuleOptionDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32)
    throw new Error(`规则“${ruleId}”最多声明 32 个配置项`);
  const keys = new Set<string>();
  return value.map((candidate, index): ExternalRuleOptionDefinition => {
    if (!isRecord(candidate))
      throw new Error(`规则“${ruleId}”第 ${index + 1} 个配置项无效`);
    const key = requiredString(candidate.key, "配置项 key", 64, STABLE_ID_PATTERN);
    if (keys.has(key)) throw new Error(`规则“${ruleId}”的配置项“${key}”重复`);
    keys.add(key);
    const kind = candidate.type ?? candidate.kind;
    if (
      ![
        "boolean",
        "integer",
        "number",
        "pitch",
        "enum",
        "pitch-range",
        "duration",
      ].includes(String(kind))
    )
      throw new Error(`配置项“${key}”的类型无效`);
    const section = candidate.section ?? "general";
    if (!["general", "threshold", "exceptions"].includes(String(section)))
      throw new Error(`配置项“${key}”的分区无效`);
    const base = {
      key,
      label: requiredString(candidate.label, `配置项“${key}”的名称`, 120),
      description:
        typeof candidate.description === "string" &&
        candidate.description.length <= 400
          ? candidate.description
          : "外置规则配置项",
      section: section as RuleOptionBase["section"],
      required: candidate.required !== false,
    };
    if (kind === "boolean") {
      if (typeof candidate.defaultValue !== "boolean")
        throw new Error(`配置项“${key}”的默认值无效`);
      return { ...base, kind, defaultValue: candidate.defaultValue };
    }
    if (kind === "enum") {
      if (
        !Array.isArray(candidate.values) ||
        candidate.values.length < 1 ||
        candidate.values.length > 32
      )
        throw new Error(`配置项“${key}”的枚举值无效`);
      const values = candidate.values.map((entry) => {
        if (!isRecord(entry)) throw new Error(`配置项“${key}”的枚举值无效`);
        return {
          value: requiredString(entry.value, "枚举值", 80),
          label: requiredString(entry.label, "枚举名称", 120),
        };
      });
      if (
        typeof candidate.defaultValue !== "string" ||
        !values.some((entry) => entry.value === candidate.defaultValue)
      )
        throw new Error(`配置项“${key}”的默认枚举值无效`);
      return { ...base, kind, values, defaultValue: candidate.defaultValue };
    }
    if (kind === "pitch-range") {
      const range = candidate.defaultValue;
      if (
        !isRecord(range) ||
        !Number.isInteger(range.minMidi) ||
        !Number.isInteger(range.maxMidi) ||
        (range.minMidi as number) < 0 ||
        (range.maxMidi as number) > 127 ||
        (range.minMidi as number) > (range.maxMidi as number)
      )
        throw new Error(`配置项“${key}”的默认音域无效`);
      return {
        ...base,
        kind,
        defaultValue: {
          minMidi: range.minMidi as number,
          maxMidi: range.maxMidi as number,
        },
      };
    }
    if (kind === "duration") {
      const duration = candidate.defaultValue;
      const min = optionalFiniteNumber(candidate.min, `配置项“${key}”的 min`);
      const max = optionalFiniteNumber(candidate.max, `配置项“${key}”的 max`);
      const step = optionalFiniteNumber(candidate.step, `配置项“${key}”的 step`);
      if (
        !isRecord(duration) ||
        typeof duration.value !== "number" ||
        !Number.isFinite(duration.value) ||
        !RULE_DURATION_UNITS.includes(
          duration.unit as (typeof RULE_DURATION_UNITS)[number],
        ) ||
        (min !== undefined && duration.value < min) ||
        (max !== undefined && duration.value > max) ||
        (step !== undefined && step <= 0)
      )
        throw new Error(`配置项“${key}”的默认时值无效`);
      return {
        ...base,
        kind,
        defaultValue: {
          value: duration.value,
          unit: duration.unit as RuleDurationUnit,
        },
        min,
        max,
        step,
      };
    }
    const min =
      kind === "pitch"
        ? (optionalFiniteNumber(candidate.min, `配置项“${key}”的 min`) ?? 0)
        : optionalFiniteNumber(candidate.min, `配置项“${key}”的 min`);
    const max =
      kind === "pitch"
        ? (optionalFiniteNumber(candidate.max, `配置项“${key}”的 max`) ?? 127)
        : optionalFiniteNumber(candidate.max, `配置项“${key}”的 max`);
    const step = optionalFiniteNumber(candidate.step, `配置项“${key}”的 step`);
    const defaultValue = candidate.defaultValue;
    if (
      typeof defaultValue !== "number" ||
      !Number.isFinite(defaultValue) ||
      ((kind === "integer" || kind === "pitch") &&
        !Number.isInteger(defaultValue)) ||
      (min !== undefined && defaultValue < min) ||
      (max !== undefined && defaultValue > max) ||
      (step !== undefined && step <= 0)
    )
      throw new Error(`配置项“${key}”的默认值无效`);
    return {
      ...base,
      kind: kind as "integer" | "number" | "pitch",
      defaultValue,
      min,
      max,
      step,
      unit:
        typeof candidate.unit === "string"
          ? candidate.unit.slice(0, 32)
          : undefined,
    };
  });
}

function parseExceptionContexts(value: unknown, ruleId: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > RULE_EXCEPTION_CONTEXTS.length)
    throw new Error(`规则“${ruleId}”的特例上下文无效`);
  const contexts = value.map((context) => {
    if (
      typeof context !== "string" ||
      !RULE_EXCEPTION_CONTEXTS.includes(context as RuleExceptionContext)
    )
      throw new Error(`规则“${ruleId}”包含未知特例上下文`);
    return context as RuleExceptionContext;
  });
  if (new Set(contexts).size !== contexts.length)
    throw new Error(`规则“${ruleId}”包含重复特例上下文`);
  return contexts;
}

function parseExceptionPolicies(
  value: unknown,
  ruleId: string,
  supported: readonly RuleExceptionContext[],
) {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`规则“${ruleId}”的默认特例策略无效`);
  const supportedSet = new Set(supported);
  const policy: RuleExceptionPolicy = {};
  for (const [context, mode] of Object.entries(value)) {
    if (
      !supportedSet.has(context as RuleExceptionContext) ||
      !RULE_EXCEPTION_MODES.includes(mode as RuleExceptionMode)
    )
      throw new Error(`规则“${ruleId}”的默认特例策略无效`);
    policy[context as RuleExceptionContext] = mode as RuleExceptionMode;
  }
  return policy;
}

export function parseExternalRuleManifest(value: unknown): ExternalRuleManifest {
  if (!isRecord(value)) throw new Error("规则包 manifest 不是有效对象");
  if (value.apiVersion !== EXTERNAL_RULE_API_VERSION)
    throw new Error(`仅支持外置规则 API v${EXTERNAL_RULE_API_VERSION}`);
  const packageId = requiredString(value.packageId, "规则包 packageId", 128, STABLE_ID_PATTERN);
  const version = requiredString(value.version, "规则包 version", 64, VERSION_PATTERN);
  if (
    !Array.isArray(value.rules) ||
    value.rules.length < 1 ||
    value.rules.length > 64
  )
    throw new Error("规则包必须声明 1 到 64 条规则");
  const seen = new Set<string>();
  const rules = value.rules.map((entry, index): ExternalRuleManifestRule => {
    if (!isRecord(entry)) throw new Error(`第 ${index + 1} 条规则声明无效`);
    const id = requiredString(entry.id, "规则 ID", 128, STABLE_ID_PATTERN);
    if (seen.has(id)) throw new Error(`规则 ID“${id}”重复`);
    seen.add(id);
    const group = (entry.group ?? "custom") as ExternalRuleGroupId;
    const defaultSeverity = (entry.defaultSeverity ?? "warning") as ExternalRuleSeverity;
    const dependencyScope = (entry.dependencyScope ?? "project") as RuleDependencyScope;
    if (!EXTERNAL_RULE_GROUPS.includes(group))
      throw new Error(`规则“${id}”的分组无效`);
    if (!EXTERNAL_RULE_SEVERITIES.includes(defaultSeverity))
      throw new Error(`规则“${id}”的默认严重程度无效`);
    if (!RULE_DEPENDENCY_SCOPES.includes(dependencyScope))
      throw new Error(`规则“${id}”的依赖范围无效`);
    if (
      !Number.isInteger(entry.configVersion) ||
      (entry.configVersion as number) < 1 ||
      (entry.configVersion as number) > 1_000_000
    )
      throw new Error(`规则“${id}”的 configVersion 无效`);
    const supportedExceptionContexts = parseExceptionContexts(
      entry.supportedExceptionContexts,
      id,
    );
    return {
      id,
      label: requiredString(entry.label, `规则“${id}”的名称`, 120),
      description:
        typeof entry.description === "string" && entry.description.length <= 400
          ? entry.description
          : "外置检查规则",
      group,
      defaultSeverity,
      dependencyScope,
      configVersion: entry.configVersion as number,
      options: parseRuleOptions(entry.options, id),
      supportedExceptionContexts,
      defaultExceptionPolicies: parseExceptionPolicies(
        entry.defaultExceptionPolicies,
        id,
        supportedExceptionContexts,
      ),
    };
  });
  return { apiVersion: EXTERNAL_RULE_API_VERSION, packageId, version, rules };
}

export function validateExternalRulePackageMetadata(
  value: unknown,
): InstalledExternalRulePackage {
  if (!isRecord(value)) throw new Error("本机规则包记录无效");
  const contentHash = requiredString(
    value.contentHash,
    "规则包内容摘要",
    64,
    CONTENT_HASH_PATTERN,
  );
  if (
    !Number.isInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 1 ||
    (value.sizeBytes as number) > MAX_EXTERNAL_RULE_BYTES
  )
    throw new Error("规则包文件大小无效");
  return {
    manifest: parseExternalRuleManifest(value.manifest),
    contentHash,
    sourcePath:
      typeof value.sourcePath === "string" && value.sourcePath.length <= 2048
        ? value.sourcePath
        : undefined,
    sizeBytes: value.sizeBytes as number,
    installedAt: requiredString(value.installedAt, "规则包安装时间", 64),
  };
}

export function assertExternalRuleContentHash(
  value: unknown,
): asserts value is string {
  if (typeof value !== "string" || !CONTENT_HASH_PATTERN.test(value))
    throw new Error("规则包内容摘要无效");
}

export function isExternalRuleMetadataFileName(value: string) {
  return (
    value.endsWith(".json") &&
    CONTENT_HASH_PATTERN.test(value.slice(0, -".json".length))
  );
}

