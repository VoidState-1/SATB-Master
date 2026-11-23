import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Copy, Download, FolderOpen, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  formatLogEntryText,
  isErrorLog,
  LOG_SCOPES,
  MAX_RECENT_LOGS,
  type LogEntry,
  type LogProcess,
  type LogScope,
} from "../../../shared/logging";
import type { HarmonyCheckResult } from "../../domain/harmony";
import type { ProjectDocument } from "../../domain/project";
import { copyText } from "../../services/clipboard";
import {
  exportDiagnosticBundleFile,
  getRecentDesktopLogs,
  openDesktopLogDirectory,
  subscribeToDesktopLogErrors,
} from "../../services/desktop";
import { buildDiagnosticBundle, logger } from "../../services/logging";
import "./logsPanel.css";

const processLabels: Record<LogProcess, string> = {
  main: "主进程",
  renderer: "渲染进程",
  worker: "Worker",
};

type LevelFilter = "all" | "warn" | "error";

export interface LogFocus {
  entryId: string;
}

interface LogsPanelProps {
  project: ProjectDocument;
  harmonyResult: HarmonyCheckResult;
  focus?: LogFocus;
}

const clock = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hourCycle: "h23",
});

function mergeEntries(...sources: readonly LogEntry[][]) {
  const byId = new Map<string, LogEntry>();
  for (const source of sources) {
    for (const entry of source) byId.set(entry.id, entry);
  }
  return [...byId.values()].reverse().sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function matchesQuery(entry: LogEntry, query: string) {
  if ([entry.message, entry.code, entry.scope].some(value => value?.toLowerCase().includes(query))) return true;
  for (let error = entry.error; error; error = error.cause) {
    if (error.stack?.toLowerCase().includes(query)) return true;
  }
  return false;
}

export function LogsPanel({ project, harmonyResult, focus }: LogsPanelProps) {
  const [rendererEntries, setRendererEntries] = useState(() => logger.getEntries());
  const [desktopEntries, setDesktopEntries] = useState<LogEntry[]>([]);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [level, setLevel] = useState<LevelFilter>("all");
  const [process, setProcess] = useState<LogProcess | "all">("all");
  const [scope, setScope] = useState<LogScope | "all">("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string>();
  const [highlightedId, setHighlightedId] = useState<string>();
  const [action, setAction] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [redactPaths, setRedactPaths] = useState(true);
  const [includeProject, setIncludeProject] = useState(false);
  const selectedRow = useRef<HTMLButtonElement>(null);
  const handledFocus = useRef<LogFocus | undefined>(undefined);
  const desktopLog = typeof window !== "undefined" && Boolean(window.desktop?.log);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      const { entries } = await getRecentDesktopLogs();
      if (!signal?.aborted) {
        setDesktopEntries(current => {
          // Preserve live errors delivered after the request began.
          const refreshed = mergeEntries(current.slice().reverse(), entries);
          return refreshed.slice(0, MAX_RECENT_LOGS);
        });
        if (!signal) setAction("已刷新主进程日志");
      }
    } catch {
      if (!signal?.aborted) setAction("无法读取主进程日志");
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const sync = () => setRendererEntries(logger.getEntries());
    const unsubscribe = logger.subscribe(sync);
    const unsubscribeDesktop = subscribeToDesktopLogErrors(entry => {
      setDesktopEntries(current => mergeEntries(current.slice().reverse(), [entry]).slice(0, MAX_RECENT_LOGS));
    });
    sync();
    if (desktopLog) void refresh(controller.signal);
    return () => {
      controller.abort();
      unsubscribe();
      unsubscribeDesktop?.();
    };
  }, [desktopLog, refresh]);

  const entries = useMemo(() => mergeEntries(desktopEntries.slice().reverse(), rendererEntries), [desktopEntries, rendererEntries]);
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries.filter(entry =>
      !hiddenIds.has(entry.id) &&
      (level === "all" || isErrorLog(entry.level) || (level === "warn" && entry.level === "warn")) &&
      (process === "all" || entry.process === process) &&
      (scope === "all" || entry.scope === scope) &&
      (!keyword || matchesQuery(entry, keyword))
    );
  }, [entries, hiddenIds, level, process, query, scope]);

  useLayoutEffect(() => {
    if (!focus || handledFocus.current === focus || !entries.some(entry => entry.id === focus.entryId)) return;
    handledFocus.current = focus;
    setLevel("all");
    setProcess("all");
    setScope("all");
    setQuery("");
    setHiddenIds(current => {
      if (!current.has(focus.entryId)) return current;
      const next = new Set(current);
      next.delete(focus.entryId);
      return next;
    });
    setHighlightedId(focus.entryId);
    setExpandedId(focus.entryId);
  }, [entries, focus]);

  useLayoutEffect(() => {
    if (!focus || handledFocus.current !== focus || highlightedId !== focus.entryId || expandedId !== focus.entryId) return;
    selectedRow.current?.scrollIntoView?.({ block: "nearest" });
    selectedRow.current?.focus({ preventScroll: true });
  }, [expandedId, highlightedId, focus]);

  async function copy(text: string, success: string) {
    setAction(await copyText(text) ? success : "复制失败");
  }

  async function copySummary() {
    const { appVersion, platform, sessionId, logs } = await buildDiagnosticBundle({ redactPaths: true });
    const recentProblems = logs.filter(entry => entry.level === "warn" || isErrorLog(entry.level)).slice(-20).reverse();
    await copy([
      `SATB Master ${appVersion} · ${platform}`,
      `会话 ${sessionId}`,
      `${logs.length} 条日志 · ${logs.filter(entry => isErrorLog(entry.level)).length} 条错误`,
      ...recentProblems.map(formatLogEntryText),
    ].join("\n\n"), "已复制排错摘要");
  }

  async function openDirectory() {
    try {
      if (!(await openDesktopLogDirectory()).opened) setAction("无法打开日志目录");
    } catch {
      setAction("无法打开日志目录");
    }
  }

  async function exportBundle() {
    setExporting(true);
    setAction("");
    try {
      const bundle = await buildDiagnosticBundle({
        redactPaths,
        ...(includeProject ? { project, harmonySummary: harmonyResult } : {}),
      });
      const result = await exportDiagnosticBundleFile(JSON.stringify(bundle, null, 2));
      if (!result.canceled) {
        setExportOpen(false);
        setAction("已导出排错包");
      }
    } catch (error) {
      setAction(error instanceof Error ? error.message : "导出排错包失败");
    } finally {
      setExporting(false);
    }
  }

  function clearView() {
    setHiddenIds(current => new Set([...current, ...entries.map(entry => entry.id)]));
    setExpandedId(undefined);
    setHighlightedId(undefined);
    setAction("已清空当前视图");
  }

  return (
    <section className="logs-panel" role="tabpanel" aria-label="日志">
      <div className="logs-toolbar">
        <div className="logs-filters">
          <select aria-label="日志级别" value={level} onChange={event => setLevel(event.target.value as LevelFilter)}>
            <option value="all">全部级别</option>
            <option value="warn">警告及以上 (WARN+)</option>
            <option value="error">仅错误 (ERROR+)</option>
          </select>
          <select aria-label="日志进程" value={process} onChange={event => setProcess(event.target.value as LogProcess | "all")}>
            <option value="all">全部进程</option>
            {Object.entries(processLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="日志模块" value={scope} onChange={event => setScope(event.target.value as LogScope | "all")}>
            <option value="all">全部模块</option>
            {LOG_SCOPES.map(value => <option key={value}>{value}</option>)}
          </select>
          <label className="logs-search">
            <Search aria-hidden="true" />
            <input type="search" aria-label="搜索日志" placeholder="搜索日志" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
        </div>
        <div className="logs-actions">
          <button type="button" disabled={!desktopLog || refreshing} onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" /> 刷新主进程日志
          </button>
          <button type="button" onClick={() => void copySummary()}><Copy aria-hidden="true" /> 复制排错摘要</button>
          {desktopLog && <button type="button" onClick={() => void openDirectory()}><FolderOpen aria-hidden="true" /> 打开日志目录</button>}
          <button type="button" aria-expanded={exportOpen} disabled={exporting} onClick={() => {
            if (!exportOpen) {
              setRedactPaths(true);
              setIncludeProject(false);
            }
            setExportOpen(!exportOpen);
          }}>
            <Download aria-hidden="true" /> 导出排错包
          </button>
          <button type="button" disabled={!visible.length} onClick={clearView}><Trash2 aria-hidden="true" /> 清空当前视图</button>
        </div>
        {exportOpen && (
          <fieldset className="logs-export-options" aria-label="排错包选项" disabled={exporting}>
            <label><input type="checkbox" checked={redactPaths} onChange={event => setRedactPaths(event.target.checked)} /> 脱敏路径</label>
            <label><input type="checkbox" checked={includeProject} onChange={event => setIncludeProject(event.target.checked)} /> 附带当前工程与和声诊断</label>
            <button type="button" onClick={() => void exportBundle()}>{exporting ? "正在导出…" : "确认导出 JSON"}</button>
          </fieldset>
        )}
        {action && <div className="logs-action-result" role="status">{action}</div>}
      </div>
      <div className="logs-results">
        {!visible.length && (
          <p className="logs-empty">{refreshing ? "正在读取日志…" : entries.some(entry => !hiddenIds.has(entry.id)) ? "没有符合筛选条件的日志" : "暂无日志"}</p>
        )}
        <ul className="logs-list">
          {visible.map(entry => {
            const expanded = expandedId === entry.id;
            const highlighted = highlightedId === entry.id;
            const context = entry.context;
            const duration = context && typeof context === "object" && !Array.isArray(context) ? context.durationMs : undefined;
            const time = new Date(entry.timestamp);
            return (
              <li key={entry.id} className={highlighted ? "logs-highlight" : undefined}>
                <button
                  type="button"
                  className="logs-row"
                  ref={highlighted ? selectedRow : undefined}
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? undefined : entry.id)}
                >
                  <ChevronRight aria-hidden="true" />
                  <time dateTime={entry.timestamp}>{clock.format(time)}</time>
                  <span className="logs-level" data-level={entry.level}>{entry.level.toUpperCase()}</span>
                  <span className="logs-process">{processLabels[entry.process]}</span>
                  <code className="logs-scope">{entry.scope}</code>
                  <span className="logs-message">{entry.code && <code className="logs-code">{entry.code}</code>}{entry.message}</span>
                  {typeof duration === "number" && <span className="logs-duration">{Math.round(duration)} ms</span>}
                </button>
                {expanded && (
                  <div className="logs-detail">
                    <div className="logs-detail-actions">
                      <button type="button" onClick={() => void copy(JSON.stringify(entry, null, 2), "已复制日志 JSON")}>复制 JSON</button>
                      <button type="button" onClick={() => void copy(formatLogEntryText(entry), "已复制日志文本")}>复制文本</button>
                    </div>
                    {context !== undefined && <pre aria-label="日志上下文">{JSON.stringify(context, null, 2)}</pre>}
                    {entry.error && <pre aria-label="错误堆栈">{formatLogEntryText({ ...entry, context: undefined }).split("\n").slice(1).join("\n")}</pre>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
