export type DiagnosticSeverity = "error" | "warning" | "suggestion";
export type HarmonyRuleSeverity = DiagnosticSeverity | "off";

export type HarmonyRuleGroupId =
  | "voice"
  | "melody"
  | "voiceLeading"
  | "chord"
  | "resolution"
  | "nonchord"
  | "function"
  | "connection"
  | "rhythm"
  | "cadence"
  | "tonality";

export type RuleRequirement =
  "written-pitches" | "chords" | "semantics" | "complete-satb";

export type RuleDependencyScope =
  "note" | "slice" | "chord" | "phrase" | "project";

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

export type RuleExceptionContext = (typeof RULE_EXCEPTION_CONTEXTS)[number];
export type RuleExceptionMode = "exempt" | "downgrade" | "strict";
export type RuleExceptionPolicy = Partial<
  Record<RuleExceptionContext, RuleExceptionMode>
>;

export type RuleConfigValue =
  | string
  | number
  | boolean
  | { minMidi: number; maxMidi: number }
  | { value: number; unit: "ticks" | "beats" | "measures" };
export type RuleConfig = Record<string, RuleConfigValue>;

interface RuleOptionBase {
  key: string;
  label: string;
  description: string;
  section: "general" | "threshold" | "exceptions";
  required: boolean;
}

export type RuleOptionDefinition =
  | (RuleOptionBase & {
      kind: "boolean";
      defaultValue: boolean;
    })
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
      defaultValue: {
        value: number;
        unit: "ticks" | "beats" | "measures";
      };
      min?: number;
      max?: number;
      step?: number;
    });

export interface HarmonyRuleDefinition {
  id: string;
  catalogNumber: string;
  coveredRuleIds: readonly string[];
  label: string;
  description: string;
  rationale: string;
  group: HarmonyRuleGroupId;
  defaultSeverity: HarmonyRuleSeverity;
  requires: readonly RuleRequirement[];
  dependencyScope: RuleDependencyScope;
  configVersion: number;
  defaultConfig: RuleConfig;
  options: readonly RuleOptionDefinition[];
  supportedExceptionContexts: readonly RuleExceptionContext[];
  defaultExceptionPolicies: RuleExceptionPolicy;
}

export interface RuleInstanceSettings {
  severity: HarmonyRuleSeverity;
  configVersion: number;
  config: RuleConfig;
  exceptions: RuleExceptionPolicy;
}

export interface RuleConfigRepair {
  key: string;
  reason: "missing" | "type" | "range" | "enum" | "unknown" | "relation";
  previous?: unknown;
  replacement?: RuleConfigValue;
}

export interface RuleConfigNormalizationResult {
  config: RuleConfig;
  repairs: RuleConfigRepair[];
}
