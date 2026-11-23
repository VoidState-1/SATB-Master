import { useCallback, useEffect, useRef, useState } from "react";
import { AppError } from "../../../shared/logging";
import { audioEngine } from "../../audio/audioEngine";
import {
  buildMidi,
  midiFileName,
  type MidiExportOptions,
} from "../../domain/midi";
import {
  buildMusicXml,
  musicXmlFileName,
  type MusicXmlExportOptions,
} from "../../domain/musicxml";
import { normalizeProject, type ProjectDocument } from "../../domain/project";
import {
  autosaveProject,
  discardRecovery,
  exportMidi,
  exportMusicXml,
  findRecovery,
  openProject,
  saveProject,
} from "../../services/desktop";
import { logger } from "../../services/logging";
import type { ConfirmationState } from "./useConfirmationController";

interface ProjectHistoryFilePort {
  isDirty: boolean;
  commit(project: ProjectDocument): void;
  load(project: ProjectDocument): void;
  recover(project: ProjectDocument): void;
  markSaved(): void;
}

interface FileWorkflowOptions {
  project: ProjectDocument;
  history: ProjectHistoryFilePort;
  createProject(): ProjectDocument;
  onWorkspaceReset(project: ProjectDocument): void;
  showNotice(message: string): void;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
}

export function useFileWorkflow({
  project,
  history,
  createProject,
  onWorkspaceReset,
  showNotice,
  requestConfirmation,
}: FileWorkflowOptions) {
  const [filePath, setFilePath] = useState<string>();
  const [migrationBackupSourcePath, setMigrationBackupSourcePath] =
    useState<string>();
  const recoveryCheckedRef = useRef(false);
  const isBusyRef = useRef(false);

  useEffect(() => {
    if (recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    void findRecovery()
      .catch((error) => {
        logger.warn("file", "读取自动恢复文件失败", { code: "RECOVERY_FAILED", error });
      })
      .then(async (recovery) => {
        if (!recovery) return;
        const savedAt = new Date(recovery.savedAt).toLocaleString("zh-CN");
        const source = recovery.sourcePath
          ? `\n原工程：${recovery.sourcePath}`
          : "";
        const shouldRecover = await requestConfirmation({
          title: "恢复未保存内容",
          message: `发现 ${savedAt} 的自动恢复内容。${source}\n\n是否恢复？`,
          confirmLabel: "恢复内容",
          cancelLabel: "不恢复",
        });
        if (!shouldRecover) {
          logger.recordBreadcrumb("file", "放弃自动恢复");
          await discardRecovery();
          return;
        }
        logger.recordBreadcrumb("file", "恢复自动保存");
        logger.span("file", "恢复自动保存", () => {
          history.recover(recovery.project);
          setFilePath(recovery.sourcePath);
          setMigrationBackupSourcePath(
            recovery.migrationBackupSourcePath ??
              (recovery.migratedFromSchemaVersion === 2 ? recovery.sourcePath : undefined),
          );
          showNotice("已恢复未保存内容");
        }, { hasSource: Boolean(recovery.sourcePath) }, { code: "RECOVERY_FAILED", level: "info" });
      })
      .catch((error) => logger.warn("file", "处理自动恢复失败", { code: "RECOVERY_FAILED", error }));
  }, [history, requestConfirmation, showNotice]);

  useEffect(() => {
    if (!history.isDirty) return;
    const timer = window.setTimeout(() => {
      void autosaveProject(project, filePath, migrationBackupSourcePath).catch(
        (error) => logger.warn("file", "自动恢复保存失败", { code: "RECOVERY_FAILED", error }),
      );
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [filePath, history.isDirty, migrationBackupSourcePath, project]);

  const handleNew = useCallback(async () => {
    if (
      history.isDirty &&
      !(await requestConfirmation({
        title: "新建工程",
        message: "当前工程尚未保存，仍要新建吗？",
        confirmLabel: "继续新建",
        cancelLabel: "取消",
      }))
    )
      return;
    audioEngine.stop();
    const nextProject = createProject();
    history.load(nextProject);
    logger.recordBreadcrumb("editor", "新建工程");
    setFilePath(undefined);
    setMigrationBackupSourcePath(undefined);
    onWorkspaceReset(nextProject);
  }, [createProject, history, onWorkspaceReset, requestConfirmation]);

  const handleOpen = useCallback(async () => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    try {
      await logger.span("file", "打开工程", async () => {
        if (
          history.isDirty &&
          !(await requestConfirmation({
            title: "打开工程",
            message: "当前工程尚未保存，仍要打开其他工程吗？",
            confirmLabel: "继续打开",
            cancelLabel: "取消",
          }))
        )
          return { canceled: true };
        logger.recordBreadcrumb("file", "打开工程");
        const result = await openProject();
        if (!result) return { canceled: true };
        audioEngine.stop();
        history.load(result.project);
        setFilePath(result.filePath);
        setMigrationBackupSourcePath(
          result.migratedFromSchemaVersion === 2 ? result.filePath : undefined,
        );
        onWorkspaceReset(result.project);
        showNotice("工程已打开");
        return { canceled: false, migratedFromSchemaVersion: result.migratedFromSchemaVersion };
      }, undefined, { code: "FILE_READ_FAILED", level: "info", summarize: (result) => result });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "打开工程失败");
    } finally {
      isBusyRef.current = false;
    }
  }, [history, onWorkspaceReset, requestConfirmation, showNotice]);

  const handleSave = useCallback(
    async (forceDialog = false) => {
      if (isBusyRef.current) return;
      isBusyRef.current = true;
      try {
        logger.recordBreadcrumb("file", "保存工程", { forceDialog });
        const result = await logger.span("file", "保存工程", () => {
          let normalized: ProjectDocument;
          try {
            normalized = normalizeProject(project);
          } catch (cause) {
            throw new AppError("PROJECT_INVALID", "当前工程数据无效", { cause });
          }
          return saveProject(normalized, filePath, forceDialog, migrationBackupSourcePath);
        }, { forceDialog }, {
          code: "FILE_WRITE_FAILED",
          level: "info",
          summarize: ({ canceled }) => ({ canceled }),
        });
        if (result.canceled) return;
        setFilePath(result.filePath ?? filePath);
        setMigrationBackupSourcePath(undefined);
        history.markSaved();
        showNotice(
          result.migrationBackupPath
            ? "工程已升级为 v3 并备份原文件；旧版本不能打开新文件"
            : "工程已保存",
        );
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "保存工程失败");
      } finally {
        isBusyRef.current = false;
      }
    },
    [filePath, history, migrationBackupSourcePath, project, showNotice],
  );

  const handleExportMidi = useCallback(
    async (options?: MidiExportOptions) => {
      if (isBusyRef.current) return;
      isBusyRef.current = true;
      try {
        const layout = options?.layout ?? "satb-separate";
        logger.recordBreadcrumb("file", "导出 MIDI", { layout });
        const result = await logger.span("file", "导出 MIDI", () =>
          exportMidi(buildMidi(project, options), midiFileName(project, layout)),
        { layout }, {
          code: "FILE_WRITE_FAILED",
          level: "info",
          summarize: ({ canceled }) => ({ canceled }),
        });
        if (!result.canceled) showNotice("MIDI 已导出");
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "MIDI 导出失败");
      } finally {
        isBusyRef.current = false;
      }
    },
    [project, showNotice],
  );

  const handleExportMusicXml = useCallback(
    async (options?: MusicXmlExportOptions) => {
      if (isBusyRef.current) return;
      isBusyRef.current = true;
      try {
        const layout = options?.layout ?? "grand-staff";
        logger.recordBreadcrumb("file", "导出 MusicXML", { layout });
        const result = await logger.span("file", "导出 MusicXML", () =>
          exportMusicXml(buildMusicXml(project, options), musicXmlFileName(project, layout)),
        { layout }, {
          code: "FILE_WRITE_FAILED",
          level: "info",
          summarize: ({ canceled }) => ({ canceled }),
        });
        if (!result.canceled) showNotice("MusicXML 已导出");
      } catch (error) {
        showNotice(
          error instanceof Error ? error.message : "MusicXML 导出失败",
        );
      } finally {
        isBusyRef.current = false;
      }
    },
    [project, showNotice],
  );

  return {
    filePath,
    handleNew,
    handleOpen,
    handleSave,
    handleExportMidi,
    handleExportMusicXml,
  } as const;
}
