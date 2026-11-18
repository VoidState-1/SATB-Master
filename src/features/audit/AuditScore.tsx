import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Focus, Maximize2, Music2, Pause, Play, Square, ZoomIn, ZoomOut } from "lucide-react";
import type { BoundAuditCase, BoundAuditItem } from "../../domain/audit";
import type { ProjectDocument } from "../../domain/project";
import { buildScorePreviewModel } from "../../domain/notation";
import { formatChordRegion } from "../../domain/chords";
import { toMidi } from "../../domain/pitch";
import { audioEngine } from "../../audio/audioEngine";
import { useAuditPlayback } from "./useAuditPlayback";
import { loadVexFlow, renderScorePreview, type ScoreMeasureLayout, type ScoreNoteSelection } from "../scorePreview";

import "./audit-evidence.css";
import "./audit-score-cursor.css";

const readOnlyHistory = { commit() {} };
function scoreX(layout: ScoreMeasureLayout, tick: number) {
  const points = layout.anchors;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (tick <= b.tick) return a.x + (b.x - a.x) * (tick - a.tick) / (b.tick - a.tick);
  }
  return layout.right;
}

interface Props {
  auditCase: BoundAuditCase;
  selected?: BoundAuditItem;
  project?: ProjectDocument;
  cursorTick: number;
  onCursorTickChange(tick: number): void;
  showNotice(message: string): void;
}

