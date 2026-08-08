import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { replaceProject } from "../../domain/editing";
import { checkHarmony, createHarmonyRuleScheduler } from "../../domain/harmony";
import {
  externalRuleReferenceKey,
  normalizeExternalRuleConfig,
  type ExternalRuleFailure,
  type InstalledExternalRulePackage,
} from "../../domain/harmony";
import type {
  HarmonyRuleId,
  HarmonyRuleSeverity,
  RuleConfig,
  RuleExceptionPolicy,
} from "../../domain/harmony";
import type { ProjectDocument, RuleProfile } from "../../domain/project";
import {
  createPortableRuleProfile,
  prepareRuleProfileImport,
  resetAllBuiltinRules,
  resetBuiltinRule,
  resolveBuiltinRuleProfile,
  saveNewProjectRuleProfile,
  setBuiltinRuleConfig,
  setBuiltinRuleException,
  setBuiltinRuleSeverity,
} from "../../domain/ruleProfile";
import { useExternalRuleLibrary } from "../../hooks/useExternalRuleLibrary";
import { openRuleProfileFile, saveRuleProfileFile } from "../../services/desktop";
import {
  ExternalRuleRuntime,
  mergeHarmonyWithExternalRules,
} from "../../services/externalRuleRuntime";
import type { ConfirmationState } from "./useConfirmationController";

interface ProjectHistoryCommitter {
  commit(project: ProjectDocument): void;
}

interface HarmonyControllerOptions {
  project: ProjectDocument;
  history: ProjectHistoryCommitter;
  showNotice(message: string): void;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
}

