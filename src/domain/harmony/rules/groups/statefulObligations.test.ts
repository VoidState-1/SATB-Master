import { describe, expect, it } from "vitest";
import type { ChordRegion, NoteEvent, VoiceId } from "../../../project";
import { createEmptyProject, PPQ } from "../../../project";
import type { SpelledPitch } from "../../../pitch";
import type { ChordQuality } from "../../../chordModel";
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
  quality: ChordQuality,
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

function projectForVoices(
  regions: readonly ChordRegion[],
  voices: Partial<Record<VoiceId, readonly SpelledPitch[]>>,
) {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * Math.max(
    regions.length,
    ...Object.values(voices).map((pitches) => pitches?.length ?? 0),
  );
  project.chordTrack.regions = [...regions];
  (Object.keys(voices) as VoiceId[]).forEach((voiceId) => {
    const pitches = voices[voiceId] ?? [];
    project.satbTracks.find((track) => track.id === voiceId)!.notes = pitches.map(
      (value, index) => note(`${voiceId}-${index}`, index, value),
    );
  });
  return project;
}

function invertedTertianRegion(
  id: string,
  index: number,
  root: ChordRegion["identity"]["root"],
  bass: ChordRegion["identity"]["bass"],
) {
  const region = tertianRegion(id, index, root, "major");
  return {
    ...region,
    identity: { ...region.identity, bass },
  };
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
    ["下属和弦上的非构成音", tertianRegion("subdominant", 0, { step: "F", alter: 0 }, "major"), false],
    ["属和弦三音", V(), true],
    ["没有和弦覆盖", undefined, true],
  ] as const)("同样下行到 G4 时，区分%s的导音义务", (_label, sourceChord, reports) => {
    const project = projectFor(sourceChord ? [sourceChord, I()] : [I()], "soprano", [
      pitch("B", 0, 4), pitch("G", 0, 4),
    ]);
    const { diagnostics } = runObligation("resolution.leading-tone", project);
    expect(diagnostics).toEqual(reports ? [expect.objectContaining({
      tick: PPQ, voiceIds: ["soprano"],
    })] : []);
  });

  it.each([
    ["正确上行到主音", pitch("C", 0, 5), false],
    ["错误下行到五音", pitch("G", 0, 4), true],
  ] as const)("持续音成为属和弦三音后%s", (_label, landing, reports) => {
    const tonic = tertianRegion("tonic-before", 0, { step: "C", alter: 0 }, "major");
    const dominant = tertianRegion("dominant", 1, { step: "G", alter: 0 }, "major");
    const target = tertianRegion("tonic-after", 2, { step: "C", alter: 0 }, "major");
    const project = projectFor([tonic, dominant, target], "soprano", [pitch("B", 0, 4), landing]);
    const [held, next] = project.satbTracks.find(track => track.id === "soprano")!.notes;
    held.durationTicks = 2 * PPQ;
    next.startTick = 2 * PPQ;

    const { diagnostics, trace } = runObligation("resolution.leading-tone", project);
    expect(trace.filter(entry => entry.reason === "obligation-opened")).toEqual([
      expect.objectContaining({ tick: PPQ }),
    ]);
    expect(diagnostics).toEqual(reports ? [expect.objectContaining({
      tick: 2 * PPQ, voiceIds: ["soprano"],
    })] : []);
  });

  it.each([V, V7])("原位属和弦接完整主和弦时，允许内声部导音下行三度至五音", (dominant) => {
    const project = projectForVoices([dominant(), I()], {
      soprano: [pitch("D", 0, 5), pitch("C", 0, 5)],
      alto: [pitch(dominant === V ? "G" : "F", 0, 4), pitch("E", 0, 4)],
      tenor: [pitch("B", 0, 3), pitch("G", 0, 3)],
      bass: [pitch("G", 0, 2), pitch("C", 0, 3)],
    });

    const result = runObligation("resolution.leading-tone", project);
    expect(result.diagnostics).toEqual([]);
    expect(result.trace).toContainEqual(expect.objectContaining({ reason: "inner-leading-tone-descends-to-fifth" }));
  });

  it.each([
    { soprano: pitch("C", 0, 5), alto: pitch("E", 0, 4), tenor: pitch("F", 2, 3) },
    { soprano: pitch("C", 0, 5), alto: pitch("E", 0, 4), tenor: pitch("G", 0, 2) },
    { soprano: pitch("C", 0, 5), alto: pitch("C", 0, 4), tenor: pitch("G", 0, 3) },
  ])("内声部例外仍要求书写下行单三度和完整主和弦", (target) => {
    const project = projectForVoices([V7(), I()], {
      soprano: [pitch("D", 0, 5), target.soprano],
      alto: [pitch("F", 0, 4), target.alto],
      tenor: [pitch("B", 0, 3), target.tenor],
      bass: [pitch("G", 0, 2), pitch("C", 0, 3)],
    });

    expect(runObligation("resolution.leading-tone", project).diagnostics).toContainEqual(
      expect.objectContaining({ tick: PPQ, voiceIds: ["tenor"] }),
    );
  });

  it("外声部导音直接下行至主和弦五音仍报警", () => {
    const project = projectForVoices([V7(), I()], {
      soprano: [pitch("B", 0, 4), pitch("G", 0, 4)],
      alto: [pitch("F", 0, 4), pitch("E", 0, 4)],
      tenor: [pitch("D", 0, 4), pitch("C", 0, 4)],
      bass: [pitch("G", 0, 2), pitch("C", 0, 3)],
    });

    expect(runObligation("resolution.leading-tone", project).diagnostics).toContainEqual(
      expect.objectContaining({ tick: PPQ, voiceIds: ["soprano"] }),
    );
  });

  it("七音保持到下一个和弦作为协和音（如 ii7 -> I）直接消除倾向并解决", () => {
    const ii7 = tertianRegion(
      "supertonic-seventh",
      0,
      { step: "D", alter: 0 },
      "minor7",
    );
    const project = projectFor([ii7, I()], "alto", [
      pitch("C", 0, 4),
      pitch("C", 0, 4),
    ]);

    const result = runObligation("resolution.chord-seventh", project);
    const reasons = result.trace.map((entry) => entry.reason);

    expect(reasons).toContain("chord-seventh-resolved");
    expect(reasons).not.toContain("chord-seventh-moved-elsewhere");
    expect(result.diagnostics).toEqual([]);
  });

  it("下属七和弦保持到主六和弦（SII7 -> i6）时，七音作为主音保持直接解决", () => {
    const fSharpHalfDim7 = tertianRegion(
      "sii7",
      0,
      { step: "F", alter: 1 },
      "halfDiminished7",
    );
    const eMinor6 = invertedTertianRegion(
      "t6",
      1,
      { step: "E", alter: 0 },
      { step: "G", alter: 0 },
    );
    eMinor6.identity.structure = {
      kind: "tertian",
      quality: "minor",
      extensions: [],
      alterations: [],
    };
    const project = projectFor([fSharpHalfDim7, eMinor6], "alto", [
      pitch("E", 0, 4),
      pitch("E", 0, 4),
    ]);

    const result = runObligation("resolution.chord-seventh", project);
    const reasons = result.trace.map((entry) => entry.reason);

    expect(reasons).toContain("chord-seventh-resolved");
    expect(reasons).not.toContain("chord-seventh-moved-elsewhere");
    expect(result.diagnostics).toEqual([]);
  });

  it("七音可同音延留后在后续切片中下行级进解决", () => {
    const tonicRegion: ChordRegion = {
      id: "tonic-double",
      startTick: PPQ,
      durationTicks: PPQ * 2,
      identity: {
        root: { step: "C", alter: 0 },
        bass: { step: "C", alter: 0 },
        structure: {
          kind: "tertian",
          quality: "major",
          extensions: [],
          alterations: [],
        },
      },
      locked: false,
    };
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions = [V7(), tonicRegion];
    project.satbTracks.find((track) => track.id === "alto")!.notes = [
      note("alto-0", 0, pitch("F", 0, 4)),
      note("alto-1", 1, pitch("F", 0, 4)),
      note("alto-2", 2, pitch("E", 0, 4)),
    ];

    const result = runObligation("resolution.chord-seventh", project);
    const reasons = result.trace.map((entry) => entry.reason);

    expect(reasons).toContain("chord-seventh-repeated");
    expect(reasons).toContain("chord-seventh-resolved");
    expect(reasons).not.toContain("chord-seventh-moved-elsewhere");
    expect(result.diagnostics).toEqual([]);
  });

  it("导音可在同功能和声的转位变化中跨声部交接", () => {
    const project = projectForVoices(
      [
        tertianRegion("dominant", 0, { step: "A", alter: 0 }, "major"),
        invertedTertianRegion(
          "dominant-sixth",
          1,
          { step: "A", alter: 0 },
          { step: "C", alter: 1 },
        ),
        tertianRegion("tonic", 2, { step: "D", alter: 0 }, "major"),
      ],
      {
        soprano: [
          pitch("C", 1, 5),
          pitch("E", 0, 5),
          pitch("D", 0, 5),
        ],
        bass: [
          pitch("A", 0, 2),
          pitch("C", 1, 3),
          pitch("D", 0, 3),
        ],
      },
    );
    project.keyEvents[0].tonic = { step: "D", alter: 0 };

    const result = runObligation("resolution.leading-tone", project);
    const reasons = result.trace.map((entry) => entry.reason);

    expect(reasons).toContain("leading-tone-transferred");
    expect(reasons).not.toContain("leading-tone-moved-elsewhere");
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ ruleId: "resolution.leading-tone" }),
    );
  });

  it("导音可在属三和弦与属七和弦（如 D6 -> D2）转换中跨声部交接并解决", () => {
    const d6 = invertedTertianRegion(
      "d6",
      0,
      { step: "B", alter: 0 },
      { step: "D", alter: 1 },
    );
    const d2: ChordRegion = {
      id: "d2",
      startTick: PPQ,
      durationTicks: PPQ,
      identity: {
        root: { step: "B", alter: 0 },
        bass: { step: "A", alter: 0 },
        structure: {
          kind: "tertian",
          quality: "dominant7",
          extensions: [],
          alterations: [],
        },
      },
      locked: false,
    };
    const t6 = invertedTertianRegion(
      "t6",
      2,
      { step: "E", alter: 0 },
      { step: "G", alter: 0 },
    );
    t6.identity.structure = {
      kind: "tertian",
      quality: "minor",
      extensions: [],
      alterations: [],
    };

    const project = projectForVoices([d6, d2, t6], {
      alto: [
        pitch("F", 1, 4),
        pitch("D", 1, 4),
        pitch("E", 0, 4),
      ],
      bass: [
        pitch("D", 1, 3),
        pitch("A", 0, 3),
        pitch("G", 0, 3),
      ],
    });
    project.keyEvents[0].tonic = { step: "E", alter: 0 };
    project.keyEvents[0].mode = "minor";

    const result = runObligation("resolution.leading-tone", project);
    const reasons = result.trace.map((entry) => entry.reason);

    expect(reasons).toContain("leading-tone-transferred");
    expect(reasons).toContain("leading-tone-resolved");
    expect(reasons).not.toContain("leading-tone-moved-elsewhere");
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ ruleId: "resolution.leading-tone" }),
    );
  });

  it("七音可在同和弦转位变化中跨声部交接并解决", () => {
    const v7 = tertianRegion("v7", 0, { step: "G", alter: 0 }, "dominant7");
    const v2: ChordRegion = {
      id: "v2",
      startTick: PPQ,
      durationTicks: PPQ,
      identity: {
        root: { step: "G", alter: 0 },
        bass: { step: "F", alter: 0 },
        structure: {
          kind: "tertian",
          quality: "dominant7",
          extensions: [],
          alterations: [],
        },
      },
      locked: false,
    };
    const i = I();
    i.startTick = PPQ * 2;

    const project = projectForVoices([v7, v2, i], {
      alto: [
        pitch("F", 0, 4),
        pitch("D", 0, 4),
        pitch("C", 0, 4),
      ],
      bass: [
        pitch("G", 0, 2),
        pitch("F", 0, 2),
        pitch("E", 0, 2),
      ],
    });

    const result = runObligation("resolution.chord-seventh", project);
    const reasons = result.trace.map((entry) => entry.reason);
    expect(reasons).toContain("chord-seventh-resolved");
    expect(reasons).not.toContain("chord-seventh-moved-elsewhere");
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ ruleId: "resolution.chord-seventh" }),
    );
  });

  it("导音违规诊断附带来源、义务步骤和相关事件调试快照", () => {
    const project = projectFor([V(), I()], "alto", [
      pitch("B", 0, 4),
      pitch("A", 0, 4),
    ]);
    const { diagnostics } = runObligation("resolution.leading-tone", project);
    const diagnostic = diagnostics.find(
      (item) => item.ruleId === "resolution.leading-tone",
    );
    const debug = diagnostic?.debug;

    expect(debug).toMatchObject({
      schemaVersion: "satb-diagnostic-debug/v1",
      kind: "stateful-obligation",
      runtime: { ruleId: "resolution.leading-tone", source: "builtin" },
      subjects: {
        origin: expect.arrayContaining([
          { kind: "note", id: "alto-0", role: "origin" },
        ]),
        failure: expect.arrayContaining([
          { kind: "note", id: "alto-1", role: "failure" },
        ]),
      },
      obligation: {
        partitionKey: "voice:alto|target:C:0",
        steps: [
          { reason: "obligation-opened", outcome: "continue" },
          {
            reason: "leading-tone-moved-elsewhere",
            outcome: "violate",
            facts: {
              sameOpenedSpan: false,
              targetUnchanged: true,
              attacked: true,
            },
          },
        ],
      },
    });
    expect(debug?.relatedEvents.notes.map((item) => item.id)).toEqual(
      expect.arrayContaining(["alto-0", "alto-1"]),
    );
    expect(debug?.subjects.failure).not.toEqual(
      expect.arrayContaining([
        { kind: "note", id: "alto-0", role: "failure" },
      ]),
    );
    expect(debug?.relatedEvents.slices.length).toBeGreaterThan(0);
    expect(debug?.relatedEvents.spans.length).toBeGreaterThan(0);
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
