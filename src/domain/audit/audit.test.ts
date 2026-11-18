import { describe, expect, it } from "vitest";
import { bindAuditPackage, canonicalAuditJson, createAuditFeedback, missingAuditQuestions, parseAuditFeedback, parseAuditPackage, restoreAuditFeedback, setAuditAnswer, suggestedAuditAnswers, updateAuditReview, type AuditPackage, type AuditQuestion } from "./index";
import { compileScoreText } from "../scoreText";
import { buildMeasures } from "../time";
import { locateSourceBeats, nearestSourceBeat, sourceBeatAt } from "./sourceAnchors";

const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");
function input() {
  return {
    format: "satb-audit-package", formatVersion: 1, id: "audit-unit", title: "审计协议测试",
    cases: [{ id: "one", title: "接口样例", source: { title: "手工合成, 非教材金样本" },
      score: `satb 1\nkey C major\nbars 1..2 {\nS: | B4/1 | C5/1 |\nA: | G4/1 | G4/1 |\nT: | D4/1 | E4/1 |\nB: | G2/1 | C3/1 |\n}\nreference {\nchord c1 range=[1:1,2:1) symbol=V\n}`,
      items: [{ id: "finding", title: "判断核对", category: "diagnostic", severity: "warning", range: ["1:1", "3:1"], voices: ["soprano"], model: { conclusion: "待人工核对", reason: "此处只测试协议, 不规定规则应否报警" } },
        { id: "plan", title: "方案审阅", category: "proposal", severity: "info", range: ["1:1", "2:1"], model: { conclusion: "候选方案", reason: "批准必须独立记录" } }],
    }],
  };
}
async function bound(value = input()) { return bindAuditPackage(parseAuditPackage(value), hash); }
function nativeInput(): AuditPackage {
  const value = input();
  const project = compileScoreText(value.cases[0].score).project;
  return { ...value, format: "satb-audit-package", formatVersion: 2, cases: value.cases.map((c) => ({ id: c.id, title: c.title, source: c.source, project: structuredClone(project), items: c.items.map((item) => ({ ...item, project: structuredClone(project) } as AuditPackage["cases"][number]["items"][number])) })) };
}
const questions: AuditQuestion[] = [
  { id: "spelling", label: "书写是否正确", type: "single", required: true, options: [{ id: "yes", label: "正确" }, { id: "unknown", label: "需核对" }], suggested: "yes" },
  { id: "conditions", label: "适用条件", type: "multiple", options: [{ id: "inner", label: "内声部" }, { id: "tonic", label: "完整主和弦" }], suggested: ["inner", "tonic"] },
  { id: "limit", label: "适用边界", type: "text", suggested: "请补教材例号" },
];

