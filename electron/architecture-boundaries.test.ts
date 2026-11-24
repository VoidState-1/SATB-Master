import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(projectRoot, "src");

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) ? [path] : [];
  });
}

function importSpecifiers(path: string) {
  return [...readFileSync(path, "utf8").matchAll(
    /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g,
  )].map((match) => match[1]);
}

describe("architecture boundaries", () => {
  it("keeps domain modules independent from runtime adapters", () => {
    const forbidden = /from\s+["'](?:react|electron)["']|window\.desktop|\bAudioContext\b|document\.|services\/logging/;
    const violations = sourceFiles(join(srcRoot, "domain")).filter((path) =>
      forbidden.test(readFileSync(path, "utf8")),
    );

    expect(violations).toEqual([]);
  });

  it("routes production warnings and errors through the loggers", () => {
    const violations = ["electron", "src"].flatMap((root) => {
      const methods = "warn|error";
      const call = new RegExp(
        String.raw`\bconsole\s*(?:(?:\?\.|\.)\s*(?:${methods})|(?:\?\.\s*)?\[\s*["'](?:${methods})["']\s*\])\s*(?:\?\.\s*)?\(`,
      );
      return sourceFiles(join(projectRoot, root)).flatMap((file) => {
        const name = relative(projectRoot, file).split(sep).join("/");
        if (/\.(?:test|spec|d)\.[^.]+$/.test(name) ||
            name === "electron/logger.ts" || name === "src/services/logging/logger.ts") return [];
        return call.test(readFileSync(file, "utf8")) ? [name] : [];
      });
    });
    expect(violations).toEqual([]);
  });

  it("keeps removed legacy entries absent", () => {
    expect(existsSync(join(srcRoot, "domain", "model.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "domain", "harmony.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "components", "PianoRoll.tsx"))).toBe(false);
    expect(existsSync(join(srcRoot, "components", "Inspector.tsx"))).toBe(false);
    expect(existsSync(join(srcRoot, "components", "ShortcutSettings.tsx"))).toBe(false);
    expect(existsSync(join(srcRoot, "domain", "harmonyAnalysis.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "domain", "harmonyRuntime.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "domain", "harmonyRules.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "domain", "externalRules.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "domain", "externalRuleSandbox.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "domain", "externalRuleWorkerProtocol.ts"))).toBe(false);
    expect(existsSync(join(srcRoot, "domain", "rules"))).toBe(false);
  });

  it("keeps internal callers on domain package entry points", () => {
    const internalRoots = [
      join(srcRoot, "app"),
      join(srcRoot, "features"),
      join(srcRoot, "hooks"),
      join(srcRoot, "services"),
      join(srcRoot, "audio"),
    ];
    const forbidden = /from\s+["'][^"']*(?:domain\/model|domain\/harmony\/(?:ruleTypes|runtime|analysis)|features\/(?:editor|inspector|settings|diagnostics|tracks)\/)/;
    const violations = internalRoots
      .flatMap(sourceFiles)
      .filter((path) => forbidden.test(readFileSync(path, "utf8")));

    expect(violations).toEqual([]);
  });

  it("keeps shared components independent from feature implementations", () => {
    const violations = sourceFiles(join(srcRoot, "components")).filter((path) =>
      /from\s+["'][^"']*features\//.test(readFileSync(path, "utf8")),
    );
    expect(violations).toEqual([]);
  });

  it("keeps feature implementations behind their package boundaries", () => {
    const featuresRoot = join(srcRoot, "features");
    // Composition workspaces may consume another feature's public entry point.
    // Keep this list explicit so accidental cross-feature implementation imports
    // remain visible in the architecture test.
    const allowedDependencies: Record<string, ReadonlySet<string>> = {
      ruleTesting: new Set(["editor", "inspector", "settings", "tracks"]),
      bottomPanel: new Set(["diagnostics", "scorePreview", "progressionAssistant"]),
      audit: new Set(["scorePreview", "editor", "inspector"]),
    };
    const violations = sourceFiles(featuresRoot).flatMap((path) => {
      const owner = relative(featuresRoot, path).split(sep)[0];
      return importSpecifiers(path).flatMap((specifier) => {
        if (!specifier.startsWith(".")) return [];
        const target = relative(featuresRoot, resolve(dirname(path), specifier));
        if (!target || target.startsWith(`..${sep}`)) return [];
        const dependency = target.split(sep)[0];
        return dependency === owner ||
          allowedDependencies[owner]?.has(dependency)
          ? []
          : [`${path} -> ${specifier}`];
      });
    });

    expect(violations).toEqual([]);
  });
});
