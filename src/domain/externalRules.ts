import { legacyHarmonyProjection } from "./chordModel";
import type {
  AnalysisChord,
  HarmonyAnalysis,
} from "./harmonyAnalysis";
import type {
  HarmonyCheckResult,
  HarmonyDiagnostic,
  SkippedRule,
} from "./harmonyRuntime";
import {
  VOICE_ORDER,
  type ProjectDocument,
  type RuleProfileRef,
} from "./model";
import type {
  DiagnosticSeverity,
  HarmonyRuleGroupId,
  HarmonyRuleSeverity,
  RuleDependencyScope,
} from "./harmonyRules";

export const EXTERNAL_RULE_API_VERSION = 2;
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

// API v2 继续暴露旧和弦字段。新功能语义在下一版规则 API 统一升级前不会穿透沙箱边界。
export interface ExternalRuleChordRegionV2 {
  id: string;
  startTick: number;
  durationTicks: number;
  identity: {
    root: AnalysisChord["identity"]["root"];
    quality: Exclude<
      AnalysisChord["identity"]["structure"],
      { kind: "augmented-sixth" }
    >["quality"];
    extensions: readonly number[];
    alterations: readonly { degree: number; alter: number }[];
    bass: AnalysisChord["identity"]["bass"];
  };
  semantics?: ReturnType<typeof legacyHarmonyProjection>;
  locked: boolean;
}

export interface ExternalRuleSliceV2 {
  index: number;
  spanId?: string;
  tick: number;
  endTick: number;
  notes: HarmonyAnalysis["slices"][number]["notes"];
  attackVoiceIds: HarmonyAnalysis["slices"][number]["attackVoiceIds"];
  key: HarmonyAnalysis["slices"][number]["key"];
  chord?: ExternalRuleChordRegionV2;
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
      displayMode: "roman" | "absolute" | "both";
      regions: ExternalRuleChordRegionV2[];
    };
  };
  slices: ExternalRuleSliceV2[];
  harmonySpans: Array<
    Omit<HarmonyAnalysis["harmonySpans"][number], "semantics"> & {
      semantics?: ReturnType<typeof legacyHarmonyProjection>;
    }
  >;
  melodyTransitions: HarmonyAnalysis["melodyTransitions"];
  sliceTransitions: Array<
    Omit<
      HarmonyAnalysis["sliceTransitions"][number],
      "previous" | "current"
    > & {
      previous: ExternalRuleSliceV2;
      current: ExternalRuleSliceV2;
    }
  >;
  chordProgressions: Array<
    Omit<
      HarmonyAnalysis["chordProgressions"][number],
      "previous" | "current"
    > & {
      previous: ExternalRuleChordRegionV2;
      current: ExternalRuleChordRegionV2;
    }
  >;
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
    RuleProfileRef["external"][number],
    "packageId" | "version" | "contentHash" | "ruleId"
  >,
) {
  return `${reference.packageId}@${reference.version}:${reference.contentHash}:${reference.ruleId}`;
}

export function buildExternalRuleContext(
  analysis: HarmonyAnalysis,
): ExternalRuleContext {
  const chordMap = new Map<string, ExternalRuleChordRegionV2>();
  analysis.project.chordTrack.regions.forEach((chord) => {
    if (
      chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.extensions.some((extension) => extension >= 9) ||
      (chord.semantics &&
        (chord.semantics.interpretations.length !== 1 ||
          chord.semantics.pedalContext))
    )
      return;
    chordMap.set(chord.id, {
      id: chord.id,
      startTick: chord.startTick,
      durationTicks: chord.durationTicks,
      identity: {
        root: chord.identity.root,
        quality: chord.identity.structure.quality,
        extensions: chord.identity.structure.extensions,
        alterations: chord.identity.structure.alterations,
        bass: chord.identity.bass,
      },
      semantics: chord.semantics
        ? legacyHarmonyProjection(chord.semantics)
        : undefined,
      locked: chord.locked,
    });
  });
  const slices = analysis.slices.map(
    (slice): ExternalRuleSliceV2 => ({
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
  const displayMode = analysis.project.chordTrack.displayMode;
  // Map 和宿主查询函数不跨越 Worker/QuickJS 边界；只发送冻结快照可重建的 plain data。
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
        displayMode:
          displayMode === "absolute"
            ? "absolute"
            : displayMode === "functional-absolute" ||
                displayMode === "roman-absolute"
              ? "both"
              : "roman",
        regions: [...chordMap.values()],
      },
    },
    slices,
    harmonySpans: analysis.harmonySpans
      .filter((span) => span.regionIds.every((id) => chordMap.has(id)))
      .map((span) => ({
        ...span,
        semantics: span.semantics
          ? legacyHarmonyProjection(span.semantics)
          : undefined,
      })),
    melodyTransitions: analysis.melodyTransitions,
    sliceTransitions: analysis.sliceTransitions.map((transition) => ({
      ...transition,
      previous: sliceMap.get(transition.previous.index)!,
      current: sliceMap.get(transition.current.index)!,
    })),
    chordProgressions: analysis.chordProgressions
      .filter(
        (progression) =>
          chordMap.has(progression.previous.id) &&
          chordMap.has(progression.current.id),
      )
      .map((progression) => ({
        ...progression,
        previous: chordMap.get(progression.previous.id)!,
        current: chordMap.get(progression.current.id)!,
      })),
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
}): HarmonyDiagnostic[] {
  const { value, project, package: installedPackage, rule, severity } = options;
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

  return diagnosticsValue.map((entry, index) => {
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
      severity,
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
    };
  });
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
