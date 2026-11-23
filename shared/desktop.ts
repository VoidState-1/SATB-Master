import type { InstalledExternalRulePackage } from "./external-rules.js";
import type { LogEntry } from "./logging.js";

export const LOG_SESSION_ARGUMENT = "--satb-log-session=";
export const MAX_RULE_TEST_CASE_BYTES = 20 * 1024 * 1024;
export const MAX_AUDIT_FILE_BYTES = 32 * 1024 * 1024;

export interface ProjectSaveRequest {
  project: unknown;
  currentPath?: string;
  forceDialog?: boolean;
  migrationBackupSourcePath?: string;
}

export interface ProjectRecoveryRequest {
  project: unknown;
  sourcePath?: string;
  migrationBackupSourcePath?: string;
}

export interface SoundFontResource {
  token: string;
  sourceUrl: string;
  sizeBytes: number;
  requiredMemoryBytes: number;
  availableMemoryBytes: number;
}

export interface InstallExternalRuleRequest {
  source: string;
  sourcePath?: string;
  contentHash: string;
  manifest: unknown;
}

export interface DesktopInvokeMap {
  "log:append-batch": {
    request: { entries: readonly LogEntry[] };
    response: { written: number };
  };
  "log:get-recent": {
    request: { limit?: number };
    response: { entries: LogEntry[]; logFilePath?: string; logDirectory?: string };
  };
  "log:open-directory": {
    request: void;
    response: { opened: boolean; directory?: string };
  };
  "log:export-bundle": {
    request: { bundleJson: string; defaultName?: string };
    response: { canceled: boolean; filePath?: string };
  };
  "audit:read-startup-package": { request: void; response: string };
  "window:minimize": { request: void; response: void };
  "window:toggle-maximize": { request: void; response: boolean };
  "window:is-maximized": { request: void; response: boolean };
  "window:is-focused": { request: void; response: boolean };
  "window:close": { request: void; response: void };
  "project:open": {
    request: void;
    response: { canceled: boolean; filePath?: string; project?: unknown };
  };
  "project:save": {
    request: ProjectSaveRequest;
    response: {
      canceled: boolean;
      filePath?: string;
      migrationBackupPath?: string;
    };
  };
  "project:autosave": {
    request: ProjectRecoveryRequest;
    response: { recoveryPath: string };
  };
  "project:recovery": {
    request: void;
    response: {
      available: boolean;
      savedAt?: string;
      sourcePath?: string;
      migrationBackupSourcePath?: string;
      project?: unknown;
    };
  };
  "project:discard-recovery": {
    request: void;
    response: { discarded: boolean };
  };
  "rule-test-case:open": {
    request: void;
    response: { canceled: boolean; filePath?: string; document?: unknown };
  };
  "rule-test-case:save": {
    request: {
      currentPath?: string;
      forceDialog: boolean;
      json: string;
      defaultName?: string;
    };
    response: { canceled: boolean; filePath?: string };
  };
  "rule-test-case:open-directory": {
    request: { directoryPath?: string } | void;
    response: {
      canceled: boolean;
      directoryPath?: string;
      entries: Array<{
        key: string;
        filePath: string;
        relativePath?: string;
        displayName: string;
        document?: unknown;
        error?: string;
      }>;
    };
  };
  "rule-test-case:delete": {
    request: { filePath: string };
    response: { deleted: boolean };
  };
  "midi:export": {
    request: { bytes: Uint8Array; defaultName: string };
    response: { canceled: boolean; filePath?: string };
  };
  "musicxml:export": {
    request: { xml: string; defaultName: string };
    response: { canceled: boolean; filePath?: string };
  };
  "rule-profile:open": {
    request: void;
    response: { canceled: boolean; filePath?: string; profile?: unknown };
  };
  "rule-profile:save": {
    request: { profile: unknown; defaultName?: string };
    response: { canceled: boolean; filePath?: string };
  };
  "soundfont:open": {
    request: void;
    response:
      | { canceled: true }
      | ({ canceled: false; filePath: string; name: string } & SoundFontResource);
  };
  "soundfont:load-path": {
    request: { filePath: string };
    response: { filePath: string; name: string } & SoundFontResource;
  };
  "soundfont:default": {
    request: void;
    response: { name: string } & SoundFontResource;
  };
  "soundfont:hash": { request: { token: string }; response: string };
  "soundfont:release": { request: { token: string }; response: void };
  "rule-library:list": {
    request: void;
    response: InstalledExternalRulePackage[];
  };
  "rule-library:import": {
    request: void;
    response: {
      canceled: boolean;
      source?: string;
      sourcePath?: string;
      contentHash?: string;
      sizeBytes?: number;
    };
  };
  "rule-library:install": {
    request: InstallExternalRuleRequest;
    response: InstalledExternalRulePackage;
  };
  "rule-library:load-source": {
    request: { contentHash: string };
    response: { source: string };
  };
  "rule-library:remove": {
    request: { contentHash: string };
    response: { removed: boolean };
  };
}

export interface DesktopEventMap {
  "window:maximized-changed": boolean;
  "soundfont:hash-progress": {
    token: string;
    processedBytes: number;
    totalBytes: number;
  };
}

export type DesktopInvokeChannel = keyof DesktopInvokeMap;
export type DesktopEventChannel = keyof DesktopEventMap;

