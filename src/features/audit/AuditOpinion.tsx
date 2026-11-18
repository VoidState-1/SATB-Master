import { AUDIT_ATTRIBUTIONS, AUDIT_DECISIONS, type ReviewRecord } from "../../domain/audit";

const decisionLabels = { pending: "待审", accept: "认可模型判断", reject: "不认可模型判断", "needs-evidence": "需要补证" };
const attributionLabels = { uncertain: "尚不确定", program: "程序问题", transcription: "转写/标注问题", reference: "参考答案问题", policy: "规则口径差异", context: "上下文不足", none: "无需修改" };
export function AuditOpinion({ record, onChange, mode = "item", missing = 0 }: { record: ReviewRecord; onChange(patch: Partial<ReviewRecord>): void; mode?: "item" | "source" | "proposal"; missing?: number }) {
  const labels = mode === "source" ? { ...decisionLabels, accept: "核准转写", reject: "转写需修改" } : mode === "proposal" ? { ...decisionLabels, accept: "批准此修复方案", reject: "拒绝此修复方案" } : decisionLabels;
  return <div className={`audit-opinion audit-opinion-${mode}`}>
    <label>{mode === "source" ? "谱例转写核准" : mode === "proposal" ? "方案审阅决定" : "你的审计结论"}
      <select aria-label={mode === "source" ? "谱例转写核准" : mode === "proposal" ? "方案审阅决定" : "审计结论"} value={record.decision} onChange={(e) => onChange({ decision: e.target.value as ReviewRecord["decision"] })}>
        {AUDIT_DECISIONS.map((key) => <option key={key} value={key} disabled={key === "accept" && missing > 0}>{labels[key]}</option>)}
      </select>
    </label>
    {missing > 0 && <p className="audit-muted">完成剩余 {missing} 道必填题后可选择认可。</p>}
    {mode === "item" && <label>问题归因<select aria-label="问题归因" value={record.attribution} onChange={(e) => onChange({ attribution: e.target.value as ReviewRecord["attribution"] })}>{AUDIT_ATTRIBUTIONS.map((key) => <option key={key} value={key}>{attributionLabels[key]}</option>)}</select></label>}
    <label>{mode === "source" ? "转写复核备注" : "意见与补证要求"}<textarea aria-label={mode === "source" ? "转写复核备注" : "审计意见"} rows={mode === "source" ? 2 : 3} maxLength={20_000} value={record.comment} onChange={(e) => onChange({ comment: e.target.value })} placeholder={mode === "source" ? "记录音符、时值、声部或来源疑点…" : "说明你的判断、适用条件或需要模型补查的依据…"} /></label>
    {record.updatedAt && <small>记录于 {new Date(record.updatedAt).toLocaleString()}</small>}
  </div>;
}
