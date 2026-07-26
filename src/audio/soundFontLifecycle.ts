export interface SoundFontSynthHost {
  destroy(): void
  soundBankManager: {
    addSoundBank(buffer: ArrayBuffer, id: string): Promise<void>
  }
}

export async function installExclusiveSoundFont<T extends SoundFontSynthHost>(
  synth: T,
  currentId: string | undefined,
  buffer: ArrayBuffer,
  nextId: string,
  createReplacement: () => Promise<T>,
) {
  if (currentId === nextId) return { synth, changed: false }

  let target = synth
  if (currentId) {
    // SpessaSynth 不允许删除最后一个 SoundBank；销毁 Worklet 才能保证旧库不会继续参与预置匹配。
    synth.destroy()
    target = await createReplacement()
  }
  await target.soundBankManager.addSoundBank(buffer, nextId)
  return { synth: target, changed: true }
}
