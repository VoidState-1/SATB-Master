import type { ReactNode } from "react";
import type { AuditItem } from "../../domain/audit";
import { categoryLabels, severityLabels } from "./auditLabels";
import "./audit-review.css";

const voices = { soprano: "女高音", alto: "女低音", tenor: "男高音", bass: "男低音" };

interface Props {
  item: AuditItem;
  source?: ReactNode;
  score?: ReactNode;
  editor?: ReactNode;
}

export function AuditAnalysis({ item, source, score, editor }: Props) {
  const model = (item.model.conclusion || item.model.reason) && <section className="audit-analysis-block model">
    <h4>模型判断</h4>
    <div className="audit-analysis-content"><strong>{item.model.conclusion}</strong><p>{item.model.reason}</p></div>
  </section>;
  const program = item.program && <section className="audit-analysis-block">
    <h4>程序结果</h4>
    <div className="audit-analysis-content">
      <p>{item.program.conclusion}</p>
      {(item.program.ruleId || item.program.run) && <details className="audit-run"><summary>运行信息</summary>
        {item.program.ruleId && <code>{item.program.ruleId}</code>}{item.program.run && <p>{item.program.run}</p>}
      </details>}
    </div>
  </section>;
  const references = <section className="audit-analysis-block audit-analysis-references">
    <h4>参考依据</h4>
    <div className="audit-analysis-content">{item.evidence?.length ? item.evidence.map((e, i) => <div className="audit-reference" key={i}>
      {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> : <strong>{e.title}</strong>}
      {e.locator && <small>{e.locator}</small>}{e.content && <p>{e.content}</p>}
    </div>) : <p className="audit-muted">尚未提供依据，可在意见中要求补证。</p>}</div>
  </section>;
  return <section className="audit-analysis" aria-label="条目分析">
    <header className="audit-detail-heading">
      <div className="audit-tags"><span className={`audit-badge severity-${item.severity}`}>{severityLabels[item.severity]}</span><span>{categoryLabels[item.category]}</span><code>{item.range.join(" → ")}</code></div>
      <h3>{item.title}</h3>
      {item.voices?.length ? <p className="audit-location">{item.voices.map(v => voices[v]).join("、")}</p> : null}
    </header>
    {item.question && <section className="audit-question"><h4>待裁定</h4><p>{item.question}</p></section>}
    {editor ? <>
      <div className="audit-analysis-editor">{editor}</div>
      <div className="audit-analysis-text">{program}{model}{references}</div>
    </> : <>
      {(source || model) && <div className={`audit-evidence-pair${source && model ? " has-caption" : ""}`}>
        {source && <div className="audit-evidence-media">{source}</div>}
        {model && <div className="audit-evidence-caption">{model}</div>}
      </div>}
      {(score || program) && <div className={`audit-evidence-pair${score && program ? " has-caption" : ""}`}>
        {score && <div className="audit-evidence-media">{score}</div>}
        {program && <div className="audit-evidence-caption">{program}</div>}
      </div>}
      <div className="audit-analysis-text">{references}</div>
    </>}
  </section>;
}
