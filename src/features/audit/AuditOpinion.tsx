import { useId } from "react";
import { Check, CircleDashed, CircleHelp, X } from "lucide-react";
import type { ReviewRecord } from "../../domain/audit";

const verdicts = [
  { value: "accept", label: "核准转写", Icon: Check },
  { value: "reject", label: "转写需修改", Icon: X },
  { value: "needs-evidence", label: "需要补证", Icon: CircleHelp },
] as const;

interface Props {
  mode: "source";
  record: ReviewRecord;
  onChange(patch: Partial<ReviewRecord>): void;
}

export function AuditOpinion({ mode, record, onChange }: Props) {
  const name = useId();
  return <div className={`audit-opinion audit-opinion-${mode}`}>
    <div className="audit-decision" role="radiogroup" aria-label="谱例转写核准">
      <div className="audit-decision-head">
        <span className="audit-field-label">谱例转写核准</span>
        <label className="audit-decision-pending" title="撤回为待审">
          <input type="radio" name={name} value="pending" checked={record.decision === "pending"} onChange={() => onChange({ decision: "pending" })} />
          <CircleDashed size={12} aria-hidden="true" /><span>待审</span>
        </label>
      </div>
      <div className="audit-decision-options">
        {verdicts.map(({ value, label, Icon }) =>
          <label key={value} className={`audit-decision-option is-${value}`}>
            <input type="radio" name={name} value={value} checked={record.decision === value} onChange={() => onChange({ decision: value })} />
            <span className="audit-decision-glyph" aria-hidden="true"><Icon size={13} strokeWidth={2.6} /></span>
            <span className="audit-decision-text">{label}</span>
          </label>)}
      </div>
    </div>
    <label className="audit-opinion-comment"><span className="audit-field-label">转写复核备注</span>
      <textarea aria-label="转写复核备注" rows={2} maxLength={20_000} value={record.comment}
        onChange={event => onChange({ comment: event.target.value })} placeholder="记录音符、时值、声部或来源疑点…" />
    </label>
    {record.updatedAt && <small className="audit-opinion-time">记录于 {new Date(record.updatedAt).toLocaleString()}</small>}
  </div>;
}
