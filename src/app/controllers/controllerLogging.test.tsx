// @vitest-environment jsdom

import { writeMidi } from "midi-file";
import { StrictMode, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalProjectOpenPayload } from "../../../shared/desktop";
import { audioEngine } from "../../audio/audioEngine";
import { createEmptyProject, PPQ } from "../../domain/project";
import { useProjectHistory } from "../../hooks/useProjectHistory";
import * as desktop from "../../services/desktop";
import { ExternalRuleRuntime } from "../../services/externalRuleRuntime";
import { logger } from "../../services/logging";
import { useConfirmationController } from "./useConfirmationController";
import { useFileWorkflow } from "./useFileWorkflow";
import { useHarmonyController } from "./useHarmonyController";
import { usePlaybackController } from "./usePlaybackController";

let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(() => root.unmount());
  Reflect.deleteProperty(window, "desktop");
  logger.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount<T>(useController: () => T, strictMode = false) {
  let controller!: T;
  function Harness() {
    controller = useController();
    return null;
  }
  await act(() => root.render(strictMode ? <StrictMode><Harness /></StrictMode> : <Harness />));
  return () => controller;
}

function stubExternalProjectBridge(pending: ExternalProjectOpenPayload | null = null) {
  let listener: ((payload: ExternalProjectOpenPayload) => void) | undefined;
  const unsubscribe = vi.fn(() => { listener = undefined; });
  const project = {
    consumePendingOpen: vi.fn().mockResolvedValue(pending),
    onOpenExternal: vi.fn((callback: NonNullable<typeof listener>) => {
      listener = callback;
      return unsubscribe;
    }),
    recovery: vi.fn().mockResolvedValue({ available: false }),
    discardRecovery: vi.fn().mockResolvedValue({ discarded: true }),
    save: vi.fn().mockResolvedValue({ canceled: true }),
  };
  Object.defineProperty(window, "desktop", { configurable: true, value: { project } });
  return {
    ...project,
    unsubscribe,
    emit(payload: ExternalProjectOpenPayload) {
      if (!listener) throw new Error("尚未订阅外部工程事件");
      listener(payload);
    },
  };
}

