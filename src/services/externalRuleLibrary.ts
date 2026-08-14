import {
  MAX_EXTERNAL_RULE_BYTES,
  validateExternalRulePackageMetadata,
  type ExternalRuleImportCandidate,
  type ExternalRuleManifest,
  type InstalledExternalRulePackage,
} from "../domain/harmony";
import type { DesktopApi } from "../../shared/desktop";

const BROWSER_LIBRARY_PREFIX = "satb-master-rule-library-v1:";
const sourceCache = new Map<string, Promise<string>>();

export interface RuleLibraryPort {
  list(): Promise<InstalledExternalRulePackage[]>;
  importCandidate(): Promise<ExternalRuleImportCandidate | undefined>;
  install(
    candidate: ExternalRuleImportCandidate,
    manifest: ExternalRuleManifest,
  ): Promise<InstalledExternalRulePackage>;
  loadSource(contentHash: string): Promise<string>;
  remove(contentHash: string): Promise<void>;
}

export interface RuleLibraryStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashExternalRuleSource(source: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return bytesToHex(new Uint8Array(digest));
}

function browserMetadataKey(contentHash: string) {
  return `${BROWSER_LIBRARY_PREFIX}${contentHash}:metadata`;
}

function browserSourceKey(contentHash: string) {
  return `${BROWSER_LIBRARY_PREFIX}${contentHash}:source`;
}

function sortPackages(
  packages: readonly InstalledExternalRulePackage[],
) {
  return [...packages].sort(
    (left, right) =>
      left.manifest.packageId.localeCompare(right.manifest.packageId) ||
      left.manifest.version.localeCompare(right.manifest.version),
  );
}

function defaultStorage(): RuleLibraryStorage {
  return localStorage;
}

function chooseBrowserRuleFile() {
  return new Promise<File | undefined>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".js,.satb-rule.js";
    input.addEventListener("change", () => resolve(input.files?.[0]), {
      once: true,
    });
    input.click();
  });
}

export function createBrowserRuleLibraryPort(options: {
  storage?: RuleLibraryStorage;
  chooseFile?: () => Promise<File | undefined>;
} = {}): RuleLibraryPort {
  const storage = options.storage ?? defaultStorage();
  const chooseFile = options.chooseFile ?? chooseBrowserRuleFile;

  return {
    async list() {
      const packages: InstalledExternalRulePackage[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (
          !key?.startsWith(BROWSER_LIBRARY_PREFIX) ||
          !key.endsWith(":metadata")
        )
          continue;
        try {
          const metadata = validateExternalRulePackageMetadata(
            JSON.parse(storage.getItem(key) ?? ""),
          );
          const source = storage.getItem(browserSourceKey(metadata.contentHash));
          if (
            typeof source !== "string" ||
            new TextEncoder().encode(source).byteLength !== metadata.sizeBytes
          )
            throw new Error("规则包私有副本缺失或大小不符");
          packages.push(metadata);
        } catch {
          // 浏览器预览中的损坏规则记录不应影响应用启动。
        }
      }
      return sortPackages(packages);
    },

    async importCandidate() {
      const file = await chooseFile();
      if (!file) return undefined;
      if (!file.name.toLowerCase().endsWith(".satb-rule.js"))
        throw new Error("只支持 .satb-rule.js 文件");
      if (file.size < 1 || file.size > MAX_EXTERNAL_RULE_BYTES)
        throw new Error("规则包必须小于等于 512 KiB 且不能为空");
      const source = await file.text();
      const sizeBytes = new TextEncoder().encode(source).byteLength;
      if (sizeBytes > MAX_EXTERNAL_RULE_BYTES)
        throw new Error("规则包超过 512 KiB 限制");
      return {
        source,
        sourcePath: file.name,
        contentHash: await hashExternalRuleSource(source),
        sizeBytes,
      };
    },

    async install(candidate, manifest) {
      const actualSize = new TextEncoder().encode(candidate.source).byteLength;
      if (
        actualSize < 1 ||
        actualSize > MAX_EXTERNAL_RULE_BYTES ||
        actualSize !== candidate.sizeBytes ||
        (await hashExternalRuleSource(candidate.source)) !== candidate.contentHash
      )
        throw new Error("规则包内容、大小或摘要不匹配");
      const installed = validateExternalRulePackageMetadata({
        manifest,
        contentHash: candidate.contentHash,
        sourcePath: candidate.sourcePath,
        sizeBytes: actualSize,
        installedAt: new Date().toISOString(),
      });
      storage.setItem(
        browserMetadataKey(candidate.contentHash),
        JSON.stringify(installed),
      );
      storage.setItem(browserSourceKey(candidate.contentHash), candidate.source);
      return installed;
    },

    async loadSource(contentHash) {
      const source = storage.getItem(browserSourceKey(contentHash));
      if (typeof source !== "string")
        throw new Error("规则包私有副本不存在");
      return source;
    },

    async remove(contentHash) {
      storage.removeItem(browserMetadataKey(contentHash));
      storage.removeItem(browserSourceKey(contentHash));
    },
  };
}

