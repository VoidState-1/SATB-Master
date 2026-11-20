import {
  RULE_DURATION_UNITS as SHARED_RULE_DURATION_UNITS,
  RULE_EXCEPTION_CONTEXTS as SHARED_RULE_EXCEPTION_CONTEXTS,
  RULE_EXCEPTION_MODES as SHARED_RULE_EXCEPTION_MODES,
  type RuleDurationUnit as SharedRuleDurationUnit,
  type RuleExceptionContext as SharedRuleExceptionContext,
  type RuleExceptionMode as SharedRuleExceptionMode,
} from "../../../../shared/external-rules";

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
  | "written-pitches"
  | "chords"
  | "semantics"
  | "complete-satb"
  | "meter";

export type RuleDependencyScope =
  "note" | "slice" | "chord" | "phrase" | "project";

export const RULE_EXCEPTION_CONTEXTS = SHARED_RULE_EXCEPTION_CONTEXTS;
export type RuleExceptionContext = SharedRuleExceptionContext;
export const RULE_EXCEPTION_MODES = SHARED_RULE_EXCEPTION_MODES;
export type RuleExceptionMode = SharedRuleExceptionMode;
export type RuleExceptionPolicy = Partial<
  Record<RuleExceptionContext, RuleExceptionMode>
>;

export const RULE_DURATION_UNITS = SHARED_RULE_DURATION_UNITS;
export type RuleDurationUnit = SharedRuleDurationUnit;

export type RuleConfigValue =
  | string
  | number
  | boolean
  | { minMidi: number; maxMidi: number }
  | { value: number; unit: RuleDurationUnit };
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
        unit: RuleDurationUnit;
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
  /** Inherited at evaluation time, so saved exception choices still take precedence. */
  contextualDefaultExceptionPolicies?: RuleExceptionPolicy;
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
