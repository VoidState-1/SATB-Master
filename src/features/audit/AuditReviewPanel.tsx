import { ChevronLeft, ChevronRight, ClipboardPen } from "lucide-react";
import type { AuditItem, AuditItemReview, AuditReviewPatch } from "../../domain/audit";
import { auditAnswerForm } from "./auditAnswerForm";
import { AuditQuestions } from "./AuditQuestions";
import { shortDecisionLabels } from "./auditLabels";
import "./audit-review.css";

interface Props {
  item: AuditItem;
  review: AuditItemReview;
  index: number;
  total: number;
  hasNextPending: boolean;
  onNavigate(offset: number): void;
  onChange(patch: AuditReviewPatch): void;
  onSubmit(patch: AuditReviewPatch): void;
}

export function AuditReviewPanel({ item, review, index, total, hasNextPending, onNavigate, onChange, onSubmit }: Props) {
  const { questions, proposal, answers, decision, requiredComplete } = auditAnswerForm(item, review);
  const oneChoice = questions.length === 1 && questions[0].type === "single";
  const submitted = review.decision !== "pending";
  const last = index + 1 >= total;

  function submitAnswer() {
    if (submitted) {
      if (!last) onNavigate(1);
      return;
    }
    if (decision) onSubmit({ decision });
  }

  return <>
    <header className="audit-pane-head audit-panel-bar">
      <h2><ClipboardPen size={15} aria-hidden="true" />我的意见</h2>
      <nav aria-label="浏览筛选结果">
        <button type="button" aria-label="上一条" title="上一条" disabled={index === 0} onClick={() => onNavigate(-1)}><ChevronLeft size={16} /></button>
        <span>{index + 1} / {total}</span>
        <button type="button" aria-label="下一条" title="下一条" disabled={last} onClick={() => onNavigate(1)}><ChevronRight size={16} /></button>
      </nav>
    </header>
    <div className="audit-review-scroll">
      {questions.length > 0 &&
        <AuditQuestions questions={questions} answers={answers}
          onChange={next => onChange(oneChoice ? { answers: next, comment: "", decision: "pending" } : { answers: next, decision: "pending" })} />}
      <label className="audit-free-answer"><span>自填答案</span>
        <textarea aria-label="自填答案" rows={3} maxLength={20_000} value={review.comment}
          placeholder={questions.length ? "也可以直接写下你的判断" : "写下你的判断"}
          onChange={event => {
            const comment = event.target.value;
            // 单选与自由作答是两种回答方式，尤其不能把自填意见误作批准方案。
            onChange(oneChoice ? { comment, answers: [], decision: "pending" } : { comment, decision: "pending" });
          }} />
      </label>
    </div>
    <footer className="audit-review-footer" data-decision={review.decision}>
      {submitted
        ? <button type="button" className="audit-defer" aria-label="撤回本条答案" onClick={() => onChange({ decision: "pending" })}>{shortDecisionLabels[review.decision]} · 撤回</button>
        : item.category !== "proposal" && <button type="button" className="audit-defer" onClick={() => onSubmit({ decision: "needs-evidence" })}>请模型补证</button>}
      {!submitted && item.category === "proposal" && !proposal && <details className="audit-proposal-actions">
        <summary>方案处理</summary>
        <div role="group" aria-label="修复方案处理">
          <button type="button" disabled={!requiredComplete} onClick={() => onSubmit({ decision: "accept" })}>批准此修复方案</button>
          {!requiredComplete && <small>完成必答题后可批准</small>}
          <button type="button" onClick={() => onSubmit({ decision: "reject" })}>拒绝此修复方案</button>
          <button type="button" onClick={() => onSubmit({ decision: "needs-evidence" })}>请模型补证</button>
        </div>
      </details>}
      <button type="button" className="audit-submit" aria-label="提交审计答案"
        disabled={submitted ? last : !decision} onClick={submitAnswer}>
        {submitted ? last ? "已提交" : "下一条" : hasNextPending ? "提交并下一条" : "提交答案"}
        {(submitted ? !last : hasNextPending) && <ChevronRight size={14} aria-hidden="true" />}
      </button>
    </footer>
  </>;
}
