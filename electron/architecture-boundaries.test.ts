import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(projectRoot, "src");

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("architecture boundaries", () => {
  it("keeps domain modules independent from runtime adapters", () => {
    const forbidden = /from\s+["'](?:react|electron)["']|window\.desktop|\bAudioContext\b|document\./;
    const violations = sourceFiles(join(srcRoot, "domain")).filter((path) =>
      forbidden.test(readFileSync(path, "utf8")),
    );

    expect(violations).toEqual([]);
  });

  it("keeps compatibility entries as forwarding facades", () => {
    expect(readFileSync(join(srcRoot, "domain", "model.ts"), "utf8").trim()).toBe(
      'export * from "./project";',
    );
    expect(
      readFileSync(join(srcRoot, "components", "PianoRoll.tsx"), "utf8"),
    ).toContain('from "../features/editor/PianoRoll"');

    const harmonyFacade = readFileSync(
      join(srcRoot, "domain", "harmony.ts"),
      "utf8",
    );
    expect(harmonyFacade).not.toMatch(/\b(?:function|const|class)\s+[A-Za-z]/);
  });
});
