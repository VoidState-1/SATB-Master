import {
  BrowserWindow,
  dialog,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from 'electron'

let isFileDialogOpen = false

export function isAnyFileDialogOpen(): boolean {
  return isFileDialogOpen
}

export async function showExclusiveOpenDialog(
  parentWindow: BrowserWindow | undefined,
  options: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  if (isFileDialogOpen) {
    return { canceled: true, filePaths: [] }
  }
  isFileDialogOpen = true
  try {
    const window =
      parentWindow && !parentWindow.isDestroyed()
        ? parentWindow
        : (BrowserWindow.getFocusedWindow() ?? undefined)
    return window && !window.isDestroyed()
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
  } finally {
    isFileDialogOpen = false
  }
}

export async function showExclusiveSaveDialog(
  parentWindow: BrowserWindow | undefined,
  options: SaveDialogOptions,
): Promise<SaveDialogReturnValue> {
  if (isFileDialogOpen) {
    return { canceled: true, filePath: '' }
  }
  isFileDialogOpen = true
  try {
    const window =
      parentWindow && !parentWindow.isDestroyed()
        ? parentWindow
        : (BrowserWindow.getFocusedWindow() ?? undefined)
    return window && !window.isDestroyed()
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
  } finally {
    isFileDialogOpen = false
  }
}
