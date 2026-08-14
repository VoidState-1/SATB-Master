import type { HarmonyAnalysis } from "../analysis";
import {
  EXTERNAL_RULE_API_VERSION,
  MAX_EXTERNAL_RULE_BYTES,
  parseExternalRuleManifest as parseSharedExternalRuleManifest,
  validateExternalRulePackageMetadata as validateSharedExternalRulePackageMetadata,
  type ExternalRuleGroupId,
  type ExternalRuleManifest,
  type ExternalRuleManifestRule,
  type InstalledExternalRulePackage,
} from "../../../../shared/external-rules";
import type {
  HarmonyCheckResult,
  HarmonyDiagnostic,
  RuleDiagnostic,
  SkippedRule,
} from "../runtime";
import type { ProjectDocument, RuleProfile } from "../../project/types";
import { VOICE_ORDER } from "../../project/voice";
import {
  type HarmonyRuleSeverity,
  type RuleConfig,
  type RuleExceptionPolicy,
} from "../rules/types";
import {
  defaultConfigFromOptions,
  normalizeRuleConfig,
} from "../rules/configSchema";
import { planRuleApplicability } from "../rules/applicability";
import { RULE_RUNTIME_LIMITS } from "../rules/policy/limits";
import {
  validateDiagnosticReferences,
  validateDiagnosticShape,
} from "../rules/policy/diagnostic";
import {
  mergeHarmonyResults,
  severityAfterApplicability,
} from "../rules/policy/result";
import { validateRuleStates } from "../rules/policy/state";

export const EXTERNAL_RULE_TIMEOUT_MS = 100;
export const EXTERNAL_RULE_MEMORY_BYTES = 32 * 1024 * 1024;
export const MAX_EXTERNAL_DIAGNOSTICS_PER_RULE =
  RULE_RUNTIME_LIMITS.diagnosticsPerRule;

export {
  EXTERNAL_RULE_API_VERSION,
  MAX_EXTERNAL_RULE_BYTES,
  type ExternalRuleGroupId,
  type ExternalRuleManifest,
  type ExternalRuleManifestRule,
  type InstalledExternalRulePackage,
};

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
  chordSpanIds: Record<string, readonly string[]>;
  contextFacts: HarmonyAnalysis["contextFacts"];
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
  targetChains: HarmonyAnalysis["targetChains"];
  auxiliarySummary: HarmonyAnalysis["auxiliarySummary"];
}

export type ExternalDiagnosticCauseKind =
  | "note"
  | "chord"
  | "voice"
  | "span"
  | "connection"
  | "melody-transition"
  | "slice-transition"
  | "local";

export interface ExternalDiagnosticCauseRef {
  kind: ExternalDiagnosticCauseKind;
  id: string;
}

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

export function normalizeExternalRuleConfig(
  rule: ExternalRuleManifestRule,
  input: RuleConfig | undefined,
) {
  return normalizeRuleConfig(
    {
      options: rule.options,
      defaultConfig: defaultConfigFromOptions(rule.options),
    },
    input,
  );
}

export function parseExternalRuleManifest(
  value: unknown,
): ExternalRuleManifest {
  return parseSharedExternalRuleManifest(value) as ExternalRuleManifest;
}

