import { LocateFixed, Plus, RefreshCw, Trash2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type {
  ExpectedDiagnostic,
  HarmonyDiagnostic,
  RuleTestRunResult,
} from "../../domain/harmony";
import type { ProjectDocument } from "../../domain/project";
import { formatPosition } from "../../domain/time";
import { RuleTestDiagnosticRow } from "./RuleTestDiagnosticRow";

interface RuleTestResultsPanelProps {
  project: ProjectDocument;
  runState: "idle" | "running" | "passed" | "failed" | "error";
  result?: RuleTestRunResult;
  selectedExpectationId?: string;
  onSelectExpected(expectation: ExpectedDiagnostic): void;
  onSelectActual(diagnostic: HarmonyDiagnostic): void;
  onAddActual(diagnostic: HarmonyDiagnostic): void;
  onUpdateSelected(diagnostic: HarmonyDiagnostic): void;
  onUpdateExpectedFromActual(
    expectationId: string,
    diagnostic: HarmonyDiagnostic,
  ): void;
  onDeleteExpected(expectationId: string): void;
}

function references(
  item: Pick<ExpectedDiagnostic, "noteIds" | "chordIds" | "voiceIds">,
) {
  return [
    item.voiceIds?.join("/"),
    item.noteIds?.join(", "),
    item.chordIds?.join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function RuleTestResultsPanel({
  project,
  runState,
  result,
  selectedExpectationId,
  onSelectExpected,
  onSelectActual,
  onAddActual,
  onUpdateSelected,
  onUpdateExpectedFromActual,
  onDeleteExpected,
}: RuleTestResultsPanelProps) {
  const comparison = result?.comparison;
  const counts = {
    match: comparison?.matches.length ?? 0,
    missing: comparison?.missing.length ?? 0,
    unexpected: comparison?.unexpected.length ?? 0,
    mismatched: comparison?.mismatched.length ?? 0,
  };
  return (
    <section className="rule-test-results" aria-label="规则测试比较结果">
      <header className="rule-test-results-header">
        <strong>结果</strong>
        <span>匹配 {counts.match}</span>
        <span>缺失 {counts.missing}</span>
        <span>意外 {counts.unexpected}</span>
        <span>不一致 {counts.mismatched}</span>
        <span className={`rule-test-run-summary ${runState}`}>
          {runState === "running"
            ? "运行中"
            : runState === "passed"
              ? "通过"
              : runState === "failed"
                ? "失败"
                : runState === "error"
                  ? "执行错误"
                  : "未运行"}
        </span>
      </header>
      <div className="rule-test-result-list">
        {result?.status === "error" ? (
          <RuleTestDiagnosticRow
            kind="error"
            title={result.error?.message ?? "规则执行失败"}
            detail={result.error?.code}
          />
        ) : null}
        {comparison?.matches.map(({ expected, actual }) => (
          <RuleTestDiagnosticRow
            key={`match:${expected.id}`}
            kind="match"
            position={formatPosition(project, actual.tick)}
            title={actual.title}
            detail={`${expected.id} · ${references(actual)}`}
            onSelect={() => onSelectActual(actual)}
            actions={
              <IconButton
                label="定位实际诊断"
                icon={<LocateFixed />}
                onClick={() => onSelectActual(actual)}
              />
            }
          />
        ))}
        {comparison?.missing.map((expected) => (
          <RuleTestDiagnosticRow
            key={`missing:${expected.id}`}
            kind="missing"
            position={formatPosition(project, expected.tick)}
            title={expected.messageKey}
            detail={`${expected.id} · ${references(expected)}`}
            onSelect={() => onSelectExpected(expected)}
            actions={
              <>
                <IconButton
                  label="定位预期诊断"
                  icon={<LocateFixed />}
                  onClick={() => onSelectExpected(expected)}
                />
                <IconButton
                  label="删除预期诊断"
                  icon={<Trash2 />}
                  onClick={() => onDeleteExpected(expected.id)}
                />
              </>
            }
          />
        ))}
        {comparison?.unexpected.map((actual) => (
          <RuleTestDiagnosticRow
            key={`unexpected:${actual.id}`}
            kind="unexpected"
            position={formatPosition(project, actual.tick)}
            title={actual.title}
            detail={`${actual.messageKey} · ${references(actual)}`}
            onSelect={() => onSelectActual(actual)}
            actions={
              <>
                <IconButton
                  label="添加为预期"
                  icon={<Plus />}
                  onClick={() => onAddActual(actual)}
                />
                <IconButton
                  label="更新选中预期"
                  icon={<RefreshCw />}
                  disabled={!selectedExpectationId}
                  onClick={() => onUpdateSelected(actual)}
                />
              </>
            }
          />
        ))}
        {comparison?.mismatched.map(({ expected, actual, differences }) => (
          <RuleTestDiagnosticRow
            key={`mismatched:${expected.id}`}
            kind="mismatched"
            position={formatPosition(project, actual.tick)}
            title={actual.title}
            detail={differences
              .map(
                (item) =>
                  `${item.field}: ${JSON.stringify(item.expected)} -> ${JSON.stringify(item.actual)}`,
              )
              .join(" · ")}
            onSelect={() => onSelectActual(actual)}
            actions={
              <>
                <IconButton
                  label="选择原预期"
                  icon={<LocateFixed />}
                  onClick={() => onSelectExpected(expected)}
                />
                <IconButton
                  label="用实际结果更新预期"
                  icon={<RefreshCw />}
                  onClick={() =>
                    onUpdateExpectedFromActual(expected.id, actual)
                  }
                />
              </>
            }
          />
        ))}
        {comparison?.skipMismatches.map((skip, index) => (
          <RuleTestDiagnosticRow
            key={`skip:${index}`}
            kind="skip"
            title={skip.kind === "missing" ? "缺少预期跳过" : "出现意外跳过"}
            detail={`${skip.expected?.reason ?? skip.actual?.reason} · partial=${skip.expected?.partial ?? skip.actual?.partial}`}
          />
        ))}
        {!result && runState !== "running" ? (
          <div className="rule-test-empty">当前用例尚未运行</div>
        ) : null}
        {runState === "running" ? (
          <div className="rule-test-empty">正在隔离运行目标规则...</div>
        ) : null}
      </div>
    </section>
  );
}
