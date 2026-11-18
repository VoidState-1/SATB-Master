import { useMemo } from "react";
import { ChevronLeft, ChevronRight, LocateFixed } from "lucide-react";
import type { BoundAuditItem } from "../../domain/audit";
import { chordAtTick, formatChordRegion } from "../../domain/chords";
import { formatSpelledPitch } from "../../domain/pitch";
import { VOICE_CONFIG, type ProjectDocument } from "../../domain/project";
import { buildMeasures, measureAtTick } from "../../domain/time";

const cadenceNames = { full: "全终止", half: "半终止", supplementary: "补充终止", deceptive: "阻碍终止" };
interface Props {
  project: ProjectDocument;
  selected?: BoundAuditItem;
  cursorTick: number;
  onCursorTickChange(tick: number): void;
}

export function AuditBeatInspector({ project, selected, cursorTick, onCursorTickChange }: Props) {
  const measures = useMemo(() => buildMeasures(project), [project.ppq, project.meterEvents, project.lengthTicks]);
  const measure = measureAtTick(measures, cursorTick);
  if (!measure) return null;
  const beat = Math.floor((cursorTick - measure.startTick) / (project.ppq * 4 / measure.denominator));
  const remainder = cursorTick - measure.beatTicks[beat];
  const current = measure.number + ":" + (beat + 1) + (remainder ? ":" + remainder : "");
  const previous = remainder ? measure.beatTicks[beat] : measure.beatTicks[beat - 1] ?? measures[measure.number - 2]?.beatTicks.at(-1);
  const next = measure.beatTicks[beat + 1] ?? measures[measure.number]?.startTick;
  const chord = chordAtTick(project, cursorTick);
  const name = chord && formatChordRegion(project, chord);
  const cadence = project.chordTrack.cadenceAnnotations.find(c => !c.stale && c.fromTick <= cursorTick && cursorTick < c.toTick);
  const chords = selected?.annotations?.filter(a => a.kind === "chord" && a.fromTick <= cursorTick && cursorTick < a.toTick) ?? [];
  // 同一争议的各条终止括线使用相同的时间轴，即便其起点相差一拍也能直接比较。
  const inQuestion = selected && selected.fromTick <= cursorTick && cursorTick < selected.toTick;
  const cadences = selected?.annotations?.filter(a => a.kind === "cadence" &&
    a.fromTick < (inQuestion ? selected.toTick : measure.endTick) && (inQuestion ? selected.fromTick : measure.startTick) < a.toTick) ?? [];
  const start = Math.min(measure.startTick, ...cadences.map(a => a.fromTick));
  const end = Math.max(measure.endTick, ...cadences.map(a => a.toTick));
  return <section className="audit-beat-inspector" aria-label="拍点与标注" data-audit-cursor-tick={cursorTick}>
    <div className="audit-beat-summary">
      <div className="audit-beat-controls">
        <button aria-label="上一拍" title="上一拍" disabled={previous === undefined} onClick={() => previous !== undefined && onCursorTickChange(previous)}><ChevronLeft size={14} /></button>
        <output aria-label="当前拍点" title="小节:拍:拍内 tick">{current}</output>
        <button aria-label="下一拍" title="下一拍" disabled={next === undefined} onClick={() => next !== undefined && onCursorTickChange(next)}><ChevronRight size={14} /></button>
        {selected && <button aria-label="回到争议起点" title="回到争议起点" onClick={() => onCursorTickChange(selected.fromTick)}><LocateFixed size={14} /></button>}
      </div>
      <div className="audit-beat-voices">{project.satbTracks.map(track => {
        const note = track.notes.find(n => n.startTick <= cursorTick && cursorTick < n.startTick + n.durationTicks);
        return <span key={track.id} title={VOICE_CONFIG[track.voice].name} style={{ borderColor: VOICE_CONFIG[track.voice].color }}>{track.shortName} {note ? formatSpelledPitch(note.pitch) : "休止"}</span>;
      })}</div>
    </div>
    {(name || cadence) && <div className="audit-beat-annotation"><small>工程标注</small>
      {name && <strong>{name.functional === "?" ? name.absolute : name.functional}</strong>}
      {cadence && <span>{cadenceNames[cadence.kind]}</span>}
    </div>}
    {[...chords, ...cadences].map((a, i) => <div className="audit-beat-annotation" key={i}>
      <small>{a.source === "model" ? "模型标注" : "程序推导"}</small>
      <strong>{a.label}</strong>
      <button className="audit-annotation-range" title="定位标注起点" onClick={() => onCursorTickChange(a.fromTick)}>{a.range.join(" → ")}</button>
      {a.context && <span>{a.context}</span>}
      {a.kind === "cadence" && <div className="audit-cadence-axis" aria-hidden="true">
        <i style={{ left: `${100 * (a.fromTick - start) / (end - start)}%`, width: `${100 * (a.toTick - a.fromTick) / (end - start)}%` }} />
        <b style={{ left: `${100 * (cursorTick - start) / (end - start)}%` }} />
      </div>}
    </div>)}
  </section>;
}
