import { FolderOpen, Search } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { HarmonyRuleTestCase } from "../../domain/harmony";
import { useMemo, useState } from "react";

interface RuleTestCaseListProps {
  testCase: HarmonyRuleTestCase;
  dirty: boolean;
  runState: "idle" | "running" | "passed" | "failed" | "error";
  filePath?: string;
  onOpen(): void;
}

export function RuleTestCaseList({
  testCase,
  dirty,
  runState,
  filePath,
  onOpen,
}: RuleTestCaseListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "passed" | "failed" | "idle">(
    "all",
  );
  const visible = useMemo(() => {
    const text = `${testCase.title} ${testCase.target.ruleId} ${testCase.tags.join(" ")}`.toLowerCase();
    const queryMatches = text.includes(query.trim().toLowerCase());
    const statusMatches =
      filter === "all" ||
      (filter === "passed" && runState === "passed") ||
      (filter === "failed" && ["failed", "error"].includes(runState)) ||
      (filter === "idle" && runState === "idle");
    return queryMatches && statusMatches;
  }, [filter, query, runState, testCase]);

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
        <IconButton label="打开规则用例" icon={<FolderOpen />} onClick={onOpen} />
      </div>
      <div className="rule-test-case-filters" aria-label="按运行状态筛选">
        {(["all", "passed", "failed", "idle"] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={filter === value ? "is-active" : ""}
            onClick={() => setFilter(value)}
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
      <div className="rule-test-case-items">
        {visible ? (
          <button type="button" className="rule-test-case-item is-active">
            <span className={`rule-test-case-state ${runState}`} />
            <span>
              <strong>
                {testCase.title}
                {dirty ? " *" : ""}
              </strong>
              <small>{testCase.target.ruleId}</small>
              <small>{filePath ?? "未保存用例"}</small>
            </span>
          </button>
        ) : (
          <div className="rule-test-empty">没有符合筛选条件的用例</div>
        )}
      </div>
    </div>
  );
}
