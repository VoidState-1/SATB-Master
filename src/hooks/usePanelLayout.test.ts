import { describe, expect, it } from 'vitest'
import { DEFAULT_PANEL_SIZES, PANEL_LIMITS, PANEL_RESIZER_SIZE, fitPanelSizes } from './usePanelLayout'

describe('panel layout constraints', () => {
  it('keeps the default layout when the workspace is large enough', () => {
    expect(fitPanelSizes(DEFAULT_PANEL_SIZES, { width: 1280, height: 800 })).toEqual(DEFAULT_PANEL_SIZES)
  })

  it('shrinks both side panels while preserving the editor minimum width', () => {
    const fitted = fitPanelSizes({ left: 320, right: 420, bottom: 182 }, { width: 760, height: 426 })
    expect(fitted.left).toBeGreaterThanOrEqual(PANEL_LIMITS.left.min)
    expect(fitted.right).toBeGreaterThanOrEqual(PANEL_LIMITS.right.min)
    expect(fitted.left + fitted.right + PANEL_RESIZER_SIZE * 2 + PANEL_LIMITS.editor.minWidth).toBeLessThanOrEqual(760)
  })

  it('limits the diagnostics panel to leave the piano roll usable', () => {
    const fitted = fitPanelSizes({ ...DEFAULT_PANEL_SIZES, bottom: 420 }, { width: 1280, height: 520 })
    expect(fitted.bottom + PANEL_RESIZER_SIZE + PANEL_LIMITS.editor.minHeight).toBeLessThanOrEqual(520)
  })

  it('can restore preferred sizes after a temporary narrow layout', () => {
    const preferred = { left: 300, right: 400, bottom: 260 }
    expect(fitPanelSizes(preferred, { width: 760, height: 426 })).not.toEqual(preferred)
    expect(fitPanelSizes(preferred, { width: 1440, height: 900 })).toEqual(preferred)
  })
})
