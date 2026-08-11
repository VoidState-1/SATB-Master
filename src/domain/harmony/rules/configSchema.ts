import type {
  HarmonyRuleDefinition,
  RuleConfig,
  RuleConfigNormalizationResult,
  RuleConfigRepair,
  RuleConfigValue,
  RuleOptionDefinition,
} from "./types";

function cloneValue<T extends RuleConfigValue>(value: T): T {
  return structuredClone(value);
}

function normalizeOption(
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
        ["ticks", "beats", "measures"].includes(String(unit)) &&
        (option.min === undefined || value >= option.min) &&
        (option.max === undefined || value <= option.max)
      )
        return {
          value: {
            value,
            unit: unit as "ticks" | "beats" | "measures",
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
    const normalized = normalizeOption(
      option,
      input?.[option.key] ?? definition.defaultConfig[option.key],
    );
    config[option.key] = normalized.value;
    if (normalized.repair && input?.[option.key] !== undefined)
      repairs.push(normalized.repair);
  });
  return { config, repairs };
}
