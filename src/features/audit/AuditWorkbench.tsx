import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, CircleAlert, CircleHelp, ClipboardCheck, Download, FileMusic, FolderOpen, Info, Keyboard, Lightbulb, ListFilter, ListMusic, Maximize2, Minimize2, Minus, PanelLeftClose, PanelLeftOpen, Search, TriangleAlert, Upload, UserRound, X } from "lucide-react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { ConfirmationState } from "../../app/controllers/useConfirmationController";
import { AUDIT_CATEGORIES, AUDIT_SEVERITIES, parseAuditFeedback, restoreAuditFeedback, createAuditFeedback, updateAuditReview, type AuditCategory, type AuditFeedback, type AuditReviewPatch, type AuditSeverity, type BoundAuditPackage } from "../../domain/audit";
import { downloadAuditFeedback, loadAuditFeedback, loadAuditSession, parseAuditJson, prepareAuditPackage, readAuditJson, saveAuditSession } from "../../services/audit";
import { AuditEvidenceWorkspace, initialAuditView, type AuditView } from "./AuditEvidenceWorkspace";
import { AuditReviewPanel } from "./AuditReviewPanel";
import { categoryLabels, severityLabels, shortDecisionLabels } from "./auditLabels";
import "./audit.css";

type Session = { bound: BoundAuditPackage; feedback: AuditFeedback };
interface Props {
  startupPackage?: boolean;
  onBack(): void;
  windowController: { isMaximized: boolean; toggleMaximize(): Promise<void>; close(): Promise<void> };
  confirmation?: ConfirmationState;
  answerConfirmation(confirmed: boolean): void;
  requestConfirmation(options: ConfirmationState): Promise<boolean>;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "审计操作失败"; }
const severityIcons = { error: CircleAlert, warning: TriangleAlert, suggestion: Lightbulb, info: Info };
const decisionIcons = { answered: ClipboardCheck, accept: Check, reject: X, "needs-evidence": CircleHelp };

