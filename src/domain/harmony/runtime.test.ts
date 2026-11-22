import { describe, expect, it } from "vitest";
import { compileScoreText } from "../scoreText";
import { checkHarmony, createHarmonyRuleScheduler, BUILTIN_HARMONY_RULES } from "./registry";
import { defaultHarmonyRuleSeverities, HARMONY_RULE_DEFINITIONS } from "./rules/catalog";
import { type HarmonyCheckResult, RuleScheduler, type RuleDefinition } from "./runtime";
import { createEmptyProject, PPQ } from "../project";
import { note, setNotes } from "./testing/fixtures/writtenPitchProject";

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

describe("Phase B RuleScheduler", () => {
  it("不同有状态规则之间不共享信封", async () => {
    const firstMetadata = HARMONY_RULE_DEFINITIONS.find(
      (definition) => definition.id === "voice.range",
    )!;
    const secondMetadata = HARMONY_RULE_DEFINITIONS.find(
      (definition) => definition.id === "voice.polyphonic-overlap",
    )!;
    const first: RuleDefinition = {
      ...firstMetadata,
      process: (context, incoming) => ({
        diagnostics: [],
        outgoing:
          incoming.length > 0
            ? incoming
            : [
                {
                  id: "private-state",
                  ownerRuleId: "voice.range",
                  createdAt: {
                    tick: context.slice.tick,
                    sliceIndex: context.sliceIndex,
                  },
                  payload: { marker: "first-rule" },
                },
              ],
      }),
    };
    const second: RuleDefinition = {
      ...secondMetadata,
      process: (_context, incoming) => {
        if (incoming.length > 0) throw new Error("state leaked between rules");
        return { diagnostics: [], outgoing: [] };
      },
    };
    const result = await new RuleScheduler([first, second]).run({
      project: createEmptyProject(),
      severities: defaultHarmonyRuleSeverities(),
      revision: 1,
    });

    expect(result.skippedRules).toEqual([]);
  });

  it("较旧 revision 的异步结果不会覆盖新结果", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const base = BUILTIN_HARMONY_RULES.find(
      (definition) => definition.id === "voice.range",
    )!;
    const delayed: RuleDefinition = {
      ...base,
      evaluate: async ({ analysis }) => {
        if (analysis.revision === 1) await firstGate;
        return { diagnostics: [] };
      },
    };
    const scheduler = new RuleScheduler([delayed]);
    const severities = defaultHarmonyRuleSeverities();
    const first = scheduler.run({
      project: createEmptyProject(),
      severities,
      revision: 1,
    });
    await Promise.resolve();
    const second = scheduler.run({
      project: createEmptyProject(),
      severities,
      revision: 2,
    });

    await expect(second).resolves.toMatchObject({
      revision: 2,
      superseded: false,
    });
    releaseFirst();
    await expect(first).resolves.toMatchObject({
      revision: 1,
      superseded: true,
    });
  });

  it("连续 revision 给出局部失效范围", async () => {
    const scheduler = createHarmonyRuleScheduler();
    const severities = defaultHarmonyRuleSeverities();
    const project = createEmptyProject();
    await scheduler.run({ project, severities, revision: 1 });
    const edited = structuredClone(project);
    setNotes(edited, "soprano", [
      note("new-note", PPQ, PPQ, { step: "C", alter: 0, octave: 5 }),
    ]);
    const result = await scheduler.run({
      project: edited,
      severities,
      revision: 2,
    });

    expect(result.invalidationRanges).toEqual([
      expect.objectContaining({
        fromTick: PPQ,
        toTick: PPQ * 2,
        scopes: expect.arrayContaining(["note", "slice", "phrase"]),
      }),
    ]);
  });

  it("拍号变化使依赖节拍层级的规则结果失效", async () => {
    const scheduler = createHarmonyRuleScheduler();
    const severities = defaultHarmonyRuleSeverities();
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    await scheduler.run({ project, severities, revision: 1 });
    const edited = structuredClone(project);
    edited.meterEvents[0] = {
      ...edited.meterEvents[0],
      numerator: 3,
    };

    const result = await scheduler.run({
      project: edited,
      severities,
      revision: 2,
    });

    expect(result.invalidationRanges).toEqual([
      {
        fromTick: 0,
        toTick: PPQ * 8,
        scopes: ["phrase", "project"],
      },
    ]);
  });

  it("单条规则异常不会中断其余规则", async () => {
    const base = BUILTIN_HARMONY_RULES.find(
      (definition) => definition.id === "voice.range",
    )!;
    const failing: RuleDefinition = {
      ...base,
      evaluate: () => {
        throw new Error("fixture failure");
      },
    };
    const scheduler = new RuleScheduler([failing]);
    const result = await scheduler.run({
      project: createEmptyProject(),
      severities: defaultHarmonyRuleSeverities(),
      revision: 1,
    });

    expect(result).toMatchObject({ superseded: false, diagnostics: [] });
    expect(result.skippedRules).toEqual([
      expect.objectContaining({
        ruleId: "voice.range",
        reason: "rule-error",
      }),
    ]);
  });
});
