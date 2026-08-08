import { useCallback, useMemo, useState } from "react";
import {
  BellRing,
  Clipboard,
  Copy,
  Download,
  Eraser,
  FilePlus2,
  FolderOpen,
  Magnet,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
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
  ZoomIn,
  ZoomOut,
  X,
  Scissors,
} from "lucide-react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DiagnosticsPanel } from "../features/diagnostics/DiagnosticsPanel";
import { IconButton } from "../components/IconButton";
import { Inspector } from "../features/inspector/Inspector";
import { PanelResizeHandle } from "../components/PanelResizeHandle";
import { PianoRoll } from "../features/editor/PianoRoll";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { TrackSidebar } from "../features/tracks/TrackSidebar";
import { replaceProject } from "../domain/editing";
import type { HarmonyDiagnostic } from "../domain/harmony";
import { createEmptyProject, type ProjectDocument } from "../domain/model";
import { buildMeasures, formatPosition } from "../domain/time";
import { loadNewProjectRuleProfile } from "../domain/ruleProfile";
import {
  DEFAULT_PANEL_SIZES,
  PANEL_RESIZER_SIZE,
  usePanelLayout,
} from "../hooks/usePanelLayout";
import { useDeveloperMode } from "../hooks/useDeveloperMode";
import { useExternalRuleLibrary } from "../hooks/useExternalRuleLibrary";
import { useShortcutBindings } from "../hooks/useShortcutBindings";
import { useConfirmationController } from "./controllers/useConfirmationController";
import { useHarmonyController } from "./controllers/useHarmonyController";
import { useFileWorkflow } from "./controllers/useFileWorkflow";
import { useEditorCommands } from "./controllers/useEditorCommands";
import { usePlaybackController } from "./controllers/usePlaybackController";
import { useKeyboardController } from "./controllers/useKeyboardController";
import { useProjectController } from "./controllers/useProjectController";
import { useWindowController } from "./controllers/useWindowController";
import { formatShortcutBinding } from "../shortcuts/shortcutRegistry";

const GRID_OPTIONS = [
  { label: "1/4", ticks: 960 },
  { label: "1/8", ticks: 480 },
  { label: "1/16", ticks: 240 },
  { label: "1/32", ticks: 120 },
];

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
  const initialProject = useMemo(() => createProjectWithRuleProfileTemplate(), []);
  const { history, project, editor, resetWorkspace } =
    useProjectController(initialProject);
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
  const panelLayout = usePanelLayout();
  const shortcutSettings = useShortcutBindings();
  const developerMode = useDeveloperMode();
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
    initialSoundFont: initialProject.audio.soundFont,
    gridTicks,
    showNotice,
  });
  const { confirmation, requestConfirmation, answerConfirmation } =
    useConfirmationController();
  const windowController = useWindowController({
    isDirty: history.isDirty,
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
    handleAddChord,
    handleUpdateChord,
    handleMoveChords,
    handleDeleteChords,
    handleSplitChord,
    handleUpdateChordBrush,
    handleUpdateChordTrack,
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
  const { filePath, handleNew, handleOpen, handleSave, handleExportMidi } =
    useFileWorkflow({
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
    handlePlay,
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

  const measureCount = buildMeasures(project).length;
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
              icon={windowController.isMaximized ? <Minimize2 /> : <Maximize2 />}
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
            icon={<Download />}
            onClick={() => void handleExportMidi()}
          />
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
            onClick={() => void handlePlay()}
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
              setPixelsPerBeat((value) => Math.max(42, value - 10))
            }
          />
          <span className="zoom-value">{pixelsPerBeat}</span>
          <IconButton
            label="放大时间轴"
            icon={<ZoomIn />}
            onClick={() =>
              setPixelsPerBeat((value) => Math.min(140, value + 10))
            }
          />
        </div>
      </div>

      <div
        className="workspace"
        ref={panelLayout.workspaceRef}
        style={{
          gridTemplateColumns: `${panelLayout.sizes.left}px ${PANEL_RESIZER_SIZE}px minmax(0, 1fr) ${PANEL_RESIZER_SIZE}px ${panelLayout.sizes.right}px`,
        }}
      >
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
        <section
          className="editor-area"
          style={{
            gridTemplateRows: `minmax(0, 1fr) ${PANEL_RESIZER_SIZE}px ${panelLayout.sizes.bottom}px`,
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
            diagnostics={harmonyResult.diagnostics}
            playheadTick={playheadTick}
            loopEnabled={loopEnabled}
            loopStartTick={loopStartTick}
            loopEndTick={loopEndTick}
            cancelRequest={cancelEditorRequest}
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
          <PanelResizeHandle
            orientation="horizontal"
            label="调整问题面板高度"
            value={panelLayout.sizes.bottom}
            min={panelLayout.limits.bottom.min}
            max={panelLayout.limits.bottom.max}
            defaultValue={DEFAULT_PANEL_SIZES.bottom}
            direction={-1}
            onResize={panelLayout.setBottom}
          />
          <DiagnosticsPanel
            project={project}
            result={harmonyResult}
            onSelect={handleDiagnostic}
          />
        </section>
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
          onUpdateNote={handleUpdateNote}
          onUpdateChord={handleUpdateChord}
          onDeleteChords={handleDeleteChords}
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
        />
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
          onClose={() => setSettingsOpen(false)}
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
