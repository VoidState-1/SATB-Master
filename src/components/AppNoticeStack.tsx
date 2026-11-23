import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import "./appNoticeStack.css";

type NoticeLevel = "info" | "success" | "warn" | "error";

interface NoticeOptions {
  level?: NoticeLevel;
  logEntryId?: string;
}

export type ShowNotice = (message: string, options?: NoticeOptions) => void;

interface Notice {
  id: number;
  message: string;
  level: NoticeLevel;
  logEntryId?: string;
  expiresAt: number;
}

const presentation = {
  info: { duration: 3500, priority: 0, label: "提示", Icon: Info },
  success: { duration: 3500, priority: 0, label: "成功", Icon: CheckCircle },
  warn: { duration: 5000, priority: 1, label: "警告", Icon: AlertTriangle },
  error: { duration: 8000, priority: 2, label: "错误", Icon: AlertCircle },
};

export function useAppNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);
  const dismissNotice = useCallback((id: number) => setNotices(current => current.filter(notice => notice.id !== id)), []);
  const showNotice = useCallback<ShowNotice>((message, { level = "info", logEntryId } = {}) => {
    const notice = { id: ++nextId.current, message, level, logEntryId, expiresAt: Date.now() + presentation[level].duration };
    setNotices(current => [...current.filter(item => item.expiresAt > Date.now()), notice]
      .sort((left, right) => presentation[right.level].priority - presentation[left.level].priority || right.id - left.id)
      .slice(0, 3));
  }, []);

  return { notices, showNotice, dismissNotice };
}

interface NoticeStackProps {
  notices: readonly Notice[];
  onDismiss(id: number): void;
  onViewLogs(entryId?: string): void;
}

export function AppNoticeStack({ notices, onDismiss, onViewLogs }: NoticeStackProps) {
  if (!notices.length) return null;
  return (
    <aside className="app-notices" aria-label="操作通知">
      {notices.map(notice => <NoticeRow key={notice.id} notice={notice} onDismiss={onDismiss} onViewLogs={onViewLogs} />)}
    </aside>
  );
}

function NoticeRow({ notice, onDismiss, onViewLogs }: Omit<NoticeStackProps, "notices"> & { notice: Notice }) {
  const { Icon, label } = presentation[notice.level];
  const needsAttention = notice.level === "warn" || notice.level === "error";

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(notice.id), Math.max(0, notice.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);

  return (
    <div className="app-notice" data-level={notice.level}>
      <Icon className="app-notice-icon" role="img" aria-label={label} />
      <span role={needsAttention ? "alert" : "status"}>{notice.message}</span>
      {needsAttention && (
        <button type="button" onClick={() => {
          onViewLogs(notice.logEntryId);
          onDismiss(notice.id);
        }}>查看日志</button>
      )}
      <button type="button" aria-label="关闭通知" onClick={() => onDismiss(notice.id)}><X aria-hidden="true" /></button>
    </div>
  );
}
