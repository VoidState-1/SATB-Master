import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_CHANNELS,
  LOG_SESSION_ARGUMENT,
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
  platform: process.platform,
  log: {
    sessionId: process.argv.find((arg) => arg.startsWith(LOG_SESSION_ARGUMENT))?.slice(LOG_SESSION_ARGUMENT.length),
    onErrorEntry: (callback) => subscribeDesktop(DESKTOP_CHANNELS.logErrorEntry, callback),
    appendBatch: (request) => invokeDesktop(DESKTOP_CHANNELS.logAppendBatch, request),
    getRecent: (request = {}) => invokeDesktop(DESKTOP_CHANNELS.logGetRecent, request),
    openDirectory: () => invokeDesktop(DESKTOP_CHANNELS.logOpenDirectory),
    exportBundle: (request) => invokeDesktop(DESKTOP_CHANNELS.logExportBundle, request),
  },
  audit: {
    hasStartupPackage: process.argv.includes('--satb-open-startup-audit'),
    readStartupPackage: () => invokeDesktop(DESKTOP_CHANNELS.auditReadStartupPackage),
  },
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  windowControls: {
    minimize: () => invokeDesktop(DESKTOP_CHANNELS.windowMinimize),
    toggleMaximize: () => invokeDesktop(DESKTOP_CHANNELS.windowToggleMaximize),
    isMaximized: () => invokeDesktop(DESKTOP_CHANNELS.windowIsMaximized),
    isFullScreen: () => invokeDesktop(DESKTOP_CHANNELS.windowIsFullScreen),
    onFullScreenChange: (callback) => subscribeDesktop(DESKTOP_CHANNELS.windowFullScreenChanged, callback),
    isFocused: () => invokeDesktop(DESKTOP_CHANNELS.windowIsFocused),
    close: (quit = false) => invokeDesktop(DESKTOP_CHANNELS.windowClose, { quit }),
    setDocument: (filePath, isDirty) => invokeDesktop(DESKTOP_CHANNELS.windowSetDocument, { filePath, isDirty }),
    onCloseRequest: (callback) => {
      const unsubscribe = subscribeDesktop(DESKTOP_CHANNELS.windowCloseRequested, callback)
      void invokeDesktop(DESKTOP_CHANNELS.windowSetCloseHandler, { enabled: true })
      return () => {
        unsubscribe()
        void invokeDesktop(DESKTOP_CHANNELS.windowSetCloseHandler, { enabled: false })
      }
    },
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
      return subscribeDesktop(DESKTOP_CHANNELS.windowMaximizedChanged, callback)
    },
  },
  menu: {
    onCommand: (callback) => subscribeDesktop(DESKTOP_CHANNELS.menuCommand, callback),
    editText: (command) => invokeDesktop(DESKTOP_CHANNELS.menuEditText, { command }),
  },
  project: {
    open: () => invokeDesktop(DESKTOP_CHANNELS.projectOpen),
    consumePendingOpen: () => invokeDesktop(DESKTOP_CHANNELS.projectConsumePendingOpen),
    onOpenExternal: (callback) => subscribeDesktop(DESKTOP_CHANNELS.projectOpenExternal, callback),
    save: (request) => invokeDesktop(DESKTOP_CHANNELS.projectSave, request),
    exportBackup: (request) => invokeDesktop(DESKTOP_CHANNELS.projectExportBackup, request),
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
    import: (format = "midi") => invokeDesktop(DESKTOP_CHANNELS.midiImport, { format }),
    export: (bytes: Uint8Array, defaultName: string) =>
      invokeDesktop(DESKTOP_CHANNELS.midiExport, { bytes, defaultName }),
  },
  musicXml: {
    export: (xml: string, defaultName: string) =>
      invokeDesktop(DESKTOP_CHANNELS.musicXmlExport, { xml, defaultName }),
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
