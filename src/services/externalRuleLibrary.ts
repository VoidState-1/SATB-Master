import {
  MAX_EXTERNAL_RULE_BYTES,
  validateExternalRulePackageMetadata,
  type ExternalRuleImportCandidate,
  type ExternalRuleManifest,
  type InstalledExternalRulePackage,
} from "../domain/harmony";

const BROWSER_LIBRARY_PREFIX = "satb-master-rule-library-v1:";
const sourceCache = new Map<string, Promise<string>>();

function bytesToHex(bytes: Uint8Array) {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function hashSource(source: string) {
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

export async function listExternalRulePackages() {
  if (window.desktop) {
    const values = await window.desktop.ruleLibrary.list();
    return values
      .map((value) => {
        try {
          return validateExternalRulePackageMetadata(value);
        } catch {
          return undefined;
        }
      })
      .filter((value): value is InstalledExternalRulePackage => Boolean(value));
  }

  const packages: InstalledExternalRulePackage[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(BROWSER_LIBRARY_PREFIX) || !key.endsWith(":metadata"))
      continue;
    try {
      packages.push(
        validateExternalRulePackageMetadata(
          JSON.parse(localStorage.getItem(key) ?? ""),
        ),
      );
    } catch {
      // 浏览器预览中的损坏规则记录不应影响应用启动。
    }
  }
  return packages.sort(
    (left, right) =>
      left.manifest.packageId.localeCompare(right.manifest.packageId) ||
      left.manifest.version.localeCompare(right.manifest.version),
  );
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

export async function selectExternalRulePackage(): Promise<
  ExternalRuleImportCandidate | undefined
> {
  if (window.desktop) {
    const result = await window.desktop.ruleLibrary.importFile();
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
  }

  const file = await chooseBrowserRuleFile();
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
    contentHash: await hashSource(source),
    sizeBytes,
  };
}

export async function installExternalRulePackage(
  candidate: ExternalRuleImportCandidate,
  manifest: ExternalRuleManifest,
) {
  let installed: InstalledExternalRulePackage;
  if (window.desktop) {
    installed = validateExternalRulePackageMetadata(
      await window.desktop.ruleLibrary.install({
        source: candidate.source,
        sourcePath: candidate.sourcePath,
        contentHash: candidate.contentHash,
        manifest,
      }),
    );
  } else {
    installed = {
      manifest,
      contentHash: candidate.contentHash,
      sourcePath: candidate.sourcePath,
      sizeBytes: candidate.sizeBytes,
      installedAt: new Date().toISOString(),
    };
    localStorage.setItem(
      browserMetadataKey(candidate.contentHash),
      JSON.stringify(installed),
    );
    localStorage.setItem(
      browserSourceKey(candidate.contentHash),
      candidate.source,
    );
  }
  sourceCache.set(candidate.contentHash, Promise.resolve(candidate.source));
  return installed;
}

export function loadExternalRulePackageSource(contentHash: string) {
  let pending = sourceCache.get(contentHash);
  if (pending) return pending;
  pending = (async () => {
    const source = window.desktop
      ? (await window.desktop.ruleLibrary.loadSource(contentHash)).source
      : localStorage.getItem(browserSourceKey(contentHash));
    if (typeof source !== "string") throw new Error("规则包私有副本不存在");
    if ((await hashSource(source)) !== contentHash)
      throw new Error("规则包私有副本的内容摘要不匹配");
    return source;
  })();
  sourceCache.set(contentHash, pending);
  pending.catch(() => sourceCache.delete(contentHash));
  return pending;
}

export async function removeExternalRulePackage(contentHash: string) {
  sourceCache.delete(contentHash);
  if (window.desktop) {
    await window.desktop.ruleLibrary.remove(contentHash);
  } else {
    localStorage.removeItem(browserMetadataKey(contentHash));
    localStorage.removeItem(browserSourceKey(contentHash));
  }
}
