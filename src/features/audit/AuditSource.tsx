import { ScanLine } from "lucide-react";
import { useState } from "react";
import type { AuditCase, AuditItem } from "../../domain/audit";

export function AuditSource({ source, title, region }: { source: AuditCase["source"]; title: string; region?: AuditItem["sourceRegion"] }) {
  const [zoom, setZoom] = useState(100);
  const [focus, setFocus] = useState(Boolean(region));
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const [failed, setFailed] = useState(false);
  const view = focus && region ? {
    x: Math.max(0, region.x - .025), y: Math.max(0, region.y - .025),
    right: Math.min(1, region.x + region.width + .025), bottom: Math.min(1, region.y + region.height + .025),
  } : { x: 0, y: 0, right: 1, bottom: 1 };
  const width = view.right - view.x;
  const height = view.bottom - view.y;
  return <section className="audit-source-card">
    <div className="audit-card-heading"><div className="audit-card-label"><ScanLine size={16} /><strong>教材原图</strong>{region && <span>橙框为定位范围</span>}</div>
      <div className="audit-inline-controls">{region && <button onClick={() => setFocus((value) => !value)}>{focus ? "完整裁图" : "定位标记"}</button>}<label title="原图缩放">{zoom}% <input aria-label="原图缩放" type="range" min="60" max="200" step="10" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label></div>
    </div>
    {failed && <p className="audit-warning" role="status">原图无法解码，请要求模型重新提供清晰裁图。</p>}
    {source.image && !failed ? <div className="audit-source-scroll"><div className="audit-source-image" style={{ width: `${zoom}%`, maxWidth: `calc(var(--audit-source-fit-height) * ${(natural.width * width) / (natural.height * height) * zoom / 100})`, aspectRatio: `${natural.width * width} / ${natural.height * height}` }}>
      <img alt={`${title} 教材原图`} src={source.image} onError={() => setFailed(true)} onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} style={{ position: "absolute", width: `${100 / width}%`, left: `${-100 * view.x / width}%`, top: `${-100 * view.y / height}%` }} />
      {region && <div className="audit-source-region" style={{ left: `${100 * (region.x - view.x) / width}%`, top: `${100 * (region.y - view.y) / height}%`, width: `${100 * region.width / width}%`, height: `${100 * region.height / height}%` }} />}
    </div></div> : !failed && <p className="audit-muted">本条未提供原图。仅凭重绘谱面不能核准识谱，请要求模型补充裁图。</p>}
  </section>;
}
