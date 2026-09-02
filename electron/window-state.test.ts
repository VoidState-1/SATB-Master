import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_STATE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  sanitizeWindowState,
} from './window-state'

describe('window-state sanitize', () => {
  it('falls back to default state when input is empty or invalid', () => {
    expect(sanitizeWindowState(null)).toEqual(DEFAULT_WINDOW_STATE)
    expect(sanitizeWindowState(undefined)).toEqual(DEFAULT_WINDOW_STATE)
    expect(sanitizeWindowState('invalid')).toEqual(DEFAULT_WINDOW_STATE)
    expect(sanitizeWindowState({})).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('clamps width and height to minimum thresholds', () => {
    const sanitized = sanitizeWindowState({
      width: 400,
      height: 300,
      isMaximized: false,
    })
    expect(sanitized.width).toBe(MIN_WINDOW_WIDTH)
    expect(sanitized.height).toBe(MIN_WINDOW_HEIGHT)
  })

  it('preserves valid bounds and maximized flag', () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }]
    const sanitized = sanitizeWindowState(
      {
        width: 1400,
        height: 900,
        x: 100,
        y: 80,
        isMaximized: true,
      },
      displays,
    )
    expect(sanitized.width).toBe(1400)
    expect(sanitized.height).toBe(900)
    expect(sanitized.x).toBe(100)
    expect(sanitized.y).toBe(80)
    expect(sanitized.isMaximized).toBe(true)
  })

  it('discards off-screen coordinates when displays are known', () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }]
    const sanitized = sanitizeWindowState(
      {
        width: 1200,
        height: 800,
        x: 5000,
        y: 4000,
        isMaximized: false,
      },
      displays,
    )
    expect(sanitized.width).toBe(1200)
    expect(sanitized.height).toBe(800)
    expect(sanitized.x).toBeUndefined()
    expect(sanitized.y).toBeUndefined()
  })
})
