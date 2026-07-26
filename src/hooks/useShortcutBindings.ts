import { useCallback, useState } from 'react'
import {
  SHORTCUT_DEFINITIONS,
  defaultShortcutBindings,
  type ShortcutBindings,
  type ShortcutCommandId,
} from '../shortcuts/shortcutRegistry'

const STORAGE_KEY = 'satb-master-shortcuts-v1'

function readStoredBindings() {
  const defaults = defaultShortcutBindings()
  if (typeof window === 'undefined') return defaults
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '') as Partial<Record<ShortcutCommandId, unknown>>
    SHORTCUT_DEFINITIONS.forEach((definition) => {
      const bindings = stored[definition.id]
      if (Array.isArray(bindings) && bindings.every((binding) => typeof binding === 'string')) {
        defaults[definition.id] = [...new Set(bindings)]
      }
    })
  } catch {
    // 损坏或来自旧版本的快捷键偏好不应阻止编辑器启动。
  }
  return defaults
}

function persistBindings(bindings: ShortcutBindings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    // 受限环境无法持久化时，当前会话中的重映射仍然有效。
  }
}

export function useShortcutBindings() {
  const [bindings, setBindingsState] = useState<ShortcutBindings>(readStoredBindings)

  const update = useCallback((recipe: (current: ShortcutBindings) => ShortcutBindings) => {
    setBindingsState((current) => {
      const next = recipe(current)
      persistBindings(next)
      return next
    })
  }, [])

  const setBinding = useCallback((commandId: ShortcutCommandId, binding: string) => update((current) => ({
    ...current,
    [commandId]: [binding],
  })), [update])

  const clearBinding = useCallback((commandId: ShortcutCommandId) => update((current) => ({
    ...current,
    [commandId]: [],
  })), [update])

  const resetBinding = useCallback((commandId: ShortcutCommandId) => {
    const definition = SHORTCUT_DEFINITIONS.find((candidate) => candidate.id === commandId)
    if (!definition) return
    update((current) => ({ ...current, [commandId]: [...definition.defaultBindings] }))
  }, [update])

  const resetAllBindings = useCallback(() => update(() => defaultShortcutBindings()), [update])

  return { bindings, setBinding, clearBinding, resetBinding, resetAllBindings }
}
