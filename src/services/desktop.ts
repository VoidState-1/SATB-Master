import { migrateProject, type ProjectDocument } from "../domain/project";
import type { PortableRuleProfile } from "../domain/ruleProfile";

const BROWSER_PROJECT_KEY = "satb-master-browser-project";
export const MAX_SOUNDFONT_BYTES = 2 * 1024 * 1024 * 1024;

export interface SoundFontLoadProgress {
  phase: "loading" | "parsing";
  completedBytes: number;
  totalBytes: number;
  fileSizeBytes: number;
  requiredMemoryBytes?: number;
  availableMemoryBytes?: number;
}

export interface PreparedDesktopSoundFont {
  token: string;
  sourceUrl: string;
  sizeBytes: number;
  requiredMemoryBytes: number;
  availableMemoryBytes: number;
  name: string;
  filePath?: string;
}

export interface LoadedSoundFont {
  name: string;
  filePath?: string;
  hash: string;
  buffer: ArrayBuffer;
  sizeBytes: number;
  requiredMemoryBytes?: number;
  availableMemoryBytes?: number;
}

type SoundFontProgressListener = (progress: SoundFontLoadProgress) => void;

export async function openProject(): Promise<
  | {
      project: ProjectDocument;
      filePath?: string;
      migratedFromSchemaVersion?: 2;
    }
  | undefined
> {
  if (window.desktop) {
    const result = await window.desktop.project.open();
    if (result.canceled) return undefined;
    const sourceSchemaVersion = (result.project as { schemaVersion?: unknown })
      ?.schemaVersion;
    const project = migrateProject(result.project);
    if (!project) throw new Error("所选文件不是受支持的 SATB 工程");
    return {
      project,
      filePath: result.filePath,
      migratedFromSchemaVersion: sourceSchemaVersion === 2 ? 2 : undefined,
    };
  }

  const raw = localStorage.getItem(BROWSER_PROJECT_KEY);
  if (!raw) throw new Error("浏览器预览中还没有保存的工程");
  const stored = JSON.parse(raw) as { schemaVersion?: unknown };
  const project = migrateProject(stored);
  if (!project) throw new Error("浏览器中的工程数据无效");
  return {
    project,
    migratedFromSchemaVersion: stored.schemaVersion === 2 ? 2 : undefined,
  };
}

export async function saveProject(
  project: ProjectDocument,
  currentPath?: string,
  forceDialog = false,
  migrationBackupSourcePath?: string,
) {
  if (window.desktop) {
    const result = await window.desktop.project.save({
      project,
      currentPath,
      forceDialog,
      migrationBackupSourcePath,
    });
    if (!result.canceled)
      localStorage.removeItem(`${BROWSER_PROJECT_KEY}-recovery`);
    return result;
  }

  localStorage.setItem(BROWSER_PROJECT_KEY, JSON.stringify(project));
  localStorage.removeItem(`${BROWSER_PROJECT_KEY}-recovery`);
  return { canceled: false, filePath: undefined };
}

export async function autosaveProject(
  project: ProjectDocument,
  sourcePath?: string,
  migrationBackupSourcePath?: string,
) {
  if (window.desktop)
    return window.desktop.project.autosave({
      project,
      sourcePath,
      migrationBackupSourcePath,
    });
  localStorage.setItem(
    `${BROWSER_PROJECT_KEY}-recovery`,
    JSON.stringify({
      format: "satb-master-recovery-v1",
      savedAt: new Date().toISOString(),
      sourcePath,
      migrationBackupSourcePath,
      project,
    }),
  );
  return { recoveryPath: "browser-local-storage" };
}

export async function findRecovery(): Promise<
  | {
      savedAt: string;
      sourcePath?: string;
      migrationBackupSourcePath?: string;
      project: ProjectDocument;
      migratedFromSchemaVersion?: 2;
    }
  | undefined
> {
  const result: {
    available: boolean;
    savedAt?: unknown;
    sourcePath?: unknown;
    migrationBackupSourcePath?: unknown;
    project?: unknown;
  } = window.desktop
    ? await window.desktop.project.recovery()
    : (() => {
        const raw = localStorage.getItem(`${BROWSER_PROJECT_KEY}-recovery`);
        return raw
          ? { available: true, ...(JSON.parse(raw) as Record<string, unknown>) }
          : { available: false };
      })();
  if (!result.available) return undefined;
  const sourceSchemaVersion = (result.project as { schemaVersion?: unknown })
    ?.schemaVersion;
  const project = migrateProject(result.project);
  if (typeof result.savedAt !== "string" || !project)
    throw new Error("自动恢复文件无效");
  return {
    savedAt: result.savedAt,
    sourcePath:
      typeof result.sourcePath === "string" ? result.sourcePath : undefined,
    migrationBackupSourcePath:
      typeof result.migrationBackupSourcePath === "string"
        ? result.migrationBackupSourcePath
        : undefined,
    project,
    migratedFromSchemaVersion: sourceSchemaVersion === 2 ? 2 : undefined,
  };
}

export async function discardRecovery() {
  if (window.desktop) return window.desktop.project.discardRecovery();
  localStorage.removeItem(`${BROWSER_PROJECT_KEY}-recovery`);
  return { discarded: true };
}

