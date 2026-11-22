import { describe, expect, it } from "vitest";
import type { VoiceId } from "../../../../project/types";
import { createEmptyProject, PPQ } from "../../../../project";
import { spellMidi } from "../../../../pitch";
import { buildHarmonyAnalysis, type HarmonyAnalysis } from "../../../analysis";
import type {
  JsonValue,
  RuleStateEnvelope,
  RuleStepContext,
} from "../../../runtime";
import { createHarmonyRuleContext } from "../../context/createRuleContext";
import {
  defineObligationRule,
  type ObligationOutcome,
  type ObligationSource,
  type RetriggerPolicy,
} from "../obligation";

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
  onNoDecision?: "continue" | "cancel",
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
    ...(onNoDecision ? { onNoDecision } : {}),
    transition(environment) {
      if (
        !environment.moment.attackedVoiceIds.includes(
          environment.obligation.payload.voiceId,
        )
      )
        return undefined;
      return { outcome, reason: `toy-obligation-${outcome}` };
    },
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
  const rules = createHarmonyRuleContext(analysis);
  const slice = analysis.slices[sliceIndex];
  const span = rules.spanAt(slice.tick)?.span;
  const previousSpan = analysis.slices[sliceIndex - 1]
    ? rules.spanAt(analysis.slices[sliceIndex - 1].tick)?.span
    : undefined;
  const nextSpan = analysis.slices[sliceIndex + 1]
    ? rules.spanAt(analysis.slices[sliceIndex + 1].tick)?.span
    : undefined;
  return {
    analysis,
    rules,
    slice,
    sliceIndex,
    previous: analysis.slices[sliceIndex - 1],
    transitionFromPrevious: analysis.sliceTransitions[sliceIndex - 1],
    span,
    isSpanStart: Boolean(span) && span?.id !== previousSpan?.id,
    isSpanEnd: Boolean(span) && span?.id !== nextSpan?.id,
  };
}

function runStep(
  rule: ReturnType<typeof toyRule>,
  context: RuleStepContext,
  incoming: readonly RuleStateEnvelope[],
) {
  const result = rule.process(context, incoming, {});
  if (result instanceof Promise) throw new Error("测试义务不应异步执行");
  return result;
}

describe("义务状态运行时", () => {
  it("retain-existing 保留义务身份并记录普通函数的决策原因", () => {
    const analysis = twoAttackAnalysis();
    const rule = toyRule("retain-existing");
    const opened = runStep(rule, stepContext(analysis, 0), []);
    const continued = runStep(rule, stepContext(analysis, 1), opened.outgoing);

    expect(continued.outgoing).toHaveLength(1);
    expect(continued.outgoing[0].id).toBe(opened.outgoing[0].id);
    expect(continued.outgoing[0].subjectRefs?.noteIds).toEqual(["soprano-0"]);
    expect(continued.outgoing[0].payload).toMatchObject({
      engine: "obligation-v2",
      history: [
        { outcome: "continue", reason: "obligation-opened" },
        { outcome: "continue", reason: "toy-obligation-continue" },
      ],
    });
  });

  it("refresh-source 使用最新触发对象替换已有义务", () => {
    const analysis = twoAttackAnalysis();
    const rule = toyRule("refresh-source");
    const opened = runStep(rule, stepContext(analysis, 0), []);
    const refreshed = runStep(rule, stepContext(analysis, 1), opened.outgoing);

    expect(refreshed.outgoing).toHaveLength(1);
    expect(refreshed.outgoing[0].id).not.toBe(opened.outgoing[0].id);
    expect(refreshed.outgoing[0].subjectRefs?.noteIds).toEqual(["soprano-1"]);
    expect(rule.inspectTrace(analysis)).toContainEqual(
      expect.objectContaining({
        obligationId: opened.outgoing[0].id,
        outcome: "cancel",
        reason: "obligation-source-refreshed",
      }),
    );
  });

  it("fork 为同一分区保留既有义务并建立独立分支", () => {
    const analysis = twoAttackAnalysis();
    const rule = toyRule("fork");
    const opened = runStep(rule, stepContext(analysis, 0), []);
    const forked = runStep(rule, stepContext(analysis, 1), opened.outgoing);

    expect(forked.outgoing).toHaveLength(2);
    expect(forked.outgoing.map((state) => state.id)).toContain(
      opened.outgoing[0].id,
    );
    expect(new Set(forked.outgoing.map((state) => state.id))).toHaveLength(2);
    expect(
      forked.outgoing.map((state) => state.subjectRefs?.noteIds?.[0]),
    ).toEqual(["soprano-0", "soprano-1"]);
  });

  it("reject 在同一分区重复触发时立即拒绝", () => {
    const analysis = twoAttackAnalysis();
    const rule = toyRule("reject");
    const opened = runStep(rule, stepContext(analysis, 0), []);

    expect(() =>
      runStep(rule, stepContext(analysis, 1), opened.outgoing),
    ).toThrow(/voice:soprano/);
  });

  it.each([
    ["continue", 1, undefined],
    ["cancel", 0, "no-decision"],
  ] as const)(
    "无转移决策时按 %s 策略处理既有义务",
    (policy, expectedCount, expectedReason) => {
      const analysis = twoAttackAnalysis();
      const rule = toyRule("retain-existing", "continue", policy);
      const opened = runStep(rule, stepContext(analysis, 0), []);
      const context = stepContext(analysis, 1);
      const passiveContext = {
        ...context,
        slice: { ...context.slice, attackVoiceIds: [] },
      } satisfies RuleStepContext;
      const result = runStep(rule, passiveContext, opened.outgoing);

      expect(result.outgoing).toHaveLength(expectedCount);
      if (expectedReason) {
        expect(rule.inspectTrace(analysis).at(-1)).toEqual(
          expect.objectContaining({
            outcome: "cancel",
            reason: expectedReason,
          }),
        );
      } else {
        expect(result.outgoing[0].id).toBe(opened.outgoing[0].id);
      }
    },
  );

  it("定义阶段拒绝遗漏义务源依赖的规则", () => {
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
        transition: () => ({ outcome: "continue", reason: "continued" }),
        reportViolation: () => undefined,
      }),
    ).toThrow(/written-pitches/);
  });

  it.each(["resolve", "violate", "cancel", "indeterminate"] as const)(
    "开发轨迹记录 %s 决策",
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
      throw new Error("测试义务 finalize 不应异步执行");

    expect(rule.inspectTrace(analysis).at(-1)).toEqual(
      expect.objectContaining({
        tick: analysis.project.lengthTicks,
        outcome: "cancel",
        reason: "project-ended",
      }),
    );
  });
});
