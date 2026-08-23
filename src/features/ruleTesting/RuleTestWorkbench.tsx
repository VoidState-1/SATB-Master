import {
  Maximize2,
  Minimize2,
  Minus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { IconButton } from "../../components/IconButton";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { GRID_OPTIONS, PianoRoll, stepTimelineZoom } from "../../features/editor";
import { TrackSidebar } from "../../features/tracks";
import { SelectionInspector } from "../../features/inspector";
import { PanelResizeHandle } from "../../components/PanelResizeHandle";
import { RuleTestCaseList } from "./RuleTestCaseList";
import { RuleTestInspector } from "./RuleTestInspector";
import { RuleTestResultsPanel } from "./RuleTestResultsPanel";
import { RuleTestToolbar } from "./RuleTestToolbar";
import { CreateTestCaseDialog } from "./CreateTestCaseDialog";
import type { RuleTestWorkspaceController } from "../../app/controllers/useRuleTestWorkspace";
import type { ConfirmationState } from "../../app/controllers/useConfirmationController";
import type { HarmonyDiagnostic } from "../../domain/harmony";
import { buildMeasures, formatPosition } from "../../domain/time";
import { usePanelLayout, DEFAULT_PANEL_SIZES, PANEL_RESIZER_SIZE } from "../../hooks/usePanelLayout";
import { useDeveloperMode } from "../../hooks/useDeveloperMode";
import { useShortcutBindings } from "../../hooks/useShortcutBindings";
import { usePlaybackController } from "../../app/controllers/usePlaybackController";
import { useKeyboardController } from "../../app/controllers/useKeyboardController";

interface RuleTestWorkbenchProps {
  controller: RuleTestWorkspaceController;
  windowController: {
    isMaximized: boolean;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
  };
  onCreateFromProject(): void;
  onBack(): void;
  confirmation?: ConfirmationState;
  answerConfirmation(confirmed: boolean): void;
  notice?: string;
  showNotice(message: string): void;
}

function missingReferences(controller: RuleTestWorkspaceController) {
  const result = controller.lastRun?.comparison;
  return {
    notes: new Set(
      result?.missing.flatMap((item) => item.noteIds ?? []) ?? [],
    ),
    chords: new Set(
      result?.missing.flatMap((item) => item.chordIds ?? []) ?? [],
    ),
  };
}

export function RuleTestWorkbench({
  controller,
  windowController,
  onCreateFromProject,
  onBack,
  confirmation,
  answerConfirmation,
  notice,
  showNotice,
}: RuleTestWorkbenchProps) {
  const panelLayout = usePanelLayout("rule-test");
  const developerMode = useDeveloperMode();
  const shortcutSettings = useShortcutBindings();
  const [leftTab, setLeftTab] = useState<"cases" | "voices">("cases");
  const [rightTab, setRightTab] = useState<"case" | "selection">("case");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const missing = missingReferences(controller);
  const {
    editor,
    editorCommands,
    project,
    testCase,
    history,
    lastRun,
  } = controller;
  const {
    activeVoice,
    setActiveVoice,
    tool,
    setTool,
    editorDomain,
    editorInteractionActive,
    setCancelEditorRequest,
    gridTicks,
    setGridTicks,
    pixelsPerBeat,
    setPixelsPerBeat,
    selectedNoteIds,
    selectedChordIds,
    effectiveTool,
    selectedNote,
    selectedChord,
  } = editor;
  const commands = editorCommands;
  const playback = usePlaybackController({
    project,
    history: { commit: controller.commitProject },
    initialSoundFont: project.audio.soundFont,
    gridTicks,
    showNotice,
    playheadTick: controller.playheadTick,
    onPlayheadChange: controller.setPlayheadTick,
  });
  useKeyboardController({
    bindings: shortcutSettings.bindings,
    confirmation,
    settingsOpen: false,
    tool,
    editorDomain,
    editorInteractionActive,
    gridTicks,
    projectLengthTicks: project.lengthTicks,
    selectedNoteIds,
    selectedChordIds,
    history,
    setTool,
    setPlayheadTick: controller.setPlayheadTick,
    handleRunRuleTest: () => void controller.run(),
    setCancelEditorRequest,
    handleNew: async () => onCreateFromProject(),
    handleOpen: async () => void controller.open(),
    handleSave: async (forceDialog) => void controller.save(forceDialog),
    handlePlay: playback.handlePlay,
    handleDeleteChords: commands.handleDeleteChords,
    handleDeleteNotes: commands.handleDeleteNotes,
    selectAllInEditorDomain: commands.selectAllInEditorDomain,
    clearSelection: commands.clearSelection,
    copySelection: commands.copySelection,
    cutSelection: commands.cutSelection,
    pasteSelection: commands.pasteSelection,
    duplicateSelection: commands.duplicateSelection,
    cycleActiveVoice: commands.cycleActiveVoice,
    movePlayheadByMeasure: commands.movePlayheadByMeasure,
    changeGridResolution: commands.changeGridResolution,
    changeTimelineZoom: commands.changeTimelineZoom,
    transformSelection: commands.transformSelection,
  });
  const measureCount = useMemo(() => buildMeasures(project).length, [project]);
  const selectDiagnostic = (diagnostic: HarmonyDiagnostic) => {
    controller.setPlayheadTick(diagnostic.tick);
    editor.setSelectedNoteIds(new Set(diagnostic.noteIds));
    editor.setSelectedChordIds(new Set(diagnostic.chordIds));
  };
  const selectExpectation = (expectation: (typeof testCase.expected.diagnostics)[number]) => {
    controller.setSelectedExpectationId(expectation.id);
    controller.setPlayheadTick(expectation.tick);
    editor.setSelectedNoteIds(new Set(expectation.noteIds ?? []));
    editor.setSelectedChordIds(new Set(expectation.chordIds ?? []));
  };
  const resultTargets = useMemo(() => {
    const comparison = lastRun?.comparison;
    if (!comparison) return [];
    return [
      ...comparison.matches.map(({ actual }) => ({
        key: `actual:${actual.id}`,
        tick: actual.tick,
        select: () => selectDiagnostic(actual),
      })),
      ...comparison.missing.map((expected) => ({
        key: `expected:${expected.id}`,
        tick: expected.tick,
        select: () => selectExpectation(expected),
      })),
      ...comparison.unexpected.map((actual) => ({
        key: `actual:${actual.id}`,
        tick: actual.tick,
        select: () => selectDiagnostic(actual),
      })),
      ...comparison.mismatched.map(({ expected, actual }) => ({
        key: `mismatch:${expected.id}`,
        tick: actual.tick,
        select: () => selectDiagnostic(actual),
      })),
    ].sort((left, right) => left.tick - right.tick || left.key.localeCompare(right.key));
  }, [lastRun]);
  const [resultCursor, setResultCursor] = useState(-1);
  useEffect(() => setResultCursor(-1), [lastRun]);
  const navigateResult = (direction: -1 | 1) => {
    if (resultTargets.length === 0) return;
    const next =
      (resultCursor + direction + resultTargets.length) % resultTargets.length;
    resultTargets[next].select();
    setResultCursor(next);
  };
  return (
    <main className="app-shell rule-test-shell">
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
        <span className="project-title">规则测试</span>
        <span className="file-path">{testCase.title}</span>
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
      <RuleTestToolbar
        autoRun={controller.autoRun}
        runState={controller.runState}
        batchRunState={controller.batchRunState}
        hasLibrary={controller.batchTotalCount > 0}
        hasActual={Boolean(lastRun)}
        isPlaying={playback.isPlaying}
        metronomeEnabled={playback.metronomeEnabled}
        audioLevel={playback.audioLevel}
        loopEnabled={project.loop.enabled}
        loopStartLabel={formatPosition(project, project.loop.startTick)}
        loopEndLabel={formatPosition(project, project.loop.endTick)}
        gridTicks={gridTicks}
        gridOptions={GRID_OPTIONS}
        pixelsPerBeat={pixelsPerBeat}
        effectiveTool={effectiveTool}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onBack={onBack}
        onOpenDirectory={() => void controller.openDirectory()}
        onRun={() => void controller.run()}
        onSetAutoRun={controller.setAutoRun}
        onClone={controller.cloneCurrent}
        onRunLibrary={() => void controller.runLibrary()}
        onCancelLibrary={controller.cancelBatchRun}
        onAcceptAll={() => void controller.acceptAllActual()}
        onNormalize={controller.normalize}
        onUndo={history.undo}
        onRedo={history.redo}
        onCopy={commands.copySelection}
        onPaste={commands.pasteSelection}
        onDelete={() =>
          editorDomain === "chords"
            ? commands.handleDeleteChords(selectedChordIds)
            : commands.handleDeleteNotes(selectedNoteIds)
        }
        onSetTool={setTool}
        onGoToStart={() => playback.handleStop(true)}
        onPlay={() => void playback.handlePlay()}
        onStop={() => playback.handleStop()}
        onToggleLoop={playback.toggleLoop}
        onSetLoopBoundary={playback.setLoopBoundary}
        onToggleMetronome={() => playback.setMetronomeEnabled((value) => !value)}
        onChangeGrid={setGridTicks}
        onZoomOut={() => setPixelsPerBeat((value) => stepTimelineZoom(value, -1))}
        onZoomIn={() => setPixelsPerBeat((value) => stepTimelineZoom(value, 1))}
      />
      <div
        className="rule-test-workspace"
        ref={panelLayout.workspaceRef}
        style={{
          gridTemplateColumns: `${panelLayout.sizes.left}px ${PANEL_RESIZER_SIZE}px minmax(0, 1fr) ${PANEL_RESIZER_SIZE}px ${panelLayout.sizes.right}px`,
        }}
      >
        <aside className="rule-test-left-panel">
          <div className="rule-test-left-tabs">
            <button
              type="button"
              className={leftTab === "cases" ? "is-active" : ""}
              onClick={() => setLeftTab("cases")}
            >
              用例
            </button>
            <button
              type="button"
              className={leftTab === "voices" ? "is-active" : ""}
              onClick={() => setLeftTab("voices")}
            >
              声部
            </button>
          </div>
          {leftTab === "cases" ? (
            <RuleTestCaseList
              currentItem={controller.currentLibraryItem}
              items={controller.libraryItems}
              recentItems={controller.recentItems}
              libraryDirectory={controller.libraryDirectory}
              batchRunState={controller.batchRunState}
              batchCompletedCount={controller.batchCompletedCount}
              batchTotalCount={controller.batchTotalCount}
              onCreateCase={() => setCreateDialogOpen(true)}
              onOpenDirectory={() => void controller.openDirectory()}
              onSelect={(key) => void controller.openLibraryItem(key)}
              onDelete={(key) => void controller.deleteLibraryItem(key)}
            />
          ) : null}
          {leftTab === "voices" ? (
            <div className="rule-test-voice-preview">
            <TrackSidebar
              project={project}
              activeVoice={editor.activeVoice}
              onSetActive={editor.setActiveVoice}
              onUpdateTrack={commands.handleUpdateTrack}
            />
            </div>
          ) : null}
        </aside>
        <PanelResizeHandle
          orientation="vertical"
          label="调整规则测试用例面板宽度"
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
            activeVoice={editor.activeVoice}
            tool={editor.effectiveTool}
            gridTicks={editor.gridTicks}
            pixelsPerBeat={editor.pixelsPerBeat}
            selectedNoteIds={editor.selectedNoteIds}
            selectedChordIds={editor.selectedChordIds}
            chordBrush={editor.chordBrush}
            diagnostics={lastRun?.actual.diagnostics ?? []}
            missingExpectedNoteIds={missing.notes}
            missingExpectedChordIds={missing.chords}
            playheadTick={playback.playheadTick}
            loopEnabled={project.loop.enabled}
            loopStartTick={project.loop.startTick}
            loopEndTick={project.loop.endTick}
            cancelRequest={editor.cancelEditorRequest}
            onSetPlayhead={playback.setPlayheadTick}
            onSetPixelsPerBeat={editor.setPixelsPerBeat}
            onSetActiveVoice={editor.setActiveVoice}
            onSetEditorDomain={editor.setEditorDomain}
            onInteractionActiveChange={editor.setEditorInteractionActive}
            onSelectNotes={commands.handleSelectNotes}
            onPreviewNote={commands.handlePreviewNote}
            onSelectChords={commands.handleSelectChords}
            onAddNote={commands.handleAddNote}
            onUpdateNote={commands.handleUpdateNote}
            onMoveNotes={commands.handleMoveNotes}
            onDeleteNotes={commands.handleDeleteNotes}
            onSplitNote={commands.handleSplitNote}
            onAddChord={commands.handleAddChord}
            onUpdateChord={commands.handleUpdateChord}
            onMoveChords={commands.handleMoveChords}
            onDeleteChords={commands.handleDeleteChords}
            onSplitChord={commands.handleSplitChord}
            onAddTimingEvent={commands.handleAddTimingEvent}
            onUpdateTimingEvent={commands.handleUpdateTimingEvent}
            onDeleteTimingEvent={commands.handleDeleteTimingEvent}
            onSetLoopBoundary={(boundary, tick) =>
              controller.commitProject({
                ...project,
                loop: {
                  ...project.loop,
                  ...(boundary === "start"
                    ? { startTick: tick }
                    : { endTick: tick }),
                },
              })
            }
          />
          <PanelResizeHandle
            orientation="horizontal"
            label="调整规则测试结果面板高度"
            value={panelLayout.sizes.bottom}
            min={panelLayout.limits.bottom.min}
            max={panelLayout.limits.bottom.max}
            defaultValue={DEFAULT_PANEL_SIZES.bottom}
            direction={-1}
            onResize={panelLayout.setBottom}
          />
          <RuleTestResultsPanel
            project={project}
            runState={controller.runState}
            result={lastRun}
            selectedExpectationId={controller.selectedExpectationId}
            navigationCount={resultTargets.length}
            onNavigate={navigateResult}
            onSelectExpected={selectExpectation}
            onSelectActual={selectDiagnostic}
            onAddActual={controller.addActualAsExpectation}
            onUpdateSelected={controller.updateSelectedFromActual}
            onUpdateExpectedFromActual={controller.updateExpectationFromActual}
            onDeleteExpected={controller.deleteExpectation}
          />
        </section>
        <PanelResizeHandle
          orientation="vertical"
          label="调整规则测试属性面板宽度"
          value={panelLayout.sizes.right}
          min={panelLayout.limits.right.min}
          max={panelLayout.limits.right.max}
          defaultValue={DEFAULT_PANEL_SIZES.right}
          direction={-1}
          onResize={panelLayout.setRight}
        />
        <aside className="rule-test-right-panel">
          <div className="rule-test-right-tabs">
            <button
              type="button"
              className={rightTab === "case" ? "is-active" : ""}
              onClick={() => setRightTab("case")}
            >
              用例
            </button>
            <button
              type="button"
              className={rightTab === "selection" ? "is-active" : ""}
              onClick={() => setRightTab("selection")}
            >
              选中对象
            </button>
          </div>
          {rightTab === "case" ? (
            <RuleTestInspector
              testCase={testCase}
              project={project}
              selectedExpectationId={controller.selectedExpectationId}
              audioState={playback.audioState}
              audioMessage={playback.audioMessage}
              soundFontProgress={playback.soundFontProgress}
              onUpdateCase={controller.commitTestCase}
              onSetRule={controller.setTargetRule}
              onChooseSoundFont={() => void playback.handleChooseSoundFont()}
              onUseDefaultSoundFont={() =>
                void playback.handleUseDefaultSoundFont()
              }
              onSelectExpectation={controller.setSelectedExpectationId}
              onUpdateExpectation={controller.updateExpectation}
              onDeleteExpectation={controller.deleteExpectation}
            />
          ) : (
            <aside className="rule-test-selection-inspector">
              <SelectionInspector
                project={project}
                selectedNote={editor.selectedNote}
                selectedChord={editor.selectedChord}
                selectedChordIds={editor.selectedChordIds}
                selectedChordCount={editor.selectedChordIds.size}
                developerMode={developerMode.enabled}
                chordBrush={editor.chordBrush}
                playheadTick={playback.playheadTick}
                onUpdateNote={commands.handleUpdateNote}
                onUpdateChord={commands.handleUpdateChord}
                onDeleteChords={commands.handleDeleteChords}
                onUpdateChordBrush={commands.handleUpdateChordBrush}
              />
            </aside>
          )}
        </aside>
      </div>
      <div className="rule-test-statusbar">
        <span>{testCase.target.ruleId}</span>
        <span>{measureCount} 小节</span>
        <span>{formatPosition(project, playback.playheadTick)}</span>
        <span>{developerMode.enabled ? "开发者模式" : "隔离规则测试"}</span>
      </div>
      {createDialogOpen ? (
        <CreateTestCaseDialog
          initialRuleId={testCase.target.ruleId}
          libraryDirectory={controller.libraryDirectory}
          onOpenDirectory={() => void controller.openDirectory()}
          onClose={() => setCreateDialogOpen(false)}
          onCreate={async (params) => {
            const success = await controller.createTestCase(params);
            if (success) setCreateDialogOpen(false);
          }}
        />
      ) : null}
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
      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}
    </main>
  );
}
