import { useCallback, useState } from 'react'
import {
  HARMONY_RULE_DEFINITIONS,
  defaultHarmonyRuleSeverities,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
  type HarmonyRuleSeverity,
} from '../domain/harmonyRules'

const STORAGE_KEY = 'satb-master-harmony-rules-v1'
const VALID_SEVERITIES = new Set<HarmonyRuleSeverity>(['error', 'warning', 'suggestion', 'off'])

function readStoredSeverities() {
  const defaults = defaultHarmonyRuleSeverities()
  if (typeof window === 'undefined') return defaults
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '') as Partial<Record<HarmonyRuleId, unknown>>
    HARMONY_RULE_DEFINITIONS.forEach((rule) => {
      const severity = stored[rule.id]
      if (typeof severity === 'string' && VALID_SEVERITIES.has(severity as HarmonyRuleSeverity)) {
        defaults[rule.id] = severity as HarmonyRuleSeverity
      }
    })
  } catch {
    // 损坏或旧版本规则偏好不应阻止编辑器启动。
  }
  return defaults
}

function persistSeverities(severities: HarmonyRuleSeverities) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(severities))
  } catch {
    // 受限环境无法持久化时，当前会话中的配置仍然有效。
  }
}

export function useHarmonyRuleSettings() {
  const [severities, setSeveritiesState] = useState<HarmonyRuleSeverities>(readStoredSeverities)

  const update = useCallback((recipe: (current: HarmonyRuleSeverities) => HarmonyRuleSeverities) => {
    setSeveritiesState((current) => {
      const next = recipe(current)
      persistSeverities(next)
      return next
    })
  }, [])

  const setSeverity = useCallback((ruleId: HarmonyRuleId, severity: HarmonyRuleSeverity) => update((current) => ({
    ...current,
    [ruleId]: severity,
  })), [update])

  const resetRule = useCallback((ruleId: HarmonyRuleId) => {
    const definition = HARMONY_RULE_DEFINITIONS.find((candidate) => candidate.id === ruleId)
    if (!definition) return
    update((current) => ({ ...current, [ruleId]: definition.defaultSeverity }))
  }, [update])

  const resetAllRules = useCallback(() => update(() => defaultHarmonyRuleSeverities()), [update])

  return { severities, setSeverity, resetRule, resetAllRules }
}
