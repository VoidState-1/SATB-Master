import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    isFocused: () => ipcRenderer.invoke('window:is-focused'),
    close: () => ipcRenderer.invoke('window:close'),
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized)
      ipcRenderer.on('window:maximized-changed', listener)
      return () => ipcRenderer.removeListener('window:maximized-changed', listener)
    },
  },
  project: {
    open: () => ipcRenderer.invoke('project:open'),
    save: (request: unknown) => ipcRenderer.invoke('project:save', request),
    autosave: (request: unknown) => ipcRenderer.invoke('project:autosave', request),
    recovery: () => ipcRenderer.invoke('project:recovery'),
    discardRecovery: () => ipcRenderer.invoke('project:discard-recovery'),
  },
  midi: {
    export: (bytes: Uint8Array, defaultName: string) => ipcRenderer.invoke('midi:export', { bytes, defaultName }),
  },
  ruleProfile: {
    open: () => ipcRenderer.invoke('rule-profile:open'),
    save: (request: unknown) => ipcRenderer.invoke('rule-profile:save', request),
  },
  soundFont: {
    open: () => ipcRenderer.invoke('soundfont:open'),
    loadPath: (filePath: string) => ipcRenderer.invoke('soundfont:load-path', { filePath }),
    loadDefault: () => ipcRenderer.invoke('soundfont:default'),
    hash: (token: string, callback: (processedBytes: number, totalBytes: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: {
        token: string
        processedBytes: number
        totalBytes: number
      }) => {
        if (progress.token === token) callback(progress.processedBytes, progress.totalBytes)
      }
      ipcRenderer.on('soundfont:hash-progress', listener)
      return ipcRenderer.invoke('soundfont:hash', { token })
        .finally(() => ipcRenderer.removeListener('soundfont:hash-progress', listener))
    },
    release: (token: string) => ipcRenderer.invoke('soundfont:release', { token }),
  },
  ruleLibrary: {
    list: () => ipcRenderer.invoke('rule-library:list'),
    importFile: () => ipcRenderer.invoke('rule-library:import'),
    install: (request: unknown) => ipcRenderer.invoke('rule-library:install', request),
    loadSource: (contentHash: string) =>
      ipcRenderer.invoke('rule-library:load-source', { contentHash }),
    remove: (contentHash: string) =>
      ipcRenderer.invoke('rule-library:remove', { contentHash }),
  },
})