describe("external project opening", () => {
  it("loads and migrates the startup project once in StrictMode and skips available recovery", async () => {
    const filePath = "C:\\Scores\\startup.SATB";
    const legacy = createEmptyProject();
    const bridge = stubExternalProjectBridge({
      filePath,
      project: {
        ...legacy,
        schemaVersion: 2,
        title: "Startup score",
        tracks: legacy.satbTracks,
        keyEvents: legacy.keyEvents.map((event) => ({ ...event, tonic: 0 })),
      },
    });
    bridge.recovery.mockResolvedValue({
      available: true, savedAt: "2026-11-25T00:00:00Z", project: createEmptyProject(),
    });
    const stop = vi.spyOn(audioEngine, "stop").mockImplementation(() => {});
    const initial = createEmptyProject();
    const showNotice = vi.fn();
    const onWorkspaceReset = vi.fn();
    const requestConfirmation = vi.fn();
    const controller = await mount(() => {
      const history = useProjectHistory(initial);
      const workflow = useFileWorkflow({
        project: history.project, history, createProject: createEmptyProject,
        onWorkspaceReset, showNotice, requestConfirmation,
      });
      return { history, workflow };
    }, true);

    expect(bridge.consumePendingOpen).toHaveBeenCalledOnce();
    expect(bridge.onOpenExternal.mock.invocationCallOrder[0])
      .toBeLessThan(bridge.consumePendingOpen.mock.invocationCallOrder[0]);
    expect(bridge.unsubscribe).toHaveBeenCalledOnce();
    expect(bridge.recovery).not.toHaveBeenCalled();
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(controller().history.project).toMatchObject({ schemaVersion: 3, title: "Startup score" });
    expect(controller().history.isDirty).toBe(false);
    expect(controller().workflow.filePath).toBe(filePath);
    expect(stop).toHaveBeenCalledOnce();
    expect(onWorkspaceReset).toHaveBeenCalledExactlyOnceWith(controller().history.project);
    expect(showNotice).toHaveBeenCalledExactlyOnceWith("工程已打开", { level: "success" });

    await act(() => controller().workflow.handleSave());
    expect(bridge.save).toHaveBeenCalledWith(expect.objectContaining({
      currentPath: filePath, migrationBackupSourcePath: filePath,
    }));
  });

  it("offers normal recovery when no startup project is pending", async () => {
    const bridge = stubExternalProjectBridge();
    const project = createEmptyProject();
    bridge.recovery.mockResolvedValue({ available: true, savedAt: "2026-11-25T00:00:00Z", project });
    const requestConfirmation = vi.fn().mockResolvedValue(false);
    await mount(() => useFileWorkflow({
      project,
      history: { isDirty: false, commit: vi.fn(), load: vi.fn(), markSaved: vi.fn(), recover: vi.fn() },
      createProject: createEmptyProject,
      onWorkspaceReset: vi.fn(),
      showNotice: vi.fn(),
      requestConfirmation,
    }));

    expect(requestConfirmation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "恢复未保存内容" }));
    expect(bridge.discardRecovery).toHaveBeenCalledOnce();
  });

  it("queues external opens and switches a dirty project only after confirmation", async () => {
    const bridge = stubExternalProjectBridge();
    const stop = vi.spyOn(audioEngine, "stop").mockImplementation(() => {});
    const initial = createEmptyProject();
    const dirty = { ...initial, title: "Unsaved score" };
    const incoming = { ...createEmptyProject(), title: "Next score" };
    const nextPath = "C:\\Scores\\next.satb";
    const showNotice = vi.fn();
    const onWorkspaceReset = vi.fn();
    const controller = await mount(() => {
      const history = useProjectHistory(initial);
      const confirmation = useConfirmationController();
      const workflow = useFileWorkflow({
        project: history.project, history, createProject: createEmptyProject,
        onWorkspaceReset, showNotice, requestConfirmation: confirmation.requestConfirmation,
      });
      return { history, workflow, confirmation };
    });

    await act(() => controller().history.commit(dirty));
    await act(() => {
      bridge.emit({ filePath: "C:\\Scores\\canceled.satb", project: createEmptyProject() });
      bridge.emit({ filePath: nextPath, project: incoming });
    });
    expect(controller().confirmation.confirmation?.message).toBe("当前工程尚未保存，仍要打开该工程吗？");
    expect(controller().history.project).toBe(dirty);

    await act(() => controller().confirmation.answerConfirmation(false));
    expect(controller().history.project).toBe(dirty);
    expect(controller().history.isDirty).toBe(true);
    expect(controller().workflow.filePath).toBeUndefined();
    expect(controller().confirmation.confirmation?.message).toBe("当前工程尚未保存，仍要打开该工程吗？");
    expect(onWorkspaceReset).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();

    await act(() => controller().confirmation.answerConfirmation(true));
    expect(controller().history.project).toMatchObject({ title: incoming.title });
    expect(controller().history.isDirty).toBe(false);
    expect(controller().workflow.filePath).toBe(nextPath);
    expect(onWorkspaceReset).toHaveBeenCalledExactlyOnceWith(controller().history.project);
    expect(stop).toHaveBeenCalledOnce();
    expect(showNotice).toHaveBeenCalledExactlyOnceWith("工程已打开", { level: "success" });
  });

  it.each(["startup", "second-instance"] as const)("reports a damaged project from %s with a log ID", async (source) => {
    const invalidMessage = "所选文件不是受支持的 SATB 工程";
    const filePath = "C:\\Scores\\broken.satb";
    const bridge = stubExternalProjectBridge(source === "startup" ? { filePath, invalidMessage } : null);
    const project = createEmptyProject();
    const load = vi.fn();
    const showNotice = vi.fn();
    const requestConfirmation = vi.fn();
    await mount(() => useFileWorkflow({
      project,
      history: { isDirty: false, commit: vi.fn(), load, markSaved: vi.fn(), recover: vi.fn() },
      createProject: createEmptyProject,
      onWorkspaceReset: vi.fn(),
      showNotice,
      requestConfirmation,
    }));
    if (source === "second-instance") {
      await act(() => bridge.emit({ filePath, project: { schemaVersion: 3 } }));
    } else {
      expect(bridge.recovery).not.toHaveBeenCalled();
    }

    const [failure] = logger.getEntries();
    expect(failure).toMatchObject({
      level: "error", scope: "file", code: "PROJECT_INVALID", message: "打开外部工程失败",
      context: { source }, error: { message: invalidMessage },
    });
    expect(showNotice).toHaveBeenCalledExactlyOnceWith(invalidMessage, { level: "error", logEntryId: failure.id });
    expect(load).not.toHaveBeenCalled();
    expect(requestConfirmation).not.toHaveBeenCalled();
  });
});

