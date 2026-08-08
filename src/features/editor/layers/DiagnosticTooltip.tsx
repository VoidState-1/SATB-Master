import { DIAGNOSTIC_LABEL } from "../geometry";
import type { DiagnosticTooltipState } from "./types";

interface DiagnosticTooltipProps {
  state?: DiagnosticTooltipState;
}

export function DiagnosticTooltip({ state }: DiagnosticTooltipProps) {
  if (!state) return null;
  return (
    <div
      className={`diagnostic-tooltip ${state.alignLeft ? "align-left" : ""} ${state.alignAbove ? "align-above" : ""}`}
      style={{ left: state.x, top: state.y }}
      role="tooltip"
    >
      <strong>{state.title}</strong>
      <div className="diagnostic-tooltip-list">
        {state.diagnostics.map((diagnostic) => (
          <div
            key={diagnostic.id}
            className={`diagnostic-tooltip-item ${diagnostic.severity}`}
          >
            <span>{DIAGNOSTIC_LABEL[diagnostic.severity]}</span>
            <div>
              <b>{diagnostic.title}</b>
              <small>{diagnostic.message}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
