import { AlertCircle, AlertTriangle, CheckCircle2, Info, Lightbulb } from 'lucide-react'
import type { HarmonyCheckResult, HarmonyDiagnostic } from '../domain/harmony'
import { formatPosition } from '../domain/time'
import type { ProjectDocument } from '../domain/model'

interface DiagnosticsPanelProps {
  project: ProjectDocument
  result: HarmonyCheckResult
  onSelect(diagnostic: HarmonyDiagnostic): void
}

export function DiagnosticsPanel({ project, result, onSelect }: DiagnosticsPanelProps) {
  const errors = result.diagnostics.filter((item) => item.severity === 'error').length
  const warnings = result.diagnostics.filter((item) => item.severity === 'warning').length
  const suggestions = result.diagnostics.filter((item) => item.severity === 'suggestion').length

  return (
    <section className="diagnostics-panel" aria-label="和声检查结果">
      <header className="diagnostics-header">
        <div>
          <strong>问题</strong>
          <span>{errors} 个错误 · {warnings} 个警告 · {suggestions} 个建议</span>
        </div>
        {result.diagnostics.length === 0 ? (
          <span className="diagnostic-clear"><CheckCircle2 /> 当前范围未发现问题</span>
        ) : null}
        {result.skippedRuleIds.length > 0 ? (
          <span className="skipped-rules"><Info /> 和弦轨为空，已跳过 {result.skippedRuleIds.length} 组和弦规则</span>
        ) : null}
      </header>
      <div className="diagnostic-list">
        {result.diagnostics.map((item) => (
          <button type="button" key={item.id} className={`diagnostic-item ${item.severity}`} onClick={() => onSelect(item)}>
            {item.severity === 'error' ? <AlertCircle /> : item.severity === 'warning' ? <AlertTriangle /> : <Lightbulb />}
            <span className="diagnostic-position">{formatPosition(project, item.tick)}</span>
            <span className="diagnostic-copy"><strong>{item.title}</strong><small>{item.message}</small></span>
          </button>
        ))}
      </div>
    </section>
  )
}
