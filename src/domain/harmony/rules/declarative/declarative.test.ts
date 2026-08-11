import { describe, expect, it } from "vitest";
import { buildHarmonyAnalysis, type HarmonyAnalysis } from "../../analysis";
import type {
  JsonValue,
  RuleStateEnvelope,
  RuleStepContext,
} from "../../runtime";
import { createEmptyProject, PPQ, type VoiceId } from "../../../project";
import { spellMidi } from "../../../pitch";
import { subjectVoiceAttacked } from "../facts/obligation";
import {
  decisionTable,
  evaluateDecisionTable,
  otherwiseWhen,
  when,
  type ObligationOutcome,
} from "./decisionTable";
import {
  FactStore,
  all,
  any,
  defineFact,
  evaluatePredicate,
  fact,
  factNo,
  factUnknown,
  factYes,
  not,
} from "./facts";
import {
  defineObligationRule,
  type ObligationSource,
  type RetriggerPolicy,
} from "./obligation";
import {
  defineCandidateProvider,
  defineConstraintRule,
  type ConstraintEnvironment,
} from "./constraint";

type Environment = { readonly cacheKey: string };

function constantFact(
  id: string,
  truth: "yes" | "no" | "unknown",
  onEvaluate?: () => void,
) {
  return fact(
    defineFact<Environment>({
      id,
      cacheKey: (environment) => environment.cacheKey,
      evaluate() {
        onEvaluate?.();
        return truth === "yes"
          ? factYes(`${id}-yes`)
          : truth === "no"
            ? factNo(`${id}-no`)
            : factUnknown(`${id}-unknown`);
      },
    }),
  );
}

describe("声明式事实内核", () => {
  it("all、any 与 not 按三值逻辑传播 unknown", () => {
    const environment = { cacheKey: "one" };
    const store = new FactStore();

    expect(
      evaluatePredicate(
        all(constantFact("yes-a", "yes"), constantFact("unknown-a", "unknown")),
        environment,
        store,
      ).result.truth,
    ).toBe("unknown");
    expect(
      evaluatePredicate(
        all(constantFact("unknown-b", "unknown"), constantFact("no-a", "no")),
        environment,
        store,
      ).result.truth,
    ).toBe("no");
    expect(
      evaluatePredicate(
        any(constantFact("unknown-c", "unknown"), constantFact("no-b", "no")),
        environment,
        store,
      ).result.truth,
    ).toBe("unknown");
    expect(
      evaluatePredicate(
        not(constantFact("unknown-d", "unknown")),
        environment,
        store,
      ).result.truth,
    ).toBe("unknown");
  });

  it("FactStore 按事实 ID 与环境键复用结果", () => {
    let evaluations = 0;
    const predicate = constantFact("cached", "yes", () => {
      evaluations += 1;
    });
    const store = new FactStore();

    evaluatePredicate(predicate, { cacheKey: "same" }, store);
    evaluatePredicate(predicate, { cacheKey: "same" }, store);
    evaluatePredicate(predicate, { cacheKey: "different" }, store);

    expect(evaluations).toBe(2);
    expect(store.stats()).toEqual({ evaluations: 2, cacheHits: 1 });
  });
});

describe("声明式义务决策表", () => {
  it("默认拒绝多个同时成立的普通决策", () => {
    const table = decisionTable<Environment>({
      rows: [
        when("resolve", "resolved", constantFact("resolve", "yes")),
        when("cancel", "cancelled", constantFact("cancel", "yes")),
      ],
    });

    expect(
      evaluateDecisionTable(table, { cacheKey: "conflict" }, new FactStore())
        .status,
    ).toBe("conflict");
  });

  it("显式 precedence 决定同 tick 的音乐学优先级", () => {
    const table = decisionTable<Environment>({
      conflicts: { precedence: ["resolve", "cancel"] },
      rows: [
        when("resolve", "resolved", constantFact("resolve-priority", "yes")),
        when("cancel", "cancelled", constantFact("cancel-priority", "yes")),
      ],
    });

    const result = evaluateDecisionTable(
      table,
      { cacheKey: "precedence" },
      new FactStore(),
    );
    expect(result.status).toBe("decided");
    if (result.status === "decided")
      expect(result.selected.row.reason).toBe("resolved");
  });

  it("普通条件未知时不执行违反兜底", () => {
    let fallbackEvaluations = 0;
    const table = decisionTable<Environment>({
      rows: [
        when("resolve", "uncertain", constantFact("uncertain", "unknown")),
        otherwiseWhen(
          "violate",
          "fallback",
          constantFact("fallback", "yes", () => {
            fallbackEvaluations += 1;
          }),
        ),
      ],
    });

    const result = evaluateDecisionTable(
      table,
      { cacheKey: "unknown" },
      new FactStore(),
    );
    expect(result.status).toBe("unknown");
    expect(fallbackEvaluations).toBe(0);
  });

  it("所有普通条件明确不成立后才执行 fallback", () => {
    const table = decisionTable<Environment>({
      rows: [
        when("resolve", "not-resolved", constantFact("not-resolved", "no")),
        otherwiseWhen(
          "violate",
          "fallback",
          constantFact("fallback-yes", "yes"),
        ),
      ],
    });

    const result = evaluateDecisionTable(
      table,
      { cacheKey: "fallback" },
      new FactStore(),
    );
    expect(result.status).toBe("decided");
    if (result.status === "decided")
      expect(result.selected.row.outcome).toBe("violate");
  });
});

