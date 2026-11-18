import type { ReactNode } from "react";
import { BookMarked, Cpu, ExternalLink, Sparkles } from "lucide-react";
import type { AuditItem } from "../../domain/audit";
import { categoryLabels, severityLabels } from "./auditLabels";
import "./audit-review.css";

const voices = { soprano: "女高音", alto: "女低音", tenor: "男高音", bass: "男低音" };

interface Props {
  item: AuditItem;
  children: ReactNode;
}

export function AuditAnalysis({ item, children }: Props) {
  const model = (item.model.conclusion || item.model.reason) && <section className="audit-analysis-block model">
    <h4><Sparkles size={13} aria-hidden="true" />模型判断</h4>
    <div className="audit-analysis-content">{item.model.conclusion && <strong>{item.model.conclusion}</strong>}{item.model.reason && <p>{item.model.reason}</p>}</div>
  </section>;
  const program = item.program && <section className="audit-analysis-block program">
    <h4><Cpu size={13} aria-hidden="true" />程序结果</h4>
    <div className="audit-analysis-content">
      <p>{item.program.conclusion}</p>
      {(item.program.ruleId || item.program.run) && <details className="audit-run"><summary>运行信息</summary>
        {item.program.ruleId && <code>{item.program.ruleId}</code>}{item.program.run && <p>{item.program.run}</p>}
      </details>}
    </div>
  </section>;
  const references = <section className="audit-analysis-block audit-analysis-references">
    <h4><BookMarked size={13} aria-hidden="true" />参考依据{item.evidence?.length ? <span className="audit-block-count">{item.evidence.length}</span> : null}</h4>
    <div className="audit-analysis-content">{item.evidence?.length ? item.evidence.map((e, i) => <div className="audit-reference" key={i}>
      <span className="audit-reference-index" aria-hidden="true">{i + 1}</span>
      <div>
        {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.title}<ExternalLink size={11} aria-hidden="true" /></a> : <strong>{e.title}</strong>}
        {e.locator && <small>{e.locator}</small>}{e.content && <p>{e.content}</p>}
      </div>
    </div>) : <p className="audit-muted">尚未提供依据，可在意见中要求补证。</p>}</div>
  </section>;
  const hasVerdictSummary = Boolean(model || program);
  return <section className="audit-analysis" aria-label="条目分析">
    <header className="audit-detail-heading">
      <div className="audit-tags">
        <span className={`audit-badge severity-${item.severity}`}>{severityLabels[item.severity]}</span>
        <span className="audit-tag">{categoryLabels[item.category]}</span>
        <code className="audit-tag audit-range" title="审计范围（小节:拍）">{item.range.join(" → ")}</code>
        {item.voices?.length ? <span className="audit-tag audit-location">{item.voices.map(v => voices[v]).join("、")}</span> : null}
      </div>
      <h2>{item.question ?? item.title}</h2>
    </header>
    {hasVerdictSummary && <details className="audit-evidence-details audit-verdict-summary" open>
      <summary>模型判断与程序结果</summary>
      <div className="audit-analysis-text audit-verdict-grid">{model}{program}</div>
    </details>}
    {children}
    {item.evidence?.length ? <details className="audit-evidence-details" open><summary>教材依据 · {item.evidence.length}</summary>{references}</details> : null}
  </section>;
}
