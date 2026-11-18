import { useId } from "react";
import {
  auditAnswer, setAuditAnswer, type AuditAnswer, type AuditAnswerRecord, type AuditQuestion,
} from "../../domain/audit";

interface Props {
  questions: readonly AuditQuestion[];
  answers?: readonly AuditAnswerRecord[];
  onChange(answers: AuditAnswerRecord[]): void;
}

export function AuditQuestions({ questions, answers = [], onChange }: Props) {
  const prefix = useId();
  return <div className="audit-answer-questions">
    {questions.map(question => {
      const value = auditAnswer(answers, question.id);
      const suggested = question.suggested;
      const change = (next: AuditAnswer) => onChange(setAuditAnswer(answers, question.id, next));
      return <fieldset key={question.id} data-question-id={question.id}>
        <legend>{question.label}{question.type === "multiple" && <small>可多选</small>}{question.required && questions.length > 1 && <small>必答</small>}</legend>
        {question.type === "text" ? <>
          <textarea aria-label={question.label} rows={2} placeholder={question.placeholder} maxLength={20_000}
            value={typeof value === "string" ? value : ""} onChange={event => change(event.target.value)} />
          {typeof suggested === "string" && suggested !== "" && suggested !== value &&
            <button className="audit-suggested-text" type="button" onClick={() => change(suggested)}>采用建议：{suggested}</button>}
        </> : <div className="audit-answer-options">
          {question.options?.map(option => {
            const isSingle = question.type === "single";
            const selected = Array.isArray(value) ? value : [];
            const recommended = Array.isArray(suggested) ? suggested.includes(option.id) : suggested === option.id;
            return <label key={option.id}>
              <input type={isSingle ? "radio" : "checkbox"} name={`${prefix}-${question.id}`} value={option.id}
                checked={isSingle ? value === option.id : selected.includes(option.id)}
                onChange={event => change(isSingle ? option.id : event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id))} />
              <span>{option.label}</span>{recommended && <small>模型建议</small>}
            </label>;
          })}
        </div>}
      </fieldset>;
    })}
  </div>;
}
