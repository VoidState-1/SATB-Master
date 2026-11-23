import { app, BrowserWindow, screen } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { logMain } from './logger.js'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

export interface DisplayWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1180,
  height: 760,
  isMaximized: false,
}

export const MIN_WINDOW_WIDTH = 760
export const MIN_WINDOW_HEIGHT = 520

export function sanitizeWindowState(
  raw: unknown,
  displays: DisplayWorkArea[] = [],
): WindowState {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_WINDOW_STATE }
  }
  const data = raw as Record<string, unknown>
  const width =
    typeof data.width === 'number' && Number.isFinite(data.width)
      ? Math.max(MIN_WINDOW_WIDTH, Math.round(data.width))
      : DEFAULT_WINDOW_STATE.width
  const height =
    typeof data.height === 'number' && Number.isFinite(data.height)
      ? Math.max(MIN_WINDOW_HEIGHT, Math.round(data.height))
      : DEFAULT_WINDOW_STATE.height
  const isMaximized = Boolean(data.isMaximized)

  let x: number | undefined
  let y: number | undefined

  if (
    typeof data.x === 'number' &&
    Number.isFinite(data.x) &&
    typeof data.y === 'number' &&
    Number.isFinite(data.y)
  ) {
    const candidateX = Math.round(data.x)
    const candidateY = Math.round(data.y)

    const isVisibleOnAnyDisplay =
      displays.length === 0 ||
      displays.some((display) => {
        // 保证窗口至少有 100x40 像素在当前可用工作区内，避免外接屏幕拔掉后悬空
        return (
          candidateX + width >= display.x + 100 &&
          candidateX <= display.x + display.width - 100 &&
          candidateY >= display.y - 10 &&
          candidateY <= display.y + display.height - 40
        )
      })

    if (isVisibleOnAnyDisplay) {
      x = candidateX
      y = candidateY
    }
  }

  return { width, height, x, y, isMaximized }
}

export function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

export function loadSavedWindowState(): WindowState {
  try {
    const displays = screen
      ? screen.getAllDisplays().map((d) => d.workArea)
      : []
    const filePath = getWindowStatePath()
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return sanitizeWindowState(raw, displays)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logMain('warn', 'app', '读取窗口尺寸记忆失败，使用默认尺寸', { code: 'FILE_READ_FAILED', error })
    }
    return { ...DEFAULT_WINDOW_STATE }
  }
}

export function saveWindowState(state: WindowState): void {
  try {
    const filePath = getWindowStatePath()
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    logMain('warn', 'app', '保存窗口尺寸记忆失败', { code: 'FILE_WRITE_FAILED', error })
  }
}

export function trackWindowState(window: BrowserWindow): () => void {
  let state = loadSavedWindowState()
  let saveTimer: NodeJS.Timeout | undefined

  const persist = () => {
    if (window.isDestroyed()) return
    if (window.isMaximized()) {
      state.isMaximized = true
    } else if (!window.isMinimized()) {
      const bounds = window.getBounds()
      state = {
        width: Math.max(MIN_WINDOW_WIDTH, bounds.width),
        height: Math.max(MIN_WINDOW_HEIGHT, bounds.height),
        x: bounds.x,
        y: bounds.y,
        isMaximized: false,
      }
    }
    saveWindowState(state)
  }

  const schedulePersist = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persist, 300)
  }

  window.on('resize', schedulePersist)
  window.on('move', schedulePersist)
  window.on('maximize', () => {
    state.isMaximized = true
    schedulePersist()
  })
  window.on('unmaximize', () => {
    state.isMaximized = false
    schedulePersist()
  })
  window.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    persist()
  })

  return () => {
    if (saveTimer) clearTimeout(saveTimer)
    persist()
  }
}
