import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { aggregateCases, blindSpec, scoreCadences, scoreChords, scoreRuleAssertions, validateRuleAssertions } from "./benchmark-metrics.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const help = `npm run benchmark -- --manifest sample.json --out new-directory [--engine-root source-directory]
Manifest: {cases:[{id,parentQuestion,sourceFile,analysisFile,printedKeyChanges?,ruleAssertions?}]}.
sourceFile and analysisFile are relative to the repository. printedKeyChanges lists optional printed mid-score key changes by bar:beat.
Each optional rule assertion fixes mode (blind|conditioned), ruleId, tick, voiceIds, severity and expected (present|absent).
Writes immutable run metadata, raw case artifacts and summary.json. Rules require confirmed transcription.
`;

function validateCases(cases) {
  if (!Array.isArray(cases) || !cases.length) throw new Error("清单需要非空 cases 数组");
  const ids = new Set();
  for (const item of cases) {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(item.id) || ids.has(item.id.toLowerCase())) throw new Error("题号重复或无效");
    if (item.parentQuestion == null || !item.sourceFile || !item.analysisFile) throw new Error(item.id + " 缺少原题键、谱面或分析元数据");
    if (item.printedKeyChanges !== undefined && (!Array.isArray(item.printedKeyChanges) || !item.printedKeyChanges.every(at => typeof at === "string"))) throw new Error(item.id + " 的 printedKeyChanges 无效");
    validateRuleAssertions(item.ruleAssertions ?? []);
    ids.add(item.id.toLowerCase());
  }
}

async function domainFingerprint(engineRoot) {
  const digest = createHash("sha256");
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        digest.update(relative(engineRoot, path).replaceAll("\\", "/") + "\0" + sha(await readFile(path)) + "\n");
      }
    }
  }
  await visit(join(engineRoot, "src/domain"));
  return digest.digest("hex");
}

function conditionedRulesInput(score, spec, annotations) {
  const make = labels => score.compileScore({ ...spec, annotations: labels, reference: [], referenceComplete: [] }).project;
  try { return { project: make(annotations), omitted: [] }; }
  catch (error) {
    const uncovered = error => error.message.includes("终止式范围必须覆盖连续的和弦区域");
    if (!uncovered(error)) throw error;
    const valid = annotations.filter(label => label.kind !== "cadence");
    const omitted = [];
    for (const label of annotations.filter(label => label.kind === "cadence")) {
      try { make([...valid, label]); valid.push(label); }
      catch (single) {
        if (!uncovered(single)) throw single;
        omitted.push({ label, reason: single.message });
      }
    }
    if (!omitted.length) throw error;
    return { project: make(valid), omitted };
  }
}

async function evaluate(item, directory, { score, harmony, chords }) {
  await mkdir(directory);
  const stages = ["compile","reference","harmony","blindCadence","conditionedCadence","blindRules","conditionedRules"];
  const row = { id: item.id, parentQuestion: item.parentQuestion, split: item.split, execution: Object.fromEntries(stages.map(stage => [stage,"not-run"])), errors: {}, cadences: {}, rules: {} };
  const assertionsFor = mode => (item.ruleAssertions ?? []).filter(entry => entry.mode === mode);
  row.ruleAssertions = Object.fromEntries(["blind","conditioned"].map(mode => [mode, scoreRuleAssertions(assertionsFor(mode))]));
  const artifact = (name, value) => save(join(directory, name + ".json"), value);
  async function run(stage, action) {
    try {
      const result = await action();
      row.execution[stage] = "completed";
      return result;
    } catch (error) {
      // Storage failures must fail the whole run: an incomplete artifact is not a musical finding.
      if (error.code && ["EACCES","ENOSPC","EEXIST","EPERM","EIO"].includes(error.code)) throw error;
      row.execution[stage] = "blocked";
      row.errors[stage] = { message: error.message, location: error.location };
    }
  }
  const prepared = await run("compile", async () => {
    const [source, analysis] = await Promise.all([item.sourceFile, item.analysisFile].map(file => readFile(resolve(repo, file), "utf8")));
    row.sourceSha256 = sha(source);
    row.analysisSha256 = sha(analysis);
    if (item.sourceSha256 && item.sourceSha256 !== row.sourceSha256) throw new Error("转写文件与清单哈希不匹配");
    if (item.analysisSha256 && item.analysisSha256 !== row.analysisSha256) throw new Error("转写确认元数据与清单哈希不匹配");
    const metadata = JSON.parse(analysis);
    row.transcriptionStatus = metadata.transcriptionStatus;
    row.humanApproval = metadata.humanApproval;
    const spec = score.parseScoreText(source);
    const raw = score.compileScore(blindSpec(spec, item.printedKeyChanges)).project;
    row.ticks = raw.lengthTicks;
    row.measures = spec.blocks.at(-1).to;
    row.ruleProfileSha256 = sha(JSON.stringify(raw.ruleProfile));
    row.blindInputSha256 = sha(JSON.stringify({ tracks: raw.satbTracks.map(track => [track.id, track.notes]),
      keys: raw.keyEvents, meters: raw.meterEvents, length: raw.lengthTicks, ppq: raw.ppq }));
    await save(join(directory, "blind-input.satb"), raw);
    return { metadata, spec, raw };
  });
  if (prepared) {
    const { spec, raw, metadata } = prepared;
    const predictions = await run("harmony", async () => {
      const inference = harmony.inferChords(raw);
      await artifact("inference", inference);
      return inference;
    });
    let blindProject;
    const blindCadences = predictions && await run("blindCadence", async () => {
      const applied = harmony.applyHarmonyInference(raw, { chordInference: predictions }, { mode: "replace-unlocked", writeNonChordToneRoles: true });
      blindProject = applied.project;
      await save(join(directory,"blind-inferred.satb"), blindProject);
      const cadences = harmony.buildHarmonyAnalysis(blindProject).cadenceCandidates;
      await artifact("cadences-blind", cadences);
      return cadences;
    });
    const checkRules = async (mode, project) => {
      const output = harmony.checkHarmony(project);
      await artifact("rules-" + mode, output);
      const counts = { error: 0, warning: 0, suggestion: 0 };
      for (const diagnostic of output.diagnostics) counts[diagnostic.severity]++;
      row.rules[mode] = { counts, skippedRuleRecords: output.skippedRules.length };
      row.ruleAssertions[mode] = scoreRuleAssertions(assertionsFor(mode), output, project.lengthTicks, project.ruleProfile.builtin);
    };
    const canCheckRules = metadata.transcriptionStatus === "confirmed" && metadata.ruleExecution !== "skip_independent_configurations";
    if (!canCheckRules) {
      const reason = metadata.transcriptionStatus === "confirmed" ? "independent-configurations" : "transcription-unconfirmed";
      row.execution.blindRules = row.execution.conditionedRules = reason;
    } else if (blindProject) await run("blindRules", () => checkRules("blind", blindProject));

    // The blind engine has already run and its raw predictions are on disk.
    const compiled = await run("reference", async () => {
      const compiled = score.compileScore(spec);
      await artifact("reference", compiled.reference);
      return compiled;
    });
    if (compiled && predictions) {
      const result = scoreChords(chords, compiled.reference, predictions.regions, compiled.project.keyEvents, raw.keyEvents);
      row.chords = result.totals;
      await artifact("chord-comparisons", result.segments);
    }
    const labels = [...spec.annotations ?? [], ...spec.reference ?? []];
    const conditionedCadences = await run("conditionedCadence", async () => {
      const project = score.compileScore({ ...spec, annotations: labels.filter(label => label.kind !== "cadence"), reference: [], referenceComplete: [] }).project;
      await save(join(directory, "conditioned.satb"), project);
      const cadences = harmony.buildHarmonyAnalysis(project).cadenceCandidates;
      await artifact("cadences-conditioned", cadences);
      return cadences;
    });
    if (compiled) {
      if (blindCadences) row.cadences.blind = scoreCadences(compiled.reference, blindCadences);
      if (conditionedCadences) row.cadences.conditioned = scoreCadences(compiled.reference, conditionedCadences);
    }
    if (canCheckRules) {
      await run("conditionedRules", async () => {
        const { project, omitted } = conditionedRulesInput(score, spec, labels);
        if (omitted.length) row.omittedRuleCadences = omitted;
        await save(join(directory, "rule-input.satb"), project);
        await checkRules("conditioned", project);
      });
      if (row.omittedRuleCadences && row.rules.conditioned) row.execution.conditionedRules = "completed-limited";
    }
  }
  await artifact("result", row);
  return row;
}

async function main() {
  const { values } = parseArgs({ options: { manifest: { type: "string" }, out: { type: "string" },
    "engine-root": { type: "string" }, help: { type: "boolean" } } });
  if (values.help) { console.log(help); return; }
  if (!values.manifest || !values.out) throw new Error(help);
  const manifestPath = resolve(values.manifest), output = resolve(values.out), engineRoot = resolve(values["engine-root"] ?? repo);
  const source = await readFile(manifestPath, "utf8"), manifest = JSON.parse(source);
  validateCases(manifest.cases);
  const domainSha256 = await domainFingerprint(engineRoot);
  const runnerFiles = [new URL(import.meta.url), new URL("benchmark-metrics.mjs", import.meta.url)];
  const runnerSha256 = sha(Buffer.concat(await Promise.all(runnerFiles.map(file => readFile(file)))));
  await mkdir(dirname(output), { recursive:true });
  await mkdir(output); // A run directory is immutable, including concurrent invocations and incomplete runs.
  await mkdir(join(output, "cases"));
  await save(join(output, "environment.json"), { formatVersion: 1, timestamp: new Date().toISOString(), node: process.version,
    manifest: relative(repo,manifestPath), manifestSha256: sha(source), engineRoot: relative(repo, engineRoot) || ".", domainSha256, runnerSha256 });
  const vite = await createServer({ root: engineRoot, configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom", logLevel: "error" });
  try {
    const [score,harmony,chords] = await Promise.all(["/src/domain/scoreText/index.ts","/src/domain/harmony/index.ts","/src/domain/chordModel.ts"].map(path => vite.ssrLoadModule(path)));
    const rows = [];
    for (const item of manifest.cases) {
      const row = await evaluate(item, join(output,"cases",item.id), { score,harmony,chords });
      rows.push(row);
      console.log(item.id, Object.values(row.execution).join(" / "));
    }
    const summary = aggregateCases(rows);
    await save(join(output,"summary.json"), summary);
    console.log(join(output,"summary.json"));
    if (rows.some(row => Object.keys(row.errors).length)) process.exitCode = 2;
  } finally { await vite.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
