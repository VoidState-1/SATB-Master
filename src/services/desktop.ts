import { normalizeProject, validateProject, type ProjectDocument } from '../domain/model'

const BROWSER_PROJECT_KEY = 'satb-master-browser-project'

export async function openProject(): Promise<{ project: ProjectDocument; filePath?: string } | undefined> {
  if (window.desktop) {
    const result = await window.desktop.project.open()
    if (result.canceled) return undefined
    if (!validateProject(result.project)) throw new Error('所选文件不是受支持的 SATB 工程')
    return { project: normalizeProject(result.project), filePath: result.filePath }
  }

  const raw = localStorage.getItem(BROWSER_PROJECT_KEY)
  if (!raw) throw new Error('浏览器预览中还没有保存的工程')
  const project = JSON.parse(raw) as unknown
  if (!validateProject(project)) throw new Error('浏览器中的工程数据无效')
  return { project: normalizeProject(project) }
}

export async function saveProject(project: ProjectDocument, currentPath?: string, forceDialog = false) {
  if (window.desktop) {
    const result = await window.desktop.project.save({ project, currentPath, forceDialog })
    if (!result.canceled) localStorage.removeItem(`${BROWSER_PROJECT_KEY}-recovery`)
    return result
  }

  localStorage.setItem(BROWSER_PROJECT_KEY, JSON.stringify(project))
  localStorage.removeItem(`${BROWSER_PROJECT_KEY}-recovery`)
  return { canceled: false, filePath: undefined }
}

export async function autosaveProject(project: ProjectDocument, sourcePath?: string) {
  if (window.desktop) return window.desktop.project.autosave({ project, sourcePath })
  localStorage.setItem(`${BROWSER_PROJECT_KEY}-recovery`, JSON.stringify({
    format: 'satb-master-recovery-v1',
    savedAt: new Date().toISOString(),
    sourcePath,
    project,
  }))
  return { recoveryPath: 'browser-local-storage' }
}

export async function findRecovery(): Promise<{
  savedAt: string
  sourcePath?: string
  project: ProjectDocument
} | undefined> {
  const result: {
    available: boolean
    savedAt?: unknown
    sourcePath?: unknown
    project?: unknown
  } = window.desktop
    ? await window.desktop.project.recovery()
    : (() => {
        const raw = localStorage.getItem(`${BROWSER_PROJECT_KEY}-recovery`)
        return raw ? { available: true, ...JSON.parse(raw) as Record<string, unknown> } : { available: false }
      })()
  if (!result.available) return undefined
  if (typeof result.savedAt !== 'string' || !validateProject(result.project)) throw new Error('自动恢复文件无效')
  return {
    savedAt: result.savedAt,
    sourcePath: typeof result.sourcePath === 'string' ? result.sourcePath : undefined,
    project: normalizeProject(result.project),
  }
}

export async function discardRecovery() {
  if (window.desktop) return window.desktop.project.discardRecovery()
  localStorage.removeItem(`${BROWSER_PROJECT_KEY}-recovery`)
  return { discarded: true }
}

export async function exportMidi(bytes: Uint8Array, defaultName: string) {
  if (window.desktop) return window.desktop.midi.export(bytes, defaultName)
  const blob = new Blob([bytes as BlobPart], { type: 'audio/midi' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${defaultName}.mid`
  anchor.click()
  URL.revokeObjectURL(url)
  return { canceled: false }
}

export async function loadDefaultSoundFont() {
  if (window.desktop) return window.desktop.soundFont.loadDefault()

  const response = await fetch(new URL('soundfonts/default.sf2', window.location.href))
  if (!response.ok) throw new Error('默认 SoundFont 资源不存在')
  return {
    name: 'SATB Master Basic Choir',
    hash: 'browser-resource',
    bytes: new Uint8Array(await response.arrayBuffer()),
  }
}

export async function loadUserSoundFont(filePath: string) {
  if (!window.desktop) throw new Error('浏览器预览无法重新读取本地 SoundFont')
  return window.desktop.soundFont.loadPath(filePath)
}
