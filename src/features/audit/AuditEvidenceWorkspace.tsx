import { useCallback, useState } from "react";
import { BookOpen, BookOpenCheck, ChevronDown, FileMusic, Image as ImageIcon, Piano } from "lucide-react";
import type { ConfirmationState } from "../../app/controllers/useConfirmationController";
import type { AuditItemReview, AuditReviewPatch, BoundAuditCase, BoundAuditItem, ReviewRecord } from "../../domain/audit";
import type { ProjectDocument } from "../../domain/project";
import { AuditAnalysis } from "./AuditAnalysis";
import { AuditBeatInspector } from "./AuditBeatInspector";
import { AuditOpinion } from "./AuditOpinion";
import { AuditProjectEditor } from "./AuditProjectEditor";
import { AuditScore } from "./AuditScore";
import { AuditSource } from "./AuditSource";
import { shortDecisionLabels } from "./auditLabels";

const views = [
  { id: "source", name: "原谱", icon: ImageIcon },
  { id: "score", name: "转写谱", icon: FileMusic },
  { id: "roll", name: "钢琴卷帘", icon: Piano },
] as const;
type View = typeof views[number]["id"];
interface Props {
  auditCase: BoundAuditCase;
  selected?: BoundAuditItem;
  review?: AuditItemReview;
  sourceReview: ReviewRecord;
  onSourceChange(patch: AuditReviewPatch): void;
  onProjectChange?(project: ProjectDocument): void;
  confirmation?: ConfirmationState;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
  showNotice(message: string): void;
}

function initialView(selected: BoundAuditItem | undefined, hasImage: boolean): View {
  if (selected?.item.category === "transcription" && hasImage) return "source";
  const rule = selected?.item.program?.ruleId ?? "";
  if (selected?.item.category === "diagnostic" && /parallel|contrary|crossing|overlap|voice-leading/i.test(rule)) return "roll";
  return "score";
}

export function AuditEvidenceWorkspace({ auditCase, selected, review, sourceReview, onSourceChange, onProjectChange, ...editorProps }: Props) {
  const [view, setView] = useState<View>(() => initialView(selected, !!auditCase.data.source.image));
  const [compare, setCompare] = useState(false);
  const [baseline, setBaseline] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [tick, setTick] = useState(selected?.fromTick ?? 0);
  const original = selected?.project ?? auditCase.project;
  const project = baseline ? auditCase.project : review?.project ?? original;
  const cursorTick = Math.min(tick, Math.max(0, project.lengthTicks - 1));
  const onCursorTickChange = useCallback((value: number) => {
    if (Number.isFinite(value)) setTick(Math.max(0, Math.min(Math.round(value), project.lengthTicks - 1)));
  }, [project.lengthTicks]);
  const cursor = { cursorTick, onCursorTickChange };
  const reference = <AuditSource source={auditCase.data.source} title={auditCase.data.title}
    region={selected?.item.sourceRegion} project={project} {...cursor} />;
  const score = <AuditScore auditCase={auditCase} selected={baseline ? undefined : selected} project={project} showNotice={editorProps.showNotice} {...cursor} />;
  const editor = <AuditProjectEditor key={baseline ? "baseline" : "copy"} initialProject={project}
    originalProject={baseline ? auditCase.project : original} selected={baseline ? undefined : selected}
    filename={auditCase.data.id + "-" + (baseline ? "source" : selected?.item.id ?? "source")}
    label={baseline ? "谱例提交基准" : undefined} onProjectChange={baseline ? undefined : onProjectChange} {...editorProps} {...cursor} />;
  const pairLabel = view === "source" ? "对照转写谱" : "对照原谱";
  const content = <>
    <div className="audit-view-controls">
      <div className="audit-center-tabs" role="tablist" aria-label="审计视图" onKeyDown={event => {
        const i = views.findIndex(v => v.id === view);
        const target = event.key === "Home" ? 0 : event.key === "End" ? 2
          : event.key === "ArrowRight" ? (i + 1) % 3 : event.key === "ArrowLeft" ? (i + 2) % 3 : -1;
        if (target < 0) return;
        event.preventDefault();
        setView(views[target].id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[target].focus();
      }}>
        {views.map(({ id, name, icon: Icon }) => <button key={id} id={`audit-tab-${id}`} role="tab"
          aria-selected={view === id} aria-label={name} aria-controls="audit-evidence-panel" tabIndex={view === id ? 0 : -1}
          onClick={() => setView(id)}><Icon size={14} />{name}</button>)}
      </div>
      {auditCase.data.source.image && <label className="audit-compare-control"><input type="checkbox" checked={compare}
        aria-label={pairLabel} onChange={event => setCompare(event.target.checked)} />{pairLabel}</label>}
    </div>
    <div id="audit-evidence-panel" role="tabpanel" aria-labelledby={`audit-tab-${view}`} className="audit-media-panes">
      <div>{view === "source" ? reference : view === "score" ? score : editor}</div>
      {compare && auditCase.data.source.image && <div>{view === "source" ? score : reference}</div>}
    </div>
    <AuditBeatInspector project={project} selected={baseline ? undefined : selected} {...cursor} />
  </>;

  return <>
    <header className="audit-pane-head audit-case-bar">
      <div className="audit-case-heading"><BookOpen size={14} aria-hidden="true" /><h1>{auditCase.data.title}</h1>
        <details className="audit-citation"><summary>来源<ChevronDown size={12} /></summary>
          <div><strong>{auditCase.data.source.title}</strong>{auditCase.data.source.locator && <p>{auditCase.data.source.locator}</p>}</div>
        </details>
      </div>
      <div className="audit-view-actions">
        {baseline && <button className="audit-ghost" onClick={() => setBaseline(false)}>返回条目副本</button>}
        <button className={`audit-source-toggle is-${sourceReview.decision}`} aria-label="谱例转写复核" aria-expanded={sourceOpen}
          aria-controls="audit-source-review" onClick={() => setSourceOpen(!sourceOpen)}><BookOpenCheck size={14} />转写复核<span className="audit-source-state">{shortDecisionLabels[sourceReview.decision]}</span></button>
      </div>
    </header>
    <div className="audit-evidence-body">
      {sourceOpen && <section className="audit-source-review" id="audit-source-review" aria-label="谱例转写复核">
        <div className="audit-card-heading"><strong>谱例基准工程</strong><button className="audit-ghost" onClick={() => {
          setBaseline(true); setView("roll"); setSourceOpen(false);
        }}>查看基准工程</button></div>
        <AuditOpinion mode="source" record={sourceReview} onChange={onSourceChange} />
      </section>}
      {baseline && <p className="audit-draft-note">正在查看谱例基准工程（只读）</p>}
      {!baseline && review?.project && <p className="audit-draft-note">当前条目副本已修改</p>}
      {selected ? <AuditAnalysis item={selected.item}>{content}</AuditAnalysis> : content}
    </div>
  </>;
}
