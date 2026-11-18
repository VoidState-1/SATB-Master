import { Focus, Maximize2, ScanLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AuditCase, AuditItem } from "../../domain/audit";
import { locateSourceBeats, nearestSourceBeat, sourceBeatAt } from "../../domain/audit/sourceAnchors";
import type { ProjectDocument } from "../../domain/project";
import { buildMeasures } from "../../domain/time";
import "./audit-evidence.css";
import "./audit-source-cursor.css";

interface AuditSourceProps {
  source: AuditCase["source"];
  title: string;
  region?: AuditItem["sourceRegion"];
  project: ProjectDocument;
  cursorTick: number;
  onCursorTickChange: (tick: number) => void;
}

export function AuditSource({ source, title, region, project, cursorTick, onCursorTickChange }: AuditSourceProps) {
  const [zoom, setZoom] = useState(100);
  const [focus, setFocus] = useState(Boolean(region));
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const [failed, setFailed] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const anchors = useMemo(() => source.beatAnchors?.length ? locateSourceBeats(source.beatAnchors, buildMeasures(project), true) : [], [project, source.beatAnchors]);
  const { beat, row } = sourceBeatAt(anchors, cursorTick);
  let crop = region;
  const activeRow = beat ?? row;
  if (region && activeRow && (activeRow.bottom <= region.y || activeRow.top >= region.y + region.height ||
    (beat && (beat.x < region.x || beat.x > region.x + region.width)))) {
    crop = { x: 0, y: activeRow.top, width: 1, height: activeRow.bottom - activeRow.top };
  }
  const view = focus && crop ? {
    x: Math.max(0, crop.x - .025), y: Math.max(0, crop.y - .025),
    right: Math.min(1, crop.x + crop.width + .025), bottom: Math.min(1, crop.y + crop.height + .025),
  } : { x: 0, y: 0, right: 1, bottom: 1 };
  const width = view.right - view.x;
  const height = view.bottom - view.y;
  const visible = anchors.filter((anchor) => anchor.x >= view.x && anchor.x <= view.right && anchor.bottom > view.y && anchor.top < view.bottom);
  const left = (x: number) => `${100 * (x - view.x) / width}%`;
  const top = (y: number) => `${100 * (y - view.y) / height}%`;
  useEffect(() => {
    const pane = scroll.current;
    if (!pane || !marker.current) return;
    const pos = marker.current.getBoundingClientRect();
    const box = pane.getBoundingClientRect();
    if (pos.left < box.left || pos.left >= box.left + pane.clientWidth) pane.scrollLeft += pos.left - box.left - pane.clientWidth / 2;
    if (pos.bottom < box.top || pos.top >= box.top + pane.clientHeight) pane.scrollTop += (pos.top + pos.bottom) / 2 - box.top - pane.clientHeight / 2;
  }, [cursorTick, zoom, focus, natural, source.image]);
  const precision = beat ? beat.position : row ? "已定位到谱行" : anchors.length ? "当前拍未标定" : region ? "条目框选 · 未标拍点" : "未标拍点";
  return <section className="audit-source-card" aria-label="教材原图">
    <div className="audit-card-heading audit-evidence-toolbar">
      <div className="audit-card-label"><ScanLine size={15} aria-hidden="true" /><strong>教材原图</strong>{region && <span className="audit-evidence-marker source" title="橙框为定位范围" aria-label="橙框为定位范围" />}{source.image && !failed && <span className="audit-source-precision">{precision}</span>}</div>
      <div className="audit-inline-controls">
        {region && <button className="audit-evidence-icon" aria-label={focus ? "完整裁图" : "定位标记"} title={focus ? "显示完整裁图" : "聚焦定位范围"} aria-pressed={focus} onClick={() => setFocus((value) => !value)}>{focus ? <Maximize2 size={15} /> : <Focus size={15} />}</button>}
        <label title="原图缩放"><input aria-label="原图缩放" type="range" min="60" max="200" step="10" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /><output className="audit-evidence-scale">{zoom}%</output></label>
      </div>
    </div>
    {failed && <p className="audit-warning" role="status">原图无法解码，请要求模型重新提供清晰裁图。</p>}
    {source.image && !failed ? <div className="audit-source-scroll" ref={scroll}><div className="audit-source-image" data-has-beats={visible.length > 0} style={{ width: `${zoom}%`, maxWidth: `calc(var(--audit-source-fit-height) * ${(natural.width * width) / (natural.height * height) * zoom / 100})`, aspectRatio: `${natural.width * width} / ${natural.height * height}` }}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const found = nearestSourceBeat(visible, view.x + width * (event.clientX - bounds.left) / bounds.width, view.y + height * (event.clientY - bounds.top) / bounds.height);
        if (found) onCursorTickChange(found.tick);
      }}>
      <img alt={`${title} 教材原图`} src={source.image} onError={() => setFailed(true)} onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} style={{ position: "absolute", width: `${100 / width}%`, left: `${-100 * view.x / width}%`, top: `${-100 * view.y / height}%` }} />
      {region && <div className="audit-source-region" style={{ left: `${100 * (region.x - view.x) / width}%`, top: `${100 * (region.y - view.y) / height}%`, width: `${100 * region.width / width}%`, height: `${100 * region.height / height}%` }} />}
      {row && <span aria-hidden="true" className="audit-source-row" style={{ top: top(row.top), height: `${100 * (row.bottom - row.top) / height}%` }} />}
      {visible.map((anchor) => <button key={anchor.position} type="button" className="audit-source-beat" data-audit-source-tick={anchor.tick}
        aria-label={`原谱拍点 ${anchor.position}`} aria-pressed={anchor.tick === cursorTick}
        style={{ left: left(anchor.x), top: top(anchor.top), height: `${100 * (anchor.bottom - anchor.top) / height}%` }}
        onClick={(event) => { event.stopPropagation(); onCursorTickChange(anchor.tick); }} />)}
      {beat && <span ref={marker} aria-hidden="true" className="audit-source-cursor" style={{ left: left(beat.x), top: top(beat.top), height: `${100 * (beat.bottom - beat.top) / height}%` }} />}
    </div></div> : !failed && <p className="audit-muted">本条未提供原图。仅凭重绘谱面不能核准识谱，请要求模型补充裁图。</p>}
  </section>;
}
