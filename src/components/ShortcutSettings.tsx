import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Keyboard, RotateCcw, Search, Settings2, X } from 'lucide-react'
import {
  SHORTCUT_DEFINITIONS,
  SHORTCUT_GROUPS,
  formatShortcutBinding,
  keyboardEventToBinding,
  type ShortcutBindings,
  type ShortcutCommandId,
} from '../shortcuts/shortcutRegistry'
import { IconButton } from './IconButton'

interface ShortcutSettingsProps {
  bindings: ShortcutBindings
  onSetBinding(commandId: ShortcutCommandId, binding: string): void
  onClearBinding(commandId: ShortcutCommandId): void
  onResetBinding(commandId: ShortcutCommandId): void
  onResetAll(): void
  onClose(): void
}

function sameBindings(left: string[], right: string[]) {
  return left.length === right.length && left.every((binding, index) => binding === right[index])
}

export function ShortcutSettings({
  bindings,
  onSetBinding,
  onClearBinding,
  onResetBinding,
  onResetAll,
  onClose,
}: ShortcutSettingsProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState('')
  const [capturing, setCapturing] = useState<ShortcutCommandId>()
  const [captureError, setCaptureError] = useState<string>()

  useEffect(() => searchRef.current?.focus(), [])

  useEffect(() => {
    if (!capturing) return
    const handleCapture = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const binding = keyboardEventToBinding(event)
      if (!binding) return
      if (binding === 'Escape') {
        setCapturing(undefined)
        setCaptureError(undefined)
        return
      }
      const conflict = SHORTCUT_DEFINITIONS.find((definition) => (
        definition.id !== capturing && bindings[definition.id].includes(binding)
      ))
      if (conflict) {
        setCaptureError(`“${formatShortcutBinding(binding)}”已用于“${conflict.label}”`)
        return
      }
      onSetBinding(capturing, binding)
      setCapturing(undefined)
      setCaptureError(undefined)
    }
    window.addEventListener('keydown', handleCapture, true)
    return () => window.removeEventListener('keydown', handleCapture, true)
  }, [bindings, capturing, onSetBinding])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredDefinitions = useMemo(() => SHORTCUT_DEFINITIONS.filter((definition) => {
    if (!normalizedQuery) return true
    const bindingText = bindings[definition.id].map(formatShortcutBinding).join(' ')
    return `${definition.label} ${bindingText}`.toLocaleLowerCase().includes(normalizedQuery)
  }), [bindings, normalizedQuery])

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="settings-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="settings-header">
          <Settings2 aria-hidden="true" />
          <h2 id="settings-title">设置</h2>
          <IconButton label="关闭设置" icon={<X />} onClick={onClose} />
        </header>

        <div className="settings-layout">
          <nav className="settings-tabs" aria-label="设置分类">
            <button type="button" className="is-active" aria-current="page">
              <Keyboard aria-hidden="true" />
              <span>快捷键</span>
            </button>
          </nav>

          <div className="shortcut-settings-content">
            <div className="shortcut-settings-toolbar">
              <label className="settings-search">
                <Search aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  placeholder="搜索命令或按键"
                  aria-label="搜索快捷键"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button type="button" className="command-button" onClick={onResetAll}>
                <RotateCcw aria-hidden="true" />
                恢复默认
              </button>
            </div>

            {captureError ? <div className="shortcut-capture-error" role="alert">{captureError}</div> : null}

            <div className="shortcut-groups">
              {SHORTCUT_GROUPS.map((group) => {
                const definitions = filteredDefinitions.filter((definition) => definition.group === group.id)
                if (definitions.length === 0) return null
                return (
                  <section className="shortcut-group" key={group.id}>
                    <h3>{group.label}</h3>
                    {definitions.map((definition) => {
                      const commandBindings = bindings[definition.id]
                      const isCapturing = capturing === definition.id
                      const isDefault = sameBindings(commandBindings, definition.defaultBindings)
                      return (
                        <div className="shortcut-row" key={definition.id}>
                          <span>{definition.label}</span>
                          <button
                            type="button"
                            className={`shortcut-binding ${isCapturing ? 'is-capturing' : ''}`}
                            aria-label={`修改“${definition.label}”快捷键`}
                            aria-pressed={isCapturing}
                            onClick={() => {
                              setCapturing(isCapturing ? undefined : definition.id)
                              setCaptureError(undefined)
                            }}
                          >
                            {isCapturing ? <span>等待输入</span> : commandBindings.length > 0
                              ? commandBindings.map((binding) => <kbd key={binding}>{formatShortcutBinding(binding)}</kbd>)
                              : <span className="shortcut-unassigned">未设置</span>}
                          </button>
                          <IconButton
                            label={`清除“${definition.label}”快捷键`}
                            icon={<X />}
                            disabled={commandBindings.length === 0}
                            onClick={() => onClearBinding(definition.id)}
                          />
                          <IconButton
                            label={`恢复“${definition.label}”默认快捷键`}
                            icon={<RotateCcw />}
                            disabled={isDefault}
                            onClick={() => onResetBinding(definition.id)}
                          />
                        </div>
                      )
                    })}
                  </section>
                )
              })}
              {filteredDefinitions.length === 0 ? <div className="shortcut-empty">没有匹配的命令</div> : null}
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}
