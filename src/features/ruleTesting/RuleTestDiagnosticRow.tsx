import type { ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  GitCompareArrows,
} from "lucide-react";

export type RuleTestResultKind =
  | "match"
  | "missing"
  | "unexpected"
  | "mismatched"
  | "skip"
  | "error";

interface RuleTestDiagnosticRowProps {
  kind: RuleTestResultKind;
  position?: string;
  title: string;
  detail?: string;
  actions?: ReactNode;
  onSelect?(): void;
}

export function RuleTestDiagnosticRow({
  kind,
  position,
  title,
  detail,
  actions,
  onSelect,
}: RuleTestDiagnosticRowProps) {
  const icon =
    kind === "match" ? (
      <CheckCircle2 />
    ) : kind === "missing" ? (
      <CircleDashed />
    ) : kind === "unexpected" || kind === "error" ? (
      <AlertCircle />
    ) : kind === "mismatched" ? (
      <GitCompareArrows />
    ) : (
      <AlertTriangle />
    );
  return (
    <div
      className={`rule-test-result-row ${kind} ${onSelect ? "is-selectable" : ""}`}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (onSelect && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="rule-test-result-icon">{icon}</span>
      <span className="rule-test-result-position">{position ?? "-"}</span>
      <span className="rule-test-result-copy">
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {actions ? (
        <span
          className="rule-test-result-actions"
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </span>
      ) : null}
    </div>
  );
}