export async function exportMidi(bytes: Uint8Array, defaultName: string) {
  if (window.desktop) return window.desktop.midi.export(bytes, defaultName);
  const blob = new Blob([bytes as BlobPart], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${defaultName}.mid`;
  anchor.click();
  URL.revokeObjectURL(url);
  return { canceled: false };
}

function chooseBrowserJsonFile() {
  return new Promise<File | undefined>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.satb-rule-profile.json";
    let settled = false;
    const finish = (file?: File) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      resolve(file);
    };
    const handleWindowFocus = () => {
      window.setTimeout(() => finish(input.files?.[0]), 0);
    };
    input.addEventListener("change", () => finish(input.files?.[0]), {
      once: true,
    });
    window.addEventListener("focus", handleWindowFocus, { once: true });
    input.click();
  });
}

export async function openRuleProfileFile(): Promise<unknown | undefined> {
  if (window.desktop) {
    const result = await window.desktop.ruleProfile.open();
    return result.canceled ? undefined : result.profile;
  }
  const file = await chooseBrowserJsonFile();
  if (!file) return undefined;
  if (file.size < 1 || file.size > 2 * 1024 * 1024)
    throw new Error("规则配置档案必须小于等于 2 MB 且不能为空");
  return JSON.parse(await file.text()) as unknown;
}

export async function saveRuleProfileFile(
  profile: PortableRuleProfile,
  defaultName: string,
) {
  if (window.desktop)
    return window.desktop.ruleProfile.save({ profile, defaultName });
  const blob = new Blob([JSON.stringify(profile, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${defaultName || "SATB Master 规则配置"}.satb-rule-profile.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  return { canceled: false };
}

export async function loadDefaultSoundFont(
  onProgress?: SoundFontProgressListener,
): Promise<LoadedSoundFont> {
  if (window.desktop) {
    const resource = await window.desktop.soundFont.loadDefault();
    return loadPreparedDesktopSoundFont(resource, onProgress);
  }

  const response = await fetch(
    new URL("soundfonts/default.sf2", window.location.href),
  );
  if (!response.ok) throw new Error("默认 SoundFont 资源不存在");
  const buffer = await response.arrayBuffer();
  return {
    name: "SATB Master Basic Choir",
    hash: "browser-resource",
    buffer,
    sizeBytes: buffer.byteLength,
  };
}

export async function loadUserSoundFont(
  filePath: string,
  onProgress?: SoundFontProgressListener,
) {
  if (!window.desktop) throw new Error("浏览器预览无法重新读取本地 SoundFont");
  const resource = await window.desktop.soundFont.loadPath(filePath);
  return loadPreparedDesktopSoundFont(resource, onProgress);
}

export async function loadPreparedDesktopSoundFont(
  resource: PreparedDesktopSoundFont,
  onProgress?: SoundFontProgressListener,
): Promise<LoadedSoundFont> {
  const desktop = window.desktop;
  if (!desktop) throw new Error("桌面端 SoundFont 接口不可用");

  let hashedBytes = 0;
  let readBytes = 0;
  const totalWorkBytes = resource.sizeBytes * 2;
  let lastProgressAt = 0;
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastProgressAt < 50) return;
    lastProgressAt = now;
    onProgress?.({
      phase: "loading",
      completedBytes: Math.min(totalWorkBytes, hashedBytes + readBytes),
      totalBytes: totalWorkBytes,
      fileSizeBytes: resource.sizeBytes,
      requiredMemoryBytes: resource.requiredMemoryBytes,
      availableMemoryBytes: resource.availableMemoryBytes,
    });
  };

  const controller = new AbortController();
  try {
    report(true);
    // 摘要和文件读取并行进行；两条路径都按块处理，主进程不会再持有整份音色数据。
    const hashPromise = desktop.soundFont
      .hash(resource.token, (processedBytes) => {
        hashedBytes = processedBytes;
        report(processedBytes === resource.sizeBytes);
      })
      .catch((error) => {
        controller.abort();
        throw error;
      });
    const bufferPromise = readSoundFontBuffer(
      resource.sourceUrl,
      resource.sizeBytes,
      (processedBytes) => {
        readBytes = processedBytes;
        report(processedBytes === resource.sizeBytes);
      },
      controller.signal,
    );
    const [hash, buffer] = await Promise.all([hashPromise, bufferPromise]);
    hashedBytes = resource.sizeBytes;
    readBytes = resource.sizeBytes;
    report(true);
    return {
      name: resource.name,
      filePath: resource.filePath,
      hash,
      buffer,
      sizeBytes: resource.sizeBytes,
      requiredMemoryBytes: resource.requiredMemoryBytes,
      availableMemoryBytes: resource.availableMemoryBytes,
    };
  } finally {
    await desktop.soundFont.release(resource.token).catch(() => undefined);
  }
}

export async function readSoundFontBuffer(
  sourceUrl: string,
  expectedBytes: number,
  onProgress?: (processedBytes: number) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(sourceUrl, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`SoundFont 读取失败（${response.status}）`);
  if (!response.body) throw new Error("当前环境不支持流式读取 SoundFont");

  let buffer: ArrayBuffer;
  try {
    buffer = new ArrayBuffer(expectedBytes);
  } catch (error) {
    if (error instanceof RangeError)
      throw new Error("无法为 SoundFont 分配连续内存，请关闭其他应用后重试");
    throw error;
  }

  const target = new Uint8Array(buffer);
  const reader = response.body.getReader();
  let offset = 0;
  onProgress?.(0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedBytes)
        throw new Error("SoundFont 文件大小在加载过程中发生了变化");
      target.set(value, offset);
      offset += value.byteLength;
      onProgress?.(offset);
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedBytes) throw new Error("SoundFont 文件读取不完整");
  return buffer;
}
