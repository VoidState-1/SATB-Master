import type { HarmonyAnalysis } from "./harmonyAnalysis";
import type {
  HarmonyCheckResult,
  HarmonyDiagnostic,
  SkippedRule,
} from "./harmonyRuntime";
import {
  VOICE_ORDER,
  type ProjectDocument,
  type RuleProfile,
} from "./model";
import {
  RULE_EXCEPTION_CONTEXTS,
  type DiagnosticSeverity,
  type HarmonyRuleGroupId,
  type HarmonyRuleSeverity,
  type RuleConfig,
  type RuleDependencyScope,
  type RuleExceptionContext,
  type RuleExceptionMode,
  type RuleExceptionPolicy,
  type RuleOptionDefinition,
} from "./harmonyRules";
import { normalizeRuleConfig } from "./rules/configSchema";

export const EXTERNAL_RULE_API_VERSION = 3;
export const MAX_EXTERNAL_RULE_BYTES = 512 * 1024;
export const EXTERNAL_RULE_TIMEOUT_MS = 100;
export const EXTERNAL_RULE_MEMORY_BYTES = 32 * 1024 * 1024;
export const MAX_EXTERNAL_DIAGNOSTICS_PER_RULE = 512;

export type ExternalRuleGroupId = HarmonyRuleGroupId | "custom";

