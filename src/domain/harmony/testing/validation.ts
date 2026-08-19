import { VOICE_ORDER, type VoiceId } from "../../project";
import {
  normalizeExceptionPolicy,
  normalizeRuleConfig,
  parseRuleConfig,
  parseRuleExceptionPolicy,
} from "../rules/configSchema";
import {
  HARMONY_RULE_DEFINITION_BY_ID,
  type HarmonyRuleId,
} from "../rules/catalog";
import type {
  DiagnosticSeverity,
  RuleExceptionContext,
  RuleExceptionPolicy,
} from "../rules/types";
import type { RuleSkipReason } from "../runtime";
import {
  RULE_TEST_CASE_FORMAT,
  RULE_TEST_CASE_FORMAT_VERSION,
  type ExpectedDiagnostic,
  type ExpectedRuleSkip,
  type HarmonyRuleTestCase,
  type RuleTestCaseIssue,
  type RuleTestCaseParseResult,
} from "./model";
import {
  dematerializeRuleTestProject,
  materializeUnknownRuleTestProject,
} from "./projectFixture";

const STABLE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const DIAGNOSTIC_SEVERITIES: readonly DiagnosticSeverity[] = [
  "error",
  "warning",
  "suggestion",
];
const SKIP_REASONS: readonly RuleSkipReason[] = [
  "no-chords",
  "missing-semantics",
  "ambiguous-semantics",
  "insufficient-context",
  "rule-error",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown, minimum = 0) {
  return Number.isInteger(value) && (value as number) >= minimum;
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

function issue(
  issues: RuleTestCaseIssue[],
  path: string,
  code: RuleTestCaseIssue["code"],
  message: string,
) {
  issues.push({ path, code, message });
}

function parseParams(value: unknown) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const params: Record<string, string | number | boolean> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (
      typeof candidate !== "string" &&
      typeof candidate !== "boolean" &&
      !(typeof candidate === "number" && Number.isFinite(candidate))
    )
      return undefined;
    params[key] = candidate;
  }
  return params;
}

function parseExpectedDiagnostic(
  value: unknown,
  index: number,
  issues: RuleTestCaseIssue[],
): ExpectedDiagnostic | undefined {
  const path = `expected.diagnostics[${index}]`;
  if (!isRecord(value)) {
    issue(issues, path, "type", "预期诊断必须是对象");
    return undefined;
  }
  if (
    typeof value.id !== "string" ||
    !STABLE_ID.test(value.id) ||
    typeof value.ruleId !== "string" ||
    typeof value.messageKey !== "string" ||
    value.messageKey.length === 0 ||
    !isInteger(value.tick)
  ) {
    issue(issues, path, "value", "预期诊断的 ID、规则、消息键或位置无效");
    return undefined;
  }
  if (
    value.rootCauseKey !== undefined &&
    typeof value.rootCauseKey !== "string"
  ) {
    issue(issues, `${path}.rootCauseKey`, "type", "rootCauseKey 必须是字符串");
    return undefined;
  }
  if (value.endTick !== undefined && !isInteger(value.endTick)) {
    issue(issues, `${path}.endTick`, "value", "结束位置必须是非负整数");
    return undefined;
  }
  const voiceIds =
    value.voiceIds === undefined ? undefined : stringArray(value.voiceIds);
  const noteIds =
    value.noteIds === undefined ? undefined : stringArray(value.noteIds);
  const chordIds =
    value.chordIds === undefined ? undefined : stringArray(value.chordIds);
  const params = parseParams(value.params);
  if (
    (value.voiceIds !== undefined && !voiceIds) ||
    (value.noteIds !== undefined && !noteIds) ||
    (value.chordIds !== undefined && !chordIds) ||
    (value.params !== undefined && !params)
  ) {
    issue(issues, path, "type", "预期诊断的引用或参数结构无效");
    return undefined;
  }
  return {
    id: value.id,
    ruleId: value.ruleId,
    messageKey: value.messageKey,
    ...(typeof value.rootCauseKey === "string"
      ? { rootCauseKey: value.rootCauseKey }
      : {}),
    tick: value.tick as number,
    ...(typeof value.endTick === "number" ? { endTick: value.endTick } : {}),
    ...(voiceIds ? { voiceIds: voiceIds as VoiceId[] } : {}),
    ...(noteIds ? { noteIds } : {}),
    ...(chordIds ? { chordIds } : {}),
    ...(params ? { params } : {}),
  };
}

