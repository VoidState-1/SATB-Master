import { describe, expect, it } from "vitest";
import { buildHarmonyAnalysis, sameHarmonyAtTicks } from "../analysis";
import { checkHarmony } from "../registry";
import {
  type HarmonyDiagnostic,
  type RuleDefinition,
  type RuleDiagnostic,
  RuleScheduler,
  runRulesSynchronously,
} from "../runtime";
import {
  createEmptyProject,
  PPQ,
  type ChordRegion,
  type HarmonySemantics,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../../project";
import { HARMONY_RULE_DEFINITIONS, defaultHarmonyRuleSeverities } from "./catalog";
import { arbitrateDiagnostics } from "./diagnosticArbiter";
import { planRuleApplicability } from "./applicability";
import { voicePairTransitionFacts } from "./sharedFacts";
import { semantics as writtenPitchSemantics, fSharpMajorRegion } from "../testing/fixtures/writtenPitchProject";

function semantics(
  id: string,
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  pedal = false,
): HarmonySemantics {
  return {
    interpretations: [
      {
        id,
        degree,
        degreeAlteration: 0,
        source: "manual",
        confidence: "certain",
      },
    ],
    primaryInterpretationId: id,
    pedalContext: pedal
      ? { pitch: { step: "C", alter: 0 }, role: "continue" }
      : undefined,
  };
}

function region(
  id: string,
  startTick: number,
  durationTicks: number,
  options: {
    root?: "C" | "G";
    semanticId?: string;
    degree?: 1 | 5;
    pedal?: boolean;
  } = {},
): ChordRegion {
  const root = options.root ?? "C";
  return {
    id,
    startTick,
    durationTicks,
    identity: {
      root: { step: root, alter: 0 },
      bass: { step: root, alter: 0 },
      structure: {
        kind: "tertian",
        quality: "major",
        extensions: [],
        alterations: [],
      },
    },
    semantics: semantics(
      options.semanticId ?? `${root}-primary`,
      options.degree ?? (root === "C" ? 1 : 5),
      options.pedal,
    ),
    locked: false,
  };
}

function note(
  id: string,
  startTick: number,
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B",
  octave: number,
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    pitch: { step, alter: 0, octave },
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function setLine(
  project: ProjectDocument,
  voiceId: VoiceId,
  notes: NoteEvent[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = notes;
}

describe("和声 span 与连接器", () => {
  it.each([1, 2, 5])("连续 %i 个同和弦区域聚合为一个 span", (count) => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * count;
    project.chordTrack.regions = Array.from({ length: count }, (_, index) =>
      region(`same-${index}`, index * PPQ, PPQ),
    );

    const analysis = buildHarmonyAnalysis(project, count);
    expect(analysis.harmonySpans).toHaveLength(1);
    expect(analysis.harmonySpans[0].regionIds).toHaveLength(count);
    expect(analysis.connections).toHaveLength(0);
  });

  it("区域间空隙中断连续性，不会被聚合为同一 span", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions = [
      region("before-gap", 0, PPQ),
      region("after-gap", PPQ * 2, PPQ),
    ];

    const analysis = buildHarmonyAnalysis(project, 1);
    expect(analysis.harmonySpans).toHaveLength(2);
    expect(analysis.connections[0]).toMatchObject({ contiguous: false });
  });

  it("同一绝对和弦的语义重解释生成 pivot 连接", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      region("old-reading", 0, PPQ, {
        semanticId: "old-tonic",
        degree: 1,
      }),
      region("new-reading", PPQ, PPQ, {
        semanticId: "new-dominant",
        degree: 5,
      }),
    ];

    expect(buildHarmonyAnalysis(project, 1).connections[0]).toMatchObject({
      relation: "pivot-reinterpretation",
      contiguous: true,
    });
  });

  it("持续低音语义成为分析层共享事实", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      region("pedal", 0, PPQ, { pedal: true }),
      region("next", PPQ, PPQ, { root: "G" }),
    ];

    const analysis = buildHarmonyAnalysis(project, 1);
    expect(analysis.contextFacts.pedalSpanIds).toContain(
      analysis.harmonySpans[0].id,
    );
  });
});

