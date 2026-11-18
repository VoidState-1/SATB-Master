import type { AuditAnswer, AuditAnswerRecord, AuditItem, AuditQuestion } from "./types";

export function effectiveAuditQuestions(item: AuditItem): AuditQuestion[] {
  if (item.questions?.length || item.category !== "proposal") return item.questions ?? [];
  return [{ id: "proposal-verdict", type: "single", label: "修复方案", options: [
    { id: "accept", label: "批准此修复方案" }, { id: "reject", label: "拒绝此修复方案" },
    { id: "needs-evidence", label: "需要补证" },
  ] }];
}

export function auditAnswer(answers: readonly AuditAnswerRecord[] | undefined, id: string): AuditAnswer | undefined {
  return answers?.find((answer) => answer.id === id)?.value;
}

export function auditQuestionAnswered(question: AuditQuestion, answer: AuditAnswer | undefined): boolean {
  if (question.type === "multiple") return Array.isArray(answer) && answer.length > 0;
  return typeof answer === "string" && answer.trim().length > 0;
}

export function missingAuditQuestions(questions: readonly AuditQuestion[] = [], answers: readonly AuditAnswerRecord[] = []) {
  return questions.filter((question) => question.required && !auditQuestionAnswered(question, auditAnswer(answers, question.id)));
}

export function validateAuditAnswers(questions: readonly AuditQuestion[] = [], answers: readonly AuditAnswerRecord[] = []) {
  const ids = new Set<string>();
  for (const answer of answers) {
    const question = questions.find((q) => q.id === answer.id);
    if (!question || ids.has(answer.id)) throw new Error(`预审回答 ${answer.id} 不存在或重复`);
    ids.add(answer.id);
    if (question.type === "multiple") {
      if (!Array.isArray(answer.value) || new Set(answer.value).size !== answer.value.length || answer.value.some((id) => !question.options?.some((option) => option.id === id))) throw new Error(`${question.label}: 多选回答包含无效选项`);
    } else if (typeof answer.value !== "string" || (question.type === "single" && answer.value !== "" && !question.options?.some((option) => option.id === answer.value))) {
      throw new Error(`${question.label}: 回答类型或选项无效`);
    }
  }
}

export function setAuditAnswer(answers: readonly AuditAnswerRecord[] = [], id: string, value: AuditAnswer): AuditAnswerRecord[] {
  return [...answers.filter((answer) => answer.id !== id), { id, value: Array.isArray(value) ? [...value] : value }];
}

/** 只有用户主动采用时才调用; 不覆盖已填写的人工回答。 */
export function suggestedAuditAnswers(questions: readonly AuditQuestion[], current: readonly AuditAnswerRecord[] = []) {
  let answers = [...current];
  for (const question of questions) {
    if (question.suggested !== undefined && !auditQuestionAnswered(question, auditAnswer(answers, question.id))) answers = setAuditAnswer(answers, question.id, question.suggested);
  }
  return answers;
}
