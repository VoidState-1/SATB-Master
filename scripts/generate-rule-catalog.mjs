import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(projectRoot, "DesignDocs/harmony-rule-catalog.md");
const targetPath = resolve(projectRoot, "src/domain/rules/catalog.generated.ts");
const lines = readFileSync(sourcePath, "utf8").split(/\r?\n/);

const severityMap = {
  错误: "error",
  警告: "warning",
  建议: "suggestion",
  关闭: "off",
};

const entries = [];
for (let index = 0; index < lines.length; index += 1) {
  const heading = lines[index].match(
    /^\s+- \*\*([A-K]\.\d+(?:\.\d+)?) (.+?)（`([^`]+)`）\*\*/,
  );
  if (!heading) continue;
  const entry = {
    catalogNumber: heading[1],
    label: heading[2].replaceAll("`", ""),
    id: heading[3],
    defaultSeverity: "off",
    description: "",
    rationale: "",
  };
  for (
    let detailIndex = index + 1;
    detailIndex < Math.min(index + 8, lines.length);
    detailIndex += 1
  ) {
    const line = lines[detailIndex];
    const description = line.match(/^\s+- \*\*判断规则：\*\* (.*)$/);
    const severity = line.match(/^\s+- \*\*默认严重性：\*\* (.+?)。?$/);
    const rationale = line.match(/^\s+- \*\*例外\/边界：\*\* (.*)$/);
    if (description) entry.description = description[1];
    if (severity)
      entry.defaultSeverity = severityMap[severity[1]] ?? "off";
    if (rationale) entry.rationale = rationale[1];
  }
  entries.push(entry);
}

if (entries.length !== 81)
  throw new Error(`规则目录应包含 81 条规则，实际解析到 ${entries.length} 条`);

const banner = `// 此文件由 scripts/generate-rule-catalog.mjs 从 DesignDocs/harmony-rule-catalog.md 生成。\n// 请修改设计清单后重新运行生成器，不要直接编辑本文件。\n\n`;
writeFileSync(
  targetPath,
  `${banner}export const GENERATED_RULE_CATALOG = ${JSON.stringify(entries, null, 2)} as const;\n`,
  "utf8",
);