type ToyPayload = {
  readonly [key: string]: JsonValue;
  readonly voiceId: VoiceId;
};

const toySource: ObligationSource<ToyPayload> = {
  id: "source.test-attacks",
  requires: ["written-pitches"],
  collect({ context, moment }) {
    return moment.attackedVoiceIds.flatMap((voiceId) => {
      const note = context.slice.notes[voiceId];
      return note
        ? [
            {
              partitionKey: `voice:${voiceId}`,
              payload: { voiceId },
              subjectRefs: { voiceIds: [voiceId], noteIds: [note.id] },
            },
          ]
        : [];
    });
  },
};

function toyRule(
  retrigger: RetriggerPolicy,
  outcome: ObligationOutcome = "continue",
) {
  return defineObligationRule({
    id: `test.obligation.${retrigger}`,
    catalogNumber: "Z.1",
    label: "测试义务",
    description: "测试义务运行时",
    rationale: "验证状态由运行时统一维护",
    group: "resolution",
    defaultSeverity: "off",
    requires: ["written-pitches"],
    dependencyScope: "phrase",
    source: toySource,
    retrigger,
    transition: decisionTable({
      rows: [
        when(
          outcome,
          `toy-obligation-${outcome}`,
          subjectVoiceAttacked<ToyPayload>(),
        ),
      ],
    }),
    reportViolation: () => undefined,
  });
}

function twoAttackAnalysis() {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 2;
  project.satbTracks.find((track) => track.id === "soprano")!.notes = [
    0, 1,
  ].map((index) => ({
    id: `soprano-${index}`,
    startTick: index * PPQ,
    durationTicks: PPQ,
    pitch: spellMidi(71),
    velocity: 80,
    locked: false,
    spellingSource: "manual" as const,
  }));
  return buildHarmonyAnalysis(project);
}

function stepContext(
  analysis: HarmonyAnalysis,
  sliceIndex: number,
): RuleStepContext {
  const spanId = analysis.sliceSpanIds.get(sliceIndex);
  const previousSpanId = analysis.sliceSpanIds.get(sliceIndex - 1);
  const nextSpanId = analysis.sliceSpanIds.get(sliceIndex + 1);
  return {
    analysis,
    slice: analysis.slices[sliceIndex],
    sliceIndex,
    previous: analysis.slices[sliceIndex - 1],
    transitionFromPrevious: analysis.sliceTransitions[sliceIndex - 1],
    span: spanId
      ? analysis.harmonySpans.find((span) => span.id === spanId)
      : undefined,
    isSpanStart: Boolean(spanId) && spanId !== previousSpanId,
    isSpanEnd: Boolean(spanId) && spanId !== nextSpanId,
  };
}

function runStep(
  rule: ReturnType<typeof toyRule>,
  context: RuleStepContext,
  incoming: readonly RuleStateEnvelope[],
) {
  const result = rule.process(context, incoming, {});
  if (result instanceof Promise) throw new Error("测试义务不应返回 Promise");
  return result;
}

