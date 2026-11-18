import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, BookOpenCheck, HardDrive, ChevronDown, ClipboardCheck, Download, FileMusic, FolderOpen, Image as ImageIcon, ListFilter, ListMusic, Maximize2, Minimize2, Minus, PanelLeftOpen, Piano, Search, Upload, UserRound, X } from "lucide-react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { ConfirmationState } from "../../app/controllers/useConfirmationController";
import { AUDIT_CATEGORIES, AUDIT_SEVERITIES, parseAuditFeedback, restoreAuditFeedback, createAuditFeedback, updateAuditReview, type AuditCategory, type AuditFeedback, type AuditReviewPatch, type AuditSeverity, type BoundAuditPackage } from "../../domain/audit";
import { downloadAuditFeedback, loadAuditSession, prepareAuditPackage, readAuditJson, saveAuditSession } from "../../services/audit";
import { AuditScore } from "./AuditScore";
import { AuditSource } from "./AuditSource";
import { AuditProjectEditor } from "./AuditProjectEditor";
import { AuditOpinion } from "./AuditOpinion";
import { AuditReviewPanel } from "./AuditReviewPanel";
import { categoryLabels, severityLabels, shortDecisionLabels } from "./auditLabels";
import "./audit.css";

type Session = { bound: BoundAuditPackage; feedback: AuditFeedback };
interface Props {
  onBack(): void;
  windowController: { isMaximized: boolean; toggleMaximize(): Promise<void>; close(): Promise<void> };
  confirmation?: ConfirmationState;
  answerConfirmation(confirmed: boolean): void;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "审计操作失败"; }

