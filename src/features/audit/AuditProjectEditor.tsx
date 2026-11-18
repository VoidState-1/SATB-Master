import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, Eraser, MousePointer2, Pencil, Play, Redo2, RotateCcw, Scissors, Square, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { ConfirmationState } from "../../app/controllers/useConfirmationController";
import { useEditorState } from "../../app/controllers/useEditorState";
import { useEditorCommands } from "../../app/controllers/useEditorCommands";
import { useKeyboardController } from "../../app/controllers/useKeyboardController";
import { usePlaybackController } from "../../app/controllers/usePlaybackController";
import { useProjectHistory } from "../../hooks/useProjectHistory";
import { useShortcutBindings } from "../../hooks/useShortcutBindings";
import type { BoundAuditItem } from "../../domain/audit";
import { formatPosition } from "../../domain/time";
import { VOICE_ORDER, VOICE_CONFIG, type ProjectDocument, type VoiceId } from "../../domain/project";
import { downloadAuditProject } from "../../services/audit";
import { GRID_OPTIONS, PianoRoll, stepTimelineZoom, type EditorTool } from "../editor";
import { SelectionInspector } from "../inspector";

const auditSoundFont = { kind: "default" as const, name: "SATB Master 默认音色" };
interface Props {
  initialProject: ProjectDocument;
  originalProject: ProjectDocument;
  selected?: BoundAuditItem;
  filename: string;
  label?: string;
  onProjectChange?(project: ProjectDocument): void;
  showNotice(message: string): void;
  confirmation?: ConfirmationState;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
}

