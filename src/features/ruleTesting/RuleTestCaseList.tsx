import { FilePlus2, FolderTree, Search, Trash2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { IconButton } from "../../components/IconButton";
import {
  collectRuleTestLibraryTags,
  filterRuleTestCaseLibraryItems,
  type RuleTestCaseLibraryViewItem,
  type RuleTestLibraryStatus,
  type RuleTestLibraryStatusFilter,
} from "../../services/ruleTestCases";

interface RuleTestCaseListProps {
  currentItem: RuleTestCaseLibraryViewItem;
  items: RuleTestCaseLibraryViewItem[];
  recentItems: RuleTestCaseLibraryViewItem[];
  libraryDirectory?: string;
  batchRunState: "idle" | "running" | "completed" | "cancelled";
  batchCompletedCount: number;
  batchTotalCount: number;
  onCreateCase(): void;
  onOpenDirectory(): void;
  onSelect(key: string): void;
  onDelete(key: string): void;
}

const STATUS_LABELS: Record<RuleTestLibraryStatus, string> = {
  idle: "未运行",
  running: "运行中",
  passed: "通过",
  failed: "失败",
  error: "错误",
  invalid: "无效",
};

function CaseItem({
  item,
  active,
  buttonRef,
  onSelect,
  onDelete,
  onKeyDown,
}: {
  item: RuleTestCaseLibraryViewItem;
  active: boolean;
  buttonRef(button: HTMLButtonElement | null): void;
  onSelect(): void;
  onDelete(): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
}) {
  const invalid = !item.testCase || item.issues.length > 0;
  const title = item.testCase?.title ?? item.displayName;
  const detail = invalid
    ? item.issues.map((issue) => issue.message).join("；")
    : item.testCase?.target.ruleId;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`rule-test-case-item ${active ? "is-active" : ""}`}
      aria-current={active ? "true" : undefined}
      title={invalid ? detail : (item.relativePath ?? item.filePath)}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className={`rule-test-case-state ${item.status}`} />
      <span className="rule-test-case-item-content">
        <strong className="rule-test-case-item-title">
          {title}
          {item.dirty ? " *" : ""}
        </strong>
        <small className="rule-test-case-item-rule">{detail}</small>
        <small className="rule-test-case-item-path">
          {item.relativePath ?? item.filePath ?? item.displayName}
        </small>
      </span>
      <span className="rule-test-case-item-actions">
        {item.filePath ? (
          <span
            role="button"
            tabIndex={0}
            className="rule-test-case-item-delete"
            title="删除用例文件"
            aria-label={`删除用例 ${title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
                onDelete();
              }
            }}
          >
            <Trash2 aria-hidden="true" />
          </span>
        ) : null}
        <span className={`rule-test-case-status ${item.status}`}>
          {STATUS_LABELS[item.status]}
        </span>
      </span>
    </button>
  );
}

export function RuleTestCaseList({
  currentItem,
  items,
  recentItems,
  libraryDirectory,
  batchRunState,
  batchCompletedCount,
  batchTotalCount,
  onCreateCase,
  onOpenDirectory,
  onSelect,
  onDelete,
}: RuleTestCaseListProps) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<RuleTestLibraryStatusFilter>("all");
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // 合并用例数据：以目录用例为核心，如果当前工程不在目录中（如未保存的新建用例或外部用例），则置顶显示
  const displayList = useMemo<RuleTestCaseLibraryViewItem[]>(() => {
    if (items.length > 0) {
      const isCurrentInLibrary = items.some(
        (item) =>
          item.key === currentItem.key ||
          (currentItem.filePath && item.filePath === currentItem.filePath),
      );
      return isCurrentInLibrary ? items : [currentItem, ...items];
    }
    if (recentItems.length > 0) {
      const isCurrentInRecent = recentItems.some(
        (item) =>
          item.key === currentItem.key ||
          (currentItem.filePath && item.filePath === currentItem.filePath),
      );
      return isCurrentInRecent ? recentItems : [currentItem, ...recentItems];
    }
    return [currentItem];
  }, [currentItem, items, recentItems]);

  const tags = useMemo(
    () => collectRuleTestLibraryTags(displayList),
    [displayList],
  );

  useEffect(() => {
    if (tag && !tags.includes(tag)) setTag("");
  }, [tag, tags]);

  const filter = useMemo(
    () => ({ query, tag: tag || undefined, status }),
    [query, status, tag],
  );

  const visibleItems = useMemo(
    () => filterRuleTestCaseLibraryItems(displayList, filter),
    [displayList, filter],
  );

  const isItemActive = (item: RuleTestCaseLibraryViewItem) => {
    if (item.key === currentItem.key) return true;
    if (currentItem.filePath && item.filePath === currentItem.filePath)
      return true;
    return false;
  };

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    item: RuleTestCaseLibraryViewItem,
  ) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const currentIndex = visibleItems.findIndex(
      (candidate) => candidate.key === item.key,
    );
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = Math.min(
      visibleItems.length - 1,
      Math.max(0, currentIndex + direction),
    );
    rowRefs.current.get(visibleItems[nextIndex]?.key)?.focus();
  };

  const renderItem = (item: RuleTestCaseLibraryViewItem) => (
    <CaseItem
      key={item.key}
      item={item}
      active={isItemActive(item)}
      buttonRef={(button) => {
        if (button) rowRefs.current.set(item.key, button);
        else rowRefs.current.delete(item.key);
      }}
      onSelect={() => {
        if (
          !isItemActive(item) &&
          item.testCase &&
          item.issues.length === 0
        ) {
          onSelect(item.key);
        }
      }}
      onDelete={() => onDelete(item.key)}
      onKeyDown={(event) => moveFocus(event, item)}
    />
  );

  const directoryFolderName = libraryDirectory
    ? libraryDirectory.split(/[\\/]/).filter(Boolean).at(-1)
    : undefined;

  return (
    <div className="rule-test-case-list">
      <div className="rule-test-case-search">
        <Search aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索规则用例"
          value={query}
          placeholder="搜索用例标题、规则或标签..."
          onChange={(event) => setQuery(event.target.value)}
        />
        <IconButton
          label="新建规则用例"
          icon={<FilePlus2 />}
          onClick={onCreateCase}
        />
        <IconButton
          label="打开用例目录"
          icon={<FolderTree />}
          onClick={onOpenDirectory}
        />
      </div>

      {tags.length > 0 ? (
        <div className="rule-test-case-filter-row">
          <select
            aria-label="按标签筛选"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          >
            <option value="">全部标签（{tags.length}）</option>
            {tags.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="rule-test-case-filters" aria-label="按运行状态筛选">
        {(["all", "passed", "failed", "idle"] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={status === value ? "is-active" : ""}
            onClick={() => setStatus(value)}
          >
            {value === "all"
              ? "全部"
              : value === "passed"
                ? "通过"
                : value === "failed"
                  ? "失败"
                  : "未运行"}
          </button>
        ))}
      </div>

      <div className="rule-test-directory-bar" title={libraryDirectory}>
        <FolderTree className="rule-test-directory-icon" aria-hidden="true" />
        <div className="rule-test-directory-info">
          <strong className="rule-test-directory-title">
            {directoryFolderName ?? "未选择用例目录"}
          </strong>
          {libraryDirectory ? (
            <small className="rule-test-directory-path">
              {libraryDirectory}
            </small>
          ) : null}
        </div>
        <span className="rule-test-count-badge">{visibleItems.length}</span>
      </div>

      {batchRunState !== "idle" ? (
        <div className={`rule-test-batch-progress ${batchRunState}`}>
          <span>
            {batchRunState === "running"
              ? "批量运行中..."
              : batchRunState === "completed"
                ? "批量运行完成"
                : "批量运行已取消"}
          </span>
          <strong>
            {batchCompletedCount} / {batchTotalCount}
          </strong>
        </div>
      ) : null}

      <div className="rule-test-case-items">
        {visibleItems.length > 0 ? (
          visibleItems.map(renderItem)
        ) : (
          <div className="rule-test-empty-box" style={{ margin: "14px 10px" }}>
            <span>没有匹配的用例</span>
            <small>
              {query || tag || status !== "all"
                ? "可尝试清除搜索关键字或筛选状态"
                : "点击上方按钮新建用例或打开目录"}
            </small>
          </div>
        )}
      </div>
    </div>
  );
}