export function validateExternalRulePackageMetadata(
  value: unknown,
): InstalledExternalRulePackage {
  return validateSharedExternalRulePackageMetadata(
    value,
  ) as InstalledExternalRulePackage;
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
  currentProject: ProjectDocument = analysis.project as ProjectDocument,
): ExternalRuleContext {
  const chordMap = new Map(
    analysis.project.chordTrack.regions.map((chord) => [chord.id, chord]),
  );
  const slices = analysis.slices.map((slice): ExternalRuleSliceV3 => ({
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
  }));
  const sliceMap = new Map(slices.map((slice) => [slice.index, slice]));
  // Map 和查询函数不跨越 Worker/QuickJS 边界；V3 发送完整但裁剪过工程隐私的 plain data。
  return {
    apiVersion: EXTERNAL_RULE_API_VERSION,
    revision: analysis.revision,
    project: {
      schemaVersion: currentProject.schemaVersion,
      id: currentProject.id,
      title: currentProject.title,
      ppq: currentProject.ppq,
      lengthTicks: currentProject.lengthTicks,
      tempoEvents: currentProject.tempoEvents,
      meterEvents: currentProject.meterEvents,
      keyEvents: currentProject.keyEvents,
      satbTracks: currentProject.satbTracks,
      chordTrack: {
        visible: currentProject.chordTrack.visible,
        locked: currentProject.chordTrack.locked,
        displayMode: currentProject.chordTrack.displayMode,
        regions: [...currentProject.chordTrack.regions],
      },
    },
    sharedSettings: currentProject.ruleProfile.shared,
    slices,
    harmonySpans: analysis.harmonySpans,
    chordSpanIds: Object.fromEntries(analysis.chordSpanIds),
    contextFacts: analysis.contextFacts,
    melodyTransitions: analysis.melodyTransitions,
    sliceTransitions: analysis.sliceTransitions.map((transition) => ({
      ...transition,
      previous: sliceMap.get(transition.previous.index)!,
      current: sliceMap.get(transition.current.index)!,
    })),
    connections: analysis.connections,
    targetChains: analysis.targetChains,
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
  if (
    !Array.isArray(value) ||
    value.length > RULE_RUNTIME_LIMITS.diagnosticEvidenceItems
  )
    throw new Error(
      `诊断 evidence 最多允许 ${RULE_RUNTIME_LIMITS.diagnosticEvidenceItems} 项`,
    );
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`第 ${index + 1} 项 evidence 无效`);
    const candidate = entry as RawEvidence;
    const kind = requiredString(candidate.kind, "evidence.kind", 32);
    if (!["note", "chord", "interval", "key", "function"].includes(kind))
      throw new Error(`evidence.kind“${kind}”无效`);
    return {
      kind: kind as HarmonyDiagnostic["evidence"][number]["kind"],
      id: typeof candidate.id === "string" ? candidate.id : undefined,
      label: requiredString(
        candidate.label,
        "evidence.label",
        RULE_RUNTIME_LIMITS.diagnosticEvidenceLabelLength,
      ),
      value: requiredString(
        candidate.value,
        "evidence.value",
        RULE_RUNTIME_LIMITS.diagnosticEvidenceValueLength,
      ),
    };
  });
}

function externalCauseRefs(
  value: unknown,
  analysis: HarmonyAnalysis,
  installedPackage: InstalledExternalRulePackage,
  rule: ExternalRuleManifestRule,
) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > RULE_RUNTIME_LIMITS.diagnosticStructuredRefs
  )
    throw new Error(
      `诊断 causeRefs 最多允许 ${RULE_RUNTIME_LIMITS.diagnosticStructuredRefs} 项`,
    );
  const noteIds = analysis.noteById;
  const chordIds = analysis.chordById;
  const spanIds = new Set(analysis.harmonySpans.map((span) => span.id));
  const connectionIds = new Set(
    analysis.connections.map((connection) => connection.connectionKey),
  );
  const melodyTransitionIds = new Set(
    analysis.melodyTransitions.map((transition) => transition.id),
  );
  const sliceTransitionIds = new Set(
    analysis.sliceTransitions.map((transition) => transition.id),
  );
  const localIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,118}[A-Za-z0-9])?$/;
  const prefix =
    `external:${installedPackage.manifest.packageId}:` +
    `${installedPackage.contentHash}:${rule.id}`;
  return [
    ...new Set(
      value.map((entry, index) => {
        if (!isRecord(entry))
          throw new Error(`第 ${index + 1} 项 causeRef 不是对象`);
        const kind = requiredString(
          entry.kind,
          "causeRef.kind",
          32,
        ) as ExternalDiagnosticCauseKind;
        const id = requiredString(entry.id, "causeRef.id", 240);
        const valid =
          (kind === "note" && noteIds.has(id)) ||
          (kind === "chord" && chordIds.has(id)) ||
          (kind === "voice" && VOICE_ORDER.includes(id as never)) ||
          (kind === "span" && spanIds.has(id)) ||
          (kind === "connection" && connectionIds.has(id)) ||
          (kind === "melody-transition" && melodyTransitionIds.has(id)) ||
          (kind === "slice-transition" && sliceTransitionIds.has(id)) ||
          (kind === "local" && localIdPattern.test(id));
        if (!valid)
          throw new Error(`第 ${index + 1} 项 causeRef 引用了无效分析对象`);
        const reference = kind === "connection" ? id : `${kind}:${id}`;
        return `${prefix}|${reference}`;
      }),
    ),
  ];
}

function validateExternalRuleStates(
  value: unknown,
  project: ProjectDocument,
  analysis: HarmonyAnalysis,
  rule: ExternalRuleManifestRule,
) {
  if (value === undefined) return;
  validateRuleStates(value, {
    ownerRuleId: rule.id,
    maximumTick: project.lengthTicks,
    maximumSliceIndex: Math.max(analysis.slices.length - 1, 0),
    knownReferences: {
      noteIds: analysis.noteById,
      chordIds: analysis.chordById,
      spanIds: new Set(analysis.harmonySpans.map((span) => span.id)),
    },
  });
}

