import type {
  ChordTrack,
  DiagnosticSeverity,
  KeyEvent,
  MeterEvent,
  ProjectDocument,
  SatbTrack,
  AuxiliaryTrack,
  TempoEvent,
  VoiceId,
} from "../../project";
import type {
  HarmonyDiagnostic,
  RuleSkipReason,
  SkippedRule,
} from "../runtime";
import type { HarmonyRuleId } from "../rules/catalog";
import type { RuleConfig, RuleExceptionPolicy } from "../rules/types";

export const RULE_TEST_CASE_FORMAT = "satb-rule-test-case";
export const RULE_TEST_CASE_FORMAT_VERSION = 1;

export interface RuleTestProjectFixture {
  schemaVersion: ProjectDocument["schemaVersion"];
  ppq: ProjectDocument["ppq"];
  lengthTicks: number;
  tempoEvents: TempoEvent[];
  meterEvents: MeterEvent[];
  keyEvents: KeyEvent[];
  satbTracks: SatbTrack[];
  auxiliaryTracks: AuxiliaryTrack[];
  chordTrack: ChordTrack;
}

export interface BuiltinRuleTestTarget {
  source: "builtin";
  ruleId: HarmonyRuleId;
}

export interface IsolatedRuleExecution {
  mode: "isolated";
  severity: DiagnosticSeverity;
  config: RuleConfig;
  exceptions: RuleExceptionPolicy;
}

export interface ExpectedDiagnostic {
  id: string;
  ruleId: string;
  messageKey: string;
  rootCauseKey?: string;
  tick: number;
  endTick?: number;
  voiceIds?: VoiceId[];
  noteIds?: string[];
  chordIds?: string[];
  params?: Record<string, string | number | boolean>;
}

export interface ExpectedRuleSkip {
  reason: RuleSkipReason;
  partial: boolean;
}

export interface RuleTestExpectationSet {
  diagnostics: ExpectedDiagnostic[];
  allowUnexpectedDiagnostics: boolean;
  skips: ExpectedRuleSkip[];
}

export interface HarmonyRuleTestCaseV1 {
  format: typeof RULE_TEST_CASE_FORMAT;
  formatVersion: typeof RULE_TEST_CASE_FORMAT_VERSION;
  id: string;
  title: string;
  description?: string;
  tags: string[];
  target: BuiltinRuleTestTarget;
  execution: IsolatedRuleExecution;
  project: RuleTestProjectFixture;
  expected: RuleTestExpectationSet;
}

export type HarmonyRuleTestCase = HarmonyRuleTestCaseV1;

export interface RuleTestCaseIssue {
  path: string;
  code:
    | "format"
    | "version"
    | "type"
    | "value"
    | "duplicate"
    | "unknown-rule"
    | "invalid-project"
    | "invalid-config"
    | "unsupported-exception"
    | "missing-reference";
  message: string;
}

export interface RuleTestCaseParseResult {
  testCase?: HarmonyRuleTestCase;
  issues: RuleTestCaseIssue[];
}

export interface DiagnosticFieldDifference {
  field:
    | "rootCauseKey"
    | "tick"
    | "endTick"
    | "voiceIds"
    | "noteIds"
    | "chordIds"
    | `params.${string}`;
  expected: unknown;
  actual: unknown;
}

export interface DiagnosticMatch {
  expected: ExpectedDiagnostic;
  actual: HarmonyDiagnostic;
}

export interface DiagnosticMismatch extends DiagnosticMatch {
  differences: DiagnosticFieldDifference[];
}

export interface RuleSkipMismatch {
  kind: "missing" | "unexpected";
  expected?: ExpectedRuleSkip;
  actual?: SkippedRule;
}

export interface RuleTestComparison {
  passed: boolean;
  matches: DiagnosticMatch[];
  missing: ExpectedDiagnostic[];
  unexpected: HarmonyDiagnostic[];
  mismatched: DiagnosticMismatch[];
  skipMismatches: RuleSkipMismatch[];
}

export interface RuleTestExecutionError {
  code: "unknown-rule" | "invalid-project" | "rule-error" | "aborted";
  message: string;
}

export interface RuleTestRunResult {
  status: "passed" | "failed" | "error";
  actual: import("../runtime").HarmonyCheckResult;
  comparison: RuleTestComparison;
  durationMs: number;
  error?: RuleTestExecutionError;
}
