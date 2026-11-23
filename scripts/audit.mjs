import { readFile, writeFile, mkdir, access, realpath, stat } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const help = `Usage:
  npm run audit -- pack manifest.json --out batch.satb-audit.json
  npm run audit -- validate batch.satb-audit.json
  npm run audit -- feedback batch.satb-audit.json opinions.audit-feedback.json
No inference or rule checks are run. pack never overwrites an existing file.
`;
async function readJson(filename) {
  if ((await stat(filename)).size > 32 * 1024 * 1024) throw new Error("审计文件超过 32 MB, 请拆成较小批次");
  return JSON.parse(await readFile(filename, "utf8"));
}
async function main() {
  const [command, input, ...rest] = process.argv.slice(2);
  if (!command || command === "--help") { process.stdout.write(help); return; }
  if (!input || !["pack", "validate", "feedback"].includes(command)) throw new Error(help);
  if (command === "pack" ? rest.length !== 2 || rest[0] !== "--out" || !rest[1] : command === "feedback" ? rest.length !== 1 : rest.length !== 0) throw new Error(help);
  const inputPath = await realpath(resolve(input));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom", logLevel: "error" });
  try {
    const api = await server.ssrLoadModule("/src/domain/audit/index.ts");
    const hash = async (text) => createHash("sha256").update(text).digest("hex");
    let value = await readJson(inputPath);
    if (command === "pack") {
      if (value.format !== "satb-audit-manifest" || ![1, 2].includes(value.formatVersion) || !Array.isArray(value.cases)) throw new Error("需要 satb-audit-manifest v2, 详见 Docs/audit-workspace.md");
      const cases = [];
      for (const entry of value.cases) {
        const { scoreFile, projectFile, source, items, ...fields } = entry;
        let project;
        if (typeof projectFile === "string") project = api.parseAuditProject(await readJson(resolve(dirname(inputPath), projectFile)), `${entry.id}.projectFile`);
        else if (value.formatVersion === 1 && typeof scoreFile === "string") {
          const score = await server.ssrLoadModule("/src/domain/scoreText/index.ts");
          const spec = score.parseScoreText(await readFile(resolve(dirname(inputPath), scoreFile), "utf8"));
          project = score.compileScore({ ...spec, reference: [], referenceComplete: [] }).project;
        } else throw new Error(`${entry.id}: v2 清单必须用 projectFile 附上生成的 .satb 工程`);
        if (!Array.isArray(items)) throw new Error(`${entry.id}: items 应为审计条目列表`);
        const attachedItems = [];
        for (const item of items) {
          const { projectFile: itemProjectFile, ...itemFields } = item;
          if (itemProjectFile !== undefined && typeof itemProjectFile !== "string") throw new Error(`${entry.id}/${item.id}: projectFile 应为路径`);
          const itemProject = itemProjectFile === undefined ? structuredClone(project) : api.parseAuditProject(await readJson(resolve(dirname(inputPath), itemProjectFile)), `${entry.id}/${item.id}.projectFile`);
          attachedItems.push({ ...itemFields, project: itemProject });
        }
        const { imageFile, ...sourceFields } = source ?? {};
        let image = sourceFields.image;
        if (imageFile !== undefined) {
          if (typeof imageFile !== "string") throw new Error("imageFile 应为本地图片路径");
          const imagePath = resolve(dirname(inputPath), imageFile);
          const mime = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" }[extname(imagePath).toLowerCase()];
          if (!mime) throw new Error("只支持 PNG/JPEG/WebP 原图");
          image = `data:image/${mime};base64,${(await readFile(imagePath)).toString("base64")}`;
        }
        cases.push({ ...fields, project, items: attachedItems, source: { ...sourceFields, image } });
      }
      value = { ...value, format: "satb-audit-package", formatVersion: 2, cases };
    }
    const document = api.parseAuditPackage(value);
    const bound = await api.bindAuditPackage(document, hash);
    if (command === "pack") {
      const output = resolve(rest[1]);
      try { await access(output); throw new Error("输出已存在, 请另选文件名以保留旧版本"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const json = JSON.stringify(document, null, 2) + "\n";
      if (Buffer.byteLength(json) > 32 * 1024 * 1024) throw new Error("审计包超过 32 MB, 请拆成较小批次");
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, json, { encoding: "utf8", flag: "wx" });
      process.stdout.write(`已打包 ${document.cases.length} 个谱例 / ${document.cases.reduce((n, c) => n + c.items.length, 0)} 个审计条目: ${output}\n`);
    } else if (command === "feedback") {
      const feedback = api.parseAuditFeedback(await readJson(resolve(rest[0])));
      const restored = api.restoreAuditFeedback(bound, feedback);
      process.stdout.write(JSON.stringify({ packageId: document.id, restored: restored.restored, stale: restored.stale, feedback: restored.feedback }, null, 2) + "\n");
    } else process.stdout.write(`OK: ${document.id}, ${bound.cases.length} 个谱例, 指纹 ${bound.fingerprint}\n`);
  } finally { await server.close(); }
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