describe("controller logging", () => {
  it("classifies file read, validation and write failures independently", async () => {
    const diskError = new Error("disk unavailable");
    const open = vi.fn()
      .mockRejectedValueOnce(diskError)
      .mockResolvedValueOnce({ canceled: false, invalidMessage: "工程结构或版本无效" });
    const load = vi.fn();
    Object.defineProperty(window, "desktop", { configurable: true, value: {
      project: {
        open,
        save: vi.fn().mockRejectedValue(diskError),
        recovery: vi.fn().mockRejectedValue(diskError),
      },
      midi: { export: vi.fn().mockRejectedValue(diskError) },
      musicXml: { export: vi.fn().mockRejectedValue(diskError) },
    } });
    const project = createEmptyProject();
    const controller = await mount(() => useFileWorkflow({
      project,
      history: { isDirty: false, commit: vi.fn(), load, markSaved: vi.fn(), recover: vi.fn() },
      createProject: createEmptyProject,
      onWorkspaceReset: vi.fn(),
      showNotice: vi.fn(),
      requestConfirmation: vi.fn().mockResolvedValue(true),
    }));

    await act(() => controller().handleOpen());
    await act(() => controller().handleOpen());
    await act(() => controller().handleSave());
    await act(() => controller().handleExportMidi());
    await act(() => controller().handleExportMusicXml());
    expect(logger.getEntries().map(({ level, scope, code, message }) => [level, scope, code, message])).toEqual([
      ["warn", "file", "RECOVERY_FAILED", "读取自动恢复文件失败"],
      ["error", "file", "FILE_READ_FAILED", "打开工程"],
      ["error", "file", "PROJECT_INVALID", "打开工程"],
      ["error", "file", "FILE_WRITE_FAILED", "保存工程"],
      ["error", "file", "FILE_WRITE_FAILED", "导出 MIDI"],
      ["error", "file", "FILE_WRITE_FAILED", "导出 MusicXML"],
    ]);
    expect(load).not.toHaveBeenCalled();
    expect(logger.getBreadcrumbs().map(({ message }) => message)).toEqual([
      "打开工程", "打开工程", "保存工程", "导出 MIDI", "导出 MusicXML",
    ]);
  });

  it("logs MIDI read and parse failures with notice IDs, and treats file picker cancellation as normal", async () => {
    const importFile = vi.fn()
      .mockRejectedValueOnce(new Error("无法读取 MIDI"))
      .mockResolvedValueOnce({ canceled: false, fileName: "invalid.mid", bytes: Uint8Array.of(1) })
      .mockResolvedValueOnce({ canceled: true });
    Object.defineProperty(window, "desktop", { configurable: true, value: {
      project: { recovery: vi.fn().mockResolvedValue({ available: false }) },
      midi: { import: importFile },
    } });
    const project = createEmptyProject();
    const commit = vi.fn();
    const showNotice = vi.fn();
    const controller = await mount(() => useFileWorkflow({
      project,
      history: { isDirty: false, commit, load: vi.fn(), markSaved: vi.fn(), recover: vi.fn() },
      createProject: createEmptyProject,
      onWorkspaceReset: vi.fn(),
      showNotice,
      requestConfirmation: vi.fn(),
    }));

    await act(() => controller().handleImportMidi());
    await act(() => controller().handleImportMidi());
    await act(() => controller().handleImportMidi());

    const entries = logger.getEntries();
    expect(entries.map(({ level, scope, code, message }) => [level, scope, code, message])).toEqual([
      ["error", "file", "FILE_READ_FAILED", "读取 MIDI 文件"],
      ["error", "file", "FILE_READ_FAILED", "读取 MIDI 文件"],
      ["info", "file", undefined, "读取 MIDI 文件"],
    ]);
    expect(showNotice.mock.calls).toEqual([
      ["无法读取 MIDI", { level: "error", logEntryId: entries[0].id }],
      [entries[1].error?.message, { level: "error", logEntryId: entries[1].id }],
    ]);
    expect(entries[2].context).toMatchObject({ result: { canceled: true } });
    expect(logger.getBreadcrumbs().map(({ message }) => message)).toEqual(Array(3).fill("导入 MIDI"));
    expect(controller().pendingMidiImport).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps a rejected MIDI import open and commits all successful changes in one undoable operation", async () => {
    const stop = vi.spyOn(audioEngine, "stop").mockImplementation(() => {});
    const bytes = Uint8Array.from(writeMidi({
      header: { format: 0, numTracks: 1, ticksPerBeat: PPQ },
      tracks: [[
        { type: "setTempo", deltaTime: 0, microsecondsPerBeat: 500_000 },
        { type: "noteOn", deltaTime: 0, channel: 0, noteNumber: 60, velocity: 80 },
        { type: "noteOn", deltaTime: 0, channel: 0, noteNumber: 60, velocity: 80 },
        { type: "noteOff", deltaTime: PPQ, channel: 0, noteNumber: 60, velocity: 0 },
        { type: "noteOff", deltaTime: 0, channel: 0, noteNumber: 60, velocity: 0 },
        { type: "endOfTrack", deltaTime: 0 },
      ]],
    }));
    const importFile = vi.fn().mockResolvedValue({ canceled: false, fileName: "phrase.mid", bytes });
    Object.defineProperty(window, "desktop", { configurable: true, value: {
      project: { recovery: vi.fn().mockResolvedValue({ available: false }) },
      midi: { import: importFile },
    } });
    const initial = createEmptyProject();
    const showNotice = vi.fn();
    const onImportedTracks = vi.fn();
    const controller = await mount(() => {
      const history = useProjectHistory(initial);
      const workflow = useFileWorkflow({
        project: history.project,
        history,
        createProject: createEmptyProject,
        onWorkspaceReset: vi.fn(),
        onImportedTracks,
        showNotice,
        requestConfirmation: vi.fn(),
      });
      return { history, workflow };
    });
    await act(async () => {
      const { handleImportMidi } = controller().workflow;
      await Promise.all([handleImportMidi(), handleImportMidi()]);
    });
    expect(importFile).toHaveBeenCalledOnce();
    expect(controller().workflow.pendingMidiImport?.fileName).toBe("phrase.mid");
    expect(controller().history.canUndo).toBe(false);
    expect(logger.getEntries()[0]).toMatchObject({
      level: "info", scope: "file", message: "读取 MIDI 文件",
      context: { result: { canceled: false, trackCount: 1, warningCount: 0 } },
    });

    act(() => controller().workflow.handleConfirmMidiImport({ selectedTrackKeys: [] }));
    expect(controller().workflow.pendingMidiImport).toBeDefined();
    expect(controller().history.canUndo).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    const failure = logger.getEntries().at(-1)!;
    expect(failure).toMatchObject({ level: "warn", scope: "file", code: "PROJECT_INVALID", message: "应用 MIDI 导入" });
    expect(showNotice).toHaveBeenLastCalledWith("请至少选择一条要导入的轨道", { level: "error", logEntryId: failure.id });

    const startTickOffset = initial.lengthTicks - PPQ / 2;
    act(() => controller().workflow.handleConfirmMidiImport({ startTickOffset, applyTimingEvents: true }));
    const imported = controller().history.project;
    expect(imported.auxiliaryTracks[0].notes).toEqual([expect.objectContaining({ startTick: startTickOffset })]);
    expect(imported.satbTracks).toEqual(initial.satbTracks);
    expect(imported.tempoEvents.at(-1)).toMatchObject({ tick: startTickOffset, bpm: 120 });
    expect(imported.lengthTicks).toBeGreaterThan(initial.lengthTicks);
    expect(controller().workflow.pendingMidiImport).toBeUndefined();
    expect(stop).toHaveBeenCalledOnce();
    expect(onImportedTracks).toHaveBeenCalledExactlyOnceWith([imported.auxiliaryTracks[0].id]);
    expect(showNotice).toHaveBeenLastCalledWith(
      "已导入 1 条额外声部、1 个音符，已合并 1 个完全重叠的音符，已自动延长工程", { level: "success" },
    );
    expect(logger.getEntries().at(-1)).toMatchObject({
      level: "info", scope: "file", message: "应用 MIDI 导入",
      context: { result: {
        trackCount: 1, noteCount: 1, deduplicatedNoteCount: 1, extendedLengthTicks: imported.lengthTicks,
      } },
    });
    act(() => controller().history.undo());
    expect(controller().history.project).toEqual(initial);
    expect(controller().history.canUndo).toBe(false);
    act(() => controller().history.redo());
    expect(controller().history.project).toEqual(imported);
  });

  it("reports failed SoundFont loading and failed playback with their own codes", async () => {
    vi.spyOn(audioEngine, "unloadSoundFont").mockResolvedValue(true);
    vi.spyOn(desktop, "loadDefaultSoundFont").mockRejectedValue(new Error("missing bank"));
    vi.spyOn(audioEngine, "resume").mockRejectedValue(new Error("audio unavailable"));
    const project = createEmptyProject();
    const controller = await mount(() => usePlaybackController({
      project,
      history: { commit: vi.fn() },
      gridTicks: 480,
      showNotice: vi.fn(),
    }));

    await act(() => controller().handlePlay());
    expect(logger.getEntries()).toEqual([
      expect.objectContaining({
        level: "warn", scope: "audio", code: "SOUNDFONT_LOAD_FAILED",
        error: expect.objectContaining({ message: "missing bank" }),
        context: expect.objectContaining({ durationMs: expect.any(Number) }),
      }),
      expect.objectContaining({
        level: "error", scope: "audio", code: "AUDIO_PLAYBACK_FAILED",
        error: expect.objectContaining({ message: "audio unavailable" }),
      }),
    ]);
    expect(controller().isPlaying).toBe(false);
  });

  it("warns once for the same skipped rule across consecutive edits", async () => {
    vi.spyOn(ExternalRuleRuntime.prototype, "run").mockImplementation(async ({ revision }) => ({
      revision,
      superseded: false,
      diagnostics: [],
      failures: [],
      skippedRules: [{ ruleId: "external:example", reason: "rule-error", partial: false, message: "rule failed" }],
    }));
    const initialProject = createEmptyProject();
    const controller = await mount(() => {
      const [project, setProject] = useState(initialProject);
      const harmony = useHarmonyController({
        project,
        history: { commit: vi.fn() },
        showNotice: vi.fn(),
        requestConfirmation: vi.fn().mockResolvedValue(false),
      });
      return { harmony, edit: () => setProject({ ...project, title: "Edited" }) };
    });

    await act(() => controller().edit());
    const warnings = logger.getEntries().filter(({ scope, code }) =>
      scope === "harmony" && code === "HARMONY_CHECK_FAILED",
    );
    expect(warnings).toEqual([expect.objectContaining({
      level: "warn",
      context: {
        durationMs: expect.any(Number),
        diagnosticCount: controller().harmony.harmonyResult.diagnostics.length,
        skippedRuleCount: controller().harmony.harmonyResult.skippedRules.length,
      },
    })]);
  });

  it("preserves the built-in result and summarizes a failed external dispatch", async () => {
    vi.spyOn(ExternalRuleRuntime.prototype, "run").mockRejectedValue(new Error("worker unavailable"));
    const project = createEmptyProject();
    const controller = await mount(() => useHarmonyController({
      project,
      history: { commit: vi.fn() },
      showNotice: vi.fn(),
      requestConfirmation: vi.fn().mockResolvedValue(false),
    }));

    const { harmonyResult } = controller();
    expect(harmonyResult.superseded).toBe(false);
    expect(logger.getEntries()).toContainEqual(expect.objectContaining({
      level: "error", scope: "external-rule", code: "EXTERNAL_RULE_FAILED",
      error: expect.objectContaining({ message: "worker unavailable" }),
    }));
    expect(logger.getEntries()).toContainEqual(expect.objectContaining({
      scope: "harmony",
      context: {
        durationMs: expect.any(Number),
        diagnosticCount: harmonyResult.diagnostics.length,
        skippedRuleCount: harmonyResult.skippedRules.length,
      },
    }));
  });
});
