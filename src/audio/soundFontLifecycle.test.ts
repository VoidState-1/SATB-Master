import { describe, expect, it, vi } from 'vitest'
import { installExclusiveSoundFont, type SoundFontSynthHost } from './soundFontLifecycle'

function createSynth(events: string[], label: string): SoundFontSynthHost {
  return {
    destroy: vi.fn(() => events.push(`destroy:${label}`)),
    soundBankManager: {
      addSoundBank: vi.fn(async (_buffer, id) => { events.push(`add:${label}:${id}`) }),
    },
  }
}

describe('exclusive SoundFont lifecycle', () => {
  it('destroys the old worklet before installing a replacement bank', async () => {
    const events: string[] = []
    const oldSynth = createSynth(events, 'old')
    const newSynth = createSynth(events, 'new')
    const result = await installExclusiveSoundFont(
      oldSynth,
      'default',
      new ArrayBuffer(4),
      'user:hash',
      async () => newSynth,
    )

    expect(result).toEqual({ synth: newSynth, changed: true })
    expect(events).toEqual(['destroy:old', 'add:new:user:hash'])
  })

  it('does not rebuild or reload an already active bank', async () => {
    const events: string[] = []
    const synth = createSynth(events, 'current')
    const createReplacement = vi.fn(async () => createSynth(events, 'unused'))
    const result = await installExclusiveSoundFont(
      synth,
      'user:hash',
      new ArrayBuffer(4),
      'user:hash',
      createReplacement,
    )

    expect(result).toEqual({ synth, changed: false })
    expect(createReplacement).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})
