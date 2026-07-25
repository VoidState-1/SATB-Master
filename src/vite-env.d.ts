/// <reference types="vite/client" />

interface Window {
  desktop?: {
    versions: {
      electron: string
      chrome: string
      node: string
    }
    project: {
      open(): Promise<{
        canceled: boolean
        filePath?: string
        project?: unknown
      }>
      save(request: {
        project: unknown
        currentPath?: string
        forceDialog?: boolean
      }): Promise<{ canceled: boolean; filePath?: string }>
      autosave(request: { project: unknown; sourcePath?: string }): Promise<{ recoveryPath: string }>
      recovery(): Promise<{
        available: boolean
        savedAt?: string
        sourcePath?: string
        project?: unknown
      }>
      discardRecovery(): Promise<{ discarded: boolean }>
    }
    midi: {
      export(bytes: Uint8Array, defaultName: string): Promise<{ canceled: boolean; filePath?: string }>
    }
    soundFont: {
      open(): Promise<{
        canceled: boolean
        filePath?: string
        name?: string
        hash?: string
        bytes?: Uint8Array
      }>
      loadPath(filePath: string): Promise<{
        filePath: string
        name: string
        hash: string
        bytes: Uint8Array
      }>
      loadDefault(): Promise<{
        name: string
        hash: string
        bytes: Uint8Array
      }>
    }
  }
}
