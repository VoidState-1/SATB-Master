import { access, readFile, realpath, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const help = `Usage:
  npm run score -- compile input.satbt --out output.satb [--reference-out answers.json] [--map-out map.json] [--force]
  npm run score -- render input.satb [--from 1 --to 4] [--out score.txt] [--reference-file answers.json] [--ids] [--force]
  npm run score -- render input.satbt [--reference] [--out score.txt]
  npm run score -- validate input.satbt

Without --out, compile/render writes to stdout. Reference annotations never enter the SATB input.
`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) { process.stdout.write(help); return; }
  const [command, input, ...rest] = args;
  if (!["compile", "render", "validate"].includes(command) || !input || input.startsWith("--")) throw new Error(help);
  const flags = new Map();
  const booleanFlags = new Set(["--force", "--reference", "--ids"]);
  const valueFlags = new Set(["--out", "--reference-out", "--map-out", "--reference-file", "--from", "--to"]);
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flags.has(flag)) throw new Error(`重复参数 ${flag}`);
    if (booleanFlags.has(flag)) flags.set(flag, true);
    else if (valueFlags.has(flag) && rest[index + 1] && !rest[index + 1].startsWith("--")) flags.set(flag, rest[++index]);
    else throw new Error(`未知参数或缺少值：${flag}`);
  }
  const allowed = command === "compile" ? ["--out", "--reference-out", "--map-out", "--force"] : command === "render"
    ? ["--out", "--from", "--to", "--reference", "--reference-file", "--ids", "--force"] : [];
  for (const flag of flags.keys()) if (!allowed.includes(flag)) throw new Error(`${command} 不支持 ${flag}`);
  if (flags.has("--reference") && flags.has("--reference-file")) throw new Error("--reference 与 --reference-file 不能同时使用");
  const sourcePath = resolve(input);
  const destinations = ["--out", "--reference-out", "--map-out"].filter((flag) => flags.has(flag)).map((flag) => resolve(flags.get(flag)));
  const inputs = [sourcePath, ...(flags.has("--reference-file") ? [resolve(flags.get("--reference-file"))] : [])];
  async function pathKey(path) {
    let canonical = path;
    try { canonical = await realpath(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    return process.platform === "win32" ? canonical.toLowerCase() : canonical;
  }
  const inputKeys = await Promise.all(inputs.map(pathKey));
  const outputKeys = await Promise.all(destinations.map(pathKey));
  if (outputKeys.some((target) => inputKeys.includes(target)) || new Set(outputKeys).size !== outputKeys.length) throw new Error("输出文件必须互不相同，且不能覆盖输入文件");
  if (!flags.has("--force")) for (const target of destinations) {
    let exists = false;
    try { await access(target); exists = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (exists) throw new Error(`输出文件已存在：${target}；覆盖请使用 --force`);
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
  try {
    const api = await server.ssrLoadModule("/src/domain/scoreText/index.ts");
    const { migrateProject } = await server.ssrLoadModule("/src/domain/project/index.ts");
    const source = await readFile(sourcePath, "utf8");
    const isSatb = extname(sourcePath).toLowerCase() === ".satb";
    if (command === "compile" && isSatb) throw new Error("compile 的输入应为简写文本 .satbt");
    const compiled = isSatb ? undefined : api.compileScoreText(source);
    const project = compiled?.project ?? migrateProject(JSON.parse(source));
    if (!project) throw new Error("无效或不支持的 SATB 工程");
    if (command === "validate") { process.stdout.write(`OK: ${input}\n`); return; }
    async function output(text, flag = "--out") {
      if (!flags.has(flag)) { process.stdout.write(text); return; }
      const target = resolve(flags.get(flag));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text, { encoding: "utf8", flag: flags.has("--force") ? "w" : "wx" });
    }
    if (command === "compile") {
      await output(JSON.stringify(project, null, 2) + "\n");
      if (flags.has("--reference-out")) await output(JSON.stringify(compiled.reference, null, 2) + "\n", "--reference-out");
      if (flags.has("--map-out")) await output(JSON.stringify({ aliases: compiled.aliases, sourceMap: compiled.sourceMap }, null, 2) + "\n", "--map-out");
    } else {
      if (flags.has("--reference") && !compiled) throw new Error("原生 .satb 请通过 --reference-file 指定独立参考文件");
      const reference = flags.has("--reference-file") ? JSON.parse(await readFile(resolve(flags.get("--reference-file")), "utf8")) : flags.has("--reference") ? compiled.reference : undefined;
      await output(api.renderScoreText(project, {
        ...(flags.has("--from") ? { fromBar: Number(flags.get("--from")) } : {}),
        ...(flags.has("--to") ? { toBar: Number(flags.get("--to")) } : {}),
        includeIds: flags.has("--ids"), reference,
      }));
    }
  } finally { await server.close(); }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
