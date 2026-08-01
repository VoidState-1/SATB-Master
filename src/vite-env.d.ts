/// <reference types="vite/client" />

interface Window {
  desktop?: {
    versions: {
      electron: string;
      chrome: string;
      node: string;
    };
    windowControls: {
      minimize(): Promise<void>;
      toggleMaximize(): Promise<boolean>;
      isMaximized(): Promise<boolean>;
      isFocused(): Promise<boolean>;
      close(): Promise<void>;
      onMaximizedChange(callback: (isMaximized: boolean) => void): () => void;
    };
    project: {
      open(): Promise<{
        canceled: boolean;
        filePath?: string;
        project?: unknown;
      }>;
      save(request: {
        project: unknown;
        currentPath?: string;
        forceDialog?: boolean;
        migrationBackupSourcePath?: string;
      }): Promise<{
        canceled: boolean;
        filePath?: string;
        migrationBackupPath?: string;
      }>;
      autosave(request: {
        project: unknown;
        sourcePath?: string;
        migrationBackupSourcePath?: string;
      }): Promise<{ recoveryPath: string }>;
      recovery(): Promise<{
        available: boolean;
        savedAt?: string;
        sourcePath?: string;
        migrationBackupSourcePath?: string;
        project?: unknown;
      }>;
      discardRecovery(): Promise<{ discarded: boolean }>;
    };
    midi: {
      export(
        bytes: Uint8Array,
        defaultName: string,
      ): Promise<{ canceled: boolean; filePath?: string }>;
    };
    soundFont: {
      open(): Promise<{
        canceled: boolean;
        filePath?: string;
        name?: string;
        token?: string;
        sourceUrl?: string;
        sizeBytes?: number;
        requiredMemoryBytes?: number;
        availableMemoryBytes?: number;
      }>;
      loadPath(filePath: string): Promise<{
        filePath: string;
        name: string;
        token: string;
        sourceUrl: string;
        sizeBytes: number;
        requiredMemoryBytes: number;
        availableMemoryBytes: number;
      }>;
      loadDefault(): Promise<{
        name: string;
        token: string;
        sourceUrl: string;
        sizeBytes: number;
        requiredMemoryBytes: number;
        availableMemoryBytes: number;
      }>;
      hash(
        token: string,
        onProgress: (processedBytes: number, totalBytes: number) => void,
      ): Promise<string>;
      release(token: string): Promise<void>;
    };
  };
}
