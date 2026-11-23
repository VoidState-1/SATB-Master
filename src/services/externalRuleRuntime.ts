import {
  buildHarmonyAnalysis,
  type HarmonyAnalysis,
  type HarmonyCheckResult,
  type HarmonyDiagnostic,
} from "../domain/harmony";
import {
  buildExternalRuleContext,
  externalRuleReferenceKey,
  mergeExternalRuleResult,
  normalizeExternalRuleDiagnostics,
  normalizeExternalRuleConfig,
  parseExternalRuleManifest,
  type ExternalRuleFailure,
  type ExternalRuleImportCandidate,
  type ExternalRuleManifest,
  type ExternalRuleRunResult,
  type InstalledExternalRulePackage,
} from "../domain/harmony";
import {
  completeHarmonyResult,
  skippedRulesForFailures,
} from "../domain/harmony/rules/policy/result";
import type {
  ExternalRuleWorkerRequest,
  ExternalRuleWorkerResponse,
} from "../domain/harmony/external/protocol";
import type { ProjectDocument } from "../domain/project";
import { formatPosition } from "../domain/time";
import { loadExternalRulePackageSource } from "./externalRuleLibrary";
import { logger } from "./logging";

let requestId = 0;

function createRuleWorker() {
  return new Worker(
    new URL("../workers/externalRule.worker.ts", import.meta.url),
    {
      type: "module",
      name: "satb-external-rules",
    },
  );
}

function abortError() {
  return new DOMException("外置规则执行已取消", "AbortError");
}

