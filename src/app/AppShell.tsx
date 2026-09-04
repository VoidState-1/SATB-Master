import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Cable,
  Clipboard,
  Copy,
  Download,
  Eraser,
  FlaskConical,
  FilePlus2,
  FolderOpen,
  LocateFixed,
  Magnet,
  Maximize2,
  Music2,
  Minimize2,
  Minus,
  MousePointer2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Pause,
  Pencil,
  Play,
  Repeat2,
  Redo2,
  Save,
  SaveAll,
  Settings2,
  SkipBack,
  Square,
  Trash2,
  Undo2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
  X,
  Scissors,
} from "lucide-react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BottomPanel, type BottomPanelTab } from "../features/bottomPanel";
import { IconButton } from "../components/IconButton";
import { Inspector } from "../features/inspector";
import { PanelResizeHandle } from "../components/PanelResizeHandle";
import {
  GRID_OPTIONS,
  PianoRoll,
  stepTimelineZoom,
} from "../features/editor";
import { SettingsDialog } from "../features/settings";
import { TrackSidebar } from "../features/tracks";
import { RuleTestWorkbench } from "../features/ruleTesting";
import { ChordInferenceDialog } from "../features/chordInference";
import { ScorePreviewDialog, loadVexFlow } from "../features/scorePreview";
import { ExportDialog } from "../features/export";
import { MidiOutDialog } from "../features/midiOut";
import { midiOutputManager } from "../audio/midiOutput";
import { toMidi } from "../domain/pitch";
import { replaceProject } from "../domain/editing";
import {
  applyHarmonyInference,
  buildHarmonyAnalysis,
  formatDiagnosticDebugReport,
  inferHarmony,
  type HarmonyDiagnostic,
} from "../domain/harmony";
import { createEmptyProject, type ProjectDocument } from "../domain/project";
import { buildMeasures, formatPosition } from "../domain/time";
import { loadNewProjectRuleProfile } from "../domain/ruleProfile";
import {
  DEFAULT_PANEL_SIZES,
  PANEL_RESIZER_SIZE,
  usePanelLayout,
} from "../hooks/usePanelLayout";
import { useDeveloperMode } from "../hooks/useDeveloperMode";
import { useExternalRuleLibrary } from "../hooks/useExternalRuleLibrary";
import { useScaleGuide } from "../hooks/useScaleGuide";
import { usePausePlayheadBehavior } from "../hooks/usePausePlayheadBehavior";
import {
  readStoredFollowPlayhead,
  useFollowPlayhead,
} from "../hooks/useFollowPlayhead";
import { useShortcutBindings } from "../hooks/useShortcutBindings";
import { useConfirmationController } from "./controllers/useConfirmationController";
import { useHarmonyController } from "./controllers/useHarmonyController";
import { useFileWorkflow } from "./controllers/useFileWorkflow";
import { useEditorCommands } from "./controllers/useEditorCommands";
import { usePlaybackController } from "./controllers/usePlaybackController";
import { useKeyboardController } from "./controllers/useKeyboardController";
import { useProjectController } from "./controllers/useProjectController";
import { useWindowController } from "./controllers/useWindowController";
import { useRuleTestWorkspace } from "./controllers/useRuleTestWorkspace";
import { formatShortcutBinding } from "../shortcuts/shortcutRegistry";
import { copyText } from "../services/clipboard";

const BOTTOM_PANEL_TAB_STORAGE_KEY = "satb-master-bottom-panel-tab";

function getInitialBottomPanelTab(): BottomPanelTab {
  if (typeof window === "undefined") return "diagnostics";
  try {
    const stored = window.localStorage.getItem(BOTTOM_PANEL_TAB_STORAGE_KEY);
    if (stored === "diagnostics" || stored === "score") return stored;
  } catch {
    // ignore
  }
  return "diagnostics";
}

function createProjectWithRuleProfileTemplate() {
  const project = createEmptyProject();
  const template = loadNewProjectRuleProfile();
  if (template) project.ruleProfile = template;
  return project;
}

function formatByteSize(bytes: number) {
  const gibibyte = 1024 * 1024 * 1024;
  if (bytes >= gibibyte) return `${(bytes / gibibyte).toFixed(1)} GB`;
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}

