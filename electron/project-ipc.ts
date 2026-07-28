import { app, dialog, ipcMain } from 'electron'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  hashSoundFontResource,
  prepareSoundFontResource,
  releaseSoundFontResource,
} from './soundfont-resource.js'

const MAX_PROJECT_BYTES = 20 * 1024 * 1024
const e2eDirectory = process.env.SATB_MASTER_E2E_DIRECTORY
type DialogDirectoryKind = 'project' | 'midi' | 'soundfont'
type DialogDirectories = Partial<Record<DialogDirectoryKind, string>>

let dialogDirectories: DialogDirectories | undefined
let dialogDirectoryWrite = Promise.resolve()

function defaultSoundFontDirectory() {
  // 安装包使用 extraResources 放到 resources/soundfonts；开发环境则直接读取 public 中的同一份资源。
  return app.isPackaged
    ? path.join(process.resourcesPath, 'soundfonts')
    : path.join(app.getAppPath(), 'public', 'soundfonts')
}

interface SaveRequest {
  project: unknown
  currentPath?: string
  forceDialog?: boolean
}

interface RecoveryRequest {
  project: unknown
  sourcePath?: string
}

interface LoadSoundFontRequest {
  filePath: string
}

interface SoundFontTokenRequest {
  token: string
}

interface RecoveryEnvelope {
  format: 'satb-master-recovery-v1'
  savedAt: string
  sourcePath?: string
  project: unknown
}

function assertProjectEnvelope(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('工程内容不是有效对象')
  const project = value as { schemaVersion?: unknown; tracks?: unknown }
  if (![1, 2].includes(project.schemaVersion as number) || !Array.isArray(project.tracks) || project.tracks.length !== 4) {
    throw new Error('工程结构或版本无效')
  }
}

function recoveryPath() {
  return path.join(app.getPath('userData'), 'recovery.json')
}

function dialogDirectoriesPath() {
  return path.join(app.getPath('userData'), 'dialog-directories.json')
}

async function loadDialogDirectories() {
  if (dialogDirectories) return dialogDirectories
  try {
    const stored = JSON.parse(await readFile(dialogDirectoriesPath(), 'utf8')) as Record<string, unknown>
    dialogDirectories = Object.fromEntries(
      (['project', 'midi', 'soundfont'] as DialogDirectoryKind[])
        .filter((kind) => typeof stored[kind] === 'string' && path.isAbsolute(stored[kind] as string))
        .map((kind) => [kind, stored[kind] as string]),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('读取最近文件夹记录失败，将使用系统默认目录。', error)
    }
    dialogDirectories = {}
  }
  return dialogDirectories
}

async function recentDialogDirectory(kind: DialogDirectoryKind) {
  const directory = (await loadDialogDirectories())[kind]
  if (!directory) return undefined
  try {
    return (await stat(directory)).isDirectory() ? directory : undefined
  } catch {
    return undefined
  }
}

async function rememberDialogDirectory(kind: DialogDirectoryKind, filePath: string) {
  if (e2eDirectory) return
  const directories = await loadDialogDirectories()
  directories[kind] = path.dirname(filePath)
  const snapshot = { ...directories }
  // 文件对话框可能连续打开，串行写入可避免较早的异步写操作覆盖较新的目录。
  dialogDirectoryWrite = dialogDirectoryWrite
    .catch(() => undefined)
    .then(() => writeJsonAtomic(dialogDirectoriesPath(), snapshot))
  try {
    await dialogDirectoryWrite
  } catch (error) {
    console.warn('保存最近文件夹记录失败。', error)
  }
}

async function rememberedDefaultPath(kind: DialogDirectoryKind, fileName?: string) {
  const directory = await recentDialogDirectory(kind)
  return directory && fileName ? path.join(directory, fileName) : directory ?? fileName
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const json = JSON.stringify(value, null, 2)
  if (Buffer.byteLength(json, 'utf8') > MAX_PROJECT_BYTES) throw new Error('工程文件超过 20 MB 限制')

  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporaryPath, json, 'utf8')
    // 先完整写入同目录临时文件，再替换目标，防止异常退出留下半个 JSON。
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function writeProjectAtomic(filePath: string, project: unknown) {
  assertProjectEnvelope(project)
  await writeJsonAtomic(filePath, project)
}

function assertSoundFontPath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('SoundFont 路径无效')
  const extension = path.extname(value).toLowerCase()
  if (extension !== '.sf2' && extension !== '.sf3') throw new Error('只支持 SF2 或 SF3 文件')
}