describe("共享事实与诊断仲裁", () => {
  it("分析层统一生成同和弦与分解和弦事实", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [region("tonic", 0, PPQ * 2)];
    setLine(project, "soprano", [
      note("s-c", 0, "C", 5),
      note("s-e", PPQ, "E", 5),
    ]);

    const analysis = buildHarmonyAnalysis(project, 1);
    const transitionId = analysis.melodyTransitions[0].id;
    expect(analysis.contextFacts.sameHarmonyTransitionIds).toContain(
      transitionId,
    );
    expect(analysis.contextFacts.arpeggiationTransitionIds).toContain(
      transitionId,
    );
  });

  it("持续音内重申调号或和弦只切分时间，同和声运动需要声部换音", () => {
    const project = createEmptyProject();
    project.lengthTicks = 4 * PPQ;
    project.keyEvents.push({ ...project.keyEvents[0], id: "same-key", tick: PPQ });
    project.chordTrack.regions = [region("first", 0, 3 * PPQ), region("last", 3 * PPQ, PPQ)];
    setLine(project, "soprano", [
      { ...note("s-c", 0, "C", 5), durationTicks: 2 * PPQ },
      { ...note("s-e", 2 * PPQ, "E", 5), durationTicks: 2 * PPQ },
    ]);

    const { sliceTransitions, contextFacts } = buildHarmonyAnalysis(project);
    expect(sliceTransitions.map(({ current, id }) =>
      [current.tick, contextFacts.sameHarmonyTransitionIds.includes(id)],
    )).toEqual([[PPQ, false], [2 * PPQ, true], [3 * PPQ, false]]);
  });

  it.each(["tonic", "dominant", "gap"] as const)("跨短标注的旋律跳进按其间实际和声处理：%s", middle => {
    const project = createEmptyProject();
    project.lengthTicks = 4 * PPQ;
    project.chordTrack.regions = [
      region("first", 0, PPQ),
      ...(middle === "gap" ? [] : [region("middle", PPQ, PPQ, { root: middle === "tonic" ? "C" : "G" })]),
      region("last", 2 * PPQ, 2 * PPQ),
    ];
    setLine(project, "soprano", [
      { ...note("s-c", 0, "C", 4), durationTicks: 2 * PPQ },
      note("s-g", 2 * PPQ, "G", 4), note("s-e", 3 * PPQ, "E", 5),
    ]);
    const analysis = buildHarmonyAnalysis(project);
    const transition = analysis.melodyTransitions[0];
    expect(transition.sameHarmony).toBe(middle === "tonic");
    expect(sameHarmonyAtTicks({ project }, 0, 2 * PPQ)).toBe(middle === "tonic");
    expect(analysis.contextFacts.arpeggiationTransitionIds.includes(transition.id)).toBe(middle === "tonic");
    const rule = "melody.leap-recovery";
    const alerts = checkHarmony(project, { ...defaultHarmonyRuleSeverities(), [rule]: "warning" }, {},
      { [rule]: { "same-harmony": "strict", arpeggiation: "strict" } }).diagnostics.filter(item => item.ruleId === rule);
    expect(alerts.some(item => item.tick === 3 * PPQ)).toBe(middle !== "tonic");
  });

  it("缺少显式功能标记时按级数和结构推导有效功能", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      region("degree-five", 0, PPQ, { root: "G", degree: 5 }),
      region("degree-four", PPQ, PPQ, { root: "C", degree: 1 }),
    ];

    expect(buildHarmonyAnalysis(project, 1).connections[0].relation).toBe(
      "dominant-to-tonic",
    );
  });

  it("适用性只读取宿主事实，不接受诊断伪造公共特例", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    setLine(project, "soprano", [
      note("s-c", 0, "C", 5),
      note("s-a", PPQ, "A", 5),
    ]);
    const analysis = buildHarmonyAnalysis(project, 1);
    const definition = HARMONY_RULE_DEFINITIONS.find(
      (candidate) => candidate.id === "melody.large-leap",
    )!;
    const diagnostic: RuleDiagnostic = {
      ruleId: definition.id,
      source: "builtin",
      tick: PPQ,
      endTick: PPQ * 2,
      voiceIds: ["soprano"],
      noteIds: ["s-c", "s-a"],
      chordIds: [],
      title: definition.label,
      message: "测试",
      messageKey: "test",
      params: {},
      evidence: [],
      confidence: 1,
    };

    expect(
      planRuleApplicability(
        definition,
        diagnostic,
        analysis,
        definition.defaultExceptionPolicies,
      ).policy,
    ).toBe("strict");
  });

  it("所有声部对共用同一低音上行级进事实", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    setLine(project, "soprano", [
      note("s-1", 0, "C", 5),
      note("s-2", PPQ, "D", 5),
    ]);
    setLine(project, "alto", [
      note("a-1", 0, "G", 4),
      note("a-2", PPQ, "A", 4),
    ]);
    setLine(project, "tenor", [
      note("t-1", 0, "E", 4),
      note("t-2", PPQ, "F", 4),
    ]);
    setLine(project, "bass", [
      note("b-1", 0, "C", 3),
      note("b-2", PPQ, "D", 3),
    ]);
    const transition = buildHarmonyAnalysis(project, 1).sliceTransitions[0];
    const facts = voicePairTransitionFacts(transition);

    expect(facts).toHaveLength(6);
    expect(facts.every((fact) => fact.bassMotion === "step-up")).toBe(true);
    expect(facts.filter((fact) => fact.outerVoicesOnly)).toHaveLength(1);
  });

  it("父子覆盖不依赖规则或诊断输入顺序", () => {
    const generic: HarmonyDiagnostic = {
      id: "generic",
      ruleId: "melody.augmented-interval",
      source: "builtin",
      severity: "warning",
      tick: 0,
      endTick: PPQ,
      voiceIds: ["soprano"],
      noteIds: ["n1", "n2"],
      chordIds: [],
      title: "增音程",
      message: "通用诊断",
      messageKey: "generic",
      params: {},
      evidence: [],
      confidence: 1,
    };
    const specific: HarmonyDiagnostic = {
      ...generic,
      id: "specific",
      ruleId: "melody.tritone",
      title: "三全音",
      message: "专用诊断",
      messageKey: "specific",
    };
    const definitions = HARMONY_RULE_DEFINITIONS as readonly RuleDefinition[];
    const forward = arbitrateDiagnostics([generic, specific], definitions);
    const reverse = arbitrateDiagnostics(
      [specific, generic],
      [...definitions].reverse(),
    );

    expect(forward.map((item) => item.ruleId)).toEqual(["melody.tritone"]);
    expect(reverse.map((item) => item.ruleId)).toEqual(["melody.tritone"]);
  });

  it("专用规则可按稳定根因覆盖多个通用规则", () => {
    const leadingCause =
      "resolution.leading-tone|connection:span-a->span-b|voice:alto";
    const seventhCause =
      "resolution.chord-seventh|connection:span-a->span-b|voice:tenor";
    const base: HarmonyDiagnostic = {
      id: "base",
      ruleId: "resolution.leading-tone",
      source: "builtin",
      severity: "warning",
      tick: PPQ,
      endTick: PPQ * 2,
      voiceIds: ["alto"],
      noteIds: ["leading-note"],
      chordIds: ["dominant-seventh"],
      title: "通用解决",
      message: "通用诊断",
      messageKey: "generic-resolution",
      params: {},
      evidence: [],
      confidence: 1,
      causeRefs: [leadingCause],
    };
    const seventh: HarmonyDiagnostic = {
      ...base,
      id: "seventh",
      ruleId: "resolution.chord-seventh",
      voiceIds: ["tenor"],
      noteIds: ["seventh-note"],
      causeRefs: [seventhCause],
    };
    const mockCompoundDefinition = {
      id: "mock.compound-rule",
      coveredRuleIds: ["resolution.leading-tone", "resolution.chord-seventh"],
    } as unknown as RuleDefinition;
    const specific: HarmonyDiagnostic = {
      ...base,
      id: "specific",
      ruleId: "mock.compound-rule",
      voiceIds: [],
      noteIds: [],
      title: "复合规则解决",
      message: "联合诊断",
      messageKey: "compound-rule-resolution",
      causeRefs: ["mock.compound-rule|connection:span-a->span-b"],
      coverageRefs: [leadingCause, seventhCause],
    };

    expect(
      arbitrateDiagnostics(
        [base, seventh, specific],
        [mockCompoundDefinition, ...(HARMONY_RULE_DEFINITIONS as readonly RuleDefinition[])],
      ).map((item) => item.ruleId),
    ).toEqual(["mock.compound-rule"]);
  });
});

