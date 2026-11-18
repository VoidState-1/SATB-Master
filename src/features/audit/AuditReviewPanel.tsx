import { ChevronLeft, ChevronRight } from "lucide-react";
import { missingAuditQuestions, type AuditItem, type AuditItemReview, type AuditReviewPatch } from "../../domain/audit";
import { AuditQuestions } from "./AuditQuestions";
import { AuditOpinion } from "./AuditOpinion";
import "./audit-review.css";

interface Props {
  item: AuditItem;
  review: AuditItemReview;
  index: number;
  total: number;
  onNavigate(offset: number): void;
  onChange(patch: AuditReviewPatch): void;
}

export function AuditReviewPanel({ item, review, index, total, onNavigate, onChange }: Props) {
  const missing = missingAuditQuestions(item.questions, review.answers).length;
  return <>
    <header className="audit-panel-bar">
      <h2>审计意见</h2>
      <nav aria-label="浏览筛选结果">
        <button aria-label="上一条" title="上一条" disabled={index === 0} onClick={() => onNavigate(-1)}><ChevronLeft size={16} /></button>
        <span>{index + 1} / {total}</span>
        <button aria-label="下一条" title="下一条" disabled={index + 1 >= total} onClick={() => onNavigate(1)}><ChevronRight size={16} /></button>
      </nav>
    </header>
    <div className="audit-review-scroll is-writing">
      {Boolean(item.questions?.length) && <AuditQuestions questions={item.questions!} answers={review.answers} onChange={answers => onChange({ answers })} />}
      <section className="audit-human-review"><h4>人工结论</h4><AuditOpinion mode={item.category === "proposal" ? "proposal" : "item"} record={review} onChange={onChange} missing={missing} /></section>
    </div>
  </>;
}
