import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { validateSoundFontCapacity } from './soundfont-policy.js'

const SOUNDFONT_SCHEME = 'satb-soundfont'
const RESOURCE_LIFETIME_MS = 15 * 60 * 1000
const HASH_PROGRESS_INTERVAL_BYTES = 8 * 1024 * 1024

interface SoundFontResource {
  token: string
  filePath: string
  sizeBytes: number
  modifiedAtMs: number
  requiredMemoryBytes: number
  availableMemoryBytes: number
  expectedHash?: string
  expiresAt: number
  hashPromise?: Promise<string>
}

export interface PreparedSoundFontResource {
  token: string
  sourceUrl: string
  sizeBytes: number
  requiredMemoryBytes: number
  availableMemoryBytes: number
}

const resources = new Map<string, SoundFontResource>()

export function registerSoundFontScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SOUNDFONT_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }])
}

export function registerSoundFontProtocol() {
  protocol.handle(SOUNDFONT_SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    const url = new URL(request.url)
    const token = url.hostname === 'resource' ? decodeURIComponent(url.pathname.slice(1)) : ''
    const resource = resolveResource(token)
    if (!resource) return new Response('SoundFont resource expired', { status: 404 })

    try {
      // 渲染进程只持有短时令牌 URL；真实本地路径不会交给 fetch，也不会开放任意文件读取。
      const info = await stat(resource.filePath)
      assertResourceUnchanged(resource, info.size, info.mtimeMs)
      const fileResponse = await net.fetch(pathToFileURL(resource.filePath).toString())
      if (!fileResponse.ok || !fileResponse.body) return fileResponse
      const headers = new Headers(fileResponse.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', 'no-store')
      headers.set('Content-Type', 'application/octet-stream')
      headers.set('Content-Length', String(resource.sizeBytes))
      return new Response(fileResponse.body, { status: fileResponse.status, headers })
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'SoundFont resource unavailable', { status: 409 })
    }
  })
}

export async function prepareSoundFontResource(filePath: string, expectedHash?: string): Promise<PreparedSoundFontResource> {
  removeExpiredResources()
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('SoundFont 路径不是文件')

  const memoryInfo = process.getSystemMemoryInfo()
  const availableMemoryBytes = memoryInfo.free * 1024
  const requiredMemoryBytes = validateSoundFontCapacity(info.size, availableMemoryBytes, process.arch)
  const token = randomUUID()
  resources.set(token, {
    token,
    filePath,
    sizeBytes: info.size,
    modifiedAtMs: info.mtimeMs,
    requiredMemoryBytes,
    availableMemoryBytes,
    expectedHash: expectedHash?.toLowerCase(),
    expiresAt: Date.now() + RESOURCE_LIFETIME_MS,
  })
  return {
    token,
    sourceUrl: `${SOUNDFONT_SCHEME}://resource/${token}`,
    sizeBytes: info.size,
    requiredMemoryBytes,
    availableMemoryBytes,
  }
}

export async function hashSoundFontResource(
  token: string,
  onProgress?: (processedBytes: number, totalBytes: number) => void,
) {
  const resource = requireResource(token)
  if (!resource.hashPromise) resource.hashPromise = hashResource(resource, onProgress)
  return resource.hashPromise
}

export function releaseSoundFontResource(token: string) {
  resources.delete(token)
}

async function hashResource(resource: SoundFontResource, onProgress?: (processedBytes: number, totalBytes: number) => void) {
  const hash = createHash('sha256')
  let processedBytes = 0
  let lastReportedBytes = 0
  onProgress?.(0, resource.sizeBytes)

  for await (const chunk of createReadStream(resource.filePath)) {
    hash.update(chunk)
    processedBytes += chunk.length
    if (processedBytes - lastReportedBytes >= HASH_PROGRESS_INTERVAL_BYTES || processedBytes === resource.sizeBytes) {
      lastReportedBytes = processedBytes
      onProgress?.(processedBytes, resource.sizeBytes)
    }
  }

  const info = await stat(resource.filePath)
  assertResourceUnchanged(resource, info.size, info.mtimeMs)
  const digest = hash.digest('hex')
  if (resource.expectedHash && digest !== resource.expectedHash) {
    throw new Error('默认 SoundFont 摘要校验失败')
  }
  return digest
}

function assertResourceUnchanged(resource: SoundFontResource, sizeBytes: number, modifiedAtMs: number) {
  if (sizeBytes !== resource.sizeBytes || modifiedAtMs !== resource.modifiedAtMs) {
    throw new Error('SoundFont 文件在加载过程中发生了变化')
  }
}

function resolveResource(token: string) {
  if (!token) return undefined
  const resource = resources.get(token)
  if (!resource) return undefined
  if (resource.expiresAt <= Date.now()) {
    resources.delete(token)
    return undefined
  }
  return resource
}

function requireResource(token: string) {
  const resource = resolveResource(token)
  if (!resource) throw new Error('SoundFont 加载凭据无效或已过期')
  return resource
}

function removeExpiredResources() {
  const now = Date.now()
  for (const [token, resource] of resources) {
    if (resource.expiresAt <= now) resources.delete(token)
  }
}