function parseExpectedSkip(
  value: unknown,
  index: number,
  issues: RuleTestCaseIssue[],
): ExpectedRuleSkip | undefined {
  const path = `expected.skips[${index}]`;
  if (
    !isRecord(value) ||
    !SKIP_REASONS.includes(value.reason as RuleSkipReason) ||
    typeof value.partial !== "boolean"
  ) {
    issue(issues, path, "value", "预期跳过状态无效");
    return undefined;
  }
  return { reason: value.reason as RuleSkipReason, partial: value.partial };
}

function validateExpectationReferences(
  expectations: readonly ExpectedDiagnostic[],
  project: import("../../project").ProjectDocument,
  ruleId: string,
  issues: RuleTestCaseIssue[],
) {
  const noteIds = new Set(
    [...project.satbTracks, ...project.auxiliaryTracks].flatMap((track) =>
      track.notes.map((note) => note.id),
    ),
  );
  const chordIds = new Set(project.chordTrack.regions.map((chord) => chord.id));
  const expectationIds = new Set<string>();
  expectations.forEach((expectation, index) => {
    const path = `expected.diagnostics[${index}]`;
    if (expectationIds.has(expectation.id))
      issue(issues, `${path}.id`, "duplicate", `预期诊断 ID 重复：${expectation.id}`);
    expectationIds.add(expectation.id);
    if (expectation.ruleId !== ruleId)
      issue(issues, `${path}.ruleId`, "value", "预期诊断必须属于目标规则");
    if (
      expectation.tick > project.lengthTicks ||
      (expectation.endTick !== undefined &&
        (expectation.endTick < expectation.tick ||
          expectation.endTick > project.lengthTicks))
    )
      issue(issues, path, "value", "预期诊断范围超出工程长度");
    expectation.voiceIds?.forEach((voiceId) => {
      if (!VOICE_ORDER.includes(voiceId))
        issue(issues, `${path}.voiceIds`, "missing-reference", `未知声部：${voiceId}`);
    });
    expectation.noteIds?.forEach((noteId) => {
      if (!noteIds.has(noteId))
        issue(issues, `${path}.noteIds`, "missing-reference", `未知音符：${noteId}`);
    });
    expectation.chordIds?.forEach((chordId) => {
      if (!chordIds.has(chordId))
        issue(issues, `${path}.chordIds`, "missing-reference", `未知和弦：${chordId}`);
    });
  });
}

