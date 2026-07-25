import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
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
    loadDefault: () => ipcRenderer.invoke('soundfont:default'),
  },
})
