import { expect, it } from "vitest";
import { compileScoreText } from "../scoreText";
import { checkHarmony, createHarmonyRuleScheduler } from "./registry";
import { defaultHarmonyRuleSeverities } from "./rules/catalog";
import type { HarmonyCheckResult } from "./runtime";

function phraseBoundaryEdit() {
  const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
  S: | D5/4 C5/4 |
  A: | B4/4 A4/4 |
  T: | G4/4 F4/4 |
  B: | G3/4 F3/4 |
  H: | D/4 S/4 |
}`);
  const edited = structuredClone(project);
  edited.structure.phraseBoundaries.push({
    id: "manual-split", tick: project.ppq, source: "manual", confidence: "certain",
  });
  return { project, edited };
}

function diagnostics(result: HarmonyCheckResult) {
  // checkHarmony 使用 revision 0；调度器的调试快照带有实际编辑版本号。
  const normalized = structuredClone(result.diagnostics);
  for (const diagnostic of normalized) {
    if (diagnostic.debug) diagnostic.debug.runtime.revision = 0;
  }
  return normalized;
}

it("在桌面增量检查中添加和撤销手动句界时重新判定逆功能进行", async () => {
  const { project, edited } = phraseBoundaryEdit();
  const scheduler = createHarmonyRuleScheduler();
  const severities = defaultHarmonyRuleSeverities();
  for (const [index, current] of [project, edited, project].entries()) {
    const revision = index + 1;
    const analysis = scheduler.prepareAnalysis(current, revision);
    const result = await scheduler.run({ project: current, analysis, revision, severities });
    const full = checkHarmony(current, severities);
    const retrogressions = full.diagnostics.filter(item => item.ruleId === "function.retrogression");
    expect(retrogressions.map(item => item.tick)).toEqual(current === edited ? [] : [project.ppq]);
    expect(diagnostics(result)).toEqual(full.diagnostics);
    expect(result.skippedRules).toEqual(full.skippedRules);
    if (index > 0) {
      expect(result.invalidationRanges).toEqual([
        { fromTick: 0, toTick: current.lengthTicks, scopes: ["phrase", "project"] },
      ]);
    }
  }
});

it("句界变更的检查被取消后用同一谱面重试不会复用旧句的诊断", async () => {
  const { project, edited } = phraseBoundaryEdit();
  const scheduler = createHarmonyRuleScheduler();
  const severities = defaultHarmonyRuleSeverities();
  await scheduler.run({ project, severities, revision: 1 });

  const analysis = scheduler.prepareAnalysis(edited, 2);
  const pending = scheduler.run({ project: edited, analysis, severities, revision: 2 });
  scheduler.cancel();
  expect((await pending).superseded).toBe(true);

  const retry = scheduler.prepareAnalysis(edited, 3);
  const result = await scheduler.run({ project: edited, analysis: retry, severities, revision: 3 });
  expect(retry.slices).toBe(analysis.slices);
  expect(diagnostics(result)).toEqual(checkHarmony(edited, severities).diagnostics);
});