export function parseRuleTestCase(value: unknown): RuleTestCaseParseResult {
  const issues: RuleTestCaseIssue[] = [];
  if (!isRecord(value))
    return {
      issues: [
        { path: "", code: "type", message: "规则测试用例必须是对象" },
      ],
    };
  if (value.format !== RULE_TEST_CASE_FORMAT)
    issue(issues, "format", "format", "不是 SATB Master 规则测试用例");
  if (value.formatVersion !== RULE_TEST_CASE_FORMAT_VERSION)
    issue(issues, "formatVersion", "version", "不支持该规则用例格式版本");
  if (typeof value.id !== "string" || !STABLE_ID.test(value.id))
    issue(issues, "id", "value", "用例 ID 必须是稳定的小写标识符");
  if (
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    value.title.length > 120
  )
    issue(issues, "title", "value", "用例标题不能为空且不能超过 120 个字符");
  if (
    value.description !== undefined &&
    (typeof value.description !== "string" || value.description.length > 2000)
  )
    issue(issues, "description", "value", "用例说明必须是 2000 字符以内的文本");
  const tags = stringArray(value.tags);
  if (!tags || tags.some((tag) => !tag.trim() || tag.length > 64))
    issue(issues, "tags", "value", "标签必须是 64 字符以内的非空文本数组");
  else if (new Set(tags).size !== tags.length)
    issue(issues, "tags", "duplicate", "用例标签不能重复");

  let ruleId: HarmonyRuleId | undefined;
  if (
    !isRecord(value.target) ||
    value.target.source !== "builtin" ||
    typeof value.target.ruleId !== "string"
  )
    issue(issues, "target", "type", "第一阶段只支持内置规则目标");
  else if (!HARMONY_RULE_DEFINITION_BY_ID.has(value.target.ruleId as HarmonyRuleId))
    issue(issues, "target.ruleId", "unknown-rule", `未知规则：${value.target.ruleId}`);
  else ruleId = value.target.ruleId as HarmonyRuleId;

  const project = materializeUnknownRuleTestProject(
    value.project,
    typeof value.title === "string" ? value.title : "规则测试用例",
  );
  if (!project)
    issue(issues, "project", "invalid-project", "规则测试工程输入无效或无法迁移");

  let severity: DiagnosticSeverity | undefined;
  let config: import("../rules/types").RuleConfig | undefined;
  let exceptions: RuleExceptionPolicy | undefined;
  if (!isRecord(value.execution) || value.execution.mode !== "isolated")
    issue(issues, "execution", "type", "第一阶段只支持 isolated 执行模式");
  else {
    if (!DIAGNOSTIC_SEVERITIES.includes(value.execution.severity as DiagnosticSeverity))
      issue(issues, "execution.severity", "value", "测试严重程度无效");
    else severity = value.execution.severity as DiagnosticSeverity;
    const parsedConfig = parseRuleConfig(value.execution.config);
    if (!parsedConfig) issue(issues, "execution.config", "invalid-config", "规则配置结构无效");
    else if (ruleId) {
      const definition = HARMONY_RULE_DEFINITION_BY_ID.get(ruleId)!;
      const normalized = normalizeRuleConfig(definition, parsedConfig);
      if (normalized.repairs.length > 0)
        normalized.repairs.forEach((repair) =>
          issue(
            issues,
            `execution.config.${repair.key}`,
            "invalid-config",
            `规则配置项无效：${repair.reason}`,
          ),
        );
      else config = normalized.config;
    }
    const parsedExceptions = parseRuleExceptionPolicy(value.execution.exceptions);
    if (!parsedExceptions)
      issue(issues, "execution.exceptions", "type", "规则特例策略结构无效");
    else if (ruleId) {
      const definition = HARMONY_RULE_DEFINITION_BY_ID.get(ruleId)!;
      const normalized = normalizeExceptionPolicy(
        definition.supportedExceptionContexts,
        parsedExceptions,
      );
      const unsupported = Object.keys(parsedExceptions).filter(
        (context) => !Object.hasOwn(normalized, context),
      );
      unsupported.forEach((context) =>
        issue(
          issues,
          `execution.exceptions.${context}`,
          "unsupported-exception",
          `目标规则不支持特例：${context}`,
        ),
      );
      if (unsupported.length === 0) exceptions = normalized;
    }
  }

  const expectedDiagnostics: ExpectedDiagnostic[] = [];
  const expectedSkips: ExpectedRuleSkip[] = [];
  let allowUnexpectedDiagnostics: boolean | undefined;
  if (!isRecord(value.expected))
    issue(issues, "expected", "type", "预期结果必须是对象");
  else {
    if (!Array.isArray(value.expected.diagnostics))
      issue(issues, "expected.diagnostics", "type", "预期诊断必须是数组");
    else
      value.expected.diagnostics.forEach((candidate, index) => {
        const parsed = parseExpectedDiagnostic(candidate, index, issues);
        if (parsed) expectedDiagnostics.push(parsed);
      });
    if (typeof value.expected.allowUnexpectedDiagnostics !== "boolean")
      issue(issues, "expected.allowUnexpectedDiagnostics", "type", "额外诊断策略必须是布尔值");
    else allowUnexpectedDiagnostics = value.expected.allowUnexpectedDiagnostics;
    if (!Array.isArray(value.expected.skips))
      issue(issues, "expected.skips", "type", "预期跳过状态必须是数组");
    else
      value.expected.skips.forEach((candidate, index) => {
        const parsed = parseExpectedSkip(candidate, index, issues);
        if (parsed) expectedSkips.push(parsed);
      });
  }

  if (project && ruleId)
    validateExpectationReferences(expectedDiagnostics, project, ruleId, issues);
  if (
    issues.length > 0 ||
    !project ||
    !ruleId ||
    !severity ||
    !config ||
    !exceptions ||
    !tags ||
    allowUnexpectedDiagnostics === undefined ||
    typeof value.id !== "string" ||
    typeof value.title !== "string"
  )
    return { issues };

  return {
    issues: [],
    testCase: {
      format: RULE_TEST_CASE_FORMAT,
      formatVersion: RULE_TEST_CASE_FORMAT_VERSION,
      id: value.id,
      title: value.title,
      ...(typeof value.description === "string" && value.description
        ? { description: value.description }
        : {}),
      tags,
      target: { source: "builtin", ruleId },
      execution: { mode: "isolated", severity, config, exceptions },
      project: dematerializeRuleTestProject(project),
      expected: {
        diagnostics: expectedDiagnostics,
        allowUnexpectedDiagnostics,
        skips: expectedSkips,
      },
    },
  };
}