function AppShell() {
  const initialProject = useMemo(
    () => createProjectWithRuleProfileTemplate(),
    [],
  );
  const { history, project, editor, resetWorkspace } =
    useProjectController(initialProject);
  const cadenceAnalysis = useMemo(() => buildHarmonyAnalysis(project), [project]);
  const {
    activeVoice,
    setActiveVoice,
    tool,
    setTool,
    editorDomain,
    setEditorDomain,
    editorInteractionActive,
    setEditorInteractionActive,
    cancelEditorRequest,
    setCancelEditorRequest,
    gridTicks,
    setGridTicks,
    pixelsPerBeat,
    setPixelsPerBeat,
    selectedNoteIds,
    setSelectedNoteIds,
    selectedChordIds,
    setSelectedChordIds,
    chordBrush,
    effectiveTool,
    selectedNote,
    selectedChord,
  } = editor;
  const loopEnabled = project.loop.enabled;
  const loopStartTick = project.loop.startTick;
  const loopEndTick = project.loop.endTick;
  const [notice, setNotice] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chordInferenceOpen, setChordInferenceOpen] = useState(false);
  const [scorePreviewOpen, setScorePreviewOpen] = useState(false);
  const [bottomPanelTab, setBottomPanelTabState] = useState<BottomPanelTab>(
    getInitialBottomPanelTab,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [midiOutOpen, setMidiOutOpen] = useState(false);
  const [midiOutEnabled, setMidiOutEnabled] = useState<boolean>(() =>
    midiOutputManager.isEnabled(),
  );
  const [ruleTestMode, setRuleTestMode] = useState(false);
  const panelLayout = usePanelLayout();
  const workspaceColumns = useMemo(() => {
    const cols: string[] = [];
    if (panelLayout.visibility.left) {
      cols.push(`${panelLayout.sizes.left}px`, `${PANEL_RESIZER_SIZE}px`);
    }
    cols.push("minmax(0, 1fr)");
    if (panelLayout.visibility.right) {
      cols.push(`${PANEL_RESIZER_SIZE}px`, `${panelLayout.sizes.right}px`);
    }
    return cols.join(" ");
  }, [
    panelLayout.visibility.left,
    panelLayout.visibility.right,
    panelLayout.sizes.left,
    panelLayout.sizes.right,
  ]);
  const editorAreaRows = useMemo(() => {
    if (panelLayout.visibility.bottom) {
      return `minmax(0, 1fr) ${PANEL_RESIZER_SIZE}px ${panelLayout.sizes.bottom}px`;
    }
    return "minmax(0, 1fr)";
  }, [panelLayout.visibility.bottom, panelLayout.sizes.bottom]);
  const shortcutSettings = useShortcutBindings();
  const developerMode = useDeveloperMode();
  const { scaleGuideEnabled, setScaleGuideEnabled } = useScaleGuide();
  const { pausePlayheadBehavior, setPausePlayheadBehavior } =
    usePausePlayheadBehavior();
  const { followPlayhead, setFollowPlayhead } = useFollowPlayhead();

  const setBottomPanelTab = useCallback((tab: BottomPanelTab) => {
    setBottomPanelTabState(tab);
    try {
      window.localStorage.setItem(BOTTOM_PANEL_TAB_STORAGE_KEY, tab);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const unsub = midiOutputManager.onConfigChange((cfg) =>
      setMidiOutEnabled(cfg.enabled && midiOutputManager.isSupported()),
    );
    return unsub;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadVexFlow().catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(
      () => setNotice((current) => (current === message ? undefined : current)),
      2800,
    );
  }, []);

  const {
    playheadTick,
    setPlayheadTick,
    isPlaying,
    metronomeEnabled,
    setMetronomeEnabled,
    audioState,
    audioMessage,
    audioLevel,
    soundFontProgress,
    soundFontSizeBytes,
    handleChooseSoundFont,
    handleUseDefaultSoundFont,
    handleStop,
    handlePlay,
    toggleLoop,
    setLoopBoundary,
  } = usePlaybackController({
    project,
    history,
    preloadSoundFont: !ruleTestMode,
    gridTicks,
    pausePlayheadBehavior,
    showNotice,
  });

  const onPlayWithFollowRestore = useCallback(() => {
    if (!isPlaying && readStoredFollowPlayhead()) {
      setFollowPlayhead(true);
    }
    return handlePlay();
  }, [handlePlay, isPlaying, setFollowPlayhead]);
  const { confirmation, requestConfirmation, answerConfirmation } =
    useConfirmationController();
  const ruleTestWorkspace = useRuleTestWorkspace({
    initialProject,
    showNotice,
    requestConfirmation,
  });
  const windowController = useWindowController({
    isDirty:
      history.isDirty ||
      (ruleTestMode && ruleTestWorkspace.history.isDirty),
    requestConfirmation,
  });
  const resetWorkspaceForProject = (nextProject: ProjectDocument) =>
    resetWorkspace(nextProject, setPlayheadTick);
  const {
    handleAddNote,
    handleMoveNotes,
    handleSelectNotes,
    handleSelectChords,
    handlePreviewNote,
    handleSplitNote,
    handleUpdateNote,
    handleDeleteNotes,
    handleUpdateTrack,
    handleUpdateProject,
    handleUpdateInstructions,
    handleAddEditableRange,
    handleUpdateEditableRange,
    handleDeleteEditableRange,
    handleAddPhraseBoundary,
    handleDeletePhraseBoundary,
    handleAddChord,
    handleUpdateChord,
    handleMoveChords,
    handleDeleteChords,
    handleSplitChord,
    handleUpdateChordBrush,
    handleUpdateChordTrack,
    handleAddCadenceAnnotation,
    handleUpdateCadenceAnnotation,
    handleDeleteCadenceAnnotation,
    handleAddTimingEvent,
    handleUpdateTimingEvent,
    handleDeleteTimingEvent,
    copySelection,
    pasteSelection,
    clearSelection,
    selectAllInEditorDomain,
    cutSelection,
    duplicateSelection,
    cycleActiveVoice,
    movePlayheadByMeasure,
    changeGridResolution,
    changeTimelineZoom,
    transformSelection,
  } = useEditorCommands({
    project,
    history,
    editor,
    playheadTick,
    setPlayheadTick,
    showNotice,
  });
  const {
    filePath,
    handleNew,
    handleOpen,
    handleSave,
    handleExportMidi,
    handleExportMusicXml,
  } = useFileWorkflow({
    project,
    history,
    createProject: createProjectWithRuleProfileTemplate,
    onWorkspaceReset: resetWorkspaceForProject,
    showNotice,
    requestConfirmation,
  });
  const {
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
  } = useHarmonyController({
    project,
    history,
    showNotice,
    requestConfirmation,
  });
  useKeyboardController({
    enabled: !ruleTestMode,
    bindings: shortcutSettings.bindings,
    confirmation,
    settingsOpen,
    tool,
    editorDomain,
    editorInteractionActive,
    gridTicks,
    projectLengthTicks: project.lengthTicks,
    selectedNoteIds,
    selectedChordIds,
    history,
    setTool,
    setPlayheadTick,
    setCancelEditorRequest,
    handleNew,
    handleOpen,
    handleSave,
    handlePlay: onPlayWithFollowRestore,
    handleDeleteChords,
    handleDeleteNotes,
    selectAllInEditorDomain,
    clearSelection,
    copySelection,
    cutSelection,
    pasteSelection,
    duplicateSelection,
    cycleActiveVoice,
    movePlayheadByMeasure,
    changeGridResolution,
    changeTimelineZoom,
    transformSelection,
  });

  const handleDiagnostic = (diagnostic: HarmonyDiagnostic) => {
    setPlayheadTick(diagnostic.tick);
    setSelectedNoteIds(new Set(diagnostic.noteIds));
    setSelectedChordIds(new Set(diagnostic.chordIds));
  };

  const handleToggleIgnoredDiagnostic = (diagnostic: HarmonyDiagnostic) => {
    history.commit(
      replaceProject(project, (draft) => {
        const ignored = new Set(
          draft.diagnosticPreferences.ignoredDiagnosticIds,
        );
        if (ignored.has(diagnostic.id)) ignored.delete(diagnostic.id);
        else ignored.add(diagnostic.id);
        draft.diagnosticPreferences.ignoredDiagnosticIds = [...ignored].sort();
      }),
    );
  };

  const activeDiagnostics = useMemo(() => {
    const ignored = new Set(project.diagnosticPreferences.ignoredDiagnosticIds);
    return harmonyResult.diagnostics.filter((item) => !ignored.has(item.id));
  }, [
    harmonyResult.diagnostics,
    project.diagnosticPreferences.ignoredDiagnosticIds,
  ]);

  const handleScorePreviewNoteSelection = useCallback(
    ({
      sourceNoteId,
      voiceId,
      tick,
    }: {
      sourceNoteId: string;
      voiceId: ProjectDocument["satbTracks"][number]["id"];
      tick: number;
    }) => {
      // 谱面是只读投影；点击只更新编辑器选择和播放头，不提交历史。
      setEditorDomain("notes");
      setActiveVoice(voiceId);
      setSelectedNoteIds(new Set([sourceNoteId]));
      setSelectedChordIds(new Set());
      setPlayheadTick(tick);

      const track = project.satbTracks.find((t) => t.id === voiceId);
      const note = track?.notes.find((n) => n.id === sourceNoteId);
      if (note) {
        handlePreviewNote(voiceId, toMidi(note.pitch));
      }
    },
    [
      handlePreviewNote,
      project.satbTracks,
      setActiveVoice,
      setEditorDomain,
      setPlayheadTick,
      setSelectedChordIds,
      setSelectedNoteIds,
    ],
  );

  const handleCopyDiagnostic = async (diagnostic: HarmonyDiagnostic) => {
    const copied = await copyText(formatDiagnosticDebugReport(diagnostic));
    showNotice(copied ? "已复制问题调试信息" : "复制问题调试信息失败");
  };

  const handleChordInferenceApply = (options: {
    rangeMode: "selection" | "current-measure" | "project";
    fromTick: number;
    toTick: number;
    mode: "fill-gaps" | "replace-unlocked";
    allowAbsoluteFallback: boolean;
    allowIncompleteVoicing: boolean;
    minConfidence: "high" | "medium" | "low";
    writeNonChordToneRoles: boolean;
  }) => {
    const result = inferHarmony(project, {
      fromTick: options.fromTick,
      toTick: options.toTick,
      allowAbsoluteFallback: options.allowAbsoluteFallback,
      allowIncompleteVoicing: options.allowIncompleteVoicing,
      minConfidence: options.minConfidence,
    });
    const applied = applyHarmonyInference(project, result, {
      mode: options.mode,
      writeNonChordToneRoles: options.writeNonChordToneRoles,
    });
    if (applied.project !== project) history.commit(applied.project);
    const warningText = applied.skipped.length
      ? `，跳过 ${applied.skipped.length} 个区段`
      : "";
    const roleText = applied.writtenNonChordToneRoleCount
      ? `，写入 ${applied.writtenNonChordToneRoleCount} 个非和弦音角色`
      : "";
    const phraseTemplateLabel = {
      single: "单乐句",
      duple: "双乐句",
      triple: "三乐句",
    }[applied.appliedPhraseTemplate];
    const phraseText = applied.appliedPhraseBoundaryCount
      ? `，按${phraseTemplateLabel}处理，生成 ${applied.appliedPhraseBoundaryCount} 个自动边界`
      : `，按${phraseTemplateLabel}处理`;
    const unresolvedText = result.chordInference.unresolvedObservationIndices.length
      ? `，${result.chordInference.unresolvedObservationIndices.length} 个时间片未归类`
      : "";
    showNotice(
      applied.appliedRegionCount > 0
        ? `已应用 ${applied.appliedRegionCount} 个和弦区段${phraseText}${roleText}${unresolvedText}${warningText}`
        : `没有应用和弦区段${unresolvedText}${warningText}`,
    );
    setChordInferenceOpen(false);
  };

  const measureCount = buildMeasures(project).length;
  const enterRuleTestMode = async () => {
    handleStop();
    if (!ruleTestWorkspace.hasSession) {
      const created = await ruleTestWorkspace.createFromProject(project);
      if (!created) return;
    }
    setRuleTestMode(true);
  };
  const leaveRuleTestMode = async () => {
    if (
      ruleTestWorkspace.history.isDirty &&
      !(await requestConfirmation({
        title: "返回普通工程？",
        message: "规则用例有未保存修改。返回后用例会保留在测试工作区，但本次修改不会自动写入文件。",
        confirmLabel: "返回",
        cancelLabel: "留在工作台",
      }))
    )
      return;
    ruleTestWorkspace.cancelRun();
    ruleTestWorkspace.editor.setSelectedNoteIds(new Set());
    ruleTestWorkspace.editor.setSelectedChordIds(new Set());
    setRuleTestMode(false);
  };
  if (ruleTestMode) {
    return (
      <RuleTestWorkbench
        controller={ruleTestWorkspace}
        windowController={windowController}
        onCreateFromProject={() =>
          void ruleTestWorkspace.createFromProject(project)
        }
        onBack={() => void leaveRuleTestMode()}
        confirmation={confirmation}
        answerConfirmation={answerConfirmation}
        notice={notice}
        showNotice={showNotice}
      />
    );
  }
  return (
    <main className="app-shell">
      <header
        className="app-titlebar"
        onDoubleClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(".titlebar-controls")
          )
            return;
          void windowController.toggleMaximize();
        }}
      >
        <div className="brand-mark">SM</div>
        <strong>SATB Master</strong>
        <span className="project-title">
          {project.title}
          {history.isDirty ? " *" : ""}
        </span>
        <span className="file-path">{filePath ?? "未保存工程"}</span>
        <span className={`engine-status ${audioState}`}>
          <i />
          {audioMessage}
        </span>
        {window.desktop?.windowControls ? (
          <div className="titlebar-controls">
            <IconButton
              className="window-control"
              label="最小化"
              icon={<Minus />}
              onClick={() => void window.desktop?.windowControls.minimize()}
            />
            <IconButton
              className="window-control"
              label={windowController.isMaximized ? "还原" : "最大化"}
              icon={
                windowController.isMaximized ? <Minimize2 /> : <Maximize2 />
              }
              onClick={() => void windowController.toggleMaximize()}
            />
            <IconButton
              className="window-control close"
              label="关闭"
              icon={<X />}
              onClick={() => void windowController.close()}
            />
          </div>
        ) : null}
      </header>

      <div className="main-toolbar">
        <div className="toolbar-group">
          <IconButton
            label="新建工程"
            icon={<FilePlus2 />}
            onClick={() => void handleNew()}
          />
          <IconButton
            label="打开工程"
            icon={<FolderOpen />}
            onClick={() => void handleOpen()}
          />
          <IconButton
            label="保存"
            icon={<Save />}
            onClick={() => void handleSave(false)}
          />
          <IconButton
            label="另存为"
            icon={<SaveAll />}
            onClick={() => void handleSave(true)}
          />
          <IconButton
            label="导出 MIDI"
            title="导出 (MusicXML / MIDI)"
            icon={<Download />}
            onClick={() => setExportOpen(true)}
          />
          <IconButton
            label="实时 MIDI 输出"
            icon={<Cable />}
            active={midiOutEnabled}
            onClick={() => setMidiOutOpen(true)}
          />
          <IconButton
            label="打开五线谱预览"
            title="打开五线谱预览 (独立弹窗)"
            icon={<Music2 />}
            active={scorePreviewOpen}
            onClick={() => setScorePreviewOpen(true)}
          />
          <IconButton
            label="从音符推导和弦"
            icon={<WandSparkles />}
            onClick={() => setChordInferenceOpen(true)}
          />
          {developerMode.enabled && developerMode.showRuleTestEntry ? (
            <IconButton
              label="规则测试工作台"
              icon={<FlaskConical />}
              onClick={() => void enterRuleTestMode()}
            />
          ) : null}
        </div>
        <div className="toolbar-group">
          <IconButton
            label="撤销"
            icon={<Undo2 />}
            disabled={!history.canUndo}
            onClick={history.undo}
          />
          <IconButton
            label="重做"
            icon={<Redo2 />}
            disabled={!history.canRedo}
            onClick={history.redo}
          />
          <IconButton
            label="复制选中事件"
            icon={<Copy />}
            onClick={copySelection}
          />
          <IconButton
            label="粘贴事件"
            icon={<Clipboard />}
            onClick={pasteSelection}
          />
          <IconButton
            label="删除选中事件"
            icon={<Trash2 />}
            onClick={() =>
              editorDomain === "chords"
                ? handleDeleteChords(selectedChordIds)
                : handleDeleteNotes(selectedNoteIds)
            }
          />
        </div>
        <div className="toolbar-group tool-selector">
          <IconButton
            label={`选择工具（${shortcutSettings.bindings.selectTool[0] ? formatShortcutBinding(shortcutSettings.bindings.selectTool[0]) : "未设置"}）`}
            icon={<MousePointer2 />}
            active={effectiveTool === "select"}
            onClick={() => setTool("select")}
          />
          <IconButton
            label={`铅笔工具（${shortcutSettings.bindings.pencilTool[0] ? formatShortcutBinding(shortcutSettings.bindings.pencilTool[0]) : "未设置"}）`}
            icon={<Pencil />}
            active={effectiveTool === "pencil"}
            onClick={() => setTool("pencil")}
          />
          <IconButton
            label={`擦除工具（${shortcutSettings.bindings.eraserTool[0] ? formatShortcutBinding(shortcutSettings.bindings.eraserTool[0]) : "未设置"}）`}
            icon={<Eraser />}
            active={effectiveTool === "eraser"}
            onClick={() => setTool("eraser")}
          />
          <IconButton
            label={`切分工具（${shortcutSettings.bindings.splitTool[0] ? formatShortcutBinding(shortcutSettings.bindings.splitTool[0]) : "未设置"}）`}
            icon={<Scissors />}
            active={effectiveTool === "split"}
            onClick={() => setTool("split")}
          />
        </div>
        <div className="transport-group">
          <IconButton
            label="回到开头"
            icon={<SkipBack />}
            onClick={() => handleStop(true)}
          />
          <IconButton
            label={isPlaying ? "暂停" : "播放"}
            icon={isPlaying ? <Pause /> : <Play />}
            active={isPlaying}
            onClick={() => void onPlayWithFollowRestore()}
          />
          <IconButton
            label="停止"
            icon={<Square />}
            onClick={() => handleStop()}
          />
          <IconButton
            label="循环播放"
            icon={<Repeat2 />}
            active={loopEnabled}
            onClick={toggleLoop}
          />
          <IconButton
            label="跟随播放头"
            title={`跟随播放头（${followPlayhead ? "已开启" : "已关闭"}）`}
            icon={<LocateFixed />}
            active={followPlayhead}
            onClick={() => setFollowPlayhead((value) => !value)}
          />
          <button
            type="button"
            className="loop-boundary"
            title="将循环起点设为播放头"
            onClick={() => setLoopBoundary("start")}
          >
            起 {formatPosition(project, loopStartTick)}
          </button>
          <button
            type="button"
            className="loop-boundary"
            title="将循环终点设为播放头"
            onClick={() => setLoopBoundary("end")}
          >
            止 {formatPosition(project, loopEndTick)}
          </button>
          <IconButton
            label="节拍器"
            icon={<BellRing />}
            active={metronomeEnabled}
            onClick={() => setMetronomeEnabled((value) => !value)}
          />
          <span
            className={`output-meter ${audioLevel >= 0.98 ? "is-clipping" : ""}`}
            role="meter"
            aria-label="主输出电平"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number(audioLevel.toFixed(4))}
            title="主输出电平"
          >
            <i style={{ width: `${Math.max(2, audioLevel * 100)}%` }} />
          </span>
          <span className="position-readout">
            {formatPosition(project, playheadTick)}
          </span>
          <span className="transport-meta">{measureCount} 小节</span>
        </div>
        <div className="toolbar-group toolbar-right">
          <IconButton
            label="设置"
            icon={<Settings2 />}
            onClick={() => setSettingsOpen(true)}
          />
          <div className="grid-control" title="编辑吸附网格">
            <Magnet aria-hidden="true" />
            <select
              aria-label="时值对齐"
              value={gridTicks}
              onChange={(event) => setGridTicks(Number(event.target.value))}
            >
              {GRID_OPTIONS.map((option) => (
                <option key={option.ticks} value={option.ticks}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <IconButton
            label="缩小时间轴"
            icon={<ZoomOut />}
            onClick={() =>
              setPixelsPerBeat((value) => stepTimelineZoom(value, -1))
            }
          />
          <span className="zoom-value">{pixelsPerBeat}</span>
          <IconButton
            label="放大时间轴"
            icon={<ZoomIn />}
            onClick={() =>
              setPixelsPerBeat((value) => stepTimelineZoom(value, 1))
            }
          />
          <div className="toolbar-divider" />
          <div className="layout-group" role="group" aria-label="面板布局">
            <IconButton
              label={
                panelLayout.visibility.left
                  ? "隐藏左侧声部面板"
                  : "显示左侧声部面板"
              }
              title={`左侧声部面板 (${panelLayout.visibility.left ? "显示中" : "已隐藏"})`}
              icon={<PanelLeft />}
              active={panelLayout.visibility.left}
              onClick={panelLayout.toggleLeft}
            />
            <IconButton
              label={
                panelLayout.visibility.bottom
                  ? "隐藏底部面板"
                  : "显示底部面板"
              }
              title={`底部工作台 (${panelLayout.visibility.bottom ? "显示中" : "已隐藏"})`}
              icon={<PanelBottom />}
              active={panelLayout.visibility.bottom}
              onClick={panelLayout.toggleBottom}
            />
            <IconButton
              label={
                panelLayout.visibility.right
                  ? "隐藏右侧属性面板"
                  : "显示右侧属性面板"
              }
              title={`右侧属性面板 (${panelLayout.visibility.right ? "显示中" : "已隐藏"})`}
              icon={<PanelRight />}
              active={panelLayout.visibility.right}
              onClick={panelLayout.toggleRight}
            />
          </div>
        </div>
      </div>

      <div
        className="workspace"
        ref={panelLayout.workspaceRef}
        style={{
          gridTemplateColumns: workspaceColumns,
        }}
      >
        {panelLayout.visibility.left ? (
          <>
            <TrackSidebar
              project={project}
              activeVoice={activeVoice}
              onSetActive={setActiveVoice}
              onUpdateTrack={handleUpdateTrack}
            />
            <PanelResizeHandle
              orientation="vertical"
              label="调整声部面板宽度"
              value={panelLayout.sizes.left}
              min={panelLayout.limits.left.min}
              max={panelLayout.limits.left.max}
              defaultValue={DEFAULT_PANEL_SIZES.left}
              direction={1}
              onResize={panelLayout.setLeft}
            />
          </>
        ) : null}
        <section
          className="editor-area"
          style={{
            gridTemplateRows: editorAreaRows,
          }}
        >
          <PianoRoll
            project={project}
            activeVoice={activeVoice}
            tool={effectiveTool}
            gridTicks={gridTicks}
            pixelsPerBeat={pixelsPerBeat}
            selectedNoteIds={selectedNoteIds}
            selectedChordIds={selectedChordIds}
            chordBrush={chordBrush}
            diagnostics={activeDiagnostics}
            cadenceCandidates={cadenceAnalysis.cadenceCandidates}
            playheadTick={playheadTick}
            isPlaying={isPlaying}
            followPlayhead={followPlayhead}
            onDisengageFollow={() => setFollowPlayhead(false)}
            loopEnabled={loopEnabled}
            loopStartTick={loopStartTick}
            loopEndTick={loopEndTick}
            cancelRequest={cancelEditorRequest}
            scaleGuideEnabled={scaleGuideEnabled}
            onSetPlayhead={setPlayheadTick}
            onSetPixelsPerBeat={setPixelsPerBeat}
            onSetActiveVoice={setActiveVoice}
            onSetEditorDomain={setEditorDomain}
            onInteractionActiveChange={setEditorInteractionActive}
            onSelectNotes={handleSelectNotes}
            onPreviewNote={handlePreviewNote}
            onSelectChords={handleSelectChords}
            onAddNote={handleAddNote}
            onUpdateNote={handleUpdateNote}
            onMoveNotes={handleMoveNotes}
            onDeleteNotes={handleDeleteNotes}
            onSplitNote={handleSplitNote}
            onAddChord={handleAddChord}
            onUpdateChord={handleUpdateChord}
            onMoveChords={handleMoveChords}
            onDeleteChords={handleDeleteChords}
            onSplitChord={handleSplitChord}
            onAddTimingEvent={handleAddTimingEvent}
            onUpdateTimingEvent={handleUpdateTimingEvent}
            onDeleteTimingEvent={handleDeleteTimingEvent}
            onSetLoopBoundary={setLoopBoundary}
          />
          {panelLayout.visibility.bottom ? (
            <>
              <PanelResizeHandle
                orientation="horizontal"
                label="调整底部面板高度"
                value={panelLayout.sizes.bottom}
                min={panelLayout.limits.bottom.min}
                max={panelLayout.limits.bottom.max}
                defaultValue={DEFAULT_PANEL_SIZES.bottom}
                direction={-1}
                onResize={panelLayout.setBottom}
              />
              <BottomPanel
                activeTab={bottomPanelTab}
                onTabChange={setBottomPanelTab}
                project={project}
                harmonyResult={harmonyResult}
                onSelectDiagnostic={handleDiagnostic}
                onToggleIgnoredDiagnostic={handleToggleIgnoredDiagnostic}
                onCopyDiagnostic={handleCopyDiagnostic}
                developerMode={developerMode.enabled}
                revision={history.revision}
                playheadTick={playheadTick}
                isPlaying={isPlaying}
                selectedNoteIds={selectedNoteIds}
                onSelectScoreNote={handleScorePreviewNoteSelection}
                onOpenScoreDialog={() => setScorePreviewOpen(true)}
              />
            </>
          ) : null}
        </section>
        {panelLayout.visibility.right ? (
          <>
            <PanelResizeHandle
              orientation="vertical"
              label="调整属性面板宽度"
              value={panelLayout.sizes.right}
              min={panelLayout.limits.right.min}
              max={panelLayout.limits.right.max}
              defaultValue={DEFAULT_PANEL_SIZES.right}
              direction={-1}
              onResize={panelLayout.setRight}
            />
            <Inspector
              project={project}
              activeVoice={activeVoice}
              selectedNote={selectedNote}
              selectedChord={selectedChord}
              selectedChordIds={selectedChordIds}
              selectedChordCount={selectedChordIds.size}
              developerMode={developerMode.enabled}
              chordBrush={chordBrush}
              cadenceCandidates={cadenceAnalysis.cadenceCandidates}
              playheadTick={playheadTick}
              audioStatus={audioMessage}
              soundFontSize={
                soundFontSizeBytes ? formatByteSize(soundFontSizeBytes) : undefined
              }
              soundFontLoad={
                soundFontProgress
                  ? {
                      percent:
                        soundFontProgress.totalBytes > 0
                          ? Math.round(
                              (soundFontProgress.completedBytes /
                                soundFontProgress.totalBytes) *
                                100,
                            )
                          : 0,
                      detail: [
                        `文件 ${formatByteSize(soundFontProgress.fileSizeBytes)}`,
                        soundFontProgress.requiredMemoryBytes
                          ? `建议可用 ${formatByteSize(soundFontProgress.requiredMemoryBytes)}`
                          : undefined,
                        soundFontProgress.availableMemoryBytes
                          ? `当前可用 ${formatByteSize(soundFontProgress.availableMemoryBytes)}`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    }
                  : undefined
              }
              onUpdateProject={handleUpdateProject}
              onUpdateInstructions={handleUpdateInstructions}
              onAddEditableRange={handleAddEditableRange}
              onUpdateEditableRange={handleUpdateEditableRange}
              onDeleteEditableRange={handleDeleteEditableRange}
              onAddPhraseBoundary={handleAddPhraseBoundary}
              onDeletePhraseBoundary={handleDeletePhraseBoundary}
              onUpdateNote={handleUpdateNote}
              onUpdateChord={handleUpdateChord}
              onDeleteChords={handleDeleteChords}
              onAddCadenceAnnotation={handleAddCadenceAnnotation}
              onUpdateCadenceAnnotation={handleUpdateCadenceAnnotation}
              onDeleteCadenceAnnotation={handleDeleteCadenceAnnotation}
              onUpdateChordBrush={handleUpdateChordBrush}
              onUpdateChordTrack={handleUpdateChordTrack}
              onAddTimingEvent={handleAddTimingEvent}
              onUpdateTimingEvent={handleUpdateTimingEvent}
              onDeleteTimingEvent={handleDeleteTimingEvent}
              onUpdateAudio={(masterVolume) =>
                history.commit(
                  replaceProject(project, (draft) => {
                    draft.audio.masterVolume = masterVolume;
                  }),
                )
              }
              onUpdateTrack={handleUpdateTrack}
              onChooseSoundFont={() => void handleChooseSoundFont()}
              onUseDefaultSoundFont={() => void handleUseDefaultSoundFont()}
              onOpenMidiOut={() => setMidiOutOpen(true)}
            />
          </>
        ) : null}
      </div>

      {confirmation ? (
        <ConfirmDialog
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          cancelLabel={confirmation.cancelLabel}
          onConfirm={() => answerConfirmation(true)}
          onCancel={() => answerConfirmation(false)}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsDialog
          bindings={shortcutSettings.bindings}
          onSetBinding={shortcutSettings.setBinding}
          onClearBinding={shortcutSettings.clearBinding}
          onResetBinding={shortcutSettings.resetBinding}
          onResetAll={shortcutSettings.resetAllBindings}
          profileTitle={project.ruleProfile.title}
          ruleHitCounts={ruleHitCounts}
          ruleSeverities={resolvedRuleProfile.severities}
          ruleConfigs={resolvedRuleProfile.configs}
          ruleExceptions={resolvedRuleProfile.exceptions}
          onSetRuleSeverity={setRuleSeverity}
          onSetRuleConfig={setRuleConfig}
          onSetRuleException={setRuleException}
          onResetRule={resetRule}
          onResetAllRules={resetAllRules}
          onImportRuleProfile={() => void handleImportRuleProfile()}
          onExportRuleProfile={() => void handleExportRuleProfile()}
          onSetDefaultRuleProfile={handleSetDefaultRuleProfile}
          externalRulePackages={externalRuleLibrary.packages}
          externalRuleReferences={project.ruleProfile.external}
          externalRuleFailures={externalRuleFailures}
          externalRuleLibraryLoading={externalRuleLibrary.loading}
          externalRuleLibraryError={externalRuleLibrary.error}
          onImportExternalRulePackage={() =>
            void handleImportExternalRulePackage()
          }
          onMountExternalRulePackage={mountExternalRulePackage}
          onRemoveExternalRulePackage={(installedPackage) =>
            void handleRemoveExternalRulePackage(installedPackage)
          }
          onSetExternalRuleEnabled={(reference, enabled) =>
            updateExternalRuleReference(reference, { enabled })
          }
          onSetExternalRuleSeverity={(reference, severity) =>
            updateExternalRuleReference(reference, { severity })
          }
          onSetExternalRuleConfig={setExternalRuleConfig}
          onSetExternalRuleException={setExternalRuleException}
          onResetExternalRule={resetExternalRule}
          developerMode={developerMode.enabled}
          onSetDeveloperMode={developerMode.setEnabled}
          showRuleTestEntry={developerMode.showRuleTestEntry}
          onSetShowRuleTestEntry={developerMode.setShowRuleTestEntry}
          scaleGuideEnabled={scaleGuideEnabled}
          onSetScaleGuideEnabled={setScaleGuideEnabled}
          followPlayhead={followPlayhead}
          onSetFollowPlayhead={setFollowPlayhead}
          pausePlayheadBehavior={pausePlayheadBehavior}
          onSetPausePlayheadBehavior={setPausePlayheadBehavior}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {chordInferenceOpen ? (
        <ChordInferenceDialog
          project={project}
          playheadTick={playheadTick}
          selectedNoteIds={selectedNoteIds}
          selectedChordIds={selectedChordIds}
          onClose={() => setChordInferenceOpen(false)}
          onApply={handleChordInferenceApply}
        />
      ) : null}
      {scorePreviewOpen ? (
        <ScorePreviewDialog
          project={project}
          revision={history.revision}
          playheadTick={playheadTick}
          isPlaying={isPlaying}
          selectedNoteIds={selectedNoteIds}
          onClose={() => setScorePreviewOpen(false)}
          onSelectNote={handleScorePreviewNoteSelection}
        />
      ) : null}
      {exportOpen ? (
        <ExportDialog
          project={project}
          onClose={() => setExportOpen(false)}
          onExportMidi={(options) => {
            setExportOpen(false);
            void handleExportMidi(options);
          }}
          onExportMusicXml={(options) => {
            setExportOpen(false);
            void handleExportMusicXml(options);
          }}
        />
      ) : null}
      {midiOutOpen ? (
        <MidiOutDialog
          isOpen={midiOutOpen}
          onClose={() => setMidiOutOpen(false)}
        />
      ) : null}
      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}
    </main>
  );
}

export default AppShell;
