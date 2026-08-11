import { describe, expect, it } from "vitest";
import type { ChordRegion, NoteEvent, VoiceId } from "../../../project";
import { createEmptyProject, PPQ } from "../../../project";
import type { SpelledPitch } from "../../../pitch";
import {
  buildHarmonyAnalysis,
  type HarmonyAnalysis,
} from "../../analysis";
import type {
  RuleStateEnvelope,
  RuleStepContext,
  StatefulRuleDefinition,
} from "../../runtime";
import type { ObligationRuntimeTraceEntry } from "../declarative";
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
  project.lengthTicks = PPQ * 2;
  project.chordTrack.regions = [...regions];
  project.satbTracks.find((track) => track.id === voiceId)!.notes = pitches.map(
    (value, index) => note(`${voiceId}-${index}`, index, value),
  );
  return project;
}

function stepContext(analysis: HarmonyAnalysis, sliceIndex: number): RuleStepContext {
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

interface InspectableObligationRule extends StatefulRuleDefinition {
  inspectTrace(analysis: HarmonyAnalysis): readonly ObligationRuntimeTraceEntry[];
}

function obligationRule(ruleId: string): InspectableObligationRule {
  const definition = STATEFUL_RULES.find((rule) => rule.id === ruleId);
  if (!definition || !("inspectTrace" in definition))
    throw new Error(`规则“${ruleId}”不是可检查的声明式义务`);
  return definition as InspectableObligationRule;
}

function traceReasons(ruleId: string, project: ReturnType<typeof createEmptyProject>) {
  const analysis = buildHarmonyAnalysis(project);
  const rule = obligationRule(ruleId);
  let states: readonly RuleStateEnvelope[] = [];
  for (let index = 0; index < analysis.slices.length; index += 1) {
    const result = rule.process(stepContext(analysis, index), states, {});
    if (result instanceof Promise)
      throw new Error("内置义务规则不应在同步测试中返回 Promise");
    states = result.outgoing;
  }
  return rule.inspectTrace(analysis).map((entry) => entry.reason);
}

const V = () =>
  tertianRegion("dominant", 0, { step: "G", alter: 0 }, "major");
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
const VI = () => tertianRegion("submediant", 1, { step: "A", alter: 0 }, "minor");

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
    sameHarmony: projectFor(
      [V(), V_AGAIN()],
      "alto",
      [pitch("B", 0, 4), pitch("G", 0, 4)],
    ),
    resolved: projectFor(
      [V(), I()],
      "alto",
      [pitch("B", 0, 4), pitch("C", 0, 5)],
    ),
    violated: projectFor(
      [V(), I()],
      "alto",
      [pitch("B", 0, 4), pitch("A", 0, 4)],
    ),
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
    sameHarmony: projectFor(
      [V7(), V7_AGAIN()],
      "alto",
      [pitch("F", 0, 4), pitch("A", 0, 4)],
    ),
    resolved: projectFor(
      [V7(), I()],
      "alto",
      [pitch("F", 0, 4), pitch("E", 0, 4)],
    ),
    violated: projectFor(
      [V7(), I()],
      "alto",
      [pitch("F", 0, 4), pitch("G", 0, 4)],
    ),
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
    sameHarmony: projectFor(
      [V9(), V9_AGAIN()],
      "alto",
      [pitch("A", 0, 4), pitch("B", 0, 4)],
    ),
    resolved: projectFor(
      [V9(), I()],
      "alto",
      [pitch("A", 0, 4), pitch("G", 0, 4)],
    ),
    violated: projectFor(
      [V9(), I()],
      "alto",
      [pitch("A", 0, 4), pitch("B", 0, 4)],
    ),
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
    resolved: projectFor(
      [alteredRegion("altered", 0), VI()],
      "alto",
      [pitch("G", 1, 4), pitch("A", 0, 4)],
    ),
    violated: projectFor(
      [alteredRegion("altered", 0), I()],
      "alto",
      [pitch("G", 1, 4), pitch("G", 0, 4)],
    ),
    cancelled: projectFor(
      [alteredRegion("altered", 0), I()],
      "alto",
      [pitch("G", 1, 4)],
    ),
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
});
