import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repo = fileURLToPath(new URL("../", import.meta.url));
const voices = ["soprano", "alto", "tenor", "bass"];
const sixFourRoles = ["cadential64", "passing64", "pedal64"];
const triadQualities = ["major", "minor", "diminished", "augmented"];
const steps = "CDEFGAB";

const nonblank = (value) => typeof value === "string" && value.trim().length > 0;
const validChapter = (value) => /^\d+$/.test(value) && Number(value) >= 4 && Number(value) <= 58;
const metadataChecks = {
  tier: [(value) => ["L1", "L2", "L3"].includes(value), "L1、L2 或 L3"],
  medium: [(value) => value === "written", "written"],
  chapter: [validChapter, "4 到 58 的整数"],
  exerciseType: [(value) => ["melody", "bass"].includes(value), "melody 或 bass"],
  book: [nonblank, "非空书名"],
  question: [nonblank, "非空题号"],
  page: [nonblank, "非空页码"],
};

function makeResult(filePath) {
  return {
    filePath,
    ok: false,
    stats: {
      measures: 0,
      lengthTicks: 0,
      soundingSpanTicks: 0,
      chordCoverageRatio: 0,
      chordGapCount: 0,
      referenceChords: 0,
      referencePhrases: 0,
      referenceCadences: 0,
      halfCadences: 0,
      fullCadences: 0,
      deceptiveCadences: 0,
      supplementaryCadences: 0,
      referenceNoteRoles: 0,
      conditionedRuleErrors: null,
      conditionedRuleWarnings: null,
      conditionedRuleSkips: null,
    },
    metadata: {},
    errors: [],
    warnings: [],
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportCompileError(result, spec, error) {
  const message = errorMessage(error);
  const location = error?.location;
  result.errors.push({ code: "COMPILE_ERROR", message, ...(location && { detail: { location } }) });

  // 这些标注在默认编译中已被拒绝，无法从已解析的参考区间再诊断。
  const label = spec?.reference?.find((item) => location && item.location?.line === location.line);
  if (!label) return;
  let code;
  if (label.kind === "chord" && message.includes("和弦区域不能重叠")) code = "CHORD_OVERLAP";
  if (label.kind === "phrase" && message.includes("乐句范围不能重叠")) code = "PHRASE_OVERLAP";
  if (label.kind === "cadence") {
    if (/范围结束位置必须晚于开始位置|终止式范围必须位于所属乐句内|终止式引用了未声明的乐句/.test(message)) {
      code = "CADENCE_INVALID_RANGE";
    } else if (label.fields.kind === "supplementary" && !label.fields.form && message.includes("终止式类型与限定不一致")) {
      code = "CADENCE_MISSING_FORM";
    }
  }
  if (code) result.errors.push({ code, message, detail: { name: label.name, location } });
}

function checkMetadata(result, allowLegacyMeta) {
  const issues = allowLegacyMeta ? result.warnings : result.errors;
  for (const [key, [isValid, expected]] of Object.entries(metadataChecks)) {
    const value = result.metadata[key];
    if (value === undefined) {
      issues.push({ code: "META_MISSING", message: "缺少元数据 " + key, detail: { key } });
    } else if (!isValid(value)) {
      issues.push({ code: "META_INVALID", message: "元数据 " + key + " 应为" + expected, detail: { key, value } });
    }
  }
}

function orderRanges(ranges) {
  return [...ranges].sort((a, b) => a.fromTick - b.fromTick || a.toTick - b.toTick);
}

function eventRange({ startTick, durationTicks }) {
  return { fromTick: startTick, toTick: startTick + durationTicks };
}

function mergeRanges(ordered) {
  const merged = [];
  for (const range of ordered) {
    const last = merged.at(-1);
    if (last && range.fromTick <= last.toTick) last.toTick = Math.max(last.toTick, range.toTick);
    else merged.push({ fromTick: range.fromTick, toTick: range.toTick });
  }
  return merged;
}

function overlappingRanges(ordered) {
  const overlaps = [];
  let end = 0;
  for (const { fromTick, toTick } of ordered) {
    if (fromTick < end) overlaps.push({ fromTick, toTick: Math.min(end, toTick) });
    end = Math.max(end, toTick);
  }
  return overlaps;
}

function uncoveredRanges(required, covered) {
  const gaps = [];
  let index = 0;
  for (const span of required) {
    let cursor = span.fromTick;
    while (index < covered.length && covered[index].fromTick < span.toTick) {
      const range = covered[index];
      if (range.fromTick > cursor) gaps.push({ fromTick: cursor, toTick: range.fromTick });
      cursor = Math.max(cursor, range.toTick);
      if (range.toTick >= span.toTick) break;
      index++;
    }
    if (cursor < span.toTick) gaps.push({ fromTick: cursor, toTick: span.toTick });
  }
  return gaps;
}

function totalTicks(ranges) {
  return ranges.reduce((total, { fromTick, toTick }) => total + toTick - fromTick, 0);
}

function measurePositions(project) {
  // positionText 只需要小节编号、边界和拍号分母。
  const measures = [];
  const meters = project.meterEvents;
  let meterIndex = 0;
  for (let startTick = 0; startTick < project.lengthTicks;) {
    while (meters[meterIndex + 1]?.tick <= startTick) meterIndex++;
    const { numerator, denominator } = meters[meterIndex];
    const endTick = Math.min(
      startTick + numerator * project.ppq * 4 / denominator,
      meters[meterIndex + 1]?.tick ?? project.lengthTicks,
      project.lengthTicks,
    );
    measures.push({ number: measures.length + 1, startTick, endTick, denominator });
    startTick = endTick;
  }
  return measures;
}

function coveragePercent(ratio) {
  const percent = (ratio * 100).toFixed(2);
  return ratio < 1 && percent === "100.00" ? "<100.00%" : percent + "%";
}

function rangeIssue(code, message, ranges, formatRange, extra = {}) {
  const intervals = ranges.map((range) => ({ ...range, text: formatRange(range) }));
  const sample = intervals.slice(0, 5).map(({ text }) => text).join("、");
  return {
    code,
    message: message + "：" + sample + (intervals.length > 5 ? "（其余见报告）" : ""),
    detail: { count: intervals.length, intervals, ...extra },
  };
}

function checkChords(reference, sounding, result, formatRange) {
  const { errors, warnings, stats } = result;
  if (!reference.complete.includes("chord")) {
    errors.push({ code: "MISSING_COMPLETE_CHORD", message: "参考答案缺少 complete=chord 声明" });
  }
  const chords = orderRanges(reference.chords.map(eventRange));
  const overlaps = overlappingRanges(chords);
  if (overlaps.length) {
    errors.push(rangeIssue("CHORD_OVERLAP", "参考和弦范围重叠", overlaps, formatRange));
  }
  const gaps = uncoveredRanges(sounding, mergeRanges(chords));
  const soundingTicks = totalTicks(sounding);
  stats.chordCoverageRatio = soundingTicks ? (soundingTicks - totalTicks(gaps)) / soundingTicks : 0;
  stats.chordGapCount = gaps.length;
  if (gaps.length) {
    const percent = coveragePercent(stats.chordCoverageRatio);
    errors.push(rangeIssue(
      "CHORD_COVERAGE_GAP", "发声区间有 " + gaps.length + " 处和弦空洞（覆盖率 " + percent + "）",
      gaps, formatRange, { coverageRatio: stats.chordCoverageRatio, coveragePercent: percent },
    ));
  }
  for (const chord of reference.chords) {
    const { root, bass, structure } = chord.identity;
    const diatonicDistance = (steps.indexOf(bass.step) - steps.indexOf(root.step) + 7) % 7;
    if (structure.kind !== "tertian" || structure.extensions.length || !triadQualities.includes(structure.quality) ||
      diatonicDistance !== 4 || sixFourRoles.includes(chord.semantics?.cadenceRole)) continue;
    const range = eventRange(chord);
    warnings.push({
      code: "SIX_FOUR_MISSING_ROLE",
      message: "四六和弦 " + chord.id + " " + formatRange(range) + " 缺少四六用途标注",
      detail: { chordId: chord.id, ...range },
    });
  }
}

function checkPhrases(phrases, lengthTicks, entryTick, errors, formatRange) {
  if (!phrases.length) {
    errors.push({ code: "MISSING_PHRASES", message: "参考答案至少应标注一个乐句" });
    return;
  }
  const overlaps = overlappingRanges(phrases);
  if (overlaps.length) {
    errors.push(rangeIssue("PHRASE_OVERLAP", "参考乐句范围重叠", overlaps, formatRange));
  }
  const fromTick = phrases[0].fromTick === entryTick ? entryTick : 0;
  const gaps = uncoveredRanges([{ fromTick, toTick: lengthTicks }], mergeRanges(phrases));
  if (gaps.length) {
    errors.push(rangeIssue("PHRASE_COVERAGE_GAP", "参考乐句未连续覆盖工程", gaps, formatRange));
  }
}

function insidePhrase(cadence, phrase) {
  return cadence.fromTick >= phrase.fromTick && cadence.toTick <= phrase.toTick;
}

function checkCadences(compiled, phrases, result, formatRange, finalMeasureStart) {
  const { reference, annotations } = compiled;
  const { errors, metadata, stats } = result;
  if (!reference.complete.includes("cadence")) {
    errors.push({ code: "MISSING_COMPLETE_CADENCE", message: "参考答案缺少 complete=cadence 声明" });
  }
  if (!reference.cadences.length) {
    errors.push({ code: "MISSING_CADENCES", message: "参考答案至少应标注一条终止式" });
  }

  const byId = new Map([...annotations.phrases, ...phrases].map((phrase) => [phrase.phraseId, phrase]));
  const validCadences = [];
  for (const cadence of reference.cadences) {
    const { id, phraseId, fromTick, toTick, kind, form, completion } = cadence;
    const phrase = byId.get(phraseId);
    const detail = { cadenceId: id, phraseId, fromTick, toTick };
    if (fromTick < toTick && phrase && insidePhrase(cadence, phrase)) validCadences.push(cadence);
    else {
      errors.push({
        code: "CADENCE_INVALID_RANGE",
        message: "终止式 " + id + " " + formatRange(cadence) + " 须为正长度并位于所属乐句内",
        detail,
      });
    }
    if (kind !== "deceptive" && !["authentic", "plagal"].includes(form)) {
      errors.push({ code: "CADENCE_MISSING_FORM", message: "终止式 " + id + " 缺少正格或变格标注", detail });
    }
    if (kind === "full" && !["perfect", "imperfect"].includes(completion)) {
      errors.push({ code: "CADENCE_MISSING_COMPLETION", message: "全终止 " + id + " 缺少完满性标注", detail });
    }
  }

  const last = phrases.at(-1);
  if (last && !validCadences.some((cadence) => insidePhrase(cadence, last) ||
    (cadence.toTick > Math.max(last.fromTick, finalMeasureStart) && cadence.toTick <= last.toTick))) {
    errors.push({
      code: "MISSING_FINAL_CADENCE", message: "末乐句 " + last.name + " " + formatRange(last) + " 缺少结尾终止式",
      detail: { phraseId: last.phraseId },
    });
  }
  if (stats.measures < 8) return;
  if (phrases.length === 1 && !validCadences.some(({ kind }) => kind === "half" || kind === "deceptive") &&
    !nonblank(metadata.singlePhraseConfirmed)) {
    errors.push({ code: "LONG_SINGLE_PHRASE_UNCONFIRMED", message: "至少 8 小节仅标一个乐句，缺少半终止、阻碍终止或 singlePhraseConfirmed 复核说明" });
  }
  if (!nonblank(metadata.internalCadenceChecked)) {
    for (const phrase of phrases.slice(0, -1)) {
      const midpoint = phrase.fromTick + (phrase.toTick - phrase.fromTick) / 2;
      if (validCadences.some((cadence) => cadence.phraseId === phrase.phraseId ||
        (cadence.toTick >= midpoint && cadence.toTick <= phrase.toTick))) continue;
      errors.push({
        code: "MISSING_INTERNAL_CADENCE", message: "非末乐句 " + phrase.name + " " + formatRange(phrase) + " 缺少内部终止式或复核说明",
        detail: { phraseId: phrase.phraseId, fromTick: phrase.fromTick, toTick: phrase.toTick },
      });
    }
  }
}

function checkConditioned(spec, score, harmony, result) {
  let project;
  try {
    project = score.compileScore({
      ...spec,
      annotations: [...(spec.annotations ?? []), ...(spec.reference ?? [])],
      reference: [],
      referenceComplete: [],
    }).project;
  } catch (error) {
    result.errors.push({ code: "CONDITIONED_COMPILE_FAILED", message: errorMessage(error) });
    return;
  }
  try {
    harmony.buildHarmonyAnalysis(project);
    const { diagnostics, skippedRules } = harmony.checkHarmony(project);
    result.stats.conditionedRuleErrors = diagnostics.filter(({ severity }) => severity === "error").length;
    result.stats.conditionedRuleWarnings = diagnostics.filter(({ severity }) => severity === "warning").length;
    result.stats.conditionedRuleSkips = skippedRules.length;
  } catch (error) {
    result.errors.push({ code: "CONDITIONED_ANALYSIS_FAILED", message: errorMessage(error) });
  }
}

export function validateWrittenCaseSource(sourceText, { score, harmony, filePath, allowLegacyMeta = false }) {
  const result = makeResult(filePath);
  const { errors, stats } = result;
  let spec, compiled;
  try {
    spec = score.parseScoreText(sourceText);
    result.metadata = { ...spec.metadata };
    compiled = score.compileScore(spec);
  } catch (error) {
    reportCompileError(result, spec, error);
    return result;
  }

  const { project, reference } = compiled;
  const { metadata } = result;
  stats.measures = spec.blocks.at(-1).to;
  stats.lengthTicks = project.lengthTicks;
  stats.referenceChords = reference.chords.length;
  stats.referencePhrases = reference.phrases.length;
  stats.referenceCadences = reference.cadences.length;
  stats.referenceNoteRoles = reference.notes.filter(({ role }) => role).length;
  const cadenceCounts = { half: "halfCadences", full: "fullCadences", deceptive: "deceptiveCadences", supplementary: "supplementaryCadences" };
  for (const { kind } of reference.cadences) stats[cadenceCounts[kind]]++;

  const noteRanges = [];
  for (const voice of voices) {
    const track = project.satbTracks.find((track) => track.voice === voice);
    if (track?.notes.length) {
      for (const note of track.notes) noteRanges.push(eventRange(note));
    } else {
      errors.push({ code: "EMPTY_VOICE", message: "声部 " + voice + " 没有音符", detail: { voice } });
    }
  }
  const sounding = mergeRanges(orderRanges(noteRanges));
  const entryTick = sounding[0]?.fromTick ?? 0;
  const endTick = sounding.at(-1)?.toTick ?? 0;
  stats.soundingSpanTicks = endTick - entryTick;
  if (stats.measures > 24) errors.push({ code: "LENGTH_TOO_LONG", message: "共 " + stats.measures + " 小节，Written100 最多收录 24 小节" });
  if (stats.measures < 6 && !(metadata.chapter === "4" && stats.measures >= 4)) {
    errors.push({ code: "LENGTH_TOO_SHORT", message: "共 " + stats.measures + " 小节，常规书面题至少 6 小节；第 4 章至少 4 小节" });
  }
  checkMetadata(result, allowLegacyMeta);
  const measures = measurePositions(project);
  const formatRange = ({ fromTick, toTick }) =>
    "[" + score.positionText(fromTick, measures) + ", " + score.positionText(toTick, measures) + ")";
  checkChords(reference, sounding, result, formatRange);
  const phrases = orderRanges(reference.phrases);
  checkPhrases(phrases, project.lengthTicks, entryTick, errors, formatRange);
  const finalMeasure = measures.findLast((measure) => measure.startTick < endTick) ?? measures.at(-1);
  checkCadences(compiled, phrases, result, formatRange, finalMeasure.startTick);
  if (validChapter(metadata.chapter) && Number(metadata.chapter) >= 36 && Number(metadata.chapter) <= 45 &&
    !stats.referenceNoteRoles && !nonblank(metadata.nctChecked)) {
    errors.push({ code: "MISSING_NCT_ROLES", message: "和弦外音专题章须提供参考音符角色或 nctChecked 复核说明" });
  }
  checkConditioned(spec, score, harmony, result);
  result.ok = errors.length === 0;
  return result;
}

const usage = "用法：node scripts/validate-written-case.mjs <file-or-dir>... [--manifest <json>] [--json] [--out <report.json>] [--allow-legacy-meta]";
const isScoreFile = (file) => extname(file).toLowerCase() === ".satbt";
async function canonicalPath(file) {
  try {
    return await realpath(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return resolve(file);
  }
}

async function statIfPresent(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  }
}

async function collectInputs(paths, manifestPath) {
  const inputs = new Map();
  async function add(file, id) {
    const filePath = await canonicalPath(file);
    if (!inputs.has(filePath)) inputs.set(filePath, { filePath, id });
  }

  async function collectDirectory(directory) {
    if (basename(directory).toLowerCase() === "node_modules") return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collectDirectory(path);
      else if (entry.isFile() && isScoreFile(path)) await add(path);
    }
  }

  if (manifestPath) {
    const manifest = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
    const rows = manifest?.cases ?? manifest?.records;
    if (!Array.isArray(rows)) throw new Error("清单须包含 cases 或 records 数组");
    for (const [index, row] of rows.entries()) {
      const file = row?.file ?? row?.input ?? row?.sourceFile;
      if (!nonblank(file) || !isScoreFile(file)) throw new Error("清单第 " + (index + 1) + " 项须指定 .satbt 文件");
      let path = resolve(dirname(manifestPath), file);
      if (!isAbsolute(file) && !await statIfPresent(path)) {
        const repoPath = resolve(repo, file);
        if (repoPath !== path && await statIfPresent(repoPath)) path = repoPath;
      }
      await add(path, row.id);
    }
  }

  for (const input of paths) {
    const path = resolve(input);
    const info = await statIfPresent(path);
    if (info?.isDirectory()) await collectDirectory(path);
    else if (isScoreFile(path)) await add(path);
    else throw new Error("输入须为目录或 .satbt 文件：" + input);
  }
  if (!inputs.size) throw new Error("没有找到 .satbt 文件\n" + usage);
  return [...inputs.values()];
}

function reportSummary(cases) {
  const passed = cases.filter(({ ok }) => ok).length;
  return {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    errors: cases.reduce((sum, item) => sum + item.errors.length, 0),
    warnings: cases.reduce((sum, item) => sum + item.warnings.length, 0),
  };
}

function printTextReport({ cases, summary }) {
  for (const item of cases) {
    const { stats } = item;
    const label = item.id === undefined ? item.filePath : item.id + " " + item.filePath;
    process.stdout.write((item.ok ? "PASS " : "FAIL ") + label +
      " | " + item.errors.length + " 错误，" + item.warnings.length + " 警告 | 和弦覆盖率 " + coveragePercent(stats.chordCoverageRatio) +
      " | 终止式 " + stats.referenceCadences + " 条（半 " + stats.halfCadences + "、全 " + stats.fullCadences +
      "、阻碍 " + stats.deceptiveCadences + "、补充 " + stats.supplementaryCadences + "）\n");
    for (const issue of item.errors) process.stdout.write("  错误 [" + issue.code + "] " + issue.message + "\n");
    for (const issue of item.warnings) process.stdout.write("  警告 [" + issue.code + "] " + issue.message + "\n");
  }
  process.stdout.write("\n共 " + summary.total + " 题，" + summary.passed + " 通过，" + summary.failed + " 失败；" +
    summary.errors + " 错误，" + summary.warnings + " 警告\n");
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: "string" },
      json: { type: "boolean" },
      out: { type: "string" },
      "allow-legacy-meta": { type: "boolean" },
    },
  });
  if (!positionals.length && !values.manifest) throw new Error(usage);
  const manifest = values.manifest ? await canonicalPath(values.manifest) : undefined;
  const inputs = await collectInputs(positionals, manifest);
  const out = values.out ? await canonicalPath(values.out) : undefined;
  if (out && (out === manifest || inputs.some(({ filePath }) => filePath === out))) {
    throw new Error("报告输出路径与输入文件相同：" + out);
  }
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: repo,
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
    logLevel: "error",
  });
  const cases = [];
  try {
    const [score, harmony] = await Promise.all([
      vite.ssrLoadModule("/src/domain/scoreText/index.ts"),
      vite.ssrLoadModule("/src/domain/harmony/index.ts"),
    ]);
    for (const { filePath, id } of inputs) {
      let source;
      try {
        source = await readFile(filePath, "utf8");
      } catch (error) {
        const result = makeResult(filePath);
        result.errors.push({ code: "INPUT_READ_ERROR", message: errorMessage(error) });
        cases.push({ id, ...result });
        continue;
      }
      cases.push({
        id, ...validateWrittenCaseSource(source, { score, harmony, filePath, allowLegacyMeta: values["allow-legacy-meta"] }),
      });
    }
  } finally {
    await vite.close();
  }
  const report = { summary: reportSummary(cases), cases };
  const json = values.json || out ? JSON.stringify(report, null, 2) + "\n" : "";
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, json, "utf8");
  }
  if (values.json) process.stdout.write(json);
  else printTextReport(report);
  process.exitCode = report.summary.failed ? 1 : 0;
}

if (import.meta.main ?? (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(errorMessage(error) + "\n");
    process.exitCode = 1;
  });
}