export function AuditProjectEditor({ initialProject, originalProject, selected, filename, label = "当前条目工程", onProjectChange, showNotice, confirmation, requestConfirmation }: Props) {
  const history = useProjectHistory(initialProject);
  const project = history.project;
  const editor = useEditorState(initialProject, project);
  const [playhead, setPlayhead] = useState(selected?.fromTick ?? 0);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [showProperties, setShowProperties] = useState(true);
  const [focusSerial, setFocusSerial] = useState(0);
  const stopRef = useRef<() => void>(() => {});
  const emitted = useRef(initialProject);
  const readOnly = !onProjectChange;
  const commit = useCallback((next: ProjectDocument) => {
    if (!onProjectChange || next === project) return;
    stopRef.current();
    history.commit(next);
    emitted.current = next;
    onProjectChange(next);
  }, [history.commit, onProjectChange, project]);
  // 撤销/重做同样回填当前条目, 不依赖主工程历史。
  useLayoutEffect(() => {
    if (emitted.current === project) return;
    emitted.current = project;
    onProjectChange?.(project);
  }, [project, onProjectChange]);
  const playback = usePlaybackController({ project, history: { commit }, soundFont: auditSoundFont, gridTicks: editor.gridTicks, playheadTick: playhead, onPlayheadChange: setPlayhead, showNotice });
  stopRef.current = playback.handleStop;
  const commands = useEditorCommands({ project, history: { commit }, editor, playheadTick: playhead, setPlayheadTick: setPlayhead, showNotice });
  const shortcuts = useShortcutBindings();
  const focusRange = useMemo(() => ({ fromTick: Math.min(selected?.fromTick ?? 0, project.lengthTicks - 1), toTick: Math.min(selected?.toTick ?? project.lengthTicks, project.lengthTicks), noteIds: selected?.noteIds, requestKey: focusSerial }), [selected, focusSerial]);
  useEffect(() => {
    editor.setSelectedNoteIds(new Set(selected?.noteIds));
    if (selected?.item.voices?.[0]) editor.setActiveVoice(selected.item.voices[0]);
  }, [selected, editor.setSelectedNoteIds, editor.setActiveVoice]);
  const exportProject = useCallback(async () => { downloadAuditProject(project, filename); showNotice("已发起当前条目工程副本导出"); }, [project, filename, showNotice]);
  useKeyboardController({
    enabled: keyboardFocused && !readOnly,
    bindings: shortcuts.bindings, confirmation, settingsOpen: false,
    tool: editor.tool, editorDomain: editor.editorDomain, editorInteractionActive: editor.editorInteractionActive,
    gridTicks: editor.gridTicks, projectLengthTicks: project.lengthTicks,
    selectedNoteIds: editor.selectedNoteIds, selectedChordIds: editor.selectedChordIds,
    history, setTool: editor.setTool, setPlayheadTick: setPlayhead, setCancelEditorRequest: editor.setCancelEditorRequest,
    handleNew: async () => showNotice("当前区域编辑此条目的独立副本，其他条目保持不变"),
    handleOpen: async () => showNotice("模型工程随审计包提交，可用上方入口导入新的审计包"),
    handleSave: exportProject, handlePlay: playback.handlePlay,
    handleDeleteChords: commands.handleDeleteChords, handleDeleteNotes: commands.handleDeleteNotes,
    selectAllInEditorDomain: commands.selectAllInEditorDomain, clearSelection: commands.clearSelection,
    copySelection: commands.copySelection, cutSelection: commands.cutSelection, pasteSelection: commands.pasteSelection,
    duplicateSelection: commands.duplicateSelection, cycleActiveVoice: commands.cycleActiveVoice,
    movePlayheadByMeasure: commands.movePlayheadByMeasure, changeGridResolution: commands.changeGridResolution,
    changeTimelineZoom: commands.changeTimelineZoom, transformSelection: commands.transformSelection,
  });
  const reset = async () => {
    if (await requestConfirmation({ title: "恢复本条提交工程？", message: "只恢复当前条目的工程副本，保留审计文字和问答；结论需要重新确认。", confirmLabel: "恢复", cancelLabel: "取消" })) {
      stopRef.current();
      history.commit(originalProject);
      emitted.current = originalProject;
      onProjectChange?.(originalProject);
    }
  };
  const deleteSelection = () => editor.editorDomain === "chords" ? commands.handleDeleteChords(editor.selectedChordIds) : commands.handleDeleteNotes(editor.selectedNoteIds);
  const noteCount = project.satbTracks.reduce((n, track) => n + track.notes.length, 0);
  return <section className="audit-project-editor" aria-label="条目工程副本" data-audit-note-count={noteCount} data-audit-readonly={readOnly} onFocusCapture={() => setKeyboardFocused(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setKeyboardFocused(false); }}>
    <div className="audit-project-heading"><div><strong>{label}{readOnly ? "（只读）" : " · 独立副本"}</strong><small>{readOnly ? "提交基准保持只读，可返回条目副本试改" : "修改仅保存到本条反馈，不覆盖模型提交或其他条目"}</small></div><span>{noteCount} 个音符 · {formatPosition(project, playhead)}</span></div>
    <div className="audit-project-tools">
      <label>声部<select aria-label="工程声部" value={editor.activeVoice} onChange={(e) => editor.setActiveVoice(e.target.value as VoiceId)}>{VOICE_ORDER.map((voice) => <option key={voice} value={voice}>{VOICE_CONFIG[voice].name}</option>)}</select></label>
      {([["select", "选择", MousePointer2], ["pencil", "画笔", Pencil], ["eraser", "橡皮", Eraser], ["split", "切分", Scissors]] as const).map(([tool, label, Icon]) => <button key={tool} aria-label={`工程${label}`} className={editor.tool === tool ? "is-active" : ""} disabled={readOnly && tool !== "select"} onClick={() => editor.setTool(tool as EditorTool)}><Icon size={15} /></button>)}
      <button aria-label="工程撤销" disabled={!history.canUndo} onClick={() => { stopRef.current(); history.undo(); }}><Undo2 size={15} /></button>
      <button aria-label="工程重做" disabled={!history.canRedo} onClick={() => { stopRef.current(); history.redo(); }}><Redo2 size={15} /></button>
      <button aria-label="工程删除选中" disabled={readOnly || (!editor.selectedNoteIds.size && !editor.selectedChordIds.size)} onClick={deleteSelection}><Trash2 size={15} /></button>
      <label>网格<select aria-label="工程时值对齐" value={editor.gridTicks} onChange={(e) => editor.setGridTicks(Number(e.target.value))}>{GRID_OPTIONS.map((g) => <option key={g.ticks} value={g.ticks}>{g.label}</option>)}</select></label>
      <button aria-label="缩小工程" onClick={() => editor.setPixelsPerBeat((value) => stepTimelineZoom(value, -1))}><ZoomOut size={15} /></button>
      <button aria-label="放大工程" onClick={() => editor.setPixelsPerBeat((value) => stepTimelineZoom(value, 1))}><ZoomIn size={15} /></button>
      <button onClick={() => { setPlayhead(focusRange.fromTick); setFocusSerial((v) => v + 1); }}>定位审计范围</button>
    </div>
    <div className="audit-project-canvas">
      <PianoRoll project={project} activeVoice={editor.activeVoice} tool={editor.effectiveTool} gridTicks={editor.gridTicks} pixelsPerBeat={editor.pixelsPerBeat}
        selectedNoteIds={editor.selectedNoteIds} selectedChordIds={editor.selectedChordIds} chordBrush={editor.chordBrush} diagnostics={[]}
        focusRange={focusRange} playheadTick={playhead} isPlaying={playback.isPlaying} followPlayhead={true}
        loopEnabled={project.loop.enabled} loopStartTick={project.loop.startTick} loopEndTick={project.loop.endTick} cancelRequest={editor.cancelEditorRequest}
        onSetPlayhead={setPlayhead} onSetPixelsPerBeat={editor.setPixelsPerBeat} onSetActiveVoice={editor.setActiveVoice} onSetEditorDomain={editor.setEditorDomain}
        onInteractionActiveChange={editor.setEditorInteractionActive} onSelectNotes={commands.handleSelectNotes} onPreviewNote={commands.handlePreviewNote} onSelectChords={commands.handleSelectChords}
        onAddNote={commands.handleAddNote} onUpdateNote={commands.handleUpdateNote} onMoveNotes={commands.handleMoveNotes} onDeleteNotes={commands.handleDeleteNotes} onSplitNote={commands.handleSplitNote}
        onAddChord={commands.handleAddChord} onUpdateChord={commands.handleUpdateChord} onMoveChords={commands.handleMoveChords} onDeleteChords={commands.handleDeleteChords} onSplitChord={commands.handleSplitChord}
        onAddTimingEvent={commands.handleAddTimingEvent} onUpdateTimingEvent={commands.handleUpdateTimingEvent} onDeleteTimingEvent={commands.handleDeleteTimingEvent}
        onSetLoopBoundary={playback.setLoopBoundary} />
    </div>
    <div className="audit-project-actions">
      <button onClick={() => void playback.handlePlay()}><Play size={15} />{playback.isPlaying ? "暂停工程" : "播放工程"}</button>
      <button onClick={() => playback.handleStop()}><Square size={14} />停止工程</button>
      <button onClick={() => void exportProject()}><Download size={15} />导出此条工程</button>
      <button disabled={readOnly} onClick={() => void reset()}><RotateCcw size={14} />恢复提交工程</button>
      <button onClick={() => setShowProperties((v) => !v)}>{showProperties ? "收起选中属性" : "编辑选中属性"}</button>
    </div>
    {showProperties && <fieldset className="audit-project-properties" disabled={readOnly}><legend>选中对象属性</legend>
      <SelectionInspector project={project} selectedNote={editor.selectedNote} selectedChord={editor.selectedChord} selectedChordIds={editor.selectedChordIds} selectedChordCount={editor.selectedChordIds.size}
        developerMode={false} chordBrush={editor.chordBrush} playheadTick={playhead} cadenceCandidates={[]}
        onUpdateNote={commands.handleUpdateNote} onUpdateChord={commands.handleUpdateChord} onDeleteChords={commands.handleDeleteChords} onUpdateChordBrush={commands.handleUpdateChordBrush}
        onAddCadenceAnnotation={commands.handleAddCadenceAnnotation} onUpdateCadenceAnnotation={commands.handleUpdateCadenceAnnotation} onDeleteCadenceAnnotation={commands.handleDeleteCadenceAnnotation} />
    </fieldset>}
  </section>;
}
