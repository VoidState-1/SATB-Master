import { useId } from "react";
import { auditAnswer, auditQuestionAnswered, setAuditAnswer, suggestedAuditAnswers, type AuditAnswer, type AuditAnswerRecord, type AuditQuestion } from "../../domain/audit";

interface Props {
  questions: readonly AuditQuestion[];
  answers?: readonly AuditAnswerRecord[];
  onChange(answers: AuditAnswerRecord[]): void;
}
function suggestedLabel(question: AuditQuestion) {
  const value = question.suggested;
  if (question.type === "text") return String(value ?? "");
  const ids = Array.isArray(value) ? value : [value];
  return ids.map((id) => question.options?.find((option) => option.id === id)?.label).filter(Boolean).join("、") || "未选择";
}

export function AuditQuestions({ questions, answers = [], onChange }: Props) {
  const prefix = useId();
  const fillable = questions.some((q) => q.suggested !== undefined && !auditQuestionAnswered(q, auditAnswer(answers, q.id)));
  return <section className="audit-preflight" aria-label="预审问答">
    <div className="audit-preflight-heading"><h3>预审问答</h3><button disabled={!fillable} onClick={() => onChange(suggestedAuditAnswers(questions, answers))}>填入未作答项</button></div>
    <p className="audit-muted">可采用模型建议，也可直接作答。</p>
    {questions.map((question) => {
      const value = auditAnswer(answers, question.id);
      const change = (value: AuditAnswer) => onChange(setAuditAnswer(answers, question.id, value));
      return <fieldset key={question.id} data-question-id={question.id}>
        <legend>{question.label}{question.required && <span className="audit-required"> · 必填</span>}</legend>
        {question.type === "text" ? <textarea rows={2} aria-label={`预审：${question.label}`} placeholder={question.placeholder} maxLength={20_000} value={typeof value === "string" ? value : ""} onChange={(e) => change(e.target.value)} /> : <div className="audit-question-options">
          {question.options?.map((option) => <label key={option.id}><input type={question.type === "single" ? "radio" : "checkbox"} name={`${prefix}-${question.id}`} value={option.id} checked={question.type === "single" ? value === option.id : Array.isArray(value) && value.includes(option.id)} onChange={(e) => {
            if (question.type === "single") change(option.id);
            else {
              const selected = Array.isArray(value) ? value : [];
              change(e.target.checked ? [...selected, option.id] : selected.filter((id) => id !== option.id));
            }
          }} /><span>{option.label}</span></label>)}
          {question.type === "single" && typeof value === "string" && value && <button className="audit-question-clear" onClick={() => change("")}>清空选择</button>}
        </div>}
        {question.suggested !== undefined && <div className="audit-question-suggestion"><span>模型建议：{suggestedLabel(question)}</span><button onClick={() => change(Array.isArray(question.suggested) ? [...question.suggested] : question.suggested!)}>采用此建议</button></div>}
      </fieldset>;
    })}
  </section>;
}