describe("可视化审计协议与人工意见", () => {
  it("保存独立标注和条件推导的不同起拍，拒绝界外或倒置的标注", async () => {
    const pkg = nativeInput(), item = pkg.cases[0].items[0];
    item.annotations = [
      { kind: "cadence", source: "model", label: "半终止", range: ["1:4", "3:1"] },
      { kind: "cadence", source: "program", label: "半终止", range: ["2:1", "3:1"], context: "给定和弦与乐句" },
    ];
    const bound = await bindAuditPackage(parseAuditPackage(pkg), hash);
    expect(bound.cases[0].items[0].annotations).toMatchObject([
      { source: "model", fromTick: 2880, toTick: 7680 },
      { source: "program", fromTick: 3840, toTick: 7680, context: "给定和弦与乐句" },
    ]);
    item.annotations[0].range = ["2:1", "1:4"];
    await expect(bindAuditPackage(parseAuditPackage(pkg), hash)).rejects.toThrow("标注范围");
    item.annotations[0].range = ["2:1", "4:1"];
    await expect(bindAuditPackage(parseAuditPackage(pkg), hash)).rejects.toThrow("annotations[0]");
  });

  it("自填意见可替代备选，空白回复不能恢复为已作答", async () => {
    const pkg = nativeInput();
    pkg.cases[0].items[0].questions = questions;
    const b = await bindAuditPackage(parseAuditPackage(pkg), hash);
    const feedback = updateAuditReview(createAuditFeedback(b), "one", "finding", { decision: "answered", comment: "这一拍有另一种解释" }, "2026-11-18T12:00:00Z");
    expect(restoreAuditFeedback(b, parseAuditFeedback(feedback)).feedback.cases[0].items[0].decision).toBe("answered");
    feedback.cases[0].items[0].comment = "  ";
    expect(() => restoreAuditFeedback(b, feedback)).toThrow("缺少人工答案");
  });
  it("将小节/拍点和声部绑定到音符, 不把独立参考注入输入", async () => {
    const b = await bound();
    expect(b.cases[0].project.chordTrack.regions).toEqual([]);
    expect(b.cases[0].items[0].noteIds.size).toBe(2);
    expect(b.cases[0].items[0]).toMatchObject({ fromTick: 0, toTick: 7680 });
    expect(b.cases[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it("谱例核准、模型判断和具体方案批准互相独立", async () => {
    const b = await bound();
    const initial = createAuditFeedback(b);
    const approved = updateAuditReview(initial, "one", undefined, { decision: "accept", comment: "只核准转写" }, "2026-11-17T00:00:00Z");
    expect(initial.cases[0].source.decision).toBe("pending");
    expect(approved.cases[0].items.map((i) => i.decision)).toEqual(["pending", "pending"]);
    const finding = updateAuditReview(approved, "one", "finding", { decision: "accept", attribution: "program" }, "2026-11-17T00:01:00Z");
    expect(finding.cases[0].items[1].decision).toBe("pending");
    expect(parseAuditFeedback(JSON.parse(JSON.stringify(finding)))).toEqual(finding);
  });
  it("同一内容重新编译生成不同工程ID时仍可恢复意见", async () => {
    const a = await bound();
    const feedback = updateAuditReview(createAuditFeedback(a), "one", "finding", { decision: "needs-evidence", comment: "请补例号" }, "2026-11-17T00:00:00Z");
    const restored = restoreAuditFeedback(await bound(), feedback);
    expect(restored).toMatchObject({ restored: 1, stale: 0 });
    expect(restored.feedback.cases[0].items[0].comment).toBe("请补例号");
  });
  it("改变音符使旧转写核准及相关条目意见失效", async () => {
    const old = await bound();
    let feedback = updateAuditReview(createAuditFeedback(old), "one", undefined, { decision: "accept" }, "2026-11-17T00:00:00Z");
    feedback = updateAuditReview(feedback, "one", "finding", { decision: "accept" }, "2026-11-17T00:00:00Z");
    const changed = input(); changed.cases[0].score = changed.cases[0].score.replace("B4/1", "A4/1");
    const restored = restoreAuditFeedback(await bound(changed), feedback);
    expect(restored).toMatchObject({ restored: 0, stale: 2 });
    expect(restored.feedback.cases[0].source.decision).toBe("pending");
  });
  it("改变模型分析使该条意见失效, 谱面核准和其他方案不失效", async () => {
    const b = await bound();
    let feedback = updateAuditReview(createAuditFeedback(b), "one", undefined, { decision: "accept" }, "2026-11-17T00:00:00Z");
    feedback = updateAuditReview(feedback, "one", "finding", { decision: "accept" }, "2026-11-17T00:00:00Z");
    feedback = updateAuditReview(feedback, "one", "plan", { decision: "reject" }, "2026-11-17T00:00:00Z");
    const changed = input(); changed.cases[0].items[0].model.reason = "新分析";
    const restored = restoreAuditFeedback(await bound(changed), feedback);
    expect(restored).toMatchObject({ restored: 2, stale: 1 });
    expect(restored.feedback.cases[0].source.decision).toBe("accept");
    expect(restored.feedback.cases[0].items.map((i) => i.decision)).toEqual(["pending", "reject"]);
  });
  it("对象字段顺序不影响内容指纹", () => {
    expect(canonicalAuditJson({ b: 1, a: { d: 3, c: 2 }, empty: undefined })).toBe(canonicalAuditJson({ a: { c: 2, d: 3 }, b: 1 }));
  });
  it("合并导入只覆盖明确填写的意见, 保留本机其他审计结果", async () => {
    const b = await bound();
    const current = updateAuditReview(createAuditFeedback(b), "one", "plan", { decision: "reject", comment: "方案需收窄" }, "2026-11-17T00:00:00Z");
    const imported = updateAuditReview(createAuditFeedback(b), "one", "finding", { decision: "needs-evidence" }, "2026-11-17T00:00:00Z");
    const result = restoreAuditFeedback(b, imported, current);
    expect(result.feedback.cases[0].items.map((i) => i.decision)).toEqual(["needs-evidence", "reject"]);
    expect(current.cases[0].items[0].decision).toBe("pending");
    const cleared = updateAuditReview(imported, "one", "plan", { decision: "pending", comment: "" }, "2026-11-17T00:01:00Z");
    expect(restoreAuditFeedback(b, cleared, current).feedback.cases[0].items[1].decision).toBe("pending");
  });
  it("拒绝其他批次意见, 不按相同条目名套用", async () => {
    const b = await bound(); const feedback = createAuditFeedback(b); feedback.packageId = "another";
    expect(() => restoreAuditFeedback(b, feedback)).toThrow(/其他审计包/);
  });
  it.each(["javascript:alert(1)", "file:///C:/secret"])("拒绝不可审阅的资料链接 %s", (url) => {
    const value = input() as unknown as { cases: { items: Record<string, unknown>[] }[] };
    value.cases[0].items[0].evidence = [{ title: "资料", url }];
    expect(() => parseAuditPackage(value)).toThrow(/http/);
  });
  it("拒绝重复条目与不安全原图地址", () => {
    const duplicate = input(); duplicate.cases[0].items.push(duplicate.cases[0].items[0]);
    expect(() => parseAuditPackage(duplicate)).toThrow(/重复/);
    const unsafe = input(); Object.assign(unsafe.cases[0].source, { image: "https://remote/image.png" });
    expect(() => parseAuditPackage(unsafe)).toThrow(/内嵌/);
  });
  it("拒绝越界范围和不存在音符的声部范围", async () => {
    const value = input(); value.cases[0].items[0].range = ["2:1", "5:1"];
    await expect(bound(value)).rejects.toThrow(/one\/finding/);
    const empty = input(); empty.cases[0].score = empty.cases[0].score.replace("S: | B4/1 | C5/1 |", "S: empty");
    await expect(bound(empty)).rejects.toThrow(/没有音符/);
  });
  it("保留原图的不等距拍点, 区分多行、未标拍点与谱行空白", async () => {
    const value = nativeInput();
    value.cases[0].source.beatAnchors = [
      { position: "2:1", x: .16, top: .58, bottom: .93 },
      { position: "1:1", x: .14, top: .12, bottom: .42 },
      { position: "1:3", x: .36, top: .12, bottom: .42 },
    ];
    const result = await bindAuditPackage(parseAuditPackage(value), hash);
    const c = result.cases[0];
    const located = locateSourceBeats(c.data.source.beatAnchors!, buildMeasures(c.project));
    expect(located.map((a) => a.tick)).toEqual([0, 1920, 3840]);
    expect(sourceBeatAt(located, 1920).beat?.x).toBe(.36);
    expect(sourceBeatAt(located, 960)).toEqual({ row: { top: .12, bottom: .42 } });
    expect(sourceBeatAt(located, 2880)).toEqual({});
    expect(sourceBeatAt([], 0)).toEqual({});
    expect(nearestSourceBeat(located, .32, .25)?.tick).toBe(1920);
    expect(nearestSourceBeat(located, .32, .75)?.tick).toBe(3840);
    expect(nearestSourceBeat(located, .32, .5)).toBeUndefined();
  });
  it("拒绝原图越界坐标、重复或越界的音乐位置", async () => {
    const value = nativeInput(), source = value.cases[0].source;
    const anchor = { position: "1:1", x: .1, top: .2, bottom: .7 };
    source.beatAnchors = [{ ...anchor, bottom: .1 }];
    expect(() => parseAuditPackage(value)).toThrow(/beatAnchors/);
    source.beatAnchors = [anchor, { ...anchor, position: "1:1+0/2" }];
    await expect(bindAuditPackage(parseAuditPackage(value), hash)).rejects.toThrow(/重复拍点/);
    source.beatAnchors = [{ ...anchor, position: "8:3" }];
    await expect(bindAuditPackage(parseAuditPackage(value), hash)).rejects.toThrow(/source.beatAnchors/);
    source.beatAnchors = [{ ...anchor, position: "3:1" }];
    await expect(bindAuditPackage(parseAuditPackage(value), hash)).rejects.toThrow(/工程结束线/);
  });
  it("模型审计包无法携带自动生效的人工批准", async () => {
    const value = { ...input(), feedback: { decision: "accept" } };
    const b = await bindAuditPackage(parseAuditPackage(value), hash);
    expect(createAuditFeedback(b).cases[0].source.decision).toBe("pending");
  });
  it("v2 强制每例和每条意见附有效工程, 不能用文字代替附件", () => {
    const missing = nativeInput(); delete missing.cases[0].project;
    expect(() => parseAuditPackage(missing)).toThrow(/project/);
    const missingItem = nativeInput(); delete missingItem.cases[0].items[0].project;
    expect(() => parseAuditPackage(missingItem)).toThrow(/items\[0\].project/);
  });
  it("每条工程在内存中独立, 修改一个副本不会污染提交基准与另一条", async () => {
    const source = nativeInput();
    const b = await bindAuditPackage(parseAuditPackage(source), hash);
    b.cases[0].items[0].project.satbTracks[0].notes[0].pitch.step = "A";
    expect(b.cases[0].items[1].project.satbTracks[0].notes[0].pitch.step).toBe("B");
    expect(b.cases[0].project.satbTracks[0].notes[0].pitch.step).toBe("B");
    expect(b.cases[0].items[0].item.project!.satbTracks[0].notes[0].pitch.step).toBe("B");
    expect(source.cases[0].project!.satbTracks[0].notes[0].pitch.step).toBe("B");
  });
  it("人工工程副本随意见往返, 编辑会撤回当前条目决定而保留其他条目的判断", async () => {
    const b = await bindAuditPackage(parseAuditPackage(nativeInput()), hash);
    let feedback = updateAuditReview(createAuditFeedback(b), "one", "finding", { decision: "accept" }, "2026-11-17T00:00:00Z");
    feedback = updateAuditReview(feedback, "one", "plan", { decision: "reject" }, "2026-11-17T00:00:00Z");
    const edited = structuredClone(b.cases[0].items[0].project);
    edited.satbTracks[0].notes[0].pitch.step = "A";
    feedback = updateAuditReview(feedback, "one", "finding", { project: edited }, "2026-11-17T00:01:00Z");
    edited.satbTracks[0].notes[0].pitch.step = "F";
    const restored = restoreAuditFeedback(b, parseAuditFeedback(JSON.parse(JSON.stringify(feedback))));
    expect(restored.feedback.cases[0].items[0].project!.satbTracks[0].notes[0].pitch.step).toBe("A");
    expect(restored.feedback.cases[0].items.map((i) => i.decision)).toEqual(["pending", "reject"]);
    expect(b.cases[0].items[0].project.satbTracks[0].notes[0].pitch.step).toBe("B");
  });
  it("单条模型工程变更仅使本条意见过期, 不撤销基准转写核准", async () => {
    const value = nativeInput();
    const b = await bindAuditPackage(parseAuditPackage(value), hash);
    let feedback = updateAuditReview(createAuditFeedback(b), "one", undefined, { decision: "accept" }, "2026-11-17T00:00:00Z");
    feedback = updateAuditReview(feedback, "one", "finding", { decision: "accept" }, "2026-11-17T00:00:00Z");
    feedback = updateAuditReview(feedback, "one", "plan", { decision: "reject" }, "2026-11-17T00:00:00Z");
    const changed = structuredClone(value);
    changed.cases[0].items[0].project!.satbTracks[0].notes[0].pitch.step = "A";
    const result = restoreAuditFeedback(await bindAuditPackage(parseAuditPackage(changed), hash), feedback);
    expect(result).toMatchObject({ restored: 2, stale: 1 });
    expect(result.feedback.cases[0].source.decision).toBe("accept");
  });
  it("模型预填不自动产生人工回答, 主动采用也不批准判断并保留已填内容", async () => {
    const value = nativeInput(); value.cases[0].items[0].questions = questions;
    const b = await bindAuditPackage(parseAuditPackage(value), hash);
    const initial = createAuditFeedback(b);
    expect(initial.cases[0].items[0].answers).toBeUndefined();
    expect(missingAuditQuestions(questions, [])).toHaveLength(1);
    const adopted = suggestedAuditAnswers(questions, [{ id: "limit", value: "人工备注" }]);
    expect(adopted).toContainEqual({ id: "limit", value: "人工备注" });
    expect(adopted).toContainEqual({ id: "conditions", value: ["inner", "tonic"] });
    const feedback = updateAuditReview(initial, "one", "finding", { answers: adopted }, "2026-11-17T00:00:00Z");
    const result = restoreAuditFeedback(b, parseAuditFeedback(JSON.parse(JSON.stringify(feedback))));
    expect(result.feedback.cases[0].items[0].decision).toBe("pending");
    expect(result.feedback.cases[0].items[0].answers).toEqual(adopted);
    expect(missingAuditQuestions(questions, adopted)).toHaveLength(0);
  });
  it("拒绝无效的建议、重复问题与不存在的多选值", () => {
    const value = nativeInput(); value.cases[0].items[0].questions = structuredClone(questions);
    value.cases[0].items[0].questions[0].suggested = "fake-option";
    expect(() => parseAuditPackage(value)).toThrow(/无效/);
    value.cases[0].items[0].questions = [questions[0], questions[0]];
    expect(() => parseAuditPackage(value)).toThrow(/重复/);
  });
  it("必填未答的批准意见不能导入, 需补证决定仍可保留", async () => {
    const value = nativeInput(); value.cases[0].items[0].questions = questions;
    const b = await bindAuditPackage(parseAuditPackage(value), hash);
    const invalid = updateAuditReview(createAuditFeedback(b), "one", "finding", { decision: "accept" }, "2026-11-17T00:00:00Z");
    expect(() => restoreAuditFeedback(b, invalid)).toThrow(/必填/);
    const pending = updateAuditReview(invalid, "one", "finding", { decision: "needs-evidence" }, "2026-11-17T00:01:00Z");
    expect(restoreAuditFeedback(b, pending).feedback.cases[0].items[0].decision).toBe("needs-evidence");
    const wrong = updateAuditReview(pending, "one", "finding", { answers: [{ id: "conditions", value: ["missing"] }] }, "2026-11-17T00:02:00Z");
    expect(() => restoreAuditFeedback(b, wrong)).toThrow(/无效选项/);
  });
  it("已认可后改变预审回答需要重新确认, 并且问答只能归属具体条目", async () => {
    const value = nativeInput(); value.cases[0].items[0].questions = questions;
    const b = await bindAuditPackage(parseAuditPackage(value), hash);
    let feedback = updateAuditReview(createAuditFeedback(b), "one", "finding", { answers: suggestedAuditAnswers(questions) }, "2026-11-17T00:00:00Z");
    feedback = updateAuditReview(feedback, "one", "finding", { decision: "accept" }, "2026-11-17T00:01:00Z");
    const changed = updateAuditReview(feedback, "one", "finding", { answers: setAuditAnswer(feedback.cases[0].items[0].answers, "spelling", "unknown") }, "2026-11-17T00:02:00Z");
    expect(changed.cases[0].items[0].decision).toBe("pending");
    expect(() => updateAuditReview(feedback, "one", undefined, { answers: [] }, "2026-11-17T00:00:00Z")).toThrow(/具体审计条目/);
  });
  it("旧 v1 审计包和意见仍可按原指纹恢复", async () => {
    const b = await bound();
    const feedback = updateAuditReview(createAuditFeedback(b), "one", "finding", { decision: "needs-evidence", comment: "旧版意见" }, "2026-11-17T00:00:00Z");
    feedback.formatVersion = 1;
    const restored = restoreAuditFeedback(await bound(), parseAuditFeedback(JSON.parse(JSON.stringify(feedback))));
    expect(restored).toMatchObject({ restored: 1, stale: 0 });
    expect(restored.feedback.cases[0].items[0].comment).toBe("旧版意见");
  });
});