export function normalizeExternalRuleDiagnostics(options: {
  value: unknown;
  analysis: HarmonyAnalysis;
  package: InstalledExternalRulePackage;
  rule: ExternalRuleManifestRule;
  severity: Exclude<HarmonyRuleSeverity, "off">;
  exceptionPolicy?: RuleExceptionPolicy;
}): HarmonyDiagnostic[] {
  const {
    value,
    analysis,
    package: installedPackage,
    rule,
    severity,
  } = options;
  const project = analysis.project as ProjectDocument;
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
  if (isRecord(value))
    validateExternalRuleStates(value.states, project, analysis, rule);
  if (diagnosticsValue.length > MAX_EXTERNAL_DIAGNOSTICS_PER_RULE)
    throw new Error(
      `单条规则最多返回 ${MAX_EXTERNAL_DIAGNOSTICS_PER_RULE} 项诊断`,
    );
  const references = {
    maximumTick: project.lengthTicks,
    noteIds: analysis.noteById,
    chordIds: analysis.chordById,
    spanIds: new Set(analysis.harmonySpans.map((span) => span.id)),
  };

  return diagnosticsValue
    .map((entry, index): HarmonyDiagnostic | undefined => {
      if (!isRecord(entry)) throw new Error(`第 ${index + 1} 项诊断不是对象`);
      if (entry.ruleId !== undefined && entry.ruleId !== rule.id)
        throw new Error(`第 ${index + 1} 项诊断引用了未授权的规则 ID`);
      if (entry.exceptionContexts !== undefined)
        throw new Error(`第 ${index + 1} 项诊断不能自行声明 exceptionContexts`);
      if (entry.coverageRefs !== undefined)
        throw new Error(`第 ${index + 1} 项外置诊断不能声明 coverageRefs`);
      if (entry.severity !== undefined)
        throw new Error(`第 ${index + 1} 项诊断不能自行声明 severity`);
      const tick = entry.tick;
      const endTick = entry.endTick ?? tick;
      const diagnosticNoteIds = stringArray(
        entry.noteIds ?? [],
        "诊断 noteIds",
      );
      const diagnosticChordIds = stringArray(
        entry.chordIds ?? [],
        "诊断 chordIds",
      );
      const voiceIds = stringArray(entry.voiceIds ?? [], "诊断 voiceIds");
      const confidence =
        entry.confidence === undefined
          ? 1
          : typeof entry.confidence === "number"
            ? entry.confidence
            : Number.NaN;
      const title = requiredString(
        entry.title,
        "诊断标题",
        RULE_RUNTIME_LIMITS.diagnosticTitleLength,
      );
      const message = requiredString(
        entry.message,
        "诊断消息",
        RULE_RUNTIME_LIMITS.diagnosticMessageLength,
      );
      const messageKey =
        typeof entry.messageKey === "string" && entry.messageKey.trim()
          ? requiredString(
              entry.messageKey,
              "诊断 messageKey",
              RULE_RUNTIME_LIMITS.diagnosticMessageKeyLength,
            )
          : "external-diagnostic";
      const causeRefs = externalCauseRefs(
        entry.causeRefs,
        analysis,
        installedPackage,
        rule,
      );
      const rawDiagnostic: RuleDiagnostic = {
        ruleId: rule.id,
        source: "external",
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
        causeRefs,
      };
      const shape = validateDiagnosticShape(rawDiagnostic, references.maximumTick);
      if (!shape.ok)
        throw new Error(`第 ${index + 1} 项诊断${shape.reason}`);
      const referenceValidation = validateDiagnosticReferences(
        rawDiagnostic,
        references,
      );
      if (!referenceValidation.ok)
        throw new Error(`第 ${index + 1} 项诊断${referenceValidation.reason}`);
      const applicability = planRuleApplicability(
        {
          id: rule.id,
          dependencyScope: rule.dependencyScope,
          supportedExceptionContexts: rule.supportedExceptionContexts,
          defaultExceptionPolicies: rule.defaultExceptionPolicies,
        },
        rawDiagnostic,
        analysis,
        exceptionPolicy,
      );
      const effectiveSeverity = severityAfterApplicability(
        severity,
        applicability.policy,
      );
      if (!effectiveSeverity)
        return undefined;
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
          ...(causeRefs ?? []),
        ].join(":"),
        ...rawDiagnostic,
        severity: effectiveSeverity,
        exceptionContexts:
          applicability.contexts.length > 0
            ? [...applicability.contexts]
            : undefined,
      };
    })
    .filter(
      (diagnostic): diagnostic is HarmonyDiagnostic => diagnostic !== undefined,
    );
}

export function mergeExternalRuleResult(
  builtin: HarmonyCheckResult,
  external: ExternalRuleRunResult,
): HarmonyCheckResult {
  return mergeHarmonyResults(builtin, external);
}
