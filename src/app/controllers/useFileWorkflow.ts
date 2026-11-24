import { useCallback, useEffect, useRef, useState } from "react";
import { AppError } from "../../../shared/logging";
import type { ShowNotice } from "../../components/AppNoticeStack";
import { audioEngine } from "../../audio/audioEngine";
import {
  buildMidi,
  midiFileName,
  type MidiExportOptions,
} from "../../domain/midi";
import {
  importMidiToAuxiliaryTracks,
  parseMidiForImport,
  type MidiImportApplyOptions,
  type MidiImportResult,
  type ParsedMidiFile,
} from "../../domain/midiImport";
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
  openMidiFile,
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
  onImportedAuxiliaryTracks?(trackIds: string[]): void;
  showNotice: ShowNotice;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
}

export function useFileWorkflow({
  project,
  history,
  createProject,
  onWorkspaceReset,
  onImportedAuxiliaryTracks,
  showNotice,
  requestConfirmation,
}: FileWorkflowOptions) {
  const [filePath, setFilePath] = useState<string>();
  const [migrationBackupSourcePath, setMigrationBackupSourcePath] =
    useState<string>();
  const [pendingMidiImport, setPendingMidiImport] = useState<ParsedMidiFile>();
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
    let logEntryId: string | undefined;
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
        showNotice("工程已打开", { level: "success" });
        return { canceled: false, migratedFromSchemaVersion: result.migratedFromSchemaVersion };
      }, undefined, {
        code: "FILE_READ_FAILED", level: "info", summarize: (result) => result,
        onFailure: entry => { logEntryId = entry.id; },
      });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "打开工程失败", { level: "error", logEntryId });
    } finally {
      isBusyRef.current = false;
    }
  }, [history, onWorkspaceReset, requestConfirmation, showNotice]);

  const handleSave = useCallback(
    async (forceDialog = false) => {
      if (isBusyRef.current) return;
      isBusyRef.current = true;
      let logEntryId: string | undefined;
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
          onFailure: entry => { logEntryId = entry.id; },
        });
        if (result.canceled) return;
        setFilePath(result.filePath ?? filePath);
        setMigrationBackupSourcePath(undefined);
        history.markSaved();
        showNotice(
          result.migrationBackupPath
            ? "工程已升级为 v3 并备份原文件；旧版本不能打开新文件"
            : "工程已保存",
          { level: "success" },
        );
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "保存工程失败", { level: "error", logEntryId });
      } finally {
        isBusyRef.current = false;
      }
    },
    [filePath, history, migrationBackupSourcePath, project, showNotice],
  );

  const handleImportMidi = useCallback(async () => {
    if (isBusyRef.current || pendingMidiImport) return;
    isBusyRef.current = true;
    let logEntryId: string | undefined;
    try {
      logger.recordBreadcrumb("file", "导入 MIDI");
      const parsed = await logger.span("file", "读取 MIDI 文件", async () => {
        const file = await openMidiFile();
        return file ? parseMidiForImport(file.bytes, file.fileName) : undefined;
      }, undefined, {
        code: "FILE_READ_FAILED",
        level: "info",
        summarize: (parsed) => parsed
          ? { canceled: false, trackCount: parsed.tracks.length, warningCount: parsed.warnings.length }
          : { canceled: true },
        onFailure: (entry) => { logEntryId = entry.id; },
      });
      if (parsed) setPendingMidiImport(parsed);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "读取 MIDI 文件失败", { level: "error", logEntryId });
    } finally {
      isBusyRef.current = false;
    }
  }, [pendingMidiImport, showNotice]);

  const handleConfirmMidiImport = useCallback((options: MidiImportApplyOptions) => {
    if (!pendingMidiImport) return;
    let logEntryId: string | undefined;
    let result: MidiImportResult;
    try {
      result = logger.span("file", "应用 MIDI 导入", () => {
        const imported = importMidiToAuxiliaryTracks(project, pendingMidiImport, options);
        if (imported.error) throw new AppError("PROJECT_INVALID", imported.error);
        return imported;
      }, undefined, {
        code: "PROJECT_INVALID",
        level: "info",
        failureLevel: "warn",
        summarize: (imported) => ({
          trackCount: imported.importedTrackIds.length,
          noteCount: imported.importedNoteCount,
          deduplicatedNoteCount: imported.deduplicatedNoteCount,
          extendedLengthTicks: imported.extendedLengthTicks,
        }),
        onFailure: (entry) => { logEntryId = entry.id; },
      });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "MIDI 导入失败", { level: "error", logEntryId });
      return;
    }

    audioEngine.stop();
    history.commit(result.project);
    setPendingMidiImport(undefined);
    onImportedAuxiliaryTracks?.(result.importedTrackIds);

    const details = [];
    if (result.deduplicatedNoteCount > 0) {
      details.push(`已合并 ${result.deduplicatedNoteCount} 个完全重叠的音符`);
    }
    if (result.extendedLengthTicks !== undefined) details.push("已自动延长工程");
    if (result.warnings.length > pendingMidiImport.warnings.length) details.push("已跳过部分调号变更");
    const summary = `已导入 ${result.importedTrackIds.length} 条额外声部、${result.importedNoteCount} 个音符`;
    showNotice([summary, ...details].join("，"), { level: "success" });
  }, [history, onImportedAuxiliaryTracks, pendingMidiImport, project, showNotice]);

  const handleCancelMidiImport = useCallback(() => {
    setPendingMidiImport(undefined);
  }, []);

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
    pendingMidiImport,
    handleImportMidi,
    handleConfirmMidiImport,
    handleCancelMidiImport,
    handleExportMidi,
    handleExportMusicXml,
  } as const;
}