function requestWorker(
  worker: Worker,
  request: ExternalRuleWorkerRequest,
  signal: AbortSignal | undefined,
  timeoutMs: number,
) {
  return new Promise<ExternalRuleWorkerResponse>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      worker.terminate();
      reject(new Error("外置规则 Worker 未在预期时间内响应"));
    }, timeoutMs);
    const onAbort = () => {
      cleanup();
      worker.terminate();
      reject(abortError());
    };
    const onMessage = (event: MessageEvent<ExternalRuleWorkerResponse>) => {
      if (event.data.id !== request.id) return;
      cleanup();
      resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || "外置规则 Worker 启动失败"));
    };
    const onMessageError = () => {
      cleanup();
      reject(new Error("无法读取外置规则 Worker 的响应"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    try {
      worker.postMessage(request);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function inspectExternalRuleCandidate(
  candidate: ExternalRuleImportCandidate,
) {
  return logger.span("external-rule", "检查外置规则包", async () => {
    const worker = createRuleWorker();
    try {
      const response = await requestWorker(
        worker,
        { id: ++requestId, type: "inspect", source: candidate.source },
        undefined,
        10_000,
      );
      if (!response.ok || response.type !== "inspect")
        throw new Error(response.ok ? "规则包检查返回类型无效" : response.error);
      const manifest = parseExternalRuleManifest(response.inspection.manifest);
      const executableRuleIds = response.inspection.executableRuleIds;
      const manifestRuleIds = manifest.rules.map((rule) => rule.id);
      if (
        executableRuleIds.length !== manifestRuleIds.length ||
        executableRuleIds.some((id, index) => id !== manifestRuleIds[index])
      )
        throw new Error("manifest 中的规则必须与可执行 rules 列表一一对应");
      return manifest;
    } finally {
      worker.terminate();
    }
  }, { sizeBytes: candidate.sizeBytes }, { code: "EXTERNAL_RULE_FAILED" });
}

function completeExternalRun(options: {
  diagnostics: HarmonyDiagnostic[];
  failures: ExternalRuleFailure[];
  unavailable?: HarmonyCheckResult["skippedRules"];
  revision: number;
  superseded: boolean;
}): ExternalRuleRunResult {
  const completed = completeHarmonyResult({
    diagnostics: options.diagnostics,
    skippedRules: [...skippedRulesForFailures(options.failures), ...(options.unavailable ?? [])],
    revision: options.revision,
    superseded: options.superseded,
  });
  return {
    diagnostics: completed.diagnostics,
    skippedRules: completed.skippedRules,
    failures: options.failures,
    revision: options.revision,
    superseded: options.superseded,
  };
}

function manifestsEqual(
  left: ExternalRuleManifest,
  right: ExternalRuleManifest,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function usesDoubleAugmented43(chord: ProjectDocument["chordTrack"]["regions"][number]) {
  const { structure } = chord.identity;
  if (structure.kind === "augmented-sixth" && structure.variant === "doubleAugmented43")
    return true;
  const hasRole = (interpretation: NonNullable<typeof chord.semantics>["interpretations"][number]) =>
    interpretation.designation?.specialRole === "doubleAugmented43";
  return chord.semantics?.interpretations.some(hasRole) ||
    chord.semantics?.alternatives?.some(hasRole);
}

export class ExternalRuleRuntime {
  private activeWorker?: Worker;

  cancel() {
    this.activeWorker?.terminate();
    this.activeWorker = undefined;
  }

  async run(options: {
    project: ProjectDocument;
    packages: InstalledExternalRulePackage[];
    revision: number;
    analysis?: HarmonyAnalysis;
    signal?: AbortSignal;
  }): Promise<ExternalRuleRunResult> {
    this.cancel();
    const { project, packages, revision, signal } = options;
    const activeReferences = project.ruleProfile.external.filter(
      (reference) => reference.enabled && reference.severity !== "off",
    );
    if (activeReferences.length === 0) {
      return completeExternalRun({
        diagnostics: [],
        failures: [],
        revision,
        superseded: Boolean(signal?.aborted),
      });
    }

    const installedByHash = new Map(
      packages.map((installedPackage) => [
        installedPackage.contentHash,
        installedPackage,
      ]),
    );
    const failures: ExternalRuleFailure[] = [];
    let entries: Extract<
      ExternalRuleWorkerRequest,
      { type: "run" }
    >["entries"] = [];
    const sourcePromises = new Map<string, Promise<string>>();
    const uniqueReferences = new Map(
      activeReferences.map((reference) => [
        externalRuleReferenceKey(reference),
        reference,
      ]),
    );

    for (const reference of uniqueReferences.values()) {
      const installedPackage = installedByHash.get(reference.contentHash);
      const rule = installedPackage?.manifest.rules.find(
        (candidate) => candidate.id === reference.ruleId,
      );
      if (
        !installedPackage ||
        installedPackage.manifest.packageId !== reference.packageId ||
        installedPackage.manifest.version !== reference.version ||
        !rule
      ) {
        failures.push({
          packageId: reference.packageId,
          version: reference.version,
          contentHash: reference.contentHash,
          ruleId: reference.ruleId,
          code: "missing-package",
          message: "本机规则库中没有与工程引用完全匹配的规则包",
        });
        continue;
      }
      let sourcePromise = sourcePromises.get(reference.contentHash);
      if (!sourcePromise) {
        sourcePromise = loadExternalRulePackageSource(reference.contentHash);
        sourcePromises.set(reference.contentHash, sourcePromise);
      }
      try {
        const normalizedConfig = normalizeExternalRuleConfig(
          rule,
          reference.config,
        );
        entries.push({
          package: installedPackage,
          source: await sourcePromise,
          rule,
          severity: reference.severity as Exclude<
            typeof reference.severity,
            "off"
          >,
          config: normalizedConfig.config,
          exceptionPolicy: {
            ...rule.defaultExceptionPolicies,
            ...reference.exceptions,
          },
        });
      } catch (error) {
        failures.push({
          packageId: reference.packageId,
          version: reference.version,
          contentHash: reference.contentHash,
          ruleId: reference.ruleId,
          code: "source-error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (signal?.aborted) {
      return completeExternalRun({
        diagnostics: [],
        failures,
        revision,
        superseded: true,
      });
    }
    if (entries.length === 0) {
      return completeExternalRun({
        diagnostics: [],
        failures,
        revision,
        superseded: false,
      });
    }

    const analysis =
      options.analysis ?? buildHarmonyAnalysis(project, revision);
    if (analysis.revision !== revision)
      throw new Error("外置规则收到的分析 revision 与运行请求不一致");
    const unsupported = project.chordTrack.regions.filter(usesDoubleAugmented43);
    const unavailable: HarmonyCheckResult["skippedRules"] = [];
    let legacyNoteAnalysis: HarmonyAnalysis | undefined;
    if (unsupported.length > 0) {
      const locations = unsupported.map((chord) => {
        const start = formatPosition(project, chord.startTick);
        const end = formatPosition(project, chord.startTick + chord.durationTicks);
        return `${start}–${end}`;
      }).join("、");
      // v3 的 evaluate 和 process 都能读到全曲。局部 scope 也无法保证规则能在缺失片段旁继续判定。
      entries = entries.filter((entry) => {
        if (entry.rule.supportsDoubleAugmented43 || entry.rule.dependencyScope === "note")
          return true;
        const packageId = entry.package.manifest.packageId;
        unavailable.push({
          ruleId: `external:${packageId}:${entry.package.contentHash}:${entry.rule.id}`,
          reason: "insufficient-context",
          partial: false,
          message: `外置规则「${entry.rule.label}」（${packageId}）输入不足。DD++43 位于 ${locations}，该规则需要完整和声输入，本次未运行。`,
        });
        return false;
      });
      if (entries.length === 0)
        return completeExternalRun({ diagnostics: [], failures, unavailable, revision, superseded: false });
      if (entries.some((entry) => !entry.rule.supportsDoubleAugmented43)) {
        const excludedIds = new Set(unsupported.map((chord) => chord.id));
        const noteProject = {
          ...project,
          chordTrack: {
            ...project.chordTrack,
            regions: project.chordTrack.regions.filter((chord) => !excludedIds.has(chord.id)),
          },
        };
        legacyNoteAnalysis = buildHarmonyAnalysis(noteProject, revision);
      }
    }
    let worker: Worker | undefined;
    try {
      worker = createRuleWorker();
      this.activeWorker = worker;
      const failureCountBeforeWorker = failures.length;
      const response = await requestWorker(
        worker,
        {
          id: ++requestId,
          type: "run",
          context: buildExternalRuleContext(analysis, project),
          legacyNoteContext: legacyNoteAnalysis && buildExternalRuleContext(legacyNoteAnalysis),
          entries,
        },
        signal,
        Math.max(10_000, entries.length * 500),
      );
      if (!response.ok || response.type !== "run")
        throw new Error(response.ok ? "外置规则返回类型无效" : response.error);
      failures.push(...response.failures);
      const diagnostics = response.evaluations.flatMap((evaluation) => {
        try {
          const manifest = parseExternalRuleManifest(evaluation.manifest);
          if (!manifestsEqual(manifest, evaluation.package.manifest))
            throw new Error("执行时 manifest 与已安装记录不一致");
          return normalizeExternalRuleDiagnostics({
            value: evaluation.value,
            analysis,
            package: evaluation.package,
            rule: evaluation.rule,
            severity: evaluation.severity,
            exceptionPolicy: evaluation.exceptionPolicy,
          });
        } catch (error) {
          failures.push({
            packageId: evaluation.package.manifest.packageId,
            version: evaluation.package.manifest.version,
            contentHash: evaluation.package.contentHash,
            ruleId: evaluation.rule.id,
            code:
              error instanceof Error && error.message.includes("manifest")
                ? "manifest-mismatch"
                : "invalid-result",
            message: error instanceof Error ? error.message : String(error),
          });
          return [];
        }
      });
      const workerFailureCount = failures.length - failureCountBeforeWorker;
      if (workerFailureCount > 0 && !signal?.aborted) {
        logger.warn("external-rule", "部分外置规则执行失败", {
          code: "EXTERNAL_RULE_FAILED",
          context: { failureCount: workerFailureCount, ruleCount: entries.length },
        });
      }
      return completeExternalRun({
        diagnostics,
        failures,
        unavailable,
        revision,
        superseded: Boolean(signal?.aborted),
      });
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return completeExternalRun({
          diagnostics: [],
          failures,
          revision,
          superseded: true,
        });
      }
      logger.error("external-rule", "外置规则 Worker 执行失败", {
        code: "EXTERNAL_RULE_FAILED", error, context: { ruleCount: entries.length },
      });
      entries.forEach((entry) =>
        failures.push({
          packageId: entry.package.manifest.packageId,
          version: entry.package.manifest.version,
          contentHash: entry.package.contentHash,
          ruleId: entry.rule.id,
          code: "exception",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return completeExternalRun({
        diagnostics: [],
        failures,
        unavailable,
        revision,
        superseded: false,
      });
    } finally {
      worker?.terminate();
      if (this.activeWorker === worker) this.activeWorker = undefined;
    }
  }
}

export function mergeHarmonyWithExternalRules(
  builtin: HarmonyCheckResult,
  external: ExternalRuleRunResult,
) {
  return mergeExternalRuleResult(builtin, external);
}
