import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Info,
  Lightbulb,
} from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type {
  HarmonyCheckResult,
  HarmonyDiagnostic,
} from "../../domain/harmony";
import { formatPosition } from "../../domain/time";
import type { ProjectDocument } from "../../domain/project";

function isExternalRuleUnavailable(item: HarmonyCheckResult["skippedRules"][number]) {
  return item.ruleId.startsWith("external:") && item.reason === "insufficient-context";
}

export interface DiagnosticsPanelProps {
  project: ProjectDocument;
  result: HarmonyCheckResult;
  onSelect(diagnostic: HarmonyDiagnostic): void;
  onToggleIgnored(diagnostic: HarmonyDiagnostic): void;
  onCopy?(diagnostic: HarmonyDiagnostic): void;
  developerMode?: boolean;
  hideHeader?: boolean;
}

export function DiagnosticsSummary({
  result,
  ignoredCount = 0,
}: {
  result: HarmonyCheckResult;
  ignoredCount?: number;
}) {
  const errors = result.diagnostics.filter(
    (item) => item.severity === "error",
  ).length;
  const warnings = result.diagnostics.filter(
    (item) => item.severity === "warning",
  ).length;
  const suggestions = result.diagnostics.filter(
    (item) => item.severity === "suggestion",
  ).length;
  const fullySkipped = result.skippedRules.filter((item) => !item.partial);
  const partiallySkipped = result.skippedRules.filter((item) => item.partial);
  const skippedSummary = [
    ...new Set(result.skippedRules.map((item) => item.message)),
  ].join("\n");

  return (
    <div className="diagnostics-summary-group">
      <span className="diagnostics-counts">
        {errors} 个错误 · {warnings} 个警告 · {suggestions} 个建议
        {ignoredCount > 0 ? ` · ${ignoredCount} 条已忽略` : ""}
      </span>
      {result.diagnostics.length === 0 && !result.skippedRules.some(isExternalRuleUnavailable) ? (
        <span className="diagnostic-clear">
          <CheckCircle2 /> 当前范围未发现问题
        </span>
      ) : null}
      {result.skippedRules.length > 0 ? (
        <span className="skipped-rules" title={skippedSummary}>
          <Info />
          {fullySkipped.length > 0
            ? ` 已跳过 ${fullySkipped.length} 条规则`
            : ""}
          {fullySkipped.length > 0 && partiallySkipped.length > 0
            ? " · "
            : ""}
          {partiallySkipped.length > 0
            ? `${partiallySkipped.length} 条规则仅检查了上下文完整的部分`
            : ""}
        </span>
      ) : null}
    </div>
  );
}

export function DiagnosticsPanel({
  project,
  result,
  onSelect,
  onToggleIgnored,
  onCopy,
  developerMode = false,
  hideHeader = false,
}: DiagnosticsPanelProps) {
  const ignoredDiagnosticIds = new Set(
    project.diagnosticPreferences.ignoredDiagnosticIds,
  );
  const ignoredCount = result.diagnostics.filter((item) =>
    ignoredDiagnosticIds.has(item.id),
  ).length;
  const unavailable = result.skippedRules.filter(isExternalRuleUnavailable);

  return (
    <section
      className={`diagnostics-panel ${hideHeader ? "no-header" : ""}`}
      aria-label="和声检查结果"
    >
      {!hideHeader ? (
        <header className="diagnostics-header">
          <div>
            <strong>问题</strong>
          </div>
          <DiagnosticsSummary result={result} ignoredCount={ignoredCount} />
        </header>
      ) : null}
      <div className="diagnostic-list">
        {unavailable.length > 0 ? (
          <ul aria-label="外置规则输入不足">
            {unavailable.map((item) => <li key={item.ruleId}>{item.message}</li>)}
          </ul>
        ) : null}
        {result.diagnostics.map((item) => {
          const ignored = ignoredDiagnosticIds.has(item.id);
          return (
            <div
              key={item.id}
              className={
                `diagnostic-item ${item.severity} ${ignored ? "ignored" : ""}`
              }
            >
              <button
                type="button"
                className="diagnostic-select"
                onClick={() => onSelect(item)}
              >
                {item.severity === "error" ? (
                  <AlertCircle />
                ) : item.severity === "warning" ? (
                  <AlertTriangle />
                ) : (
                  <Lightbulb />
                )}
                <span className="diagnostic-position">
                  {formatPosition(project, item.tick)}
                </span>
                <span className="diagnostic-copy">
                  <strong>
                    {item.title}
                    {ignored ? <em>已忽略</em> : null}
                  </strong>
                  <small>{item.message}</small>
                </span>
              </button>
              <IconButton
                className="diagnostic-ignore-button"
                label={ignored ? "取消忽略此问题" : "忽略此问题"}
                aria-pressed={ignored}
                icon={
                  ignored ? (
                    <Eye aria-hidden="true" />
                  ) : (
                    <EyeOff aria-hidden="true" />
                  )
                }
                onClick={() => onToggleIgnored(item)}
              />
              {developerMode && onCopy ? (
                <IconButton
                  className="diagnostic-copy-button"
                  label="复制此问题的调试信息"
                  icon={<Copy aria-hidden="true" />}
                  onClick={() => onCopy(item)}
                />
              ) : null}
              {item.consequences?.length ? (
                <details className="diagnostic-consequences">
                  <summary>含 {item.consequences.length} 条连带提示</summary>
                  <ul>
                    {item.consequences.map(child => (
                      <li key={child.id}>
                        <strong>{child.title}</strong> <code>{child.ruleId}</code>
                        <div>{child.message}</div>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
