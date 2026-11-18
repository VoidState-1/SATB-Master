import { describe, expect, it } from "vitest";
import type { AuditItem, AuditItemReview } from "../../domain/audit";
import { auditAnswerForm } from "./auditAnswerForm";

const finding: AuditItem = {
  id: "ending", title: "终止范围", category: "cadence", severity: "info", range: ["1:1", "2:1"],
  model: { conclusion: "半终止", reason: "待确定起拍" },
};
const review: AuditItemReview = { id: "ending", fingerprint: "test", decision: "pending", attribution: "uncertain", comment: "" };

describe("审计意见提交", () => {
  it("普通旧条目没有备选时，可直接用自己的答案完成", () => {
    expect(auditAnswerForm(finding, { ...review, comment: "  " }).decision).toBeUndefined();
    const form = auditAnswerForm(finding, { ...review, comment: "从第 2 拍算起" });
    expect(form.questions).toEqual([]);
    expect(form.decision).toBe("answered");
  });

  it("自填可替代必答题，多选原值可恢复", () => {
    const item: AuditItem = { ...finding, questions: [
      { id: "voices", type: "multiple", label: "声部", options: [{ id: "s", label: "女高" }, { id: "b", label: "男低" }] },
      { id: "reason", type: "text", label: "原因", required: true },
    ] };
    const draft = { ...review, answers: [{ id: "voices", value: ["s", "b"] }] };
    expect(auditAnswerForm(item, draft).decision).toBeUndefined();
    const form = auditAnswerForm(item, { ...draft, comment: "这里应由内声部判断" });
    expect(form.decision).toBe("answered");
    expect(form.answers).toEqual(draft.answers);
  });

  it("只有显式选中的方案审批项可提交批准，自填或同名普通选项保留一般意见语义", () => {
    const proposal: AuditItem = { ...finding, category: "proposal" };
    const draft = { ...review, answers: [{ id: "proposal-verdict", value: "accept" }] };
    expect(auditAnswerForm(proposal, draft).decision).toBe("accept");
    expect(auditAnswerForm(proposal, { ...review, comment: "批准" }).decision).toBe("answered");
    const ordinary: AuditItem = { ...finding, questions: [{ id: "proposal-verdict", type: "single", label: "范围", options: [{ id: "accept", label: "从此处起" }] }] };
    expect(auditAnswerForm(ordinary, draft).decision).toBe("answered");
  });

  it.each(["accept", "reject", "needs-evidence"] as const)("保留没有结构化选项的旧方案决定 %s", decision => {
    const proposal: AuditItem = { ...finding, category: "proposal" };
    for (const answers of [undefined, []]) {
      const form = auditAnswerForm(proposal, { ...review, decision, answers });
      expect(form.answers).toEqual([{ id: "proposal-verdict", value: decision }]);
      expect(form.decision).toBe(decision);
    }
  });

  it("附有问题的旧方案可以正常作答，显式批准的门槛仍取决于必答题", () => {
    const proposal: AuditItem = { ...finding, category: "proposal", questions: [
      { id: "scope", type: "single", required: true, label: "适用范围", options: [{ id: "accept", label: "此例适用" }] },
    ] };
    const free = auditAnswerForm(proposal, { ...review, comment: "同意修改规则" });
    expect(free.decision).toBe("answered");
    expect(free.requiredComplete).toBe(false);
    const choice = auditAnswerForm(proposal, { ...review, answers: [{ id: "scope", value: "accept" }] });
    expect(choice.decision).toBe("answered");
    expect(choice.requiredComplete).toBe(true);
  });
});