export const DESKTOP_CHANNELS = Object.freeze({
  logAppendBatch: "log:append-batch",
  logGetRecent: "log:get-recent",
  logOpenDirectory: "log:open-directory",
  logExportBundle: "log:export-bundle",
  auditReadStartupPackage: "audit:read-startup-package",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowIsMaximized: "window:is-maximized",
  windowIsFocused: "window:is-focused",
  windowClose: "window:close",
  windowMaximizedChanged: "window:maximized-changed",
  projectOpen: "project:open",
  projectSave: "project:save",
  projectAutosave: "project:autosave",
  projectRecovery: "project:recovery",
  projectDiscardRecovery: "project:discard-recovery",
  ruleTestCaseOpen: "rule-test-case:open",
  ruleTestCaseSave: "rule-test-case:save",
  ruleTestCaseOpenDirectory: "rule-test-case:open-directory",
  ruleTestCaseDelete: "rule-test-case:delete",
  midiExport: "midi:export",
  musicXmlExport: "musicxml:export",
  ruleProfileOpen: "rule-profile:open",
  ruleProfileSave: "rule-profile:save",
  soundFontOpen: "soundfont:open",
  soundFontLoadPath: "soundfont:load-path",
  soundFontDefault: "soundfont:default",
  soundFontHash: "soundfont:hash",
  soundFontRelease: "soundfont:release",
  soundFontHashProgress: "soundfont:hash-progress",
  ruleLibraryList: "rule-library:list",
  ruleLibraryImport: "rule-library:import",
  ruleLibraryInstall: "rule-library:install",
  ruleLibraryLoadSource: "rule-library:load-source",
  ruleLibraryRemove: "rule-library:remove",
} as const satisfies Record<string, DesktopInvokeChannel | DesktopEventChannel>);

export interface DesktopApi {
  log: {
    sessionId?: string;
    appendBatch(request: DesktopInvokeMap["log:append-batch"]["request"]): Promise<DesktopInvokeMap["log:append-batch"]["response"]>;
    getRecent(request?: DesktopInvokeMap["log:get-recent"]["request"]): Promise<DesktopInvokeMap["log:get-recent"]["response"]>;
    openDirectory(): Promise<DesktopInvokeMap["log:open-directory"]["response"]>;
    exportBundle(request: DesktopInvokeMap["log:export-bundle"]["request"]): Promise<DesktopInvokeMap["log:export-bundle"]["response"]>;
  };
  audit: {
    hasStartupPackage: boolean;
    readStartupPackage(): Promise<string>;
  };
  versions: { electron: string; chrome: string; node: string };
  windowControls: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    isMaximized(): Promise<boolean>;
    isFocused(): Promise<boolean>;
    close(): Promise<void>;
    onMaximizedChange(callback: (isMaximized: boolean) => void): () => void;
  };
  project: {
    open(): Promise<DesktopInvokeMap["project:open"]["response"]>;
    save(request: ProjectSaveRequest): Promise<DesktopInvokeMap["project:save"]["response"]>;
    autosave(request: ProjectRecoveryRequest): Promise<DesktopInvokeMap["project:autosave"]["response"]>;
    recovery(): Promise<DesktopInvokeMap["project:recovery"]["response"]>;
    discardRecovery(): Promise<DesktopInvokeMap["project:discard-recovery"]["response"]>;
  };
  ruleTestCases: {
    open(): Promise<DesktopInvokeMap["rule-test-case:open"]["response"]>;
    save(request: DesktopInvokeMap["rule-test-case:save"]["request"]): Promise<DesktopInvokeMap["rule-test-case:save"]["response"]>;
    openDirectory(request?: DesktopInvokeMap["rule-test-case:open-directory"]["request"]): Promise<DesktopInvokeMap["rule-test-case:open-directory"]["response"]>;
    delete(request: DesktopInvokeMap["rule-test-case:delete"]["request"]): Promise<DesktopInvokeMap["rule-test-case:delete"]["response"]>;
  };
  midi: {
    export(bytes: Uint8Array, defaultName: string): Promise<DesktopInvokeMap["midi:export"]["response"]>;
  };
  musicXml: {
    export(xml: string, defaultName: string): Promise<DesktopInvokeMap["musicxml:export"]["response"]>;
  };
  ruleProfile: {
    open(): Promise<DesktopInvokeMap["rule-profile:open"]["response"]>;
    save(request: DesktopInvokeMap["rule-profile:save"]["request"]): Promise<DesktopInvokeMap["rule-profile:save"]["response"]>;
  };
  soundFont: {
    open(): Promise<DesktopInvokeMap["soundfont:open"]["response"]>;
    loadPath(filePath: string): Promise<DesktopInvokeMap["soundfont:load-path"]["response"]>;
    loadDefault(): Promise<DesktopInvokeMap["soundfont:default"]["response"]>;
    hash(token: string, callback: (processedBytes: number, totalBytes: number) => void): Promise<string>;
    release(token: string): Promise<void>;
  };
  ruleLibrary: {
    list(): Promise<DesktopInvokeMap["rule-library:list"]["response"]>;
    importFile(): Promise<DesktopInvokeMap["rule-library:import"]["response"]>;
    install(request: InstallExternalRuleRequest): Promise<DesktopInvokeMap["rule-library:install"]["response"]>;
    loadSource(contentHash: string): Promise<DesktopInvokeMap["rule-library:load-source"]["response"]>;
    remove(contentHash: string): Promise<DesktopInvokeMap["rule-library:remove"]["response"]>;
  };
}
