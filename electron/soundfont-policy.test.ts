import { describe, expect, it } from 'vitest'
import {
  GIBIBYTE,
  MAX_SOUNDFONT_BYTES,
  MEBIBYTE,
  availableSoundFontMemoryBytes,
  requiredSoundFontMemory,
  validateSoundFontCapacity,
} from './soundfont-policy.js'

describe('SoundFont capacity policy', () => {
  it('uses reclaimable macOS memory without counting overlapping caches twice', () => {
    const memory = { total: 8 * 1024 * 1024, free: 128 * 1024, fileBacked: 640 * 1024, purgeable: 192 * 1024 }
    const available = availableSoundFontMemoryBytes(memory, 'darwin')
    expect(available).toBe(768 * MEBIBYTE)
    expect(validateSoundFontCapacity(4096, available, 'arm64')).toBe(requiredSoundFontMemory(4096))
    expect(availableSoundFontMemoryBytes(memory, 'win32')).toBe(128 * MEBIBYTE)
  })

  it('accepts a 2 GB SoundFont on 64-bit systems with sufficient free memory', () => {
    expect(MAX_SOUNDFONT_BYTES).toBe(2 * GIBIBYTE)
    expect(validateSoundFontCapacity(2 * GIBIBYTE, 4 * GIBIBYTE, 'x64'))
      .toBe(requiredSoundFontMemory(2 * GIBIBYTE))
  })

  it('rejects files larger than 2 GB', () => {
    expect(() => validateSoundFontCapacity(2 * GIBIBYTE + 1, 8 * GIBIBYTE, 'x64'))
      .toThrow('超过 2 GB')
  })

  it('rejects a load when parser headroom would consume available memory', () => {
    expect(() => validateSoundFontCapacity(GIBIBYTE, 2 * GIBIBYTE - 1, 'x64'))
      .toThrow('可用内存不足')
  })

  it('keeps large SoundFonts disabled on 32-bit builds', () => {
    expect(() => validateSoundFontCapacity(512 * MEBIBYTE + 1, 8 * GIBIBYTE, 'ia32'))
      .toThrow('需要 64 位版本')
  })
})
