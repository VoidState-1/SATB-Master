import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_CHANNELS,
  type DesktopApi,
  type DesktopEventChannel,
  type DesktopEventMap,
  type DesktopInvokeChannel,
  type DesktopInvokeMap,
} from '../shared/desktop.js'

function invokeDesktop<Channel extends DesktopInvokeChannel>(
  channel: Channel,
  ...args: DesktopInvokeMap[Channel]['request'] extends void
    ? []
    : [DesktopInvokeMap[Channel]['request']]
): Promise<DesktopInvokeMap[Channel]['response']> {
  return ipcRenderer.invoke(channel, args[0])
}

function subscribeDesktop<Channel extends DesktopEventChannel>(
  channel: Channel,
  callback: (value: DesktopEventMap[Channel]) => void,
) {
  const listener = (_event: Electron.IpcRendererEvent, value: DesktopEventMap[Channel]) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const desktop: DesktopApi = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  windowControls: {
    minimize: () => invokeDesktop(DESKTOP_CHANNELS.windowMinimize),
    toggleMaximize: () => invokeDesktop(DESKTOP_CHANNELS.windowToggleMaximize),
    isMaximized: () => invokeDesktop(DESKTOP_CHANNELS.windowIsMaximized),
    isFocused: () => invokeDesktop(DESKTOP_CHANNELS.windowIsFocused),
    close: () => invokeDesktop(DESKTOP_CHANNELS.windowClose),
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
      return subscribeDesktop(DESKTOP_CHANNELS.windowMaximizedChanged, callback)
    },
  },
  project: {
    open: () => invokeDesktop(DESKTOP_CHANNELS.projectOpen),
    save: (request) => invokeDesktop(DESKTOP_CHANNELS.projectSave, request),
    autosave: (request) => invokeDesktop(DESKTOP_CHANNELS.projectAutosave, request),
    recovery: () => invokeDesktop(DESKTOP_CHANNELS.projectRecovery),
    discardRecovery: () => invokeDesktop(DESKTOP_CHANNELS.projectDiscardRecovery),
  },
  ruleTestCases: {
    open: () => invokeDesktop(DESKTOP_CHANNELS.ruleTestCaseOpen),
    save: (request) => invokeDesktop(DESKTOP_CHANNELS.ruleTestCaseSave, request),
    openDirectory: (request) => invokeDesktop(DESKTOP_CHANNELS.ruleTestCaseOpenDirectory, request),
    delete: (request) => invokeDesktop(DESKTOP_CHANNELS.ruleTestCaseDelete, request),
  },
  midi: {
    export: (bytes: Uint8Array, defaultName: string) =>
      invokeDesktop(DESKTOP_CHANNELS.midiExport, { bytes, defaultName }),
  },
  ruleProfile: {
    open: () => invokeDesktop(DESKTOP_CHANNELS.ruleProfileOpen),
    save: (request) => invokeDesktop(DESKTOP_CHANNELS.ruleProfileSave, request),
  },
  soundFont: {
    open: () => invokeDesktop(DESKTOP_CHANNELS.soundFontOpen),
    loadPath: (filePath: string) => invokeDesktop(DESKTOP_CHANNELS.soundFontLoadPath, { filePath }),
    loadDefault: () => invokeDesktop(DESKTOP_CHANNELS.soundFontDefault),
    hash: (token: string, callback: (processedBytes: number, totalBytes: number) => void) => {
      const removeListener = subscribeDesktop(DESKTOP_CHANNELS.soundFontHashProgress, (progress) => {
        if (progress.token === token) callback(progress.processedBytes, progress.totalBytes)
      })
      return invokeDesktop(DESKTOP_CHANNELS.soundFontHash, { token })
        .finally(removeListener)
    },
    release: (token: string) => invokeDesktop(DESKTOP_CHANNELS.soundFontRelease, { token }),
  },
  ruleLibrary: {
    list: () => invokeDesktop(DESKTOP_CHANNELS.ruleLibraryList),
    importFile: () => invokeDesktop(DESKTOP_CHANNELS.ruleLibraryImport),
    install: (request) => invokeDesktop(DESKTOP_CHANNELS.ruleLibraryInstall, request),
    loadSource: (contentHash: string) =>
      invokeDesktop(DESKTOP_CHANNELS.ruleLibraryLoadSource, { contentHash }),
    remove: (contentHash: string) =>
      invokeDesktop(DESKTOP_CHANNELS.ruleLibraryRemove, { contentHash }),
  },
}

contextBridge.exposeInMainWorld('desktop', desktop)
