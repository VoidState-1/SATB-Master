import { FileUp, FolderTree, Search } from "lucide-react";
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
  onOpen(): void;
  onOpenDirectory(): void;
  onSelect(key: string): void;
}

const STATUS_LABELS: Record<RuleTestLibraryStatus, string> = {
  idle: "未运行",
  running: "运行中",
  passed: "通过",
  failed: "失败",
  error: "错误",
  invalid: "无效",
};

function identity(item: RuleTestCaseLibraryViewItem) {
  return item.filePath ?? item.key;
}

function CaseItem({
  item,
  active,
  buttonRef,
  onSelect,
  onKeyDown,
}: {
  item: RuleTestCaseLibraryViewItem;
  active: boolean;
  buttonRef(button: HTMLButtonElement | null): void;
  onSelect(): void;
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
        <strong>
          {title}
          {item.dirty ? " *" : ""}
        </strong>
        <small>{detail}</small>
        <small>{item.relativePath ?? item.filePath ?? item.displayName}</small>
      </span>
      <span className={`rule-test-case-status ${item.status}`}>
        {STATUS_LABELS[item.status]}
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
  onOpen,
  onOpenDirectory,
  onSelect,
}: RuleTestCaseListProps) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<RuleTestLibraryStatusFilter>("all");
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const allItems = useMemo(
    () => [currentItem, ...items, ...recentItems],
    [currentItem, items, recentItems],
  );
  const tags = useMemo(() => collectRuleTestLibraryTags(allItems), [allItems]);
  useEffect(() => {
    if (tag && !tags.includes(tag)) setTag("");
  }, [tag, tags]);
  const filter = useMemo(
    () => ({ query, tag: tag || undefined, status }),
    [query, status, tag],
  );
  const visibleCurrent = filterRuleTestCaseLibraryItems([currentItem], filter);
  const visibleLibrary = filterRuleTestCaseLibraryItems(
    items.filter((item) => item.key !== currentItem.key),
    filter,
  );
  const represented = new Set([identity(currentItem), ...items.map(identity)]);
  const visibleRecent = filterRuleTestCaseLibraryItems(
    recentItems.filter((item) => !represented.has(identity(item))),
    filter,
  );
  const visibleItems = [...visibleCurrent, ...visibleLibrary, ...visibleRecent];
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
      active={item.key === currentItem.key}
      buttonRef={(button) => {
        if (button) rowRefs.current.set(item.key, button);
        else rowRefs.current.delete(item.key);
      }}
      onSelect={() => {
        if (
          item.key !== currentItem.key &&
          item.testCase &&
          item.issues.length === 0
        )
          onSelect(item.key);
      }}
      onKeyDown={(event) => moveFocus(event, item)}
    />
  );

  return (
    <div className="rule-test-case-list">
      <div className="rule-test-case-search">
        <Search aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索规则用例"
          value={query}
          placeholder="标题、规则或标签"
          onChange={(event) => setQuery(event.target.value)}
        />
        <IconButton label="打开规则用例" icon={<FileUp />} onClick={onOpen} />
        <IconButton
          label="打开用例目录"
          icon={<FolderTree />}
          onClick={onOpenDirectory}
        />
      </div>
      <div className="rule-test-case-filter-row">
        <select
          aria-label="按标签筛选"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
        >
          <option value="">全部标签</option>
          {tags.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
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
      {batchRunState !== "idle" ? (
        <div className={`rule-test-batch-progress ${batchRunState}`}>
          <span>
            {batchRunState === "running"
              ? "批量运行"
              : batchRunState === "completed"
                ? "批量完成"
                : "批量已取消"}
          </span>
          <strong>
            {batchCompletedCount}/{batchTotalCount}
          </strong>
        </div>
      ) : null}
      <div className="rule-test-case-items">
        {visibleCurrent.length > 0 ? (
          <section className="rule-test-case-section">
            <h3>当前</h3>
            {visibleCurrent.map(renderItem)}
          </section>
        ) : null}
        <section className="rule-test-case-section">
          <h3 title={libraryDirectory}>
            目录
            <small>{libraryDirectory ?? "未选择"}</small>
          </h3>
          {visibleLibrary.length > 0 ? (
            visibleLibrary.map(renderItem)
          ) : (
            <div className="rule-test-empty">没有符合筛选条件的目录用例</div>
          )}
        </section>
        {visibleRecent.length > 0 ? (
          <section className="rule-test-case-section">
            <h3>最近</h3>
            {visibleRecent.map(renderItem)}
          </section>
        ) : null}
      </div>
    </div>
  );
}
