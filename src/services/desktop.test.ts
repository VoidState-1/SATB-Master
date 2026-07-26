import { describe, expect, it } from 'vitest'
import { readSoundFontBuffer } from './desktop'

describe('SoundFont streaming reader', () => {
  it('assembles streamed bytes into one exact-sized ArrayBuffer', async () => {
    const progress: number[] = []
    const buffer = await readSoundFontBuffer(
      'data:application/octet-stream;base64,AQIDBA==',
      4,
      (processedBytes) => progress.push(processedBytes),
    )

    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4])
    expect(progress.at(0)).toBe(0)
    expect(progress.at(-1)).toBe(4)
  })

  it('rejects data that no longer matches the preflight size', async () => {
    await expect(readSoundFontBuffer('data:application/octet-stream;base64,AQIDBA==', 3))
      .rejects.toThrow('文件大小在加载过程中发生了变化')
  })
})
