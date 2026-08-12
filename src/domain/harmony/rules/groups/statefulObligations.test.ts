import { describe, expect, it } from "vitest";
import type { ChordRegion, NoteEvent, VoiceId } from "../../../project";
import { createEmptyProject, PPQ } from "../../../project";
import type { SpelledPitch } from "../../../pitch";
import { buildHarmonyAnalysis, type HarmonyAnalysis } from "../../analysis";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import type {
  RuleDiagnostic,
  RuleStateEnvelope,
  RuleStepContext,
  StatefulRuleDefinition,
} from "../../runtime";
import type { ObligationRuntimeTraceEntry } from "../state/obligation";
import { STATEFUL_RULES } from "./stateful";

function pitch(
  step: SpelledPitch["step"],
  alter: SpelledPitch["alter"],
  octave: number,
): SpelledPitch {
  return { step, alter, octave };
}

function note(id: string, index: number, value: SpelledPitch): NoteEvent {
  return {
    id,
    startTick: index * PPQ,
    durationTicks: PPQ,
    pitch: value,
    velocity: 80,
    locked: false,
    spellingSource: "manual",
  };
}

function tertianRegion(
  id: string,
  index: number,
  root: ChordRegion["identity"]["root"],
  quality: "major" | "minor" | "dominant7",
  extensions: readonly 9[] = [],
): ChordRegion {
  return {
    id,
    startTick: index * PPQ,
    durationTicks: PPQ,
    identity: {
      root,
      bass: root,
      structure: {
        kind: "tertian",
        quality,
        extensions: [...extensions],
        alterations: [],
      },
    },
    locked: false,
  };
}

function alteredRegion(id: string, index: number): ChordRegion {
  return {
    id,
    startTick: index * PPQ,
    durationTicks: PPQ,
    identity: {
      root: { step: "C", alter: 0 },
      bass: { step: "C", alter: 0 },
      structure: {
        kind: "tertian",
        quality: "major",
        extensions: [],
        alterations: [{ degree: 5, alter: 1, tendency: "up" }],
      },
    },
    locked: false,
  };
}

function projectFor(
  regions: readonly ChordRegion[],
  voiceId: VoiceId,
  pitches: readonly SpelledPitch[],
) {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * Math.max(regions.length, pitches.length);
  project.chordTrack.regions = [...regions];
  project.satbTracks.find((track) => track.id === voiceId)!.notes = pitches.map(
    (value, index) => note(`${voiceId}-${index}`, index, value),
  );
  return project;
}

