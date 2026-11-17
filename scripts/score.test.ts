import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

function removeTempDirectory(directory: string) {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("satb-score-"))
    throw new Error(`临时目录不在预期范围内：${target}`);
  rmSync(target, { recursive: true, force: true });
}

const cli = resolve("scripts/score.mjs");
const sample = resolve("StandardCase/Samples/annotated-cadence.satbt");
function run(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 20000, windowsHide: true });
}

describe("score CLI", () => {
  it("编译、保存、校验并重新读取原生工程及独立答案文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "satb-score-cli-"));
    try {
      const projectPath = join(dir, "含空格的 input.satb");
      const referencePath = join(dir, "answer.json");
      const compile = run("compile", sample, "--out", projectPath, "--reference-out", referencePath);
      expect(compile.stderr).toBe("");
      expect(compile.status).toBe(0);
      const project = JSON.parse(readFileSync(projectPath, "utf8"));
      expect(project.chordTrack.cadenceAnnotations).toEqual([]);
      expect(JSON.parse(readFileSync(referencePath, "utf8")).cadences).toHaveLength(1);
      expect(run("validate", projectPath).status).toBe(0);
      const render = run("render", projectPath, "--from", "2", "--to", "2", "--reference-file", referencePath);
      expect(render.status).toBe(0);
      expect(render.stdout).toContain("view bars 2..2");
      expect(render.stdout).toContain("REFERENCE (not input)");
      expect(render.stdout).toContain("kind=full");
    } finally { removeTempDirectory(dir); }
  }, 25000);

  it("无效简写返回非零状态且不生成工程", () => {
    const dir = mkdtempSync(join(tmpdir(), "satb-score-invalid-"));
    try {
      const input = join(dir, "bad.satbt");
      writeFileSync(input, "satb 1\nbars 1..1 {\nS: | C4/2 |\nA: empty\nT: empty\nB: empty\n}");
      const result = run("compile", input);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/S 声部.*第 1 小节.*时值不完整/);
      expect(run("render", input, "--unknown").status).toBe(1);
    } finally { removeTempDirectory(dir); }
  }, 15000);

  it("覆盖需显式 force，输入文件始终受到保护", () => {
    const dir = mkdtempSync(join(tmpdir(), "satb-score-write-"));
    try {
      const target = join(dir, "existing.satb");
      writeFileSync(target, "keep me");
      expect(run("compile", sample, "--out", target).status).toBe(1);
      expect(readFileSync(target, "utf8")).toBe("keep me");
      expect(run("compile", sample, "--out", target, "--force").status).toBe(0);
      expect(JSON.parse(readFileSync(target, "utf8")).schemaVersion).toBe(3);
      const before = readFileSync(sample, "utf8");
      expect(run("compile", sample, "--out", sample, "--force").status).toBe(1);
      expect(readFileSync(sample, "utf8")).toBe(before);
    } finally { removeTempDirectory(dir); }
  }, 15000);
});
