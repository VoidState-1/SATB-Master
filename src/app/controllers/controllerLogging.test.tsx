// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioEngine } from "../../audio/audioEngine";
import { createEmptyProject } from "../../domain/project";
import * as desktop from "../../services/desktop";
import { ExternalRuleRuntime } from "../../services/externalRuleRuntime";
import { logger } from "../../services/logging";
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

async function mount<T>(useController: () => T) {
  let controller!: T;
  function Harness() {
    controller = useController();
    return null;
  }
  await act(() => root.render(<Harness />));
  return () => controller;
}

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
