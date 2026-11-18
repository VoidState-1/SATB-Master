import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Focus, Maximize2, Music2, Pause, Play, Square, ZoomIn, ZoomOut } from "lucide-react";
import type { BoundAuditCase, BoundAuditItem } from "../../domain/audit";
import type { ProjectDocument } from "../../domain/project";
import { buildScorePreviewModel } from "../../domain/notation";
import { toMidi } from "../../domain/pitch";
import { audioEngine } from "../../audio/audioEngine";
import { usePlaybackController } from "../../app/controllers/usePlaybackController";
import { loadVexFlow, renderScorePreview } from "../scorePreview";

import "./audit-evidence.css";

const readOnlyHistory = { commit() {} };
export function AuditScore({ auditCase, selected, project: suppliedProject, showNotice }: { auditCase: BoundAuditCase; selected?: BoundAuditItem; project?: ProjectDocument; showNotice(message: string): void }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [scale, setScale] = useState(1);
  const [wholeScore, setWholeScore] = useState(false);
  const [warning, setWarning] = useState("");
  const project = suppliedProject ?? selected?.project ?? auditCase.project;
  const toTick = Math.min(selected?.toTick ?? project.lengthTicks, project.lengthTicks);
  const fromTick = Math.min(selected?.fromTick ?? 0, toTick - 1);
  const playbackProject = useMemo(() => ({ ...project, loop: { enabled: true, startTick: fromTick, endTick: toTick } }), [project, fromTick, toTick]);
  const playback = usePlaybackController({ project: playbackProject, history: readOnlyHistory, soundFont: { kind: "default", name: "SATB Master 默认音色" }, gridTicks: project.ppq / 4, showNotice });
  const setPlayhead = playback.setPlayheadTick;
  useEffect(() => { setPlayhead(fromTick); }, [fromTick, setPlayhead]);
  const model = useMemo(() => {
    const model = buildScorePreviewModel(project);
    if (wholeScore || !selected) return model;
    const first = Math.max(0, model.measures.findIndex((m) => m.toTick > fromTick) - 1);
    const last = model.measures.findIndex((m) => m.fromTick >= toTick);
    return { ...model, measures: model.measures.slice(first, Math.max(first + 1, Math.min(first + 8, (last < 0 ? model.measures.length : last) + 1))) };
  }, [project, selected, fromTick, toTick, wholeScore]);
  useEffect(() => {
    const element = host.current?.parentElement;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const preview = useCallback(({ sourceNoteId, voiceId }: { sourceNoteId: string; voiceId: string }) => {
    const track = project.satbTracks.find((t) => t.id === voiceId);
    const note = track?.notes.find((n) => n.id === sourceNoteId);
    if (track && note) void audioEngine.previewNote(toMidi(note.pitch), track.voice).catch(() => showNotice("音符试听不可用"));
  }, [project, showNotice]);
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    setWarning("");
    void loadVexFlow().then((vexflow) => {
      if (!active || !host.current) return;
      const rendered = renderScorePreview(host.current, model, { scale, availableWidth: width, onNoteClick: preview }, vexflow);
      cleanup = rendered.cleanup;
      for (const ref of rendered.noteElementRefs) {
        if (selected?.noteIds.has(ref.sourceNoteId)) {
          ref.element.classList.add("audit-note-focus");
          ref.element.dataset.auditSelected = "true";
        }
      }
      setWarning([...model.warnings, ...rendered.warnings].map((w) => w.message).join("；"));
    }).catch((error) => { if (active) setWarning(error instanceof Error ? error.message : "谱面渲染失败"); });
    return () => { active = false; cleanup?.(); };
  }, [model, scale, width, selected, preview]);
  return <section className="audit-score-card" aria-label="转写谱面">
    <div className="audit-card-heading audit-evidence-toolbar">
      <div className="audit-card-label"><Music2 size={15} aria-hidden="true" /><strong>转写五线谱</strong>{selected && <span className="audit-evidence-marker score" title="绿色为审计范围" aria-label="绿色为审计范围" />}</div>
      <div className="audit-score-transport" role="group" aria-label="谱面试听">
        <button className={`audit-evidence-icon ${playback.isPlaying ? "is-active" : ""}`} aria-label={playback.isPlaying ? "暂停试听" : "循环试听此段"} title={playback.isPlaying ? "暂停试听" : "循环试听此段"} onClick={() => void playback.handlePlay()}>{playback.isPlaying ? <Pause size={15} /> : <Play size={15} />}<span className="audit-evidence-sr">{playback.isPlaying ? "暂停试听" : "循环试听此段"}</span></button>
        <button className="audit-evidence-icon" aria-label="停止" title="停止试听" onClick={() => { playback.handleStop(); playback.setPlayheadTick(fromTick); }}><Square size={14} /></button>
      </div>
      <div className="audit-inline-controls" role="group" aria-label="谱面视图">
        <button className="audit-evidence-icon" aria-label={wholeScore ? "问题附近" : "查看全谱"} title={wholeScore ? "显示问题附近" : "查看全谱"} aria-pressed={wholeScore} onClick={() => setWholeScore((v) => !v)}>{wholeScore ? <Focus size={15} /> : <Maximize2 size={15} />}</button>
        <button className="audit-evidence-icon" aria-label="缩小谱面" title="缩小谱面" disabled={scale <= .75} onClick={() => setScale((v) => Math.max(.75, v - .15))}><ZoomOut size={15} /></button>
        <output className="audit-evidence-scale" aria-label="谱面缩放">{Math.round(scale * 100)}%</output>
        <button className="audit-evidence-icon" aria-label="放大谱面" title="放大谱面" disabled={scale >= 1.5} onClick={() => setScale((v) => Math.min(1.5, v + .15))}><ZoomIn size={15} /></button>
      </div>
    </div>
    <div className="audit-score-scroll"><div ref={host} className="audit-score-surface" /></div>
    {warning && <p className="audit-warning" role="status">{warning}</p>}
    {playback.audioMessage && <p className="audit-evidence-audio" role="status">{playback.audioMessage}</p>}
  </section>;
}