function stepContext(
  analysis: HarmonyAnalysis,
  sliceIndex: number,
): RuleStepContext {
  const rules = createHarmonyRuleContext(analysis);
  const spanId = analysis.sliceSpanIds.get(sliceIndex);
  const previousSpanId = analysis.sliceSpanIds.get(sliceIndex - 1);
  const nextSpanId = analysis.sliceSpanIds.get(sliceIndex + 1);
  return {
    analysis,
    rules,
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

interface InspectableObligationRule extends StatefulRuleDefinition {
  inspectTrace(
    analysis: HarmonyAnalysis,
  ): readonly ObligationRuntimeTraceEntry[];
}

function obligationRule(ruleId: string): InspectableObligationRule {
  const definition = STATEFUL_RULES.find((rule) => rule.id === ruleId);
  if (!definition || !("inspectTrace" in definition))
    throw new Error(`规则“${ruleId}”不是可检查的声明式义务`);
  return definition as InspectableObligationRule;
}

function traceReasons(
  ruleId: string,
  project: ReturnType<typeof createEmptyProject>,
) {
  return runObligation(ruleId, project).trace.map((entry) => entry.reason);
}

function runObligation(
  ruleId: string,
  project: ReturnType<typeof createEmptyProject>,
) {
  const analysis = buildHarmonyAnalysis(project);
  const rule = obligationRule(ruleId);
  let states: readonly RuleStateEnvelope[] = [];
  const diagnostics: RuleDiagnostic[] = [];
  for (let index = 0; index < analysis.slices.length; index += 1) {
    const result = rule.process(stepContext(analysis, index), states, {});
    if (result instanceof Promise)
      throw new Error("内置义务规则不应在同步测试中返回 Promise");
    diagnostics.push(...result.diagnostics);
    states = result.outgoing;
  }
  return {
    analysis,
    diagnostics,
    states,
    trace: rule.inspectTrace(analysis),
  };
}

function makeSemanticsAmbiguous(region: ChordRegion) {
  region.semantics = {
    interpretations: [
      {
        id: `${region.id}-primary`,
        degree: 1,
        degreeAlteration: 0,
        source: "confirmed",
        confidence: "certain",
      },
    ],
    primaryInterpretationId: `${region.id}-primary`,
    alternatives: [
      {
        id: `${region.id}-alternative`,
        degree: 5,
        degreeAlteration: 0,
        source: "inferred",
        confidence: "probable",
      },
    ],
  };
  return region;
}

const V = () => tertianRegion("dominant", 0, { step: "G", alter: 0 }, "major");
const V_AGAIN = () =>
  tertianRegion("dominant-again", 1, { step: "G", alter: 0 }, "major");
const V7 = () =>
  tertianRegion("dominant-seventh", 0, { step: "G", alter: 0 }, "dominant7");
const V7_AGAIN = () =>
  tertianRegion(
    "dominant-seventh-again",
    1,
    { step: "G", alter: 0 },
    "dominant7",
  );
const V9 = () =>
  tertianRegion("dominant-ninth", 0, { step: "G", alter: 0 }, "dominant7", [9]);
const V9_AGAIN = () =>
  tertianRegion(
    "dominant-ninth-again",
    1,
    { step: "G", alter: 0 },
    "dominant7",
    [9],
  );
const I = () => tertianRegion("tonic", 1, { step: "C", alter: 0 }, "major");
const VI = () =>
  tertianRegion("submediant", 1, { step: "A", alter: 0 }, "minor");

interface TendencyReasonCases {
  ruleId: string;
  reasons: readonly [string, string, string, string];
  sameHarmony: ReturnType<typeof createEmptyProject>;
  resolved: ReturnType<typeof createEmptyProject>;
  violated: ReturnType<typeof createEmptyProject>;
  cancelled: ReturnType<typeof createEmptyProject>;
}

const CASES: readonly TendencyReasonCases[] = [
  {
    ruleId: "resolution.leading-tone",
    reasons: [
      "leading-tone-repeated",
      "leading-tone-resolved",
      "leading-tone-moved-elsewhere",
      "leading-tone-context-ended",
    ],
    sameHarmony: projectFor([V(), V_AGAIN()], "alto", [
      pitch("B", 0, 4),
      pitch("G", 0, 4),
    ]),
    resolved: projectFor([V(), I()], "alto", [
      pitch("B", 0, 4),
      pitch("C", 0, 5),
    ]),
    violated: projectFor([V(), I()], "alto", [
      pitch("B", 0, 4),
      pitch("A", 0, 4),
    ]),
    cancelled: projectFor([V(), I()], "alto", [pitch("B", 0, 4)]),
  },
  {
    ruleId: "resolution.chord-seventh",
    reasons: [
      "chord-seventh-same-harmony",
      "chord-seventh-resolved",
      "chord-seventh-moved-elsewhere",
      "chord-seventh-context-ended",
    ],
    sameHarmony: projectFor([V7(), V7_AGAIN()], "alto", [
      pitch("F", 0, 4),
      pitch("A", 0, 4),
    ]),
    resolved: projectFor([V7(), I()], "alto", [
      pitch("F", 0, 4),
      pitch("E", 0, 4),
    ]),
    violated: projectFor([V7(), I()], "alto", [
      pitch("F", 0, 4),
      pitch("G", 0, 4),
    ]),
    cancelled: projectFor([V7(), I()], "alto", [pitch("F", 0, 4)]),
  },
  {
    ruleId: "resolution.dominant-ninth",
    reasons: [
      "dominant-ninth-same-harmony",
      "dominant-ninth-resolved",
      "dominant-ninth-moved-elsewhere",
      "dominant-ninth-context-ended",
    ],
    sameHarmony: projectFor([V9(), V9_AGAIN()], "alto", [
      pitch("A", 0, 4),
      pitch("B", 0, 4),
    ]),
    resolved: projectFor([V9(), I()], "alto", [
      pitch("A", 0, 4),
      pitch("G", 0, 4),
    ]),
    violated: projectFor([V9(), I()], "alto", [
      pitch("A", 0, 4),
      pitch("B", 0, 4),
    ]),
    cancelled: projectFor([V9(), I()], "alto", [pitch("A", 0, 4)]),
  },
  {
    ruleId: "resolution.altered-tone",
    reasons: [
      "altered-tone-same-harmony",
      "altered-tone-resolved",
      "altered-tone-moved-elsewhere",
      "altered-tone-context-ended",
    ],
    sameHarmony: projectFor(
      [alteredRegion("altered", 0), alteredRegion("altered-again", 1)],
      "alto",
      [pitch("G", 1, 4), pitch("G", 0, 4)],
    ),
    resolved: projectFor([alteredRegion("altered", 0), VI()], "alto", [
      pitch("G", 1, 4),
      pitch("A", 0, 4),
    ]),
    violated: projectFor([alteredRegion("altered", 0), I()], "alto", [
      pitch("G", 1, 4),
      pitch("G", 0, 4),
    ]),
    cancelled: projectFor([alteredRegion("altered", 0), I()], "alto", [
      pitch("G", 1, 4),
    ]),
  },
];

describe("倾向音义务决策原因", () => {
  it.each(CASES)("$ruleId 的四类转换均可达", (item) => {
    const scenarios = [
      item.sameHarmony,
      item.resolved,
      item.violated,
      item.cancelled,
    ];
    item.reasons.forEach((reason, index) => {
      expect(traceReasons(item.ruleId, scenarios[index])).toContain(reason);
    });
  });

  it.each(CASES)(
    "$ruleId 的违规诊断保留来源、失败对象、根因与状态轨迹",
    (item) => {
      const { analysis, diagnostics } = runObligation(
        item.ruleId,
        item.violated,
      );
      const result = diagnostics.find(
        (diagnostic) => diagnostic.ruleId === item.ruleId,
      );
      const sourceSpan = analysis.harmonySpans[0];
      const targetSpan = analysis.harmonySpans[1];
      const connection = analysis.connections.find(
        (candidate) =>
          candidate.previousSpanId === sourceSpan.id &&
          candidate.currentSpanId === targetSpan.id,
      );
      const sourceChordId = item.violated.chordTrack.regions[0].id;
      const targetChordId = item.violated.chordTrack.regions[1].id;
      const causeKind = item.ruleId.slice("resolution.".length);

      expect(connection).toBeDefined();
      expect(result?.subjects?.origin).toEqual({
        voiceIds: ["alto"],
        noteIds: ["alto-0"],
        ...(item.ruleId === "resolution.leading-tone"
          ? {}
          : { chordIds: [sourceChordId] }),
        spanIds: [sourceSpan.id],
      });
      expect(result?.subjects?.failure).toEqual({
        voiceIds: ["alto"],
        noteIds: ["alto-1"],
        chordIds: [targetChordId],
      });
      expect(result?.causeRefs).toEqual([
        `resolution.${causeKind}|${connection!.connectionKey}|voice:alto`,
      ]);
      expect(result?.trace).toEqual([
        {
          tick: 0,
          outcome: "continue",
          reason: "obligation-opened",
        },
        {
          tick: PPQ,
          outcome: "violate",
          reason: item.reasons[2],
        },
      ]);
    },
  );

  it("导音可经过多次同音重复后解决到主音", () => {
    const project = projectFor(
      [
        tertianRegion("dominant-0", 0, { step: "G", alter: 0 }, "major"),
        tertianRegion("dominant-1", 1, { step: "G", alter: 0 }, "major"),
        tertianRegion("dominant-2", 2, { step: "G", alter: 0 }, "major"),
        tertianRegion("tonic-3", 3, { step: "C", alter: 0 }, "major"),
      ],
      "alto",
      [
        pitch("B", 0, 4),
        pitch("B", 0, 4),
        pitch("B", 0, 4),
        pitch("C", 0, 5),
      ],
    );
    const reasons = traceReasons("resolution.leading-tone", project);

    expect(
      reasons.filter((reason) => reason === "leading-tone-repeated"),
    ).toHaveLength(2);
    expect(reasons).toContain("leading-tone-resolved");
    expect(reasons).not.toContain("leading-tone-moved-elsewhere");
  });

  it.each([
    ["resolution.leading-tone", V(), pitch("B", 0, 4)],
    ["resolution.chord-seventh", V7(), pitch("F", 0, 4)],
    ["resolution.dominant-ninth", V9(), pitch("A", 0, 4)],
    ["resolution.altered-tone", alteredRegion("altered", 0), pitch("G", 1, 4)],
  ] as const)(
    "%s 不会从含候选解释的和弦建立确定义务",
    (ruleId, source, sourcePitch) => {
      const project = projectFor(
        [makeSemanticsAmbiguous(source), I()],
        "alto",
        [sourcePitch, pitch("G", 0, 4)],
      );

      expect(traceReasons(ruleId, project)).not.toContain("obligation-opened");
    },
  );

  it.each([
    ["resolution.leading-tone", V(), I(), pitch("B", 0, 4), pitch("A", 0, 4), "leading-tone"],
    ["resolution.chord-seventh", V7(), I(), pitch("F", 0, 4), pitch("G", 0, 4), "chord-seventh"],
    ["resolution.dominant-ninth", V9(), I(), pitch("A", 0, 4), pitch("B", 0, 4), "dominant-ninth"],
    ["resolution.altered-tone", alteredRegion("altered", 0), I(), pitch("G", 1, 4), pitch("G", 0, 4), "altered-tone"],
  ] as const)(
    "%s 在目标和声变为歧义时取消义务而不报告确定违规",
    (ruleId, source, target, sourcePitch, targetPitch, reasonPrefix) => {
      const project = projectFor(
        [source, makeSemanticsAmbiguous(target)],
        "alto",
        [sourcePitch, targetPitch],
      );
      const result = runObligation(ruleId, project);
      const reasons = result.trace.map((entry) => entry.reason);

      expect(reasons).toContain(`${reasonPrefix}-context-ended`);
      expect(reasons).not.toContain(`${reasonPrefix}-moved-elsewhere`);
      expect(result.diagnostics).toEqual([]);
    },
  );
});
