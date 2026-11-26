import type {
  HarmonyRuleDefinition,
  RuleConfig,
  RuleConfigNormalizationResult,
  RuleConfigRepair,
  RuleConfigValue,
  RuleOptionDefinition,
} from "./types";
import {
  RULE_DURATION_UNITS,
  RULE_EXCEPTION_CONTEXTS,
  RULE_EXCEPTION_MODES,
  type RuleExceptionContext,
  type RuleExceptionMode,
  type RuleExceptionPolicy,
} from "./types";

export const MAX_RULE_CONFIG_ENTRIES = 64;

/** Optional teaching policies are stored in ordinary rule instances (profile v2). */
export const EQUAL_K46_ACCENT = teachingOption("allow-equal-accent", "允许 K46 与后继和弦等强", "K46 仍须位于强拍或次强拍。");
export const CLOSED_PHRASE_SYNCOPATION = teachingOption("check-closed-ending", "检查完整句尾切分", "和声延续至工程末尾或已标明的句界时，也检查它是否跨过更强拍位。");
export const INNER_LEADING_DESCENT = teachingOption("allow-inner-descent", "允许内声部导音下行至主和弦五音", "属和声进入主三和弦时，允许女低或男高导音下行大三度至五音。");

function teachingOption(key: string, label: string, description: string) {
  return { kind: "boolean", key, label, description, section: "general", required: false, defaultValue: false } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T extends RuleConfigValue>(value: T): T {
  return structuredClone(value);
}

/** 解析持久化边界允许出现的通用配置值，不绑定某一条规则的 option。 */
export function parseRuleConfigValue(
  value: unknown,
): RuleConfigValue | undefined {
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
    RULE_DURATION_UNITS.includes(
      value.unit as (typeof RULE_DURATION_UNITS)[number],
    )
  )
    return {
      value: value.value,
      unit: value.unit as (typeof RULE_DURATION_UNITS)[number],
    };
  return undefined;
}

export function parseRuleConfig(
  value: unknown,
  options: { readonly keyPattern?: RegExp; readonly maximumEntries?: number } = {},
): RuleConfig | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > (options.maximumEntries ?? MAX_RULE_CONFIG_ENTRIES))
    return undefined;
  const config: RuleConfig = {};
  for (const [key, candidate] of entries) {
    if (options.keyPattern && !options.keyPattern.test(key)) return undefined;
    const parsed = parseRuleConfigValue(candidate);
    if (parsed === undefined) return undefined;
    config[key] = parsed;
  }
  return config;
}

export function parseRuleExceptionPolicy(
  value: unknown,
): RuleExceptionPolicy | undefined {
  if (!isRecord(value)) return undefined;
  const policy: RuleExceptionPolicy = {};
  for (const [context, mode] of Object.entries(value)) {
    if (
      !RULE_EXCEPTION_CONTEXTS.includes(context as RuleExceptionContext) ||
      !RULE_EXCEPTION_MODES.includes(mode as RuleExceptionMode)
    )
      return undefined;
    policy[context as RuleExceptionContext] = mode as RuleExceptionMode;
  }
  return policy;
}

/** 运行时只保留规则明确支持且 mode 合法的特例项。 */
export function normalizeExceptionPolicy(
  supportedContexts: readonly RuleExceptionContext[],
  input: unknown,
): RuleExceptionPolicy {
  if (!isRecord(input)) return {};
  const supported = new Set<RuleExceptionContext>(supportedContexts);
  const policy: RuleExceptionPolicy = {};
  for (const [context, mode] of Object.entries(input)) {
    if (
      supported.has(context as RuleExceptionContext) &&
      RULE_EXCEPTION_MODES.includes(mode as RuleExceptionMode)
    )
      policy[context as RuleExceptionContext] = mode as RuleExceptionMode;
  }
  return policy;
}

export function defaultConfigFromOptions(
  options: readonly RuleOptionDefinition[],
): RuleConfig {
  return Object.fromEntries(
    options.map((option) => [option.key, cloneValue(option.defaultValue)]),
  );
}

export function normalizeRuleConfigValue(
  option: RuleOptionDefinition,
  candidate: unknown,
): { value: RuleConfigValue; repair?: RuleConfigRepair } {
  const fallback = cloneValue(option.defaultValue);
  const repair = (reason: RuleConfigRepair["reason"]) => ({
    value: fallback,
    repair: {
      key: option.key,
      reason,
      previous: candidate,
      replacement: fallback,
    },
  });

  if (candidate === undefined) return repair("missing");
  if (option.kind === "boolean")
    return typeof candidate === "boolean"
      ? { value: candidate }
      : repair("type");
  if (option.kind === "enum")
    return typeof candidate === "string" &&
      option.values.some((entry) => entry.value === candidate)
      ? { value: candidate }
      : repair("enum");
  if (option.kind === "pitch-range") {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      Number.isInteger((candidate as { minMidi?: unknown }).minMidi) &&
      Number.isInteger((candidate as { maxMidi?: unknown }).maxMidi)
    ) {
      const { minMidi, maxMidi } = candidate as {
        minMidi: number;
        maxMidi: number;
      };
      if (minMidi >= 0 && maxMidi <= 127 && minMidi <= maxMidi)
        return { value: { minMidi, maxMidi } };
      return repair("relation");
    }
    return repair("type");
  }
  if (option.kind === "duration") {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      const { value, unit } = candidate as {
        value?: unknown;
        unit?: unknown;
      };
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        RULE_DURATION_UNITS.includes(
          unit as (typeof RULE_DURATION_UNITS)[number],
        ) &&
        (option.min === undefined || value >= option.min) &&
        (option.max === undefined || value <= option.max)
      )
        return {
          value: {
            value,
            unit: unit as (typeof RULE_DURATION_UNITS)[number],
          },
        };
      return repair("range");
    }
    return repair("type");
  }

  if (typeof candidate !== "number" || !Number.isFinite(candidate))
    return repair("type");
  if (
    (option.kind === "integer" || option.kind === "pitch") &&
    !Number.isInteger(candidate)
  )
    return repair("type");
  if (
    (option.min !== undefined && candidate < option.min) ||
    (option.max !== undefined && candidate > option.max)
  )
    return repair("range");
  return { value: candidate };
}

export function normalizeRuleConfig(
  definition: Pick<HarmonyRuleDefinition, "options" | "defaultConfig">,
  input: RuleConfig | undefined,
): RuleConfigNormalizationResult {
  const config: RuleConfig = {};
  const repairs: RuleConfigRepair[] = [];
  const knownKeys = new Set(definition.options.map((option) => option.key));
  Object.keys(input ?? {}).forEach((key) => {
    if (!knownKeys.has(key)) repairs.push({ key, reason: "unknown" });
  });
  definition.options.forEach((option) => {
    const supplied = input !== undefined && Object.hasOwn(input, option.key);
    const normalized = normalizeRuleConfigValue(
      option,
      supplied ? input?.[option.key] : definition.defaultConfig[option.key],
    );
    config[option.key] = normalized.value;
    if (normalized.repair && supplied)
      repairs.push(normalized.repair);
  });
  return { config, repairs };
}