export function AuditScore({ auditCase, selected, project: suppliedProject, cursorTick, onCursorTickChange, showNotice }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [scale, setScale] = useState(1);
  const [wholeScore, setWholeScore] = useState(false);
  const [warning, setWarning] = useState("");
  const layouts = useRef<ScoreMeasureLayout[]>([]);
  const cursorLine = useRef<HTMLDivElement | null>(null);
  const currentCursor = useRef(cursorTick);
  currentCursor.current = cursorTick;
  const changeCursor = useRef(onCursorTickChange);
  changeCursor.current = onCursorTickChange;
  const project = suppliedProject ?? selected?.project ?? auditCase.project;
  const toTick = Math.min(selected?.toTick ?? project.lengthTicks, project.lengthTicks);
  const fromTick = Math.min(selected?.fromTick ?? 0, toTick - 1);
  const playbackProject = useMemo(() => ({ ...project, loop: { enabled: true, startTick: fromTick, endTick: toTick } }), [project, fromTick, toTick]);
  const playback = useAuditPlayback({ project: playbackProject, history: readOnlyHistory, soundFont: { kind: "default", name: "SATB Master 默认音色" }, gridTicks: project.ppq / 4, playheadTick: cursorTick, onPlayheadChange: onCursorTickChange, showNotice });
  const fullModel = useMemo(() => buildScorePreviewModel(project), [project]);
  const measures = fullModel.measures;
  const localStart = Math.max(0, measures.findIndex(m => m.toTick > fromTick) - 1);
  const afterSelection = measures.findIndex(m => m.fromTick >= toTick);
  const localEnd = Math.min(measures.length, localStart + 8, afterSelection < 0 ? measures.length : afterSelection + 1);
  const currentMeasure = measures.findIndex(m => cursorTick < m.toTick);
  const followIndex = currentMeasure < 0 ? measures.length - 1 : currentMeasure;
  const outsideLocal = followIndex < localStart || followIndex >= localEnd;
  const first = outsideLocal ? Math.max(0, followIndex - 1) : localStart;
  const end = outsideLocal ? Math.min(measures.length, first + 3) : localEnd;
  const model = useMemo(() => {
    if (wholeScore || !selected) return fullModel;
    return { ...fullModel, measures: measures.slice(first, end) };
  }, [fullModel, measures, selected, first, end, wholeScore]);
  useEffect(() => {
    const element = host.current?.parentElement;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const preview = useCallback(({ sourceNoteId, voiceId, tick }: ScoreNoteSelection) => {
    changeCursor.current(tick);
    const track = project.satbTracks.find((t) => t.id === voiceId);
    const note = track?.notes.find((n) => n.id === sourceNoteId);
    if (track && note) void audioEngine.previewNote(toMidi(note.pitch), track.voice).catch(() => showNotice("音符试听不可用"));
  }, [project, showNotice]);
  const moveLine = useCallback(() => {
    const tick = currentCursor.current;
    const target = layouts.current.find(m => m.measure.fromTick <= tick && tick < m.measure.toTick)
      ?? (tick === project.lengthTicks ? layouts.current.at(-1) : undefined);
    const line = cursorLine.current;
    const scroll = host.current?.parentElement;
    if (!line || !scroll) return;
    if (!target) { line.remove(); return; }
    if (line.parentElement !== target.host) target.host.append(line);
    line.style.left = scoreX(target, tick) + "px";
    line.dataset.tick = String(tick);
    const rect = line.getBoundingClientRect(), view = scroll.getBoundingClientRect();
    if (rect.top < view.top || rect.top >= view.bottom) scroll.scrollTop += rect.top - view.top;
    if (rect.left < view.left || rect.left >= view.right) scroll.scrollLeft += rect.left - view.left - scroll.clientWidth / 2;
  }, [project.lengthTicks]);
  useEffect(moveLine, [cursorTick, moveLine]);
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    setWarning("");
    void loadVexFlow().then((vexflow) => {
      if (!active || !host.current) return;
      const positions: ScoreMeasureLayout[] = [];
      const rendered = renderScorePreview(host.current, model, { scale, availableWidth: width, onNoteClick: preview, onMeasureLayout: pos => positions.push(pos) }, vexflow);
      cleanup = rendered.cleanup;
      layouts.current = positions;
      const line = document.createElement("div");
      line.className = "audit-score-playhead";
      line.setAttribute("aria-hidden", "true");
      cursorLine.current = line;
      const systems = new Map<HTMLDivElement, { ticks: number[]; xs: number[] }>();
      for (const position of positions) {
        const { host: system, measure } = position;
        let staff = systems.get(system);
        if (!staff) { staff = { ticks: [], xs: [] }; systems.set(system, staff); }
        const beatTicks = project.ppq * 4 / measure.denominator;
        for (let tick = measure.fromTick, beat = 1; tick < measure.toTick; tick += beatTicks, beat++) {
          const x = scoreX(position, tick);
          staff.ticks.push(tick); staff.xs.push(x);
          const mark = document.createElement("button");
          mark.type = "button"; mark.className = "audit-score-beat";
          mark.style.left = x + "px"; mark.dataset.auditBeatTick = String(tick);
          mark.textContent = beat === 1 ? measure.number + ":1" : String(beat);
          mark.setAttribute("aria-label", "第 " + measure.number + " 小节第 " + beat + " 拍");
          mark.onclick = () => changeCursor.current(tick);
          system.append(mark);
        }
        const regions = project.chordTrack.regions.filter(r => r.startTick < measure.toTick && r.startTick + r.durationTicks > measure.fromTick);
        for (const region of regions) {
          if (region.startTick < measure.fromTick && staff.ticks[0] !== measure.fromTick) continue;
          const start = Math.max(region.startTick, measure.fromTick);
          const label = document.createElement("span"), chord = formatChordRegion(project, region);
          label.className = "audit-score-chord";
          label.textContent = chord.functional === "?" ? chord.absolute : chord.functional;
          label.title = chord.spokenDescription;
          const x = scoreX(position, start);
          const endTick = Math.min(measure.toTick, region.startTick + region.durationTicks);
          label.style.left = x + "px";
          label.style.maxWidth = Math.max(1, scoreX(position, endTick) - x) + "px";
          system.append(label);
        }
      }
      for (const [system, staff] of systems) {
        system.dataset.auditTimeline = "true";
        system.onclick = event => {
          if ((event.target as Element).closest("button,.score-note")) return;
          const x = event.clientX - system.getBoundingClientRect().left;
          const closest = staff.xs.reduce((best, next, index, xs) => Math.abs(x - next) < Math.abs(x - xs[best]) ? index : best, 0);
          if (staff.ticks.length) changeCursor.current(staff.ticks[closest]);
        };
      }
      moveLine();
      for (const ref of rendered.noteElementRefs) {
        if (selected?.noteIds.has(ref.sourceNoteId)) {
          ref.element.classList.add("audit-note-focus");
          ref.element.dataset.auditSelected = "true";
        }
      }
      setWarning([...model.warnings, ...rendered.warnings].map((w) => w.message).join("；"));
    }).catch((error) => { if (active) setWarning(error instanceof Error ? error.message : "谱面渲染失败"); });
    return () => { active = false; cleanup?.(); layouts.current = []; cursorLine.current = null; };
  }, [model, scale, width, selected, preview, moveLine, project]);
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