export function createDesktopRuleLibraryPort(
  api: Pick<DesktopApi, "ruleLibrary">,
): RuleLibraryPort {
  return {
    async list() {
      const values = await api.ruleLibrary.list();
      return sortPackages(
        values
          .map((value) => {
            try {
              return validateExternalRulePackageMetadata(value);
            } catch {
              return undefined;
            }
          })
          .filter(
            (value): value is InstalledExternalRulePackage => Boolean(value),
          ),
      );
    },

    async importCandidate() {
      const result = await api.ruleLibrary.importFile();
      if (result.canceled) return undefined;
      if (
        typeof result.source !== "string" ||
        typeof result.contentHash !== "string" ||
        typeof result.sizeBytes !== "number"
      )
        throw new Error("桌面端返回的规则包内容无效");
      return {
        source: result.source,
        sourcePath: result.sourcePath,
        contentHash: result.contentHash,
        sizeBytes: result.sizeBytes,
      };
    },

    async install(candidate, manifest) {
      return validateExternalRulePackageMetadata(
        await api.ruleLibrary.install({
          source: candidate.source,
          sourcePath: candidate.sourcePath,
          contentHash: candidate.contentHash,
          manifest,
        }),
      );
    },

    async loadSource(contentHash) {
      return (await api.ruleLibrary.loadSource(contentHash)).source;
    },

    async remove(contentHash) {
      await api.ruleLibrary.remove(contentHash);
    },
  };
}

function defaultPort(): RuleLibraryPort {
  return typeof window !== "undefined" && window.desktop
    ? createDesktopRuleLibraryPort(window.desktop)
    : createBrowserRuleLibraryPort();
}

export async function listExternalRulePackages() {
  return defaultPort().list();
}

export async function selectExternalRulePackage() {
  return defaultPort().importCandidate();
}

export async function installExternalRulePackage(
  candidate: ExternalRuleImportCandidate,
  manifest: ExternalRuleManifest,
) {
  const computedHash = await hashExternalRuleSource(candidate.source);
  if (computedHash !== candidate.contentHash)
    throw new Error("规则包内容摘要不匹配");
  if (
    candidate.sizeBytes < 1 ||
    candidate.sizeBytes > MAX_EXTERNAL_RULE_BYTES
  )
    throw new Error("规则包大小无效");
  const installed = await defaultPort().install(candidate, manifest);
  sourceCache.set(candidate.contentHash, Promise.resolve(candidate.source));
  return installed;
}

export function loadExternalRulePackageSource(contentHash: string) {
  let pending = sourceCache.get(contentHash);
  if (pending) return pending;
  pending = (async () => {
    const source = await defaultPort().loadSource(contentHash);
    if ((await hashExternalRuleSource(source)) !== contentHash)
      throw new Error("规则包私有副本的内容摘要不匹配");
    return source;
  })();
  sourceCache.set(contentHash, pending);
  pending.catch(() => sourceCache.delete(contentHash));
  return pending;
}

export async function removeExternalRulePackage(contentHash: string) {
  sourceCache.delete(contentHash);
  await defaultPort().remove(contentHash);
}
