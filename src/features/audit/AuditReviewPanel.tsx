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
  const submitted = review.decision !== "pending";
  const last = index + 1 >= total;

  const canSubmit = submitted ? !last : Boolean(decision);
  const freeOverrideHint = !submitted && !requiredComplete && review.comment.trim() !== "";
  const disabledHint = !submitted && !decision ? "完成上方必答题或填写自填答案后可提交" : "";

  function submitAnswer() {
    if (submitted) {
      if (!last) onNavigate(1);
      return;
    }
    if (decision) onSubmit({ decision });
  }

  return <div className="audit-review-shell" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canSubmit) {
      event.preventDefault();
      submitAnswer();
    }
  }}>
    <header className="audit-pane-head audit-panel-bar">
      <h2><ClipboardPen size={15} aria-hidden="true" />我的意见</h2>
      <nav aria-label="浏览筛选结果">
        <button type="button" aria-label="上一条" title="上一条 (Alt+↑)" disabled={index === 0} onClick={() => onNavigate(-1)}><ChevronLeft size={16} /></button>
        <span>{index + 1} / {total}</span>
        <button type="button" aria-label="下一条" title="下一条 (Alt+↓)" disabled={last} onClick={() => onNavigate(1)}><ChevronRight size={16} /></button>
      </nav>
    </header>
    <div className="audit-review-scroll">
      {questions.length > 0 &&
        <AuditQuestions questions={questions} answers={answers}
          onChange={next => onChange({ answers: next, decision: "pending" })} />}
      <label className="audit-free-answer"><span>自填答案</span>
        <textarea aria-label="自填答案" rows={2} maxLength={20_000} value={review.comment}
          placeholder={questions.length ? "补充说明，或直接写下你的独立判断" : "写下你的判断"}
          onChange={event => onChange({ comment: event.target.value, decision: "pending" })} />
        {freeOverrideHint && <small className="audit-answer-hint">将作为独立自填意见提交（未完成上方必选题）</small>}
      </label>
    </div>
    <footer className="audit-review-footer" data-decision={review.decision}>
      {disabledHint && <p className="audit-submit-hint">{disabledHint}</p>}
      {!submitted && item.category === "proposal" && !proposal && <div className="audit-proposal-inline" role="group" aria-label="修复方案处理">
        <button type="button" className="audit-proposal-btn is-accept" disabled={!requiredComplete}
          title={!requiredComplete ? "完成必答题后可批准" : "批准此修复方案"}
          onClick={() => onSubmit({ decision: "accept" })}>批准方案</button>
        <button type="button" className="audit-proposal-btn is-reject" onClick={() => onSubmit({ decision: "reject" })}>拒绝方案</button>
        <button type="button" className="audit-proposal-btn" onClick={() => onSubmit({ decision: "needs-evidence" })}>补证</button>
      </div>}
      {submitted
        ? <button type="button" className="audit-defer" aria-label="撤回本条答案" onClick={() => onChange({ decision: "pending" })}>{shortDecisionLabels[review.decision]} · 撤回</button>
        : item.category !== "proposal" && <button type="button" className="audit-defer" onClick={() => onSubmit({ decision: "needs-evidence" })}>请模型补证</button>}
      <button type="button" className="audit-submit" aria-label="提交审计答案"
        title="Ctrl+Enter 提交" disabled={!canSubmit} onClick={submitAnswer}>
        {submitted ? last ? "已提交" : "下一条" : hasNextPending ? "提交并下一条" : "提交答案"}
        {(submitted ? !last : hasNextPending) && <ChevronRight size={14} aria-hidden="true" />}
      </button>
    </footer>
  </div>;
}