describe("声明式义务运行时", () => {
  it("retain-existing 保留义务身份并记录状态原因", () => {
    const analysis = twoAttackAnalysis();
    const rule = toyRule("retain-existing");
    const opened = runStep(rule, stepContext(analysis, 0), []);
    const continued = runStep(rule, stepContext(analysis, 1), opened.outgoing);

    expect(opened.outgoing).toHaveLength(1);
    expect(continued.outgoing).toHaveLength(1);
    expect(continued.outgoing[0].id).toBe(opened.outgoing[0].id);
    expect(continued.outgoing[0].subjectRefs?.noteIds).toEqual(["soprano-0"]);
    expect(continued.outgoing[0].payload).toMatchObject({
      engine: "declarative-obligation-v1",
      history: [
        { outcome: "continue", reason: "obligation-opened" },
        { outcome: "continue", reason: "toy-obligation-continue" },
      ],
    });
    expect(rule.inspectTrace(analysis)).toEqual([
      expect.objectContaining({
        tick: 0,
        outcome: "continue",
        reason: "obligation-opened",
      }),
      expect.objectContaining({
        tick: PPQ,
        outcome: "continue",
        reason: "toy-obligation-continue",
      }),
    ]);
  });

  it("refresh-source 用最新触发对象替换已有义务", () => {
    const analysis = twoAttackAnalysis();
    const rule = toyRule("refresh-source");
    const opened = runStep(rule, stepContext(analysis, 0), []);
    const refreshed = runStep(rule, stepContext(analysis, 1), opened.outgoing);

    expect(refreshed.outgoing).toHaveLength(1);
    expect(refreshed.outgoing[0].id).not.toBe(opened.outgoing[0].id);
    expect(refreshed.outgoing[0].subjectRefs?.noteIds).toEqual(["soprano-1"]);
  });

  it("定义阶段拒绝遗漏事实依赖的规则", () => {
    expect(() =>
      defineObligationRule({
        id: "test.obligation.missing-requirement",
        catalogNumber: "Z.2",
        label: "缺失依赖",
        description: "测试",
        rationale: "测试",
        group: "resolution",
        defaultSeverity: "off",
        requires: [],
        dependencyScope: "phrase",
        source: toySource,
        retrigger: "retain-existing",
        transition: decisionTable({
          rows: [
            when("continue", "continued", subjectVoiceAttacked<ToyPayload>()),
          ],
        }),
        reportViolation: () => undefined,
      }),
    ).toThrow(/written-pitches/);
  });

  it.each(["resolve", "violate", "cancel"] as const)(
    "开发轨迹记录 %s 终态",
    (outcome) => {
      const analysis = twoAttackAnalysis();
      const rule = toyRule("retain-existing", outcome);
      const opened = runStep(rule, stepContext(analysis, 0), []);
      runStep(rule, stepContext(analysis, 1), opened.outgoing);

      expect(rule.inspectTrace(analysis)).toContainEqual(
        expect.objectContaining({
          tick: PPQ,
          outcome,
          reason: `toy-obligation-${outcome}`,
        }),
      );
    },
  );

  it("finalize 记录仍待处理义务的工程结束策略", () => {
    const analysis = twoAttackAnalysis();
    const rule = toyRule("retain-existing");
    const opened = runStep(rule, stepContext(analysis, 0), []);
    const continued = runStep(rule, stepContext(analysis, 1), opened.outgoing);
    const finalized = rule.finalize?.(
      stepContext(analysis, 1),
      continued.outgoing,
      {},
    );
    if (finalized instanceof Promise)
      throw new Error("测试义务 finalize 不应返回 Promise");

    expect(rule.inspectTrace(analysis).at(-1)).toEqual(
      expect.objectContaining({
        tick: projectLength(analysis),
        outcome: "cancel",
        reason: "project-ended",
      }),
    );
  });
});

function projectLength(analysis: HarmonyAnalysis) {
  return analysis.project.lengthTicks;
}

describe("声明式局部约束运行时", () => {
  function constraintFact(id: string, truth: "yes" | "unknown") {
    return fact(
      defineFact<ConstraintEnvironment<number>>({
        id,
        evaluate: () =>
          truth === "yes" ? factYes(`${id}-yes`) : factUnknown(`${id}-unknown`),
      }),
    );
  }

  function constraintRule(
    unknownPolicy: "ignore" | "violate",
    onReport: () => void,
  ) {
    return defineConstraintRule({
      id: `test.constraint.${unknownPolicy}`,
      catalogNumber: "Z.3",
      label: "测试约束",
      description: "测试",
      rationale: "测试",
      group: "voice",
      defaultSeverity: "off",
      requires: ["written-pitches"],
      dependencyScope: "note",
      forEach: defineCandidateProvider({
        id: `candidate.${unknownPolicy}`,
        requires: ["written-pitches"],
        select: () => [1],
        keyOf: String,
      }),
      assert: constraintFact(`constraint-${unknownPolicy}`, "unknown"),
      unknownPolicy,
      report() {
        onReport();
        return undefined;
      },
    });
  }

  it("unknownPolicy 明确控制上下文不足时是否报告", () => {
    const analysis = twoAttackAnalysis();
    let ignoredReports = 0;
    let violatedReports = 0;
    const ignored = constraintRule("ignore", () => {
      ignoredReports += 1;
    });
    const violated = constraintRule("violate", () => {
      violatedReports += 1;
    });

    ignored.evaluate({ analysis }, {});
    violated.evaluate({ analysis }, {});

    expect(ignoredReports).toBe(0);
    expect(violatedReports).toBe(1);
  });

  it("候选提供器的重复稳定键会终止规则", () => {
    const analysis = twoAttackAnalysis();
    const rule = defineConstraintRule({
      id: "test.constraint.duplicate",
      catalogNumber: "Z.4",
      label: "重复候选",
      description: "测试",
      rationale: "测试",
      group: "voice",
      defaultSeverity: "off",
      requires: [],
      dependencyScope: "note",
      forEach: defineCandidateProvider({
        id: "candidate.duplicate",
        requires: [],
        select: () => [1, 1],
        keyOf: String,
      }),
      assert: constraintFact("constraint-yes", "yes"),
      report: () => undefined,
    });

    expect(() => rule.evaluate({ analysis }, {})).toThrow(/重复候选/);
  });
});
