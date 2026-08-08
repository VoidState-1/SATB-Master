import { describe, expect, it } from "vitest";
import { buildHarmonyAnalysis } from "../analysis";
import type { HarmonyDiagnostic, RuleDefinition } from "../runtime";
import {
  createEmptyProject,
  PPQ,
  type ChordRegion,
  type HarmonySemantics,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../../project";
import { HARMONY_RULE_DEFINITIONS } from "./catalog";
import { arbitrateDiagnostics } from "./diagnosticArbiter";
import { voicePairTransitionFacts } from "./sharedFacts";

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

  it("持续低音语义成为连接器的共享特例标签", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      region("pedal", 0, PPQ, { pedal: true }),
      region("next", PPQ, PPQ, { root: "G" }),
    ];

    expect(
      buildHarmonyAnalysis(project, 1).connections[0].exceptionTags,
    ).toContain("pedal-point");
  });
});

describe("共享事实与诊断仲裁", () => {
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
});
