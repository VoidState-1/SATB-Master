// @vitest-environment node
import { globSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "vite";
import { describe, expect, it } from "vitest";

const harmony = "src/domain/harmony/";
const root = new URL("../../../", import.meta.url);
const files = new Set(globSync(["src/**/*.{ts,tsx,mts,js,jsx,mjs}", "shared/**/*.{ts,mts,js,mjs}"], {
  cwd: fileURLToPath(root),
  exclude: ["**/*.test.*", "**/__tests__/**", "**/*.d.ts"],
}).map(file => file.replaceAll("\\", "/")));

function dependencies(file: string) {
  const { module, errors } = parseSync(file, readFileSync(new URL(file, root), "utf8"));
  expect(errors, file).toEqual([]);
  const imports = module.staticImports.filter(item =>
    !item.entries.length || item.entries.some(entry => !entry.isType)).map(item => item.moduleRequest.value);
  const reexports = module.staticExports.flatMap(item =>
    item.entries.flatMap(entry => !entry.isType && entry.moduleRequest ? [entry.moduleRequest.value] : []));
  return [...imports, ...reexports].flatMap(specifier => {
    const path = specifier.startsWith(".") ? posix.join(posix.dirname(file), specifier) : specifier.replace(/^\//, "");
    const stem = path.replace(/\.(?:js|jsx|mjs)$/, "");
    const candidates = [path, ...[".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"].flatMap(ext =>
      [stem + ext, path + "/index" + ext])];
    const target = candidates.find(name => files.has(name));
    return target ? [target] : [];
  });
}

const graph = new Map<string, string[]>();
function reachableFrom(file: string) {
  const reachable = new Set<string>();
  const visit = (source: string) => {
    const edges = graph.get(source) ?? dependencies(source);
    graph.set(source, edges);
    for (const target of edges) {
      if (reachable.has(target)) continue;
      reachable.add(target);
      visit(target);
    }
  };
  visit(file);
  return reachable;
}

describe("和声领域的静态值依赖", () => {
  it("涉及 harmony 的模块均不在运行时循环内", () => {
    expect(files.has(harmony + "analysis.ts")).toBe(true);
    const components: string[][] = [];
    const reported = new Set<string>();
    for (const file of files) {
      if (!file.startsWith(harmony) || reported.has(file)) continue;
      const reachable = reachableFrom(file);
      if (!reachable.has(file)) continue;
      const component = [...reachable].filter(other => reachableFrom(other).has(file)).sort();
      component.forEach(member => reported.add(member));
      components.push(component);
    }
    expect(components).toEqual([]);
  });

  it("cadence 不直接或间接依赖 rules", () => {
    for (const file of files) {
      if (file.startsWith(harmony + "cadence/")) {
        expect([...reachableFrom(file)].filter(path => path.startsWith(harmony + "rules/")), file).toEqual([]);
      }
    }
  });
});