export function AuditWorkbench({ startupPackage, onBack, windowController, confirmation, answerConfirmation, requestConfirmation }: Props) {
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState("尚未导入");
  const [selectedKey, setSelectedKey] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [caseFilter, setCaseFilter] = useState("");
  const [severity, setSeverity] = useState<AuditSeverity | "">("");
  const [category, setCategory] = useState<AuditCategory | "">("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [compare, setCompare] = useState(false);
  const [view, setView] = useState<AuditView>("score");
  const [queueOpen, setQueueOpen] = useState(false);
  const [collapsedCases, setCollapsedCases] = useState<Set<string>>(new Set());
  const packageInput = useRef<HTMLInputElement>(null);
  const feedbackInput = useRef<HTMLInputElement>(null);
  const playToggleRef = useRef<(() => void) | undefined>(undefined);
  const sequence = useRef(0);
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  const showNotice = useCallback((message: string) => setNotice(message), []);
  const registerPlayToggle = useCallback((toggle: (() => void) | undefined) => {
    playToggleRef.current = toggle;
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setSaveStatus("正在保存…");
    const promise = saveAuditSession(session.bound.fingerprint, session.bound.data, session.feedback);
    pendingSave.current = promise;
    void promise.then(() => { if (active) setSaveStatus("已自动保存"); }).catch((error) => { if (active) { setSaveStatus("自动保存失败 · 请导出意见"); setNotice(errorText(error)); } });
    return () => { active = false; };
  }, [session]);

  const importDocument = useCallback(async (read: () => Promise<unknown>) => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const bound = await prepareAuditPackage(await read());
      let feedback = createAuditFeedback(bound);
      let message = `已导入 ${bound.cases.length} 个谱例`;
      const saved = await loadAuditFeedback(bound.data.id, bound.fingerprint);
      if (saved) {
        const restored = restoreAuditFeedback(bound, saved);
        feedback = restored.feedback;
        message += `，恢复 ${restored.restored} 条意见${restored.stale ? `，${restored.stale} 条旧意见因内容变更需重新审阅` : ""}`;
      }
      if (request !== sequence.current) return;
      setSession({ bound, feedback });
      setEditorGeneration((n) => n + 1);
      setQueueOpen(false); setShowFilters(false);
      setSelectedKey(""); setCaseFilter(""); setSearch(""); setSeverity(""); setCategory(""); setStatus("");
      setEditingKey("");
      setCollapsedCases(new Set());
      setNotice(message + (bound.data.formatVersion === 1 ? "；旧包由谱文临时生成工程，新提交请附带 .satb 工程使用 v2" : ""));
    } catch (error) { if (request === sequence.current) setNotice(errorText(error)); }
    finally { if (request === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (startupPackage && window.desktop?.audit) {
      const api = window.desktop.audit;
      void importDocument(async () => parseAuditJson(await api.readStartupPackage()));
    } else {
      const request = ++sequence.current;
      void loadAuditSession().then(async (saved) => {
        if (!saved) return;
        const bound = await prepareAuditPackage(saved.document);
        if (request === sequence.current) setSession({ bound, feedback: restoreAuditFeedback(bound, saved.feedback).feedback });
      }).catch((error) => { if (request === sequence.current) setNotice(errorText(error)); }).finally(() => { if (request === sequence.current) setLoading(false); });
    }
    return () => { sequence.current++; };
  }, [startupPackage, importDocument]);
  const importPackage = (file?: File) => file && importDocument(() => readAuditJson(file));
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
  const filtered = rows.filter(({ c, i, key, review }) => (!caseFilter || c.data.id === caseFilter) && (!severity || i.item.severity === severity) && (!category || i.item.category === category) && (!status || editingKey === key || (status === "reviewed" ? review.decision !== "pending" : review.decision === status)) && `${i.item.title} ${c.data.title} ${i.item.program?.ruleId ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const active = filtered.find((r) => r.key === selectedKey) ?? filtered[0];
  const auditCase = active?.c ?? session?.bound.cases.find((c) => c.data.id === caseFilter) ?? session?.bound.cases[0];
  const caseReview = session?.feedback.cases.find((c) => c.id === auditCase?.data.id);
  const completed = rows.filter((r) => r.review.decision !== "pending").length;
  const approvedCases = session?.feedback.cases.filter((c) => c.source.decision === "accept").length ?? 0;
  const update = (itemId: string | undefined, patch: AuditReviewPatch) => {
    if (!auditCase) return;
    if (itemId && active && status && status !== "pending" && (patch.decision === "pending" || "project" in patch || "answers" in patch)) {
      setSelectedKey(active.key);
      setEditingKey(active.key);
    }
    setSession((current) => current ? { ...current, feedback: updateAuditReview(current.feedback, auditCase.data.id, itemId, patch, new Date().toISOString()) } : current);
  };
  const activeIndex = active ? filtered.indexOf(active) : -1;
  const groupRows = new Map<(typeof rows)[number]["c"], typeof rows>();
  for (const row of filtered) {
    const group = groupRows.get(row.c);
    if (group) group.push(row);
    else groupRows.set(row.c, [row]);
  }
  const filterCount = [caseFilter, severity, category, status].filter(Boolean).length;
  const toggleGroup = (id: string) => setCollapsedCases(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectItem = (key: string) => {
    setEditingKey("");
    const group = filtered.find(row => row.key === key)?.c.data.id;
    if (group && collapsedCases.has(group)) toggleGroup(group);
    setSelectedKey(key);
    setQueueOpen(false);
    if (queueOpen) compactQueueToggle.current?.focus();
  };
  const clearFilters = () => { setSearch(""); setCaseFilter(""); setSeverity(""); setCategory(""); setStatus(""); };
  const compactQueueToggle = useRef<HTMLButtonElement>(null);
  const directoryList = useRef<HTMLDivElement>(null);
  const evidencePane = useRef<HTMLElement>(null);
  const queueSearch = useRef<HTMLInputElement>(null);
  useEffect(() => { setCollapsedCases(new Set()); setEditingKey(""); }, [search, caseFilter, severity, category, status]);
  useEffect(() => { if (queueOpen) queueSearch.current?.focus(); }, [queueOpen]);

  useEffect(() => {
    evidencePane.current?.scrollTo({ top: 0 });
    directoryList.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active?.key, session?.bound.fingerprint]);
  useEffect(() => {
    setView(initialAuditView(active?.i, Boolean(auditCase?.data.source.image)));
  }, [active?.key, session?.bound.fingerprint]);
  const submit = (patch: AuditReviewPatch) => {
    if (!active) return;
    setEditingKey("");
    update(active.i.item.id, patch);
    const ordered = [...filtered.slice(activeIndex + 1), ...filtered.slice(0, activeIndex)];
    const next = ordered.find(row => row.review.decision === "pending");
    if (next) selectItem(next.key);
    else setNotice("当前筛选中的条目已全部审阅");
  };
  useEffect(() => {
    if (!session || confirmation || loading) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showShortcuts) {
        event.preventDefault();
        setShowShortcuts(false);
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (!filtered.length || activeIndex < 0) return;
        const offset = event.key === "ArrowUp" ? -1 : 1;
        const nextRow = filtered[activeIndex + offset];
        if (!nextRow) return;
        event.preventDefault();
        selectItem(nextRow.key);
        return;
      }
      if (target?.closest(".audit-project-editor")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "1") { event.preventDefault(); setView("source"); }
      else if (event.key === "2") { event.preventDefault(); setView("score"); }
      else if (event.key === "3") { event.preventDefault(); setView("roll"); }
      else if ((event.key === "c" || event.key === "C") && auditCase?.data.source.image) {
        event.preventDefault();
        setCompare(value => !value);
      } else if (event.key === " " && !target?.closest("button, a, summary, [role=tab]")) {
        if (playToggleRef.current) {
          event.preventDefault();
          playToggleRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session, confirmation, loading, showShortcuts, filtered, activeIndex, auditCase?.data.source.image]);

  const tally = { answered: 0, accept: 0, reject: 0, "needs-evidence": 0, pending: 0 };
  for (const row of rows) tally[row.review.decision]++;
  const share = (n: number) => `${rows.length ? (n / rows.length) * 100 : 0}%`;
  const saveTone = saveStatus.includes("失败") ? "error" : saveStatus.includes("正在") ? "busy" : session ? "ok" : "idle";
  const hasWindowControls = Boolean(window.desktop?.windowControls);
  const caseReviewMap = new Map((session?.feedback.cases ?? []).map(c => [c.id, c.source.decision]));
  const exportFeedback = () => {
    if (!session) return;
    downloadAuditFeedback(session.feedback);
    const pendingCount = tally.pending;
    const unapprovedCases = session.bound.cases.length - approvedCases;
    const reminders: string[] = [];
    if (pendingCount > 0) reminders.push(`尚有 ${pendingCount} 条待审`);
    if (unapprovedCases > 0) reminders.push(`${unapprovedCases} 例转写未核准`);
    if (!session.feedback.reviewer.trim()) reminders.push("未填写审计人");
    setNotice(reminders.length ? `已发起意见文件导出（提醒：${reminders.join("，")}）` : "已发起意见文件导出，可交给模型读取");
  };

  return <main className="audit-workbench">
    <header className={`app-titlebar audit-titlebar ${hasWindowControls ? "has-window-controls" : ""}`}>
      <button className="audit-back" aria-label="返回工程" title="返回工程" onClick={() => void leave(onBack)}><ArrowLeft size={16} /></button>
      <div className="audit-title-group">
        <span className="audit-title-mark" aria-hidden="true"><ClipboardCheck size={14} /></span>
        <strong>教材审计</strong>
        {session && <span className="audit-batch-name" title={session.bound.data.title}>{session.bound.data.title}</span>}
      </div>
      {session && <button className="audit-directory-toggle" ref={compactQueueToggle} aria-expanded={queueOpen} aria-controls="audit-directory" onClick={() => setQueueOpen(v => !v)}>{queueOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}{queueOpen ? "收起目录" : "审计目录"}</button>}
      <nav className="audit-toolbar" aria-label="审计工具栏">
        {session && <>
          <button className="audit-tool audit-tool-labeled" aria-label="导入审计包" title="导入审计包" onClick={() => packageInput.current?.click()} disabled={loading}><FolderOpen size={15} /><span>导入包</span></button>
          <button className="audit-tool audit-tool-labeled" aria-label="导入意见" title="导入意见" onClick={() => feedbackInput.current?.click()} disabled={loading}><Upload size={15} /><span>导入意见</span></button>
          <div className="audit-shortcut-wrap">
            <button className={`audit-tool ${showShortcuts ? "is-active" : ""}`} aria-label="快捷键说明" title="快捷键说明" aria-expanded={showShortcuts} onClick={() => setShowShortcuts(v => !v)}><Keyboard size={15} /></button>
            {showShortcuts && <div className="audit-shortcut-popover" role="dialog" aria-label="审计快捷键">
              <strong>审阅快捷键</strong>
              <ul>
                <li><kbd>Alt</kbd>+<kbd>↑/↓</kbd><span>上一条 / 下一条</span></li>
                <li><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd><span>原谱 / 转写谱 / 卷帘</span></li>
                <li><kbd>C</kbd><span>切换对照原谱</span></li>
                <li><kbd>Space</kbd><span>试听 / 暂停当前谱</span></li>
                <li><kbd>Ctrl</kbd>+<kbd>Enter</kbd><span>提交并下一条</span></li>
              </ul>
            </div>}
          </div>
          <span className="audit-toolbar-divider" aria-hidden="true" />
          <button className="audit-primary" onClick={exportFeedback}><Download size={14} />导出意见</button>
        </>}
      </nav>
      <input ref={packageInput} aria-label="审计包文件" type="file" accept=".json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void importPackage(file); }} />
      <input ref={feedbackInput} aria-label="审计意见文件" type="file" accept=".json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void importFeedback(file); }} />
      {hasWindowControls && <div className="titlebar-controls">
        <button className="window-control" aria-label="最小化" onClick={() => void window.desktop?.windowControls.minimize()}><Minus size={16} /></button>
        <button className="window-control" aria-label="切换最大化" onClick={() => void windowController.toggleMaximize()}>{windowController.isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <button className="window-control close" aria-label="关闭窗口" onClick={() => void leave(windowController.close)}><X size={17} /></button>
      </div>}
    </header>
    {notice && <div className="audit-notice" role="status"><Info size={14} /><span>{notice}</span><button aria-label="关闭审计提示" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {!session ? <section className="audit-empty">
      <div className="audit-empty-card">
        <span className="audit-empty-icon" aria-hidden="true"><FileMusic size={26} strokeWidth={1.6} /></span>
        <h1>打开教材审计包</h1>
        <p>载入模型提交的审计包，逐条对照教材原图、转写谱面与程序结果，记录人工结论。意见自动保存在本机，可随时导出。</p>
        <button className="audit-primary audit-empty-action" disabled={loading} onClick={() => packageInput.current?.click()}><FolderOpen size={16} />{loading ? "正在恢复本机记录…" : "选择审计包"}</button>
        <small>支持 <code>.satb-audit.json</code></small>
      </div>
    </section> : <>
      <div className={`audit-layout ${queueOpen ? "queue-open" : ""}`}>
        {queueOpen && <div className="audit-drawer-backdrop" aria-hidden="true" onClick={() => setQueueOpen(false)} />}
        <aside className="audit-sidebar" id="audit-directory" aria-label="待审条目" onKeyDown={e => { if (queueOpen && e.key === "Escape") { setQueueOpen(false); compactQueueToggle.current?.focus(); } }}>
          <header className="audit-pane-head audit-queue-head"><h2><ListMusic size={15} />审计目录</h2><span className="audit-count">{filterCount || search ? `${filtered.length} / ${rows.length}` : rows.length} 条</span></header>
          <div className="audit-queue-progress">
            <div className="audit-progress-figure"><span>审阅进度</span><strong>{completed}<small> / {rows.length}</small></strong></div>
            <div className="audit-stack-bar" role="progressbar" aria-label="条目已审" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={completed}>
              <i className="is-answered" style={{ width: share(tally.answered) }} /><i className="is-accept" style={{ width: share(tally.accept) }} /><i className="is-needs-evidence" style={{ width: share(tally["needs-evidence"]) }} /><i className="is-reject" style={{ width: share(tally.reject) }} />
            </div>
            <ul className="audit-legend" aria-label="审阅进度图例">
              <li className="is-answered">已作答 {tally.answered}</li>
              <li className="is-accept">已认可 {tally.accept}</li>
              <li className="is-needs-evidence">补证 {tally["needs-evidence"]}</li>
              <li className="is-reject">未认可 {tally.reject}</li>
              <li className="is-pending">待审 {tally.pending}</li>
            </ul>
          </div>
          <div className="audit-queue-search"><label><Search size={14} /><input ref={queueSearch} aria-label="搜索审计条目" placeholder="搜索条目或规则" value={search} onChange={e => setSearch(e.target.value)} />{search && <button type="button" className="audit-search-clear" aria-label="清空搜索" onClick={() => setSearch("")}><X size={12} /></button>}</label>
            <button className="audit-filter-toggle" aria-label="筛选条目" title="筛选条目" aria-expanded={showFilters} aria-controls="audit-filters" data-active={filterCount > 0 || undefined} onClick={() => setShowFilters(v => !v)}><ListFilter size={15} />{filterCount > 0 && <span className="audit-filter-count">{filterCount}</span>}</button>
          </div>
          {showFilters && <div className="audit-filters" id="audit-filters">
            <label className="is-wide"><span>谱例</span><select aria-label="谱例筛选" value={caseFilter} onChange={(e) => setCaseFilter(e.target.value)}><option value="">全部谱例</option>{session.bound.cases.map((c) => <option key={c.data.id} value={c.data.id}>{c.data.title}</option>)}</select></label>
            <label><span>层级</span><select aria-label="层级筛选" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}><option value="">全部层级</option>{AUDIT_SEVERITIES.map((key) => <option key={key} value={key}>{severityLabels[key]}</option>)}</select></label>
            <label><span>状态</span><select aria-label="审计状态筛选" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="pending">待审</option><option value="answered">已作答</option><option value="needs-evidence">需补证</option><option value="accept">已认可</option><option value="reject">未认可</option><option value="reviewed">已有决定</option></select></label>
            <label className="is-wide"><span>类型</span><select aria-label="类型筛选" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}><option value="">全部类型</option>{AUDIT_CATEGORIES.map((key) => <option key={key} value={key}>{categoryLabels[key]}</option>)}</select></label>
            <button className="audit-filters-clear" disabled={!filterCount && !search} onClick={clearFilters}>清除筛选</button>
          </div>}
          <div className="audit-item-list" ref={directoryList}>
            {Array.from(groupRows, ([c, entries]) => {
              const expanded = !collapsedCases.has(c.data.id);
              const seenTitles = new Set<string>();
              const repeatedTitles = new Set<string>();
              for (const { item } of c.items) {
                if (seenTitles.has(item.title)) repeatedTitles.add(item.title);
                seenTitles.add(item.title);
              }
              const groupDone = entries.filter(e => e.review.decision !== "pending").length;
              const sourceDecision = caseReviewMap.get(c.data.id) ?? "pending";
              return <section key={c.data.id} className="audit-queue-group">
                <h3><button type="button" className="audit-group-toggle" aria-expanded={expanded} onClick={() => toggleGroup(c.data.id)}>
                  <ChevronDown size={13} /><span>{c.data.title}</span>
                  <em className={`audit-group-source is-${sourceDecision}`} title={`转写复核：${shortDecisionLabels[sourceDecision]}`}>{shortDecisionLabels[sourceDecision]}</em>
                  <small data-complete={groupDone === entries.length || undefined}>{groupDone}/{entries.length}</small>
                </button></h3>
                {expanded && entries.map(({ i: { item }, key, review }) => {
                  const SeverityIcon = severityIcons[item.severity];
                  const DecisionIcon = review.decision === "pending" ? undefined : decisionIcons[review.decision];
                  const context = [severityLabels[item.severity], item.range.join("–"), shortDecisionLabels[review.decision]].join(" · ");
                  return <button key={key} className={`audit-item is-${review.decision}`} aria-label={`${item.title}，${context}`} title={`${item.title}\n${context}`}
                    aria-pressed={active?.key === key} onClick={() => selectItem(key)}>
                    <SeverityIcon size={14} className={`audit-row-severity severity-${item.severity}`} />
                    <span className="audit-row-copy"><span className="audit-row-title">{item.title}</span>
                      {repeatedTitles.has(item.title) && <small className="audit-row-position">{item.range.join("–")}</small>}
                    </span>
                    <span className={`audit-row-status is-${review.decision}`} aria-hidden="true">{DecisionIcon && <DecisionIcon size={10} strokeWidth={3.2} className="audit-row-decision" />}</span>
                  </button>;
                })}
              </section>;
            })}
            {!filtered.length && <div className="audit-queue-empty"><Search size={20} strokeWidth={1.6} /><p>{rows.length ? "没有匹配的条目" : "本批次没有审计条目"}</p>{(filterCount > 0 || search) && <button onClick={clearFilters}>清除筛选</button>}</div>}
          </div>
        </aside>
        <section className="audit-evidence-pane" ref={evidencePane} aria-label="谱面与分析依据">
          {auditCase && caseReview && <AuditEvidenceWorkspace
            key={`${auditCase.fingerprint}/${active?.i.fingerprint ?? "all"}/${editorGeneration}`}
            auditCase={auditCase} selected={active?.i} review={active?.review} sourceReview={caseReview.source}
            view={view} onViewChange={setView} compare={compare} onCompareChange={setCompare}
            onSourceChange={patch => update(undefined, patch)}
            onProjectChange={active ? project => update(active.i.item.id, { project: project === active.i.project ? undefined : project }) : undefined}
            confirmation={confirmation} requestConfirmation={requestConfirmation} showNotice={showNotice}
            onRegisterPlayToggle={registerPlayToggle} />}
        </section>
        <aside className="audit-detail-pane" aria-label="条目审计意见">{active
          ? <AuditReviewPanel key={active.key} item={active.i.item} review={active.review} index={activeIndex} total={filtered.length}
              hasNextPending={filtered.some(row => row.key !== active.key && row.review.decision === "pending")}
              onNavigate={offset => selectItem(filtered[activeIndex + offset].key)} onChange={patch => update(active.i.item.id, patch)} onSubmit={submit} />
          : <p className="audit-detail-empty"><ClipboardCheck size={26} strokeWidth={1.6} />选择条目填写意见</p>}</aside>
      </div>
      <footer className="audit-statusbar">
        <span className={`audit-save-status is-${saveTone}`} role="status"><i aria-hidden="true" />{saveStatus}</span>
        <span className="audit-progress"><span className="audit-compact-count">条目已审 {completed}/{rows.length}<b aria-hidden="true">·</b></span>待补证 {tally["needs-evidence"]}<b aria-hidden="true">·</b>转写核准 {approvedCases}/{session.bound.cases.length}</span>
        <label className="audit-reviewer"><UserRound size={13} />审计人<input aria-label="审计人" placeholder="填写姓名" maxLength={300} value={session.feedback.reviewer} onChange={e => setSession({ ...session, feedback: { ...session.feedback, reviewer: e.target.value } })} /></label>
      </footer>
    </>}
    {confirmation && <ConfirmDialog {...confirmation} onConfirm={() => answerConfirmation(true)} onCancel={() => answerConfirmation(false)} />}
  </main>;
}
