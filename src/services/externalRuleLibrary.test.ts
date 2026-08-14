import { describe, expect, it } from "vitest";
import {
  createBrowserRuleLibraryPort,
  createDesktopRuleLibraryPort,
  hashExternalRuleSource,
} from "./externalRuleLibrary";
import {
  EXTERNAL_RULE_API_VERSION,
  type ExternalRuleManifest,
} from "../domain/harmony";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function manifest(): ExternalRuleManifest {
  return {
    apiVersion: EXTERNAL_RULE_API_VERSION,
    packageId: "org.example.port",
    version: "1.0.0",
    rules: [
      {
        id: "port-rule",
        label: "端口规则",
        description: "",
        group: "custom",
        defaultSeverity: "warning",
        dependencyScope: "project",
        configVersion: 1,
        options: [],
        supportedExceptionContexts: [],
        defaultExceptionPolicies: {},
      },
    ],
  };
}

async function candidate() {
  const source = "SATB_RULE.register({});";
  return {
    source,
    sourcePath: "port.satb-rule.js",
    contentHash: await hashExternalRuleSource(source),
    sizeBytes: new TextEncoder().encode(source).byteLength,
  };
}

describe("RuleLibraryPort", () => {
  it("browser adapter supports the complete list/install/load/remove contract", async () => {
    const storage = new MemoryStorage();
    const port = createBrowserRuleLibraryPort({ storage });
    const source = await candidate();
    const installed = await port.install(source, manifest());

    expect(await port.list()).toEqual([installed]);
    expect(await port.loadSource(source.contentHash)).toBe(source.source);
    await port.remove(source.contentHash);
    expect(await port.list()).toEqual([]);
    await expect(port.loadSource(source.contentHash)).rejects.toThrow("不存在");
  });

  it("desktop adapter exposes the same contract over typed IPC", async () => {
    const source = await candidate();
    const calls: string[] = [];
    const port = createDesktopRuleLibraryPort({
      ruleLibrary: {
        list: async () => [
          {
            manifest: manifest(),
            contentHash: source.contentHash,
            sizeBytes: source.sizeBytes,
            installedAt: "2026-08-14T00:00:00.000Z",
          },
        ],
        importFile: async () => ({ canceled: true }),
        install: async (request) => {
          calls.push(`install:${request.contentHash}`);
          return {
            manifest: request.manifest as ExternalRuleManifest,
            contentHash: request.contentHash,
            sizeBytes: source.sizeBytes,
            installedAt: "2026-08-14T00:00:00.000Z",
          };
        },
        loadSource: async (contentHash) => {
          calls.push(`load:${contentHash}`);
          return { source: source.source };
        },
        remove: async (contentHash) => {
          calls.push(`remove:${contentHash}`);
          return { removed: true };
        },
      },
    });

    expect((await port.list())[0].contentHash).toBe(source.contentHash);
    expect(await port.importCandidate()).toBeUndefined();
    expect(await port.install(source, manifest())).toMatchObject({
      contentHash: source.contentHash,
    });
    expect(await port.loadSource(source.contentHash)).toBe(source.source);
    await port.remove(source.contentHash);
    expect(calls).toEqual([
      `install:${source.contentHash}`,
      `load:${source.contentHash}`,
      `remove:${source.contentHash}`,
    ]);
  });
});