describe("分析与规则结果复用", () => {
  it("同步与异步调度均为同一 revision 复用唯一规则上下文", async () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      region("context-tonic", 0, PPQ),
      region("context-dominant", PPQ, PPQ, { root: "G", degree: 5 }),
    ];
    const statelessMetadata = HARMONY_RULE_DEFINITIONS.find(
      (definition) => definition.id === "voice.range",
    )!;
    const statefulMetadata = HARMONY_RULE_DEFINITIONS.find(
      (definition) => definition.id === "voice.polyphonic-overlap",
    )!;
    const severities = defaultHarmonyRuleSeverities();

    const runAndCollect = (asyncMode: boolean) => {
      const received: object[] = [];
      const definitions: RuleDefinition[] = [
        {
          ...statelessMetadata,
          evaluate: (context) => {
            received.push(context);
            return { diagnostics: [] };
          },
        },
        {
          ...statefulMetadata,
          process: (step) => {
            received.push(step.rules);
            return { diagnostics: [], outgoing: [] };
          },
        },
      ];
      if (!asyncMode) {
        runRulesSynchronously(definitions, project, severities, 1);
        return Promise.resolve(received);
      }
      return new RuleScheduler(definitions)
        .run({ project, severities, revision: 1 })
        .then(() => received);
    };

    for (const received of [
      await runAndCollect(false),
      await runAndCollect(true),
    ]) {
      expect(received.length).toBeGreaterThan(2);
      expect(new Set(received).size).toBe(1);
    }
  });

  it("只修改 profile 时复用分析并只重跑变化规则", async () => {
    const project = createEmptyProject();
    const counts = { range: 0, leap: 0 };
    const rangeMetadata = HARMONY_RULE_DEFINITIONS.find(
      (definition) => definition.id === "voice.range",
    )!;
    const leapMetadata = HARMONY_RULE_DEFINITIONS.find(
      (definition) => definition.id === "melody.large-leap",
    )!;
    const definitions: RuleDefinition[] = [
      {
        ...rangeMetadata,
        evaluate: () => {
          counts.range += 1;
          return { diagnostics: [] };
        },
      },
      {
        ...leapMetadata,
        evaluate: () => {
          counts.leap += 1;
          return { diagnostics: [] };
        },
      },
    ];
    const scheduler = new RuleScheduler(definitions);
    const severities = defaultHarmonyRuleSeverities();
    severities["voice.range"] = "warning";
    severities["melody.large-leap"] = "warning";
    const first = scheduler.prepareAnalysis(project, 1);
    await scheduler.run({ project, analysis: first, severities, revision: 1 });

    const profileOnly = structuredClone(project);
    profileOnly.ruleProfile.title = "另一套规则配置";
    const second = scheduler.prepareAnalysis(profileOnly, 2);
    const changedSeverities = { ...severities };
    changedSeverities["melody.large-leap"] = "suggestion";
    await scheduler.run({
      project: profileOnly,
      analysis: second,
      severities: changedSeverities,
      revision: 2,
    });

    expect(second.slices).toBe(first.slices);
    expect(second.invalidationRanges).toEqual([]);
    expect(counts).toEqual({ range: 1, leap: 2 });
  });

  it("同步与异步 stateful runner 使用相同的状态转移和结果策略", async () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      region("state-a", 0, PPQ),
      region("state-b", PPQ, PPQ, { root: "G", degree: 5 }),
    ];
    const metadata = HARMONY_RULE_DEFINITIONS.find(
      (definition) => definition.id === "voice.polyphonic-overlap",
    )!;
    const definition: RuleDefinition = {
      ...metadata,
      process(step, incoming) {
        const previous = incoming[0];
        const previousCount = previous
          ? (previous.payload as { count: number }).count
          : 0;
        const state = previous
          ? { ...previous, payload: { count: previousCount + 1 } }
          : {
              id: "counter",
              ownerRuleId: metadata.id,
              createdAt: { tick: step.slice.tick, sliceIndex: step.sliceIndex },
              payload: { count: 1 },
            };
        return {
          diagnostics: [
            {
              ruleId: metadata.id,
              source: "builtin",
              tick: step.slice.tick,
              endTick: step.slice.endTick,
              voiceIds: [],
              noteIds: [],
              chordIds: [],
              title: "状态测试",
              message: `计数 ${state.payload.count}`,
              messageKey: "state-test",
              params: { count: state.payload.count },
              evidence: [],
              confidence: 1,
            },
          ],
          outgoing: [state],
        };
      },
    };
    const severities = { [metadata.id]: "warning" } as Record<string, "warning">;
    const sync = runRulesSynchronously([definition], project, severities, 9);
    const asyncResult = await new RuleScheduler([definition]).run({
      project,
      severities,
      revision: 9,
    });
    expect(sync.diagnostics.map(({ id, ...item }) => item)).toEqual(
      asyncResult.diagnostics.map(({ id, ...item }) => item),
    );
    expect(sync.skippedRules).toEqual(asyncResult.skippedRules);
  });
});

describe("Phase B v1 书写与和弦金样本", () => {
  it("结构化区分无和弦与缺少和声语义的跳过原因", () => {
    const noChord = checkHarmony(createEmptyProject());
    expect(noChord.skippedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "no-chords", partial: false }),
      ]),
    );

    const noFunction = createEmptyProject();
    noFunction.lengthTicks = PPQ;
    noFunction.chordTrack.regions = [fSharpMajorRegion()];
    const result = checkHarmony(noFunction);
    expect(result.skippedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "function.retrogression",
          reason: "missing-semantics",
        }),
      ]),
    );
  });

  it("精确 appliedTarget 不再被旧粗分类误判为歧义", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    const ambiguous = fSharpMajorRegion(true);
    ambiguous.semantics = writtenPitchSemantics(2, { appliedTarget: 5 });
    project.chordTrack.regions = [ambiguous];

    const result = checkHarmony(project);
    expect(result.skippedRules).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "function.retrogression",
          reason: "ambiguous-semantics",
        }),
      ]),
    );
    expect(
      result.diagnostics.some(
        (item) => item.ruleId === "function.retrogression",
      ),
    ).toBe(false);
  });
});
