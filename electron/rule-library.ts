import { app, BrowserWindow } from 'electron'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { rememberDialogDirectory, rememberedDefaultPath } from './project-ipc.js'
import { showExclusiveOpenDialog } from './dialog-coordinator.js'
import {
  MAX_RULE_BYTES,
  assertRuleHash,
  hashRuleSource,
  isRuleMetadataFileName,
  validateInstalledRuleMetadata,
  validateRuleManifest,
  type InstalledRulePackage,
} from './rule-library-policy.js'
import { DESKTOP_CHANNELS, type InstallExternalRuleRequest } from '../shared/desktop.js'
import { handleDesktop } from './typed-ipc.js'

const e2eDirectory = process.env.SATB_MASTER_E2E_DIRECTORY

function ruleLibraryDirectory() {
  return path.join(app.getPath('userData'), 'rule-library')
}

function sourcePathForHash(contentHash: string) {
  return path.join(ruleLibraryDirectory(), `${contentHash}.satb-rule.js`)
}

function metadataPathForHash(contentHash: string) {
  return path.join(ruleLibraryDirectory(), `${contentHash}.json`)
}

async function writeTextAtomic(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporaryPath, value, 'utf8')
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function listInstalledRulePackages() {
  await mkdir(ruleLibraryDirectory(), { recursive: true })
  const names = await readdir(ruleLibraryDirectory())
  const packages: InstalledRulePackage[] = []
  for (const name of names.filter(isRuleMetadataFileName)) {
    try {
      const metadata = validateInstalledRuleMetadata(
        JSON.parse(await readFile(path.join(ruleLibraryDirectory(), name), 'utf8')),
      )
      const sourceInfo = await stat(sourcePathForHash(metadata.contentHash))
      if (!sourceInfo.isFile() || sourceInfo.size !== metadata.sizeBytes || sourceInfo.size > MAX_RULE_BYTES) {
        throw new Error('规则包私有副本缺失或大小不符')
      }
      packages.push(metadata)
    } catch (error) {
      console.warn(`忽略损坏的外置规则记录：${name}`, error)
    }
  }
  return packages.sort((left, right) =>
    left.manifest.packageId.localeCompare(right.manifest.packageId) ||
    left.manifest.version.localeCompare(right.manifest.version),
  )
}

async function readRuleImportCandidate(parentWindow?: BrowserWindow) {
  let filePath: string
  if (e2eDirectory) {
    filePath = path.join(e2eDirectory, 'example.satb-rule.js')
  } else {
    const selection = await showExclusiveOpenDialog(parentWindow, {
      title: '导入外置检查规则',
      defaultPath: await rememberedDefaultPath('rule'),
      properties: ['openFile'],
      filters: [{ name: 'SATB Master 外置规则', extensions: ['js'] }],
    })
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
    filePath = selection.filePaths[0]
    await rememberDialogDirectory('rule', filePath)
  }
  if (!filePath.toLowerCase().endsWith('.satb-rule.js')) throw new Error('只支持 .satb-rule.js 文件')
  const info = await stat(filePath)
  if (!info.isFile() || info.size < 1 || info.size > MAX_RULE_BYTES) {
    throw new Error('规则包必须小于等于 512 KiB 且不能为空')
  }
  const source = await readFile(filePath, 'utf8')
  const sizeBytes = Buffer.byteLength(source, 'utf8')
  if (sizeBytes > MAX_RULE_BYTES) throw new Error('规则包超过 512 KiB 限制')
  return {
    canceled: false,
    source,
    sourcePath: filePath,
    contentHash: hashRuleSource(source),
    sizeBytes,
  }
}

async function installRulePackage(request: InstallExternalRuleRequest) {
  if (!request || typeof request.source !== 'string') throw new Error('规则包源码无效')
  const sizeBytes = Buffer.byteLength(request.source, 'utf8')
  if (sizeBytes < 1 || sizeBytes > MAX_RULE_BYTES) throw new Error('规则包大小无效')
  assertRuleHash(request.contentHash)
  const computedHash = hashRuleSource(request.source)
  if (computedHash !== request.contentHash) throw new Error('规则包内容摘要不匹配')
  const manifest = validateRuleManifest(request.manifest)
  const installedAt = new Date().toISOString()
  const metadata: InstalledRulePackage = {
    manifest,
    contentHash: computedHash,
    sourcePath:
      typeof request.sourcePath === 'string' && request.sourcePath.length <= 2048
        ? request.sourcePath
        : undefined,
    sizeBytes,
    installedAt,
  }
  await writeTextAtomic(sourcePathForHash(computedHash), request.source)
  await writeTextAtomic(metadataPathForHash(computedHash), JSON.stringify(metadata, null, 2))
  return metadata
}

async function loadRulePackageSource(contentHash: unknown) {
  assertRuleHash(contentHash)
  const source = await readFile(sourcePathForHash(contentHash), 'utf8')
  if (Buffer.byteLength(source, 'utf8') > MAX_RULE_BYTES || hashRuleSource(source) !== contentHash) {
    throw new Error('规则包私有副本已损坏或内容摘要不匹配')
  }
  return { source }
}

async function removeRulePackage(contentHash: unknown) {
  assertRuleHash(contentHash)
  await rm(sourcePathForHash(contentHash), { force: true })
  await rm(metadataPathForHash(contentHash), { force: true })
  return { removed: true }
}

export function registerRuleLibraryIpc() {
  handleDesktop(DESKTOP_CHANNELS.ruleLibraryList, () => listInstalledRulePackages())
  handleDesktop(DESKTOP_CHANNELS.ruleLibraryImport, (event) =>
    readRuleImportCandidate(BrowserWindow.fromWebContents(event.sender) ?? undefined),
  )
  handleDesktop(DESKTOP_CHANNELS.ruleLibraryInstall, (_event, request) => installRulePackage(request))
  handleDesktop(DESKTOP_CHANNELS.ruleLibraryLoadSource, (_event, request) =>
    loadRulePackageSource(request.contentHash),
  )
  handleDesktop(DESKTOP_CHANNELS.ruleLibraryRemove, (_event, request) =>
    removeRulePackage(request.contentHash),
  )
}
