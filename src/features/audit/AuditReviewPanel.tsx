import { useRef, useState } from "react";
import { ArrowDown, ArrowRight, BookOpen, CheckCheck, ChevronLeft, ChevronRight, CircleHelp, ListChecks, ScanLine, TextQuote } from "lucide-react";
import { missingAuditQuestions, type AuditItem, type AuditItemReview, type AuditReviewPatch } from "../../domain/audit";
import { AuditQuestions } from "./AuditQuestions";
import { AuditOpinion } from "./AuditOpinion";
import { categoryLabels, severityLabels } from "./auditLabels";

const voices = { soprano: "女高音", alto: "女低音", tenor: "男高音", bass: "男低音" };

interface Props {
  item: AuditItem;
  review: AuditItemReview;
  index: number;
  total: number;
  onNavigate(offset: number): void;
  onChange(patch: AuditReviewPatch): void;
}

export function AuditReviewPanel({ item, review, index, total, onNavigate, onChange }: Props) {
  const [writing, setWriting] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const opinion = useRef<HTMLElement>(null);
  const missing = missingAuditQuestions(item.questions, review.answers).length;
  return <>
    <header className="audit-panel-bar">
      <h2><ListChecks size={17} />条目审阅</h2>
      <nav aria-label="浏览筛选结果">
        <button aria-label="上一条" title="上一条" disabled={index === 0} onClick={() => onNavigate(-1)}><ChevronLeft size={16} /></button>
        <span>{index + 1} / {total}</span>
        <button aria-label="下一条" title="下一条" disabled={index + 1 >= total} onClick={() => onNavigate(1)}><ChevronRight size={16} /></button>
      </nav>
    </header>
    <header className="audit-detail-heading">
      <div className="audit-tags"><span className={`audit-badge severity-${item.severity}`}>{severityLabels[item.severity]}</span><span>{categoryLabels[item.category]}</span></div>
      <h3>{item.title}</h3>
      <div className="audit-location"><ScanLine size={14} /><code>{item.range.join(" → ")}</code>{item.voices?.length ? <span>{item.voices.map(v => voices[v]).join("、")}</span> : null}</div>
    </header>
    <div className="audit-review-tabs" role="tablist" aria-label="审阅内容">
      {["分析依据", "填写意见"].map((label, i) => <button key={label} role="tab" id={`audit-review-tab-${i}`} aria-controls="audit-review-content" aria-selected={Number(writing) === i} tabIndex={Number(writing) === i ? 0 : -1}
        ref={el => { tabRefs.current[i] = el; }} onClick={() => setWriting(Boolean(i))}
        onKeyDown={e => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setWriting(!writing); tabRefs.current[1-i]?.focus(); } }}>{label}</button>)}
    </div>
    <div key={writing ? "review" : "analysis"} className="audit-review-scroll" role="tabpanel" id="audit-review-content" aria-labelledby={`audit-review-tab-${Number(writing)}`} tabIndex={0}>
      {writing ? <>
        {Boolean(item.questions?.length) && <AuditQuestions questions={item.questions!} answers={review.answers} onChange={answers => onChange({ answers })} />}
        <section className="audit-human-review" ref={opinion}><h4><CheckCheck size={16} />人工结论</h4><AuditOpinion mode={item.category === "proposal" ? "proposal" : "item"} record={review} onChange={onChange} missing={missing} /></section>
      </> : <>
        {item.question && <section className="audit-question"><h4><CircleHelp size={15} />待裁定</h4><p>{item.question}</p></section>}
        {item.program && <section className="audit-analysis-block"><h4>程序结果</h4><p>{item.program.conclusion}</p>{(item.program.ruleId || item.program.run) && <details className="audit-run"><summary>运行信息</summary>{item.program.ruleId && <code>{item.program.ruleId}</code>}{item.program.run && <p>{item.program.run}</p>}</details>}</section>}
        <section className="audit-analysis-block model"><h4><TextQuote size={15} />模型判断</h4><strong>{item.model.conclusion}</strong><p>{item.model.reason}</p></section>
        <section className="audit-analysis-block"><h4><BookOpen size={15} />参考依据</h4>{item.evidence?.length ? item.evidence.map((e, i) => <div className="audit-reference" key={i}>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> : <strong>{e.title}</strong>}{e.locator && <small>{e.locator}</small>}{e.content && <p>{e.content}</p>}</div>) : <p className="audit-muted">尚未提供依据，可在意见中要求补证。</p>}</section>
      </>}
    </div>
    <footer className="audit-review-actions">{writing
      ? <button onClick={() => opinion.current?.querySelector("select")?.focus()}>定位到人工结论<ArrowDown size={16} /></button>
      : <button className="audit-primary" onClick={() => setWriting(true)}>填写本条意见<ArrowRight size={16} /></button>}</footer>
  </>;
}