export function AuditWorkbench({ onBack, windowController, confirmation, answerConfirmation, requestConfirmation }: Props) {
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState("尚未导入");
  const [selectedKey, setSelectedKey] = useState("");
  const [caseFilter, setCaseFilter] = useState("");
  const [severity, setSeverity] = useState<AuditSeverity | "">("");
  const [category, setCategory] = useState<AuditCategory | "">("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [centerTab, setCenterTab] = useState<"image" | "project">("image");
  const [baselineView, setBaselineView] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const packageInput = useRef<HTMLInputElement>(null);
  const feedbackInput = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  const showNotice = useCallback((message: string) => setNotice(message), []);

  useEffect(() => {
    const request = sequence.current;
    let active = true;
    void loadAuditSession().then(async (saved) => {
      if (!saved) return;
      const bound = await prepareAuditPackage(saved.document);
      if (active && request === sequence.current) setSession({ bound, feedback: restoreAuditFeedback(bound, saved.feedback).feedback });
    }).catch((error) => { if (active) setNotice(errorText(error)); }).finally(() => { if (active && request === sequence.current) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setSaveStatus("正在保存…");
    const promise = saveAuditSession(session.bound.fingerprint, session.bound.data, session.feedback);
    pendingSave.current = promise;
    void promise.then(() => { if (active) setSaveStatus("意见和工程副本已自动保存"); }).catch((error) => { if (active) { setSaveStatus("自动保存失败 · 请导出意见"); setNotice(errorText(error)); } });
    return () => { active = false; };
  }, [session]);

  const importPackage = async (file?: File) => {
    if (!file) return;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const bound = await prepareAuditPackage(await readAuditJson(file));
      let feedback = createAuditFeedback(bound);
      let message = `已导入 ${bound.cases.length} 个谱例`;
      try {
        const saved = await loadAuditSession(bound.data.id);
        if (saved) {
          const restored = restoreAuditFeedback(bound, saved.feedback);
          feedback = restored.feedback;
          message += `，恢复 ${restored.restored} 条意见${restored.stale ? `，${restored.stale} 条旧意见因内容变更需重新审阅` : ""}`;
        }
      } catch (error) { message += `；本机恢复不可用: ${errorText(error)}`; }
      if (request !== sequence.current) return;
      setSession({ bound, feedback });
      setEditorGeneration((n) => n + 1);
      setBaselineView(false); setCenterTab("image"); setQueueOpen(false); setShowFilters(false);
      setSelectedKey(""); setCaseFilter(""); setSearch(""); setSeverity(""); setCategory(""); setStatus("");
      setNotice(message + (bound.data.formatVersion === 1 ? "；旧包由谱文临时生成工程，新提交请附带 .satb 工程使用 v2" : ""));
    } catch (error) { if (request === sequence.current) setNotice(errorText(error)); }
    finally { if (request === sequence.current) setLoading(false); }
  };
  const importFeedback = async (file?: File) => {
    if (!file || !session) return;
    const current = session;
    try {
      const incoming = parseAuditFeedback(await readAuditJson(file));
      const result = restoreAuditFeedback(current.bound, incoming, current.feedback);
      setSession((latest) => latest?.bound === current.bound ? { ...latest, feedback: restoreAuditFeedback(current.bound, incoming, latest.feedback).feedback } : latest);
      setEditorGeneration((n) => n + 1);
      setNotice(`已恢复 ${result.restored} 条意见${result.stale ? `；${result.stale} 条因谱面或条目版本不符未采用，需重新审阅` : ""}`);
    } catch (error) { setNotice(errorText(error)); }
  };
  const leave = async (action: () => void | Promise<void>) => {
    try {
      if (session) await saveAuditSession(session.bound.fingerprint, session.bound.data, session.feedback);
      else await pendingSave.current;
      await action();
    } catch (error) {
      setNotice(`${errorText(error)}；可先导出意见文件`);
      if (await requestConfirmation({ title: "审计意见未保存至本机", message: "本地保存失败。建议取消并导出意见文件；仍然离开可能丢失当前修改。", confirmLabel: "仍然离开", cancelLabel: "继续审计" })) await action();
    }
  };

  const rows = useMemo(() => session?.bound.cases.flatMap((c) => c.items.map((i) => ({ c, i, key: `${c.data.id}/${i.item.id}`, review: session.feedback.cases.find((r) => r.id === c.data.id)!.items.find((r) => r.id === i.item.id)! }))) ?? [], [session]);
  const filtered = rows.filter(({ c, i, review }) => (!caseFilter || c.data.id === caseFilter) && (!severity || i.item.severity === severity) && (!category || i.item.category === category) && (!status || (status === "reviewed" ? review.decision !== "pending" : review.decision === status)) && `${i.item.title} ${c.data.title} ${i.item.program?.ruleId ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const active = filtered.find((r) => r.key === selectedKey) ?? filtered[0];
  const auditCase = active?.c ?? session?.bound.cases.find((c) => c.data.id === caseFilter) ?? session?.bound.cases[0];
  const caseReview = session?.feedback.cases.find((c) => c.id === auditCase?.data.id);
  const completed = rows.filter((r) => r.review.decision !== "pending").length;
  const approvedCases = session?.feedback.cases.filter((c) => c.source.decision === "accept").length ?? 0;
  const update = (itemId: string | undefined, patch: AuditReviewPatch) => {
    if (!auditCase) return;
    setSession((current) => current ? { ...current, feedback: updateAuditReview(current.feedback, auditCase.data.id, itemId, patch, new Date().toISOString()) } : current);
  };
  const activeProject = active?.review.project ?? active?.i.project ?? auditCase?.project;
  const activeIndex = active ? filtered.indexOf(active) : -1;
  const groupRows = new Map<(typeof rows)[number]["c"], typeof rows>();
  for (const row of filtered) {
    const group = groupRows.get(row.c);
    if (group) group.push(row);
    else groupRows.set(row.c, [row]);
  }
  const filterCount = [caseFilter, severity, category, status].filter(Boolean).length;
  const selectItem = (key: string) => {
    setSelectedKey(key);
    setBaselineView(false);
    setQueueOpen(false);
    if (queueOpen) compactQueueToggle.current?.focus();
  };
  const clearFilters = () => { setSearch(""); setCaseFilter(""); setSeverity(""); setCategory(""); setStatus(""); };
  const compactQueueToggle = useRef<HTMLButtonElement>(null);
  const directoryList = useRef<HTMLDivElement>(null);
  const evidencePane = useRef<HTMLElement>(null);
  const [sourceReviewOpen, setSourceReviewOpen] = useState(false);
  const queueSearch = useRef<HTMLInputElement>(null);
  useEffect(() => { if (queueOpen) queueSearch.current?.focus(); }, [queueOpen]);

  useEffect(() => {
    evidencePane.current?.scrollTo({ top: 0 });
    directoryList.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
    setBaselineView(false);
  }, [active?.key, session?.bound.fingerprint]);
  useEffect(() => { setSourceReviewOpen(false); }, [auditCase?.fingerprint]);

  return <main className="audit-workbench">
    <header className="app-titlebar audit-titlebar">
      <button className="audit-back" aria-label="返回工程" title="返回工程" onClick={() => void leave(onBack)}><ArrowLeft size={17} /></button>
      <span className="audit-monogram">SM</span><strong>教材审计</strong>
      {session && <span className="audit-batch-name" title={session.bound.data.title}>{session.bound.data.title}</span>}
      {session && <button className="audit-directory-toggle" ref={compactQueueToggle} aria-expanded={queueOpen} aria-controls="audit-directory" onClick={() => setQueueOpen(v => !v)}><PanelLeftOpen size={16} />{queueOpen ? "收起目录" : "审计目录"}</button>}
      <nav className="audit-toolbar" aria-label="审计工具栏">
        {session && <><button onClick={() => packageInput.current?.click()} disabled={loading}><FolderOpen size={15} />导入审计包</button>
        <button onClick={() => feedbackInput.current?.click()} disabled={loading}><Upload size={15} />导入意见</button>
        <button className="audit-primary" onClick={() => { downloadAuditFeedback(session.feedback); setNotice("已发起意见文件导出，可交给模型读取"); }}><Download size={15} />导出意见</button></>}
      </nav>
      <input ref={packageInput} aria-label="审计包文件" type="file" accept=".json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void importPackage(file); }} />
      <input ref={feedbackInput} aria-label="审计意见文件" type="file" accept=".json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void importFeedback(file); }} />
      <div className="titlebar-controls">
        <button className="window-control" aria-label="最小化" onClick={() => void window.desktop?.windowControls.minimize()}><Minus size={16} /></button>
        <button className="window-control" aria-label="切换最大化" onClick={() => void windowController.toggleMaximize()}>{windowController.isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <button className="window-control close" aria-label="关闭窗口" onClick={() => void leave(windowController.close)}><X size={17} /></button>
      </div>
    </header>
    {notice && <div className="audit-notice" role="status"><span>{notice}</span><button aria-label="关闭审计提示" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {!session ? <section className="audit-empty">
      <div className="audit-empty-sheet" aria-hidden="true"><FileMusic size={44} strokeWidth={1.25} /></div>
      <h1>打开教材审计包</h1><p>对照教材原谱与转写工程，逐条核对模型判断并记录意见。</p>
      <button className="audit-primary" disabled={loading} onClick={() => packageInput.current?.click()}><FolderOpen size={17} />{loading ? "正在恢复本机记录…" : "选择审计包"}</button>
      <small>.satb-audit.json</small>
    </section> : <>
      <div className={`audit-layout ${queueOpen ? "queue-open" : ""}`}>
        <aside className="audit-sidebar" id="audit-directory" aria-label="待审条目" onKeyDown={e => { if (queueOpen && e.key === "Escape") { setQueueOpen(false); compactQueueToggle.current?.focus(); } }}>
          <header className="audit-queue-head"><h2><ListMusic size={18} />审计目录</h2><span>{rows.length} 条</span></header>
          <div className="audit-queue-search"><label><Search size={14} /><input ref={queueSearch} aria-label="搜索审计条目" placeholder="搜索条目或规则" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <button aria-label="筛选条目" title="筛选条目" aria-expanded={showFilters} aria-controls="audit-filters" onClick={() => setShowFilters(v => !v)}><ListFilter size={16} />{filterCount > 0 && filterCount}</button>
          </div>
          {showFilters && <div className="audit-filters" id="audit-filters">
          <select aria-label="谱例筛选" value={caseFilter} onChange={(e) => setCaseFilter(e.target.value)}><option value="">全部谱例</option>{session.bound.cases.map((c) => <option key={c.data.id} value={c.data.id}>{c.data.title}</option>)}</select>
          <div><select aria-label="层级筛选" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}><option value="">全部层级</option>{AUDIT_SEVERITIES.map((key) => <option key={key} value={key}>{severityLabels[key]}</option>)}</select><select aria-label="审计状态筛选" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="pending">待审</option><option value="needs-evidence">需补证</option><option value="accept">已认可</option><option value="reject">未认可</option><option value="reviewed">已有决定</option></select></div>
          <select aria-label="类型筛选" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}><option value="">全部类型</option>{AUDIT_CATEGORIES.map((key) => <option key={key} value={key}>{categoryLabels[key]}</option>)}</select>
            <button onClick={clearFilters}>清除筛选</button>
          </div>}
          <div className="audit-item-list" ref={directoryList}>
            {Array.from(groupRows, ([c, entries]) => <section key={c.data.id} className="audit-queue-group">
              <h3><BookOpen size={14} />{c.data.title}</h3>
              {entries.map(({ i, key, review }) => <button key={key} className="audit-item" aria-pressed={active?.key === key} onClick={() => selectItem(key)}>
                <strong>{i.item.title}</strong><span className="audit-item-meta"><span className={`audit-severity-mark severity-${i.item.severity}`} title={severityLabels[i.item.severity]} />{severityLabels[i.item.severity]}<span>·</span>{i.item.range.join("–")}<small>{shortDecisionLabels[review.decision]}</small></span>
              </button>)}
            </section>)}
            {!filtered.length && <div className="audit-queue-empty"><p>{rows.length ? "没有匹配的条目" : "本批次没有审计条目"}</p>{(filterCount > 0 || search) && <button onClick={clearFilters}>清除筛选</button>}</div>}
          </div>
          <div className="audit-queue-progress"><div><span>条目已审</span><strong>{completed} / {rows.length}</strong></div><progress aria-label="条目已审" max={rows.length || 1} value={completed} /></div>
        </aside>
        <section className="audit-evidence-pane" ref={evidencePane} aria-label="谱面证据">
          {auditCase && <>
            <header className="audit-case-heading"><div className="audit-case-meta"><span><BookOpen size={14} />谱例 {session.bound.cases.indexOf(auditCase) + 1} / {session.bound.cases.length}</span></div>
              <h1>{auditCase.data.title}</h1><p>{auditCase.data.source.title} <span>{auditCase.data.source.locator}</span></p>
            </header>
            <div className="audit-view-bar"><div className="audit-center-tabs" role="tablist" aria-label="审计视图" onKeyDown={e => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              e.currentTarget.querySelector<HTMLButtonElement>('button[aria-selected="false"]')?.focus();
              setCenterTab(centerTab === "image" ? "project" : "image"); setBaselineView(false);
            }}>
              <button role="tab" aria-selected={centerTab === "image"} tabIndex={centerTab === "image" ? 0 : -1} aria-controls="audit-image-panel" id="audit-image-tab" onClick={() => { setCenterTab("image"); setBaselineView(false); }}><ImageIcon size={15} />原图与谱面</button>
              <button role="tab" aria-selected={centerTab === "project"} tabIndex={centerTab === "project" ? 0 : -1} aria-controls="audit-project-panel" id="audit-project-tab" onClick={() => setCenterTab("project")}><Piano size={15} />工程 · 钢琴卷帘</button>
            </div><div className="audit-view-actions">{baselineView && active && <button onClick={() => setBaselineView(false)}>返回条目副本</button>}
              {caseReview && <button className="audit-source-toggle" aria-expanded={sourceReviewOpen} aria-controls="audit-source-review" onClick={() => setSourceReviewOpen(v => !v)}><BookOpenCheck size={15} />谱例转写复核<ChevronDown size={13} /></button>}
            </div></div>
            {caseReview && sourceReviewOpen && <section className="audit-source-review" id="audit-source-review" aria-label="谱例转写复核">
              <div className="audit-card-heading"><strong>原始转写 · 谱例基准工程</strong><button onClick={() => { setBaselineView(true); setCenterTab("project"); setSourceReviewOpen(false); }}>查看基准工程</button></div>
              <AuditOpinion mode="source" record={caseReview.source} onChange={patch => update(undefined, patch)} />
            </section>}
            {!baselineView && active?.review.project && <div className="audit-draft-note">当前条目副本已修改 · {active.review.decision === "pending" ? "结论需重新确认" : "意见已保存"}</div>}
          {centerTab === "image" ? <div role="tabpanel" id="audit-image-panel" aria-labelledby="audit-image-tab">
            <AuditSource key={`source/${auditCase.fingerprint}/${active?.i.item.id ?? "all"}`} source={auditCase.data.source} title={auditCase.data.title} region={active?.i.item.sourceRegion} />
            <AuditScore key={`score/${auditCase.fingerprint}/${active?.i.item.id ?? "all"}/${editorGeneration}`} auditCase={auditCase} selected={active?.i} project={activeProject} showNotice={showNotice} />
          </div> : activeProject && <div role="tabpanel" id="audit-project-panel" aria-labelledby="audit-project-tab">
            <AuditProjectEditor key={`${baselineView ? "baseline" : "project"}/${active?.i.fingerprint ?? auditCase.fingerprint}/${editorGeneration}`} initialProject={baselineView ? auditCase.project : activeProject} originalProject={baselineView ? auditCase.project : active?.i.project ?? auditCase.project}
              selected={baselineView ? undefined : active?.i} label={baselineView ? "谱例提交基准" : undefined} filename={`${auditCase.data.id}-${baselineView ? "source" : active?.i.item.id ?? "source"}`} confirmation={confirmation} requestConfirmation={requestConfirmation}
              showNotice={showNotice} onProjectChange={active && !baselineView ? (project) => update(active.i.item.id, { project: project === active.i.project ? undefined : project }) : undefined} />
          </div>}


          </>}
        </section>
        <aside className="audit-detail-pane" aria-label="审计分析与意见">{active
          ? <AuditReviewPanel key={active.key} item={active.i.item} review={active.review} index={activeIndex} total={filtered.length}
              onNavigate={offset => selectItem(filtered[activeIndex + offset].key)} onChange={patch => update(active.i.item.id, patch)} />
          : <p className="audit-detail-empty"><ClipboardCheck size={28} />选择条目查看分析与意见</p>}</aside>
      </div>
      <footer className="audit-statusbar">
        <span className="audit-save-status" role="status"><HardDrive size={14} />{saveStatus}</span>
        <span className="audit-progress"><span className="audit-compact-count">条目已审 {completed}/{rows.length}　·　</span>待补证 {rows.filter(r => r.review.decision === "needs-evidence").length}　·　转写核准 {approvedCases}/{session.bound.cases.length}</span>
        <label className="audit-reviewer"><UserRound size={14} />审计人<input aria-label="审计人" placeholder="填写姓名" maxLength={300} value={session.feedback.reviewer} onChange={e => setSession({ ...session, feedback: { ...session.feedback, reviewer: e.target.value } })} /></label>
      </footer>
    </>}
    {confirmation && <ConfirmDialog {...confirmation} onConfirm={() => answerConfirmation(true)} onCancel={() => answerConfirmation(false)} />}
  </main>;
}