export function useHarmonyController({
  project,
  history,
  showNotice,
  requestConfirmation,
}: HarmonyControllerOptions) {
  const externalRuleLibrary = useExternalRuleLibrary();
  const harmonySchedulerRef = useRef(createHarmonyRuleScheduler());
  const externalRuleRuntimeRef = useRef(new ExternalRuleRuntime());
  const harmonyRevisionRef = useRef(0);
  const [externalRuleFailures, setExternalRuleFailures] = useState<
    ExternalRuleFailure[]
  >([]);
  const resolvedRuleProfile = useMemo(
    () => resolveBuiltinRuleProfile(project),
    [project],
  );

  const [harmonyResult, setHarmonyResult] = useState(() =>
    checkHarmony(
      project,
      resolvedRuleProfile.severities,
      resolvedRuleProfile.configs,
      resolvedRuleProfile.exceptions,
    ),
  );
  useEffect(() => {
    const controller = new AbortController();
    const revision = ++harmonyRevisionRef.current;
    const builtinRun = harmonySchedulerRef.current.run({
      project,
      severities: resolvedRuleProfile.severities,
      configs: resolvedRuleProfile.configs,
      exceptions: resolvedRuleProfile.exceptions,
      revision,
      signal: controller.signal,
    });
    const externalRun = externalRuleRuntimeRef.current.run({
      project,
      packages: externalRuleLibrary.packages,
      revision,
      signal: controller.signal,
    });
    void builtinRun.then((builtinResult) => {
      // 外置规则即使超时或启动失败，也不能延迟或覆盖内置规则的可用结果。
      if (!builtinResult.superseded && !controller.signal.aborted)
        setHarmonyResult(builtinResult);
    });
    void Promise.all([builtinRun, externalRun])
      .then(([builtinResult, externalResult]) => {
        // 编辑动作可能连续触发多个 revision；被取消的旧结果绝不能覆盖较新的诊断。
        if (
          !builtinResult.superseded &&
          !externalResult.superseded &&
          !controller.signal.aborted
        ) {
          setHarmonyResult(
            mergeHarmonyWithExternalRules(builtinResult, externalResult),
          );
          setExternalRuleFailures(externalResult.failures);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.warn("外置规则调度失败", error);
      });
    return () => {
      controller.abort();
      externalRuleRuntimeRef.current.cancel();
    };
  }, [externalRuleLibrary.packages, project, resolvedRuleProfile]);
  const ruleHitCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    harmonyResult.diagnostics.forEach((diagnostic) => {
      counts[diagnostic.ruleId] = (counts[diagnostic.ruleId] ?? 0) + 1;
    });
    return counts;
  }, [harmonyResult.diagnostics]);

  const mountExternalRulePackage = useCallback(
    (installedPackage: InstalledExternalRulePackage) => {
      history.commit(
        replaceProject(project, (draft) => {
          const previous = draft.ruleProfile.external.filter(
            (reference) =>
              reference.packageId === installedPackage.manifest.packageId,
          );
          draft.ruleProfile.external = draft.ruleProfile.external.filter(
            (reference) =>
              reference.packageId !== installedPackage.manifest.packageId,
          );
          installedPackage.manifest.rules.forEach((rule) => {
            const existing = previous.find(
              (reference) => reference.ruleId === rule.id,
            );
            const normalizedConfig = normalizeExternalRuleConfig(
              rule,
              existing?.config,
            );
            draft.ruleProfile.external.push({
              ruleId: rule.id,
              packageId: installedPackage.manifest.packageId,
              version: installedPackage.manifest.version,
              contentHash: installedPackage.contentHash,
              severity: existing?.severity ?? rule.defaultSeverity,
              enabled: existing?.enabled ?? true,
              configVersion: rule.configVersion,
              config: normalizedConfig.config,
              exceptions: { ...(existing?.exceptions ?? {}) },
            });
          });
        }),
      );
    },
    [history, project],
  );

  const handleImportExternalRulePackage = useCallback(async () => {
    try {
      const installedPackage = await externalRuleLibrary.importPackage();
      if (!installedPackage) return;
      mountExternalRulePackage(installedPackage);
      showNotice(
        `已导入并挂载规则包 ${installedPackage.manifest.packageId} ${installedPackage.manifest.version}`,
      );
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "外置规则导入失败");
    }
  }, [externalRuleLibrary, mountExternalRulePackage, showNotice]);

  const handleRemoveExternalRulePackage = useCallback(
    async (installedPackage: InstalledExternalRulePackage) => {
      const confirmed = await requestConfirmation({
        title: "移除本机规则包",
        message:
          `将移除 ${installedPackage.manifest.packageId} ${installedPackage.manifest.version} 的本机私有副本。` +
          "工程中的引用会保留，并显示为未挂载。",
        confirmLabel: "移除",
        cancelLabel: "取消",
      });
      if (!confirmed) return;
      try {
        await externalRuleLibrary.removePackage(installedPackage.contentHash);
        showNotice("已移除本机规则包，工程引用仍然保留");
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "规则包移除失败");
      }
    },
    [externalRuleLibrary, requestConfirmation, showNotice],
  );

  const updateExternalRuleReference = useCallback(
    (
      target: RuleProfile["external"][number],
      patch: Partial<
        Pick<
          RuleProfile["external"][number],
          | "enabled"
          | "severity"
          | "configVersion"
          | "config"
          | "exceptions"
        >
      >,
    ) => {
      const targetKey = externalRuleReferenceKey(target);
      history.commit(
        replaceProject(project, (draft) => {
          const reference = draft.ruleProfile.external.find(
            (candidate) => externalRuleReferenceKey(candidate) === targetKey,
          );
          if (reference) Object.assign(reference, patch);
        }),
      );
    },
    [history, project],
  );

  const setExternalRuleConfig = useCallback(
    (target: RuleProfile["external"][number], patch: RuleConfig) => {
      const installedPackage = externalRuleLibrary.packages.find(
        (candidate) => candidate.contentHash === target.contentHash,
      );
      const rule = installedPackage?.manifest.rules.find(
        (candidate) => candidate.id === target.ruleId,
      );
      if (!rule) return;
      const normalized = normalizeExternalRuleConfig(rule, {
        ...target.config,
        ...patch,
      });
      updateExternalRuleReference(target, {
        configVersion: rule.configVersion,
        config: normalized.config,
      });
    },
    [externalRuleLibrary.packages, updateExternalRuleReference],
  );

  const setExternalRuleException = useCallback(
    (
      target: RuleProfile["external"][number],
      policy: RuleExceptionPolicy | undefined,
    ) => {
      const installedPackage = externalRuleLibrary.packages.find(
        (candidate) => candidate.contentHash === target.contentHash,
      );
      const rule = installedPackage?.manifest.rules.find(
        (candidate) => candidate.id === target.ruleId,
      );
      if (!rule) return;
      const supported = new Set(rule.supportedExceptionContexts);
      const exceptions = Object.fromEntries(
        Object.entries(policy ?? {}).filter(([context]) =>
          supported.has(context as never),
        ),
      ) as RuleExceptionPolicy;
      updateExternalRuleReference(target, { exceptions });
    },
    [externalRuleLibrary.packages, updateExternalRuleReference],
  );

  const resetExternalRule = useCallback(
    (target: RuleProfile["external"][number]) => {
      const installedPackage = externalRuleLibrary.packages.find(
        (candidate) => candidate.contentHash === target.contentHash,
      );
      const rule = installedPackage?.manifest.rules.find(
        (candidate) => candidate.id === target.ruleId,
      );
      if (!rule) return;
      updateExternalRuleReference(target, {
        enabled: true,
        severity: rule.defaultSeverity,
        configVersion: rule.configVersion,
        config: normalizeExternalRuleConfig(rule, undefined).config,
        exceptions: {},
      });
    },
    [externalRuleLibrary.packages, updateExternalRuleReference],
  );

  const setRuleSeverity = useCallback(
    (ruleId: HarmonyRuleId, severity: HarmonyRuleSeverity) => {
      history.commit(
        replaceProject(project, (draft) => {
          setBuiltinRuleSeverity(draft, ruleId, severity);
        }),
      );
    },
    [history, project],
  );

  const resetRule = useCallback(
    (ruleId: HarmonyRuleId) => {
      history.commit(
        replaceProject(project, (draft) => {
          resetBuiltinRule(draft, ruleId);
        }),
      );
    },
    [history, project],
  );

  const resetAllRules = useCallback(() => {
    history.commit(
      replaceProject(project, (draft) => {
        resetAllBuiltinRules(draft);
        draft.ruleProfile.external = draft.ruleProfile.external.map(
          (reference) => {
            const installedPackage = externalRuleLibrary.packages.find(
              (candidate) => candidate.contentHash === reference.contentHash,
            );
            const rule = installedPackage?.manifest.rules.find(
              (candidate) => candidate.id === reference.ruleId,
            );
            if (!rule) return reference;
            return {
              ...reference,
              enabled: true,
              severity: rule.defaultSeverity,
              configVersion: rule.configVersion,
              config: normalizeExternalRuleConfig(rule, undefined).config,
              exceptions: {},
            };
          },
        );
      }),
    );
  }, [externalRuleLibrary.packages, history, project]);

  const setRuleConfig = useCallback(
    (ruleId: HarmonyRuleId, patch: RuleConfig) => {
      history.commit(
        replaceProject(project, (draft) => {
          setBuiltinRuleConfig(draft, ruleId, patch);
        }),
      );
    },
    [history, project],
  );

  const setRuleException = useCallback(
    (ruleId: HarmonyRuleId, policy: RuleExceptionPolicy | undefined) => {
      history.commit(
        replaceProject(project, (draft) => {
          setBuiltinRuleException(draft, ruleId, policy);
        }),
      );
    },
    [history, project],
  );

  const handleImportRuleProfile = useCallback(async () => {
    try {
      const source = await openRuleProfileFile();
      if (source === undefined) return;
      const prepared = prepareRuleProfileImport(
        source,
        project.ruleProfile,
        externalRuleLibrary.packages,
      );
      const { report } = prepared;
      const summary = [
        `${report.changedRuleIds.length} 条修改`,
        `${report.addedRuleIds.length} 条新增`,
        `${report.removedRuleIds.length} 条移除`,
        report.repairedSettings.length
          ? `${report.repairedSettings.length} 条配置已按当前 schema 修复`
          : undefined,
        report.unknownBuiltinRuleIds.length
          ? `${report.unknownBuiltinRuleIds.length} 条未知内置规则将仅列入报告`
          : undefined,
        report.missingExternalRuleKeys.length
          ? `${report.missingExternalRuleKeys.length} 条外置规则缺少本机包，将保留为未挂载`
          : undefined,
      ]
        .filter(Boolean)
        .join("；");
      const confirmed = await requestConfirmation({
        title: "导入规则配置档案",
        message: `将应用“${prepared.profile.title}”：${summary || "配置与当前工程一致"}。`,
        confirmLabel: "应用配置",
        cancelLabel: "取消",
      });
      if (!confirmed) return;
      history.commit(
        replaceProject(project, (draft) => {
          draft.ruleProfile = structuredClone(prepared.profile);
        }),
      );
      showNotice(
        report.unknownBuiltinRuleIds.length > 0
          ? `配置已导入；未知内置规则：${report.unknownBuiltinRuleIds.join("、")}`
          : "规则配置档案已导入",
      );
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "规则配置档案导入失败");
    }
  }, [
    externalRuleLibrary.packages,
    history,
    project,
    requestConfirmation,
    showNotice,
  ]);

  const handleExportRuleProfile = useCallback(async () => {
    try {
      const portable = createPortableRuleProfile(project.ruleProfile);
      const result = await saveRuleProfileFile(portable, project.title);
      if (!result.canceled) showNotice("规则配置档案已导出");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "规则配置档案导出失败");
    }
  }, [project, showNotice]);

  const handleSetDefaultRuleProfile = useCallback(() => {
    saveNewProjectRuleProfile(project.ruleProfile);
    showNotice("已设为新建工程的默认规则配置");
  }, [project.ruleProfile, showNotice]);

  return {
    externalRuleLibrary,
    externalRuleFailures,
    resolvedRuleProfile,
    harmonyResult,
    ruleHitCounts,
    mountExternalRulePackage,
    handleImportExternalRulePackage,
    handleRemoveExternalRulePackage,
    updateExternalRuleReference,
    setExternalRuleConfig,
    setExternalRuleException,
    resetExternalRule,
    setRuleSeverity,
    resetRule,
    resetAllRules,
    setRuleConfig,
    setRuleException,
    handleImportRuleProfile,
    handleExportRuleProfile,
    handleSetDefaultRuleProfile,
  } as const;
}
