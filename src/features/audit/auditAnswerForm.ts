import {
  auditAnswer, auditQuestionAnswered, effectiveAuditQuestions, missingAuditQuestions,
  type AuditItem, type AuditItemReview, type AuditDecision,
} from "../../domain/audit";

export function auditAnswerForm(item: AuditItem, review: AuditItemReview) {
  const questions = effectiveAuditQuestions(item);
  const proposal = item.category === "proposal" && !item.questions?.length;
  const recordedDecision = review.decision;
  // 旧方案可能只存了批准决定。回看时恢复相应选项，避免把旧审批改写成一般回答。
  const legacyVerdict = proposal && (recordedDecision === "accept" || recordedDecision === "reject" || recordedDecision === "needs-evidence");
  const answers = review.answers?.length ? review.answers : legacyVerdict ? [{ id: "proposal-verdict", value: recordedDecision }] : [];
  const verdict = proposal ? auditAnswer(answers, "proposal-verdict") : undefined;
  const requiredComplete = missingAuditQuestions(questions, answers).length === 0;
  const hasStructuredAnswer = questions.some(question => auditQuestionAnswered(question, auditAnswer(answers, question.id)));
  const complete = review.comment.trim() !== "" || (hasStructuredAnswer && requiredComplete);
  let decision: AuditDecision | undefined;
  if (complete) decision = verdict === "accept" || verdict === "reject" || verdict === "needs-evidence" ? verdict : "answered";
  return { questions, proposal, answers, decision, requiredComplete };
}
