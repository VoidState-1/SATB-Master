import { useCallback, useEffect, useRef, useState } from "react";
import { audioEngine } from "../../audio/audioEngine";
import { buildMidi, midiFileName } from "../../domain/midi";
import { normalizeProject, type ProjectDocument } from "../../domain/model";
import {
  autosaveProject,
  discardRecovery,
  exportMidi,
  findRecovery,
  openProject,
  saveProject,
} from "../../services/desktop";
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

  useEffect(() => {
    if (recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    void findRecovery()
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
        if (shouldRecover) {
          history.recover(recovery.project);
          setFilePath(recovery.sourcePath);
          setMigrationBackupSourcePath(
            recovery.migrationBackupSourcePath ??
              (recovery.migratedFromSchemaVersion === 2
                ? recovery.sourcePath
                : undefined),
          );
          showNotice("已恢复未保存内容");
        } else {
          await discardRecovery();
        }
      })
      .catch((error) => console.warn("读取自动恢复文件失败", error));
  }, [history, requestConfirmation, showNotice]);

  useEffect(() => {
    if (!history.isDirty) return;
    const timer = window.setTimeout(() => {
      void autosaveProject(project, filePath, migrationBackupSourcePath).catch(
        (error) => console.warn("自动恢复保存失败", error),
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
    setFilePath(undefined);
    setMigrationBackupSourcePath(undefined);
    onWorkspaceReset(nextProject);
  }, [history, requestConfirmation]);

  const handleOpen = useCallback(async () => {
    if (
      history.isDirty &&
      !(await requestConfirmation({
        title: "打开工程",
        message: "当前工程尚未保存，仍要打开其他工程吗？",
        confirmLabel: "继续打开",
        cancelLabel: "取消",
      }))
    )
      return;
    try {
      const result = await openProject();
      if (!result) return;
      audioEngine.stop();
      history.load(result.project);
      setFilePath(result.filePath);
      setMigrationBackupSourcePath(
        result.migratedFromSchemaVersion === 2 ? result.filePath : undefined,
      );
      onWorkspaceReset(result.project);
      showNotice("工程已打开");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "打开工程失败");
    }
  }, [history, requestConfirmation, showNotice]);

  const handleSave = useCallback(
    async (forceDialog = false) => {
      try {
        const result = await saveProject(
          normalizeProject(project),
          filePath,
          forceDialog,
          migrationBackupSourcePath,
        );
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
      }
    },
    [filePath, history, migrationBackupSourcePath, project, showNotice],
  );

  const handleExportMidi = useCallback(async () => {
    try {
      const bytes = buildMidi(project, true);
      const result = await exportMidi(bytes, midiFileName(project));
      if (!result.canceled) showNotice("MIDI 已导出");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "MIDI 导出失败");
    }
  }, [project, showNotice]);

  return {
    filePath,
    handleNew,
    handleOpen,
    handleSave,
    handleExportMidi,
  } as const;
}
