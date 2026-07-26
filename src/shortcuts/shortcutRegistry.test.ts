import { describe, expect, it } from 'vitest'
import {
  SHORTCUT_DEFINITIONS,
  commandForKeyboardEvent,
  defaultShortcutBindings,
  formatShortcutBinding,
  keyboardEventToBinding,
} from './shortcutRegistry'

const event = (code: string, options: Partial<KeyboardEvent> = {}) => ({
  code,
  key: options.key ?? '',
  ctrlKey: options.ctrlKey ?? false,
  altKey: options.altKey ?? false,
  shiftKey: options.shiftKey ?? false,
  metaKey: options.metaKey ?? false,
})

describe('shortcut registry', () => {
  it('normalizes modifiers in a stable order', () => {
    expect(keyboardEventToBinding(event('KeyZ', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe('Ctrl+Alt+Shift+KeyZ')
    expect(keyboardEventToBinding(event('ControlLeft', { ctrlKey: true }))).toBeUndefined()
  })

  it('matches default aliases and formats them for display', () => {
    const bindings = defaultShortcutBindings()
    expect(commandForKeyboardEvent(event('KeyZ', { ctrlKey: true, shiftKey: true }), bindings)?.id).toBe('redo')
    expect(commandForKeyboardEvent(event('Tab', { shiftKey: true }), bindings)?.id).toBe('previousVoice')
    expect(formatShortcutBinding('Ctrl+Shift+KeyS')).toBe('Ctrl+Shift+S')
    expect(formatShortcutBinding('BracketLeft')).toBe('[')
  })

  it('does not ship conflicting default bindings', () => {
    const owners = new Map<string, string>()
    SHORTCUT_DEFINITIONS.forEach((definition) => definition.defaultBindings.forEach((binding) => {
      expect(owners.get(binding), `${binding} is assigned twice`).toBeUndefined()
      owners.set(binding, definition.id)
    }))
  })
})
