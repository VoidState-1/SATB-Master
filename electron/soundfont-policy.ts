export const MEBIBYTE = 1024 * 1024
export const GIBIBYTE = 1024 * MEBIBYTE
export const MAX_SOUNDFONT_BYTES = 2 * GIBIBYTE

const LARGE_SOUNDFONT_BYTES = 512 * MEBIBYTE
const PARSER_HEADROOM_RATIO = 1.5
const SYSTEM_RESERVE_BYTES = 512 * MEBIBYTE

export function requiredSoundFontMemory(sizeBytes: number) {
  // SF2 原始采样需要完整进入 AudioWorklet；额外空间留给解析结构、当前工程与系统本身。
  return Math.ceil(sizeBytes * PARSER_HEADROOM_RATIO) + SYSTEM_RESERVE_BYTES
}

export function validateSoundFontCapacity(sizeBytes: number, freeMemoryBytes: number, architecture: string) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error('SoundFont 文件为空或大小无效')
  }
  if (sizeBytes > MAX_SOUNDFONT_BYTES) {
    throw new Error('SoundFont 文件超过 2 GB 限制')
  }
  if (architecture === 'ia32' && sizeBytes > LARGE_SOUNDFONT_BYTES) {
    throw new Error('超过 512 MB 的 SoundFont 需要 64 位版本')
  }

  const requiredMemoryBytes = requiredSoundFontMemory(sizeBytes)
  if (freeMemoryBytes < requiredMemoryBytes) {
    throw new Error(
      `可用内存不足：该 SoundFont 加载前至少需要 ${formatByteSize(requiredMemoryBytes)}，当前约 ${formatByteSize(freeMemoryBytes)}`,
    )
  }
  return requiredMemoryBytes
}

export function formatByteSize(bytes: number) {
  if (bytes >= GIBIBYTE) return `${(bytes / GIBIBYTE).toFixed(1)} GB`
  return `${Math.ceil(bytes / MEBIBYTE)} MB`
}