export function registerProjectIpc() {
  ipcMain.handle('project:open', async () => {
    let filePath: string
    if (e2eDirectory) {
      // 端到端测试仍走完整 IPC 与磁盘读写，只用固定临时路径替代不可自动化的系统文件对话框。
      filePath = path.join(e2eDirectory, 'project.satb')
    } else {
      const selection = await dialog.showOpenDialog({
        title: '打开 SATB 工程',
        defaultPath: await rememberedDefaultPath('project'),
        properties: ['openFile'],
        filters: [{ name: 'SATB Master 工程', extensions: ['satb'] }],
      })
      if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
      filePath = selection.filePaths[0]
      await rememberDialogDirectory('project', filePath)
    }

    const info = await stat(filePath)
    if (info.size > MAX_PROJECT_BYTES) throw new Error('工程文件超过 20 MB 限制')
    const project = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    assertProjectEnvelope(project)
    return { canceled: false, filePath, project }
  })

  ipcMain.handle('project:save', async (_event, request: SaveRequest) => {
    let filePath = e2eDirectory ? path.join(e2eDirectory, 'project.satb') : request.currentPath
    if (!e2eDirectory && (!filePath || request.forceDialog)) {
      const selection = await dialog.showSaveDialog({
        title: '保存 SATB 工程',
        defaultPath: filePath ?? await rememberedDefaultPath('project', '未命名练习.satb'),
        filters: [{ name: 'SATB Master 工程', extensions: ['satb'] }],
      })
      if (selection.canceled || !selection.filePath) return { canceled: true }
      filePath = selection.filePath.toLowerCase().endsWith('.satb') ? selection.filePath : `${selection.filePath}.satb`
      await rememberDialogDirectory('project', filePath)
    }

    if (!filePath) throw new Error('没有可用的工程保存路径')
    await writeProjectAtomic(filePath, request.project)
    await rm(recoveryPath(), { force: true })
    return { canceled: false, filePath }
  })

  ipcMain.handle('project:autosave', async (_event, request: RecoveryRequest) => {
    assertProjectEnvelope(request.project)
    const envelope: RecoveryEnvelope = {
      format: 'satb-master-recovery-v1',
      savedAt: new Date().toISOString(),
      sourcePath: request.sourcePath,
      project: request.project,
    }
    const filePath = recoveryPath()
    await writeJsonAtomic(filePath, envelope)
    return { recoveryPath: filePath }
  })

  ipcMain.handle('project:recovery', async () => {
    const filePath = recoveryPath()
    try {
      const info = await stat(filePath)
      if (info.size > MAX_PROJECT_BYTES) throw new Error('恢复文件超过 20 MB 限制')
      const envelope = JSON.parse(await readFile(filePath, 'utf8')) as Partial<RecoveryEnvelope>
      if (envelope.format !== 'satb-master-recovery-v1' || typeof envelope.savedAt !== 'string') {
        throw new Error('恢复文件格式无效')
      }
      assertProjectEnvelope(envelope.project)
      return {
        available: true,
        savedAt: envelope.savedAt,
        sourcePath: typeof envelope.sourcePath === 'string' ? envelope.sourcePath : undefined,
        project: envelope.project,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { available: false }
      throw error
    }
  })

  ipcMain.handle('project:discard-recovery', async () => {
    await rm(recoveryPath(), { force: true })
    return { discarded: true }
  })

  ipcMain.handle('midi:export', async (_event, request: { bytes: Uint8Array; defaultName: string }) => {
    if (e2eDirectory) {
      const filePath = path.join(e2eDirectory, 'export.mid')
      await writeFile(filePath, request.bytes)
      return { canceled: false, filePath }
    }

    const selection = await dialog.showSaveDialog({
      title: '导出 MIDI',
      defaultPath: await rememberedDefaultPath('midi', `${request.defaultName || 'SATB Master'}.mid`),
      filters: [{ name: 'Standard MIDI File', extensions: ['mid', 'midi'] }],
    })
    if (selection.canceled || !selection.filePath) return { canceled: true }
    await rememberDialogDirectory('midi', selection.filePath)
    await writeFile(selection.filePath, request.bytes)
    return { canceled: false, filePath: selection.filePath }
  })

  ipcMain.handle('soundfont:open', async () => {
    const selection = await dialog.showOpenDialog({
      title: '选择 SoundFont',
      defaultPath: await rememberedDefaultPath('soundfont'),
      properties: ['openFile'],
      filters: [{ name: 'SoundFont 2', extensions: ['sf2', 'sf3'] }],
    })
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
    const filePath = selection.filePaths[0]
    assertSoundFontPath(filePath)
    await rememberDialogDirectory('soundfont', filePath)
    const soundFont = await prepareSoundFontResource(filePath)
    return {
      canceled: false,
      filePath,
      name: path.basename(filePath),
      ...soundFont,
    }
  })

  ipcMain.handle('soundfont:load-path', async (_event, request: LoadSoundFontRequest) => {
    // 工程只保存用户主动选取的绝对路径；重开时仍限制扩展名、大小并重新计算摘要。
    assertSoundFontPath(request?.filePath)
    const soundFont = await prepareSoundFontResource(request.filePath)
    return {
      filePath: request.filePath,
      name: path.basename(request.filePath),
      ...soundFont,
    }
  })

  ipcMain.handle('soundfont:default', async () => {
    const directory = defaultSoundFontDirectory()
    const expectedHash = (await readFile(path.join(directory, 'default.sf2.sha256'), 'utf8')).trim().split(/\s+/)[0]
    if (!expectedHash) throw new Error('默认 SoundFont 摘要文件无效')
    const soundFont = await prepareSoundFontResource(path.join(directory, 'default.sf2'), expectedHash)
    return {
      name: 'SATB Master Basic Choir',
      ...soundFont,
    }
  })

  ipcMain.handle('soundfont:hash', async (event, request: SoundFontTokenRequest) => {
    if (typeof request?.token !== 'string') throw new Error('SoundFont 加载凭据无效')
    return hashSoundFontResource(request.token, (processedBytes, totalBytes) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('soundfont:hash-progress', { token: request.token, processedBytes, totalBytes })
      }
    })
  })

  ipcMain.handle('soundfont:release', (_event, request: SoundFontTokenRequest) => {
    if (typeof request?.token === 'string') releaseSoundFontResource(request.token)
  })
}
