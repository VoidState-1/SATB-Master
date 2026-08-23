import { describe, expect, it } from 'vitest'
import { findReactDevToolsPath, getBrowserUserDataDirectories } from './dev-extensions'

describe('React DevTools auto-detection', () => {
  it('returns valid browser user data directories for current platform', () => {
    const dirs = getBrowserUserDataDirectories()
    expect(dirs.length).toBeGreaterThan(0)
  })

  it('can execute search without crashing', async () => {
    const result = await findReactDevToolsPath()
    // It should either find the installed extension path string or return undefined
    if (result !== undefined) {
      expect(typeof result).toBe('string')
      expect(result).toContain('fmkadmapgofadopljbjfkapdkoienihi')
    }
  })
})
