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
  soundFont: {
    open: () => ipcRenderer.invoke('soundfont:open'),
    loadPath: (filePath: string) => ipcRenderer.invoke('soundfont:load-path', { filePath }),
    loadDefault: () => ipcRenderer.invoke('soundfont:default'),
  },
})