export interface ExternalRuleManifestRule {
  id: string;
  label: string;
  description: string;
  group: ExternalRuleGroupId;
  defaultSeverity: DiagnosticSeverity;
  dependencyScope: RuleDependencyScope;
  configVersion: number;
  options: readonly RuleOptionDefinition[];
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

export interface ExternalRuleImportCandidate {
  source: string;
  sourcePath?: string;
  contentHash: string;
  sizeBytes: number;
}

export type ExternalRuleFailureCode =
  | "missing-package"
  | "source-error"
  | "manifest-mismatch"
  | "timeout"
  | "memory-limit"
  | "exception"
  | "invalid-result";

export interface ExternalRuleFailure {
  packageId: string;
  version: string;
  contentHash: string;
  ruleId: string;
  code: ExternalRuleFailureCode;
  message: string;
}

export interface ExternalRuleRunResult {
  diagnostics: HarmonyDiagnostic[];
  skippedRules: SkippedRule[];
  failures: ExternalRuleFailure[];
  revision: number;
  superseded: boolean;
}

export type ExternalRuleChordRegionV3 =
  HarmonyAnalysis["project"]["chordTrack"]["regions"][number];

export interface ExternalRuleSliceV3 {
  index: number;
  spanId?: string;
  tick: number;
  endTick: number;
  notes: HarmonyAnalysis["slices"][number]["notes"];
  attackVoiceIds: HarmonyAnalysis["slices"][number]["attackVoiceIds"];
  key: HarmonyAnalysis["slices"][number]["key"];
  chord?: ExternalRuleChordRegionV3;
  completeSatb: boolean;
  continuity: HarmonyAnalysis["slices"][number]["continuity"];
}

export interface ExternalRuleContext {
  apiVersion: typeof EXTERNAL_RULE_API_VERSION;
  revision: number;
  project: Omit<
    Pick<
      HarmonyAnalysis["project"],
      | "schemaVersion"
      | "id"
      | "title"
      | "ppq"
      | "lengthTicks"
      | "tempoEvents"
      | "meterEvents"
      | "keyEvents"
      | "satbTracks"
      | "chordTrack"
    >,
    "chordTrack"
  > & {
    chordTrack: {
      visible: boolean;
      locked: boolean;
      displayMode: HarmonyAnalysis["project"]["chordTrack"]["displayMode"];
      regions: ExternalRuleChordRegionV3[];
    };
  };
  sharedSettings: HarmonyAnalysis["project"]["ruleProfile"]["shared"];
  slices: ExternalRuleSliceV3[];
  harmonySpans: HarmonyAnalysis["harmonySpans"];
  melodyTransitions: HarmonyAnalysis["melodyTransitions"];
  sliceTransitions: Array<
    Omit<
      HarmonyAnalysis["sliceTransitions"][number],
      "previous" | "current"
    > & {
      previous: ExternalRuleSliceV3;
      current: ExternalRuleSliceV3;
    }
  >;
  connections: HarmonyAnalysis["connections"];
  auxiliarySummary: HarmonyAnalysis["auxiliarySummary"];
}

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const VERSION_PATTERN = /^[0-9A-Za-z](?:[0-9A-Za-z.+-]{0,62}[0-9A-Za-z])?$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VALID_GROUPS = new Set<ExternalRuleGroupId>([
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
]);
const VALID_SEVERITIES = new Set<DiagnosticSeverity>([
  "error",
  "warning",
  "suggestion",
]);
const VALID_SCOPES = new Set<RuleDependencyScope>([
  "note",
  "slice",
  "chord",
  "phrase",
  "project",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  label: string,
  maxLength: number,
  pattern?: RegExp,
) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    (pattern && !pattern.test(value))
  ) {
    throw new Error(`${label} 无效`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} 必须是有限数值`);
  return value;
}

function parseExternalRuleOptions(
  value: unknown,
  ruleId: string,
): readonly RuleOptionDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32)
    throw new Error(`规则“${ruleId}”最多声明 32 个配置项`);
  const keys = new Set<string>();
  return value.map((candidate, index): RuleOptionDefinition => {
    if (!isRecord(candidate))
      throw new Error(`规则“${ruleId}”第 ${index + 1} 个配置项无效`);
    const key = requiredString(candidate.key, "配置项 key", 64, ID_PATTERN);
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
      section: section as "general" | "threshold" | "exceptions",
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
        !["ticks", "beats", "measures"].includes(String(duration.unit)) ||
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
          unit: duration.unit as "ticks" | "beats" | "measures",
        },
        min,
        max,
        step,
      };
    }
    const min =
      kind === "pitch"
        ? optionalFiniteNumber(candidate.min, `配置项“${key}”的 min`) ?? 0
        : optionalFiniteNumber(candidate.min, `配置项“${key}”的 min`);
    const max =
      kind === "pitch"
        ? optionalFiniteNumber(candidate.max, `配置项“${key}”的 max`) ?? 127
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
      unit: typeof candidate.unit === "string" ? candidate.unit.slice(0, 32) : undefined,
    };
  });
}

function parseExternalExceptionContexts(value: unknown, ruleId: string) {
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

function parseExternalExceptionPolicies(
  value: unknown,
  ruleId: string,
  supported: readonly RuleExceptionContext[],
) {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`规则“${ruleId}”的默认特例策略无效`);
  const supportedSet = new Set(supported);
  const modes = new Set<RuleExceptionMode>(["exempt", "downgrade", "strict"]);
  const result: RuleExceptionPolicy = {};
  for (const [context, mode] of Object.entries(value)) {
    if (
      !supportedSet.has(context as RuleExceptionContext) ||
      !modes.has(mode as RuleExceptionMode)
    )
      throw new Error(`规则“${ruleId}”的默认特例策略无效`);
    result[context as RuleExceptionContext] = mode as RuleExceptionMode;
  }
  return result;
}

export function normalizeExternalRuleConfig(
  rule: ExternalRuleManifestRule,
  input: RuleConfig | undefined,
) {
  return normalizeRuleConfig(
    {
      options: rule.options,
      defaultConfig: Object.fromEntries(
        rule.options.map((option) => [option.key, structuredClone(option.defaultValue)]),
      ),
    },
    input,
  );
}

export function parseExternalRuleManifest(
  value: unknown,
): ExternalRuleManifest {
  if (!isRecord(value)) throw new Error("规则包 manifest 不是有效对象");
  if (value.apiVersion !== EXTERNAL_RULE_API_VERSION)
    throw new Error(`仅支持外置规则 API v${EXTERNAL_RULE_API_VERSION}`);
  const packageId = requiredString(
    value.packageId,
    "规则包 packageId",
    128,
    ID_PATTERN,
  );
  const version = requiredString(
    value.version,
    "规则包 version",
    64,
    VERSION_PATTERN,
  );
  if (
    !Array.isArray(value.rules) ||
    value.rules.length < 1 ||
    value.rules.length > 64
  )
    throw new Error("规则包必须声明 1 到 64 条规则");

  const seen = new Set<string>();
  const rules = value.rules.map((entry, index): ExternalRuleManifestRule => {
    if (!isRecord(entry)) throw new Error(`第 ${index + 1} 条规则声明无效`);
    const id = requiredString(entry.id, "规则 ID", 128, ID_PATTERN);
    if (seen.has(id)) throw new Error(`规则 ID“${id}”重复`);
    seen.add(id);
    const group = (entry.group ?? "custom") as ExternalRuleGroupId;
    const defaultSeverity = (entry.defaultSeverity ??
      "warning") as DiagnosticSeverity;
    const dependencyScope = (entry.dependencyScope ??
      "project") as RuleDependencyScope;
    if (!VALID_GROUPS.has(group)) throw new Error(`规则“${id}”的分组无效`);
    if (!VALID_SEVERITIES.has(defaultSeverity))
      throw new Error(`规则“${id}”的默认严重程度无效`);
    if (!VALID_SCOPES.has(dependencyScope))
      throw new Error(`规则“${id}”的依赖范围无效`);
    if (
      !Number.isInteger(entry.configVersion) ||
      (entry.configVersion as number) < 1 ||
      (entry.configVersion as number) > 1_000_000
    )
      throw new Error(`规则“${id}”的 configVersion 无效`);
    const supportedExceptionContexts = parseExternalExceptionContexts(
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
      options: parseExternalRuleOptions(entry.options, id),
      supportedExceptionContexts,
      defaultExceptionPolicies: parseExternalExceptionPolicies(
        entry.defaultExceptionPolicies,
        id,
        supportedExceptionContexts,
      ),
    };
  });

  return {
    apiVersion: EXTERNAL_RULE_API_VERSION,
    packageId,
    version,
    rules,
  };
}

export function validateExternalRulePackageMetadata(
  value: unknown,
): InstalledExternalRulePackage {
  if (!isRecord(value)) throw new Error("本机规则包记录无效");
  const contentHash = requiredString(
    value.contentHash,
    "规则包内容摘要",
    64,
    HASH_PATTERN,
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

export function externalRuleReferenceKey(
  reference: Pick<
    RuleProfile["external"][number],
    "packageId" | "version" | "contentHash" | "ruleId"
  >,
) {
  return `${reference.packageId}@${reference.version}:${reference.contentHash}:${reference.ruleId}`;
}

export function buildExternalRuleContext(
  analysis: HarmonyAnalysis,
): ExternalRuleContext {
  const chordMap = new Map(
    analysis.project.chordTrack.regions.map((chord) => [chord.id, chord]),
  );
  const slices = analysis.slices.map(
    (slice): ExternalRuleSliceV3 => ({
      index: slice.index,
      spanId: analysis.sliceSpanIds.get(slice.index),
      tick: slice.tick,
      endTick: slice.endTick,
      notes: slice.notes,
      attackVoiceIds: slice.attackVoiceIds,
      key: slice.key,
      chord: slice.chord ? chordMap.get(slice.chord.id) : undefined,
      completeSatb: slice.completeSatb,
      continuity: slice.continuity,
    }),
  );
  const sliceMap = new Map(slices.map((slice) => [slice.index, slice]));
  // Map 和查询函数不跨越 Worker/QuickJS 边界；V3 发送完整但裁剪过工程隐私的 plain data。
  return {
    apiVersion: EXTERNAL_RULE_API_VERSION,
    revision: analysis.revision,
    project: {
      schemaVersion: analysis.project.schemaVersion,
      id: analysis.project.id,
      title: analysis.project.title,
      ppq: analysis.project.ppq,
      lengthTicks: analysis.project.lengthTicks,
      tempoEvents: analysis.project.tempoEvents,
      meterEvents: analysis.project.meterEvents,
      keyEvents: analysis.project.keyEvents,
      satbTracks: analysis.project.satbTracks,
      chordTrack: {
        visible: analysis.project.chordTrack.visible,
        locked: analysis.project.chordTrack.locked,
        displayMode: analysis.project.chordTrack.displayMode,
        regions: [...analysis.project.chordTrack.regions],
      },
    },
    sharedSettings: analysis.project.ruleProfile.shared,
    slices,
    harmonySpans: analysis.harmonySpans,
    melodyTransitions: analysis.melodyTransitions,
    sliceTransitions: analysis.sliceTransitions.map((transition) => ({
      ...transition,
      previous: sliceMap.get(transition.previous.index)!,
      current: sliceMap.get(transition.current.index)!,
    })),
    connections: analysis.connections,
    auxiliarySummary: analysis.auxiliarySummary,
  };
}

interface RawEvidence {
  kind?: unknown;
  id?: unknown;
  label?: unknown;
  value?: unknown;
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`${label} 必须是字符串数组`);
  return [...new Set(value as string[])];
}

function primitiveParams(value: unknown) {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("诊断 params 必须是对象");
  const result: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    )
      throw new Error("诊断 params 只允许字符串、数值或布尔值");
    if (typeof entry === "number" && !Number.isFinite(entry))
      throw new Error("诊断 params 不能包含非有限数值");
    result[key] = entry;
  }
  return result;
}

function evidenceItems(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16)
    throw new Error("诊断 evidence 最多允许 16 项");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`第 ${index + 1} 项 evidence 无效`);
    const candidate = entry as RawEvidence;
    const kind = requiredString(candidate.kind, "evidence.kind", 32);
    if (!["note", "chord", "interval", "key", "function"].includes(kind))
      throw new Error(`evidence.kind“${kind}”无效`);
    return {
      kind: kind as HarmonyDiagnostic["evidence"][number]["kind"],
      id: typeof candidate.id === "string" ? candidate.id : undefined,
      label: requiredString(candidate.label, "evidence.label", 120),
      value: requiredString(candidate.value, "evidence.value", 240),
    };
  });
}

function validateExternalRuleStates(
  value: unknown,
  project: ProjectDocument,
  rule: ExternalRuleManifestRule,
) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 512)
    throw new Error("规则状态最多允许 512 项");
  const stateIds = new Set<string>();
  const noteIds = new Set(
    project.satbTracks.flatMap((track) => track.notes.map((note) => note.id)),
  );
  const chordIds = new Set(project.chordTrack.regions.map((chord) => chord.id));
  value.forEach((entry, index) => {
    if (!isRecord(entry)) throw new Error(`第 ${index + 1} 项规则状态无效`);
    const id = requiredString(entry.id, "规则状态 id", 128);
    if (stateIds.has(id)) throw new Error(`规则状态 id“${id}”重复`);
    stateIds.add(id);
    if (entry.ownerRuleId !== rule.id)
      throw new Error(`规则状态“${id}”不属于当前规则`);
    if (!isRecord(entry.createdAt)) throw new Error(`规则状态“${id}”缺少创建位置`);
    if (
      !Number.isInteger(entry.createdAt.tick) ||
      !Number.isInteger(entry.createdAt.sliceIndex) ||
      (entry.createdAt.tick as number) < 0 ||
      (entry.createdAt.tick as number) > project.lengthTicks ||
      (entry.createdAt.sliceIndex as number) < 0
    )
      throw new Error(`规则状态“${id}”的创建位置无效`);
    if (entry.subjectRefs !== undefined) {
      if (!isRecord(entry.subjectRefs)) throw new Error(`规则状态“${id}”的引用无效`);
      const voiceIds = stringArray(entry.subjectRefs.voiceIds ?? [], "规则状态 voiceIds");
      const referencedNotes = stringArray(entry.subjectRefs.noteIds ?? [], "规则状态 noteIds");
      const referencedChords = stringArray(entry.subjectRefs.chordIds ?? [], "规则状态 chordIds");
      if (voiceIds.some((voiceId) => !VOICE_ORDER.includes(voiceId as (typeof VOICE_ORDER)[number])))
        throw new Error(`规则状态“${id}”引用了不存在的声部`);
      if (referencedNotes.some((noteId) => !noteIds.has(noteId)))
        throw new Error(`规则状态“${id}”引用了不存在的音符`);
      if (referencedChords.some((chordId) => !chordIds.has(chordId)))
        throw new Error(`规则状态“${id}”引用了不存在的和弦`);
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(entry.payload);
    } catch {
      throw new Error(`规则状态“${id}”的 payload 不是 JSON 数据`);
    }
    if (serialized === undefined || serialized.length > 16 * 1024)
      throw new Error(`规则状态“${id}”的 payload 无效或超过 16 KiB`);
  });
}

export function normalizeExternalRuleDiagnostics(options: {
  value: unknown;
  project: ProjectDocument;
  package: InstalledExternalRulePackage;
  rule: ExternalRuleManifestRule;
  severity: Exclude<HarmonyRuleSeverity, "off">;
  exceptionPolicy?: RuleExceptionPolicy;
}): HarmonyDiagnostic[] {
  const { value, project, package: installedPackage, rule, severity } = options;
  const exceptionPolicy = {
    ...rule.defaultExceptionPolicies,
    ...(options.exceptionPolicy ?? {}),
  };
  const diagnosticsValue = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.diagnostics)
      ? value.diagnostics
      : undefined;
  if (!diagnosticsValue)
    throw new Error("规则必须返回诊断数组，或包含 diagnostics 的结果对象");
  if (isRecord(value)) validateExternalRuleStates(value.states, project, rule);
  if (diagnosticsValue.length > MAX_EXTERNAL_DIAGNOSTICS_PER_RULE)
    throw new Error(
      `单条规则最多返回 ${MAX_EXTERNAL_DIAGNOSTICS_PER_RULE} 项诊断`,
    );
  const noteIds = new Set(
    project.satbTracks.flatMap((track) => track.notes.map((note) => note.id)),
  );
  const chordIds = new Set(project.chordTrack.regions.map((chord) => chord.id));

  return diagnosticsValue.map((entry, index): HarmonyDiagnostic | undefined => {
    if (!isRecord(entry)) throw new Error(`第 ${index + 1} 项诊断不是对象`);
    if (entry.ruleId !== undefined && entry.ruleId !== rule.id)
      throw new Error(`第 ${index + 1} 项诊断引用了未授权的规则 ID`);
    const tick = entry.tick;
    const endTick = entry.endTick ?? tick;
    if (
      !Number.isInteger(tick) ||
      !Number.isInteger(endTick) ||
      (tick as number) < 0 ||
      (endTick as number) < (tick as number) ||
      (endTick as number) > project.lengthTicks
    )
      throw new Error(`第 ${index + 1} 项诊断的 tick 范围无效`);
    const diagnosticNoteIds = stringArray(entry.noteIds ?? [], "诊断 noteIds");
    const diagnosticChordIds = stringArray(
      entry.chordIds ?? [],
      "诊断 chordIds",
    );
    const voiceIds = stringArray(entry.voiceIds ?? [], "诊断 voiceIds");
    if (diagnosticNoteIds.some((id) => !noteIds.has(id)))
      throw new Error(`第 ${index + 1} 项诊断引用了不存在的音符`);
    if (diagnosticChordIds.some((id) => !chordIds.has(id)))
      throw new Error(`第 ${index + 1} 项诊断引用了不存在的和弦`);
    if (
      voiceIds.some(
        (id) => !VOICE_ORDER.includes(id as (typeof VOICE_ORDER)[number]),
      )
    )
      throw new Error(`第 ${index + 1} 项诊断引用了不存在的 SATB 声部`);
    const confidence = entry.confidence ?? 1;
    if (
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    )
      throw new Error(`第 ${index + 1} 项诊断的 confidence 无效`);
    const title = requiredString(entry.title, "诊断标题", 120);
    const message = requiredString(entry.message, "诊断消息", 600);
    const messageKey =
      typeof entry.messageKey === "string" && entry.messageKey.trim()
        ? requiredString(entry.messageKey, "诊断 messageKey", 120)
        : "external-diagnostic";
    const exceptionContexts = stringArray(
      entry.exceptionContexts ?? [],
      "诊断 exceptionContexts",
    ) as RuleExceptionContext[];
    if (
      exceptionContexts.some(
        (context) => !rule.supportedExceptionContexts.includes(context),
      )
    )
      throw new Error(`第 ${index + 1} 项诊断使用了规则未声明的特例上下文`);
    if (
      exceptionContexts.some((context) => exceptionPolicy[context] === "exempt")
    )
      return undefined;
    const effectiveSeverity = exceptionContexts.some(
      (context) => exceptionPolicy[context] === "downgrade",
    )
      ? severity === "error"
        ? "warning"
        : "suggestion"
      : severity;
    const stableObjects = (items: string[]) => [...items].sort().join(",");
    return {
      id: [
        "external",
        installedPackage.manifest.packageId,
        installedPackage.contentHash,
        rule.id,
        messageKey,
        tick,
        stableObjects(diagnosticNoteIds),
        stableObjects(diagnosticChordIds),
        stableObjects(voiceIds),
      ].join(":"),
      ruleId: rule.id,
      source: "external",
      severity: effectiveSeverity,
      tick: tick as number,
      endTick: endTick as number,
      voiceIds: voiceIds as HarmonyDiagnostic["voiceIds"],
      noteIds: diagnosticNoteIds,
      chordIds: diagnosticChordIds,
      title,
      message,
      messageKey,
      params: primitiveParams(entry.params),
      evidence: evidenceItems(entry.evidence),
      confidence,
      exceptionContexts,
    };
  }).filter(
    (diagnostic): diagnostic is HarmonyDiagnostic => diagnostic !== undefined,
  );
}

function severityOrder(severity: HarmonyDiagnostic["severity"]) {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

export function mergeExternalRuleResult(
  builtin: HarmonyCheckResult,
  external: ExternalRuleRunResult,
): HarmonyCheckResult {
  if (
    builtin.superseded ||
    external.superseded ||
    builtin.revision !== external.revision
  )
    return { ...builtin, diagnostics: [], superseded: true };
  const skippedRules = [...builtin.skippedRules, ...external.skippedRules];
  return {
    ...builtin,
    diagnostics: [...builtin.diagnostics, ...external.diagnostics].sort(
      (left, right) =>
        left.tick - right.tick ||
        severityOrder(left.severity) - severityOrder(right.severity) ||
        left.ruleId.localeCompare(right.ruleId),
    ),
    skippedRules,
    skippedRuleIds: [...new Set(skippedRules.map((item) => item.ruleId))],
  };
}
