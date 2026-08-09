import { describe, expect, it } from "vitest";
import { HARMONY_PHASE_B_GOLDEN } from "../fixtures/harmonyPhaseB.v1";
import { functionalTargetForDegree } from "../chordModel";
import {
  BUILTIN_HARMONY_RULES,
  checkHarmony,
  createHarmonyRuleScheduler,
} from "./registry";
import { RuleScheduler, type RuleDefinition } from "./runtime";
import {
  HARMONY_RULE_DEFINITIONS,
  defaultHarmonyRuleSeverities,
} from "./ruleTypes";
import {
  createEmptyProject,
  PPQ,
  type ChordIdentity,
  type ChordQuality,
  type ChordRegion,
  type HarmonySemantics,
  type NoteEvent,
  type ProjectDocument,
  type SpelledPitch,
  type SpelledPitchClass,
  type VoiceId,
} from "../project";

function note(
  id: string,
  startTick: number,
  durationTicks: number,
  pitch: SpelledPitch,
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: { ...pitch },
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function setNotes(
  project: ProjectDocument,
  voiceId: VoiceId,
  notes: NoteEvent[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = notes;
}

function tertianIdentity(
  root: SpelledPitchClass,
  quality: ChordQuality,
  bass: SpelledPitchClass,
): ChordIdentity {
  return {
    root,
    structure: { kind: "tertian", quality, extensions: [], alterations: [] },
    bass,
  };
}

function semantics(
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  options: {
    degreeAlteration?: -2 | -1 | 0 | 1 | 2;
    appliedTarget?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    cadenceRole?: HarmonySemantics["cadenceRole"];
  } = {},
): HarmonySemantics {
  return {
    interpretations: [
      {
        id: "primary",
        degree,
        degreeAlteration: options.degreeAlteration ?? 0,
        appliedTarget: options.appliedTarget
          ? functionalTargetForDegree(options.appliedTarget)
          : undefined,
        source: "manual",
        confidence: "certain",
      },
    ],
    primaryInterpretationId: "primary",
    cadenceRole: options.cadenceRole,
  };
}

function fSharpMajorRegion(functionAnalysis = false): ChordRegion {
  return {
    id: "f-sharp-major",
    startTick: 0,
    durationTicks: PPQ,
    identity: tertianIdentity(
      { ...HARMONY_PHASE_B_GOLDEN.enharmonicChordTone.chordRoot },
      "major",
      { step: "F", alter: 1 },
    ),
    semantics: functionAnalysis ? semantics(4, { degreeAlteration: 1 }) : undefined,
    locked: false,
  };
}

describe("Phase B v1 书写与和弦金样本", () => {
  it("同音异名不能冒充和弦构成音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.chordTrack.regions = [fSharpMajorRegion()];
    setNotes(project, "soprano", [
      note(
        "wrong-g-flat",
        0,
        PPQ,
        HARMONY_PHASE_B_GOLDEN.enharmonicChordTone.wrongEnharmonicTone,
      ),
    ]);

    const diagnostic = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "chord.unclassified-nonchord-tone",
    );
    expect(diagnostic?.noteIds).toEqual(["wrong-g-flat"]);
    expect(diagnostic?.evidence.some((item) => item.value.includes("G♭"))).toBe(
      true,
    );
  });

  it("正确的 F♯ 拼写作为和弦构成音通过", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.chordTrack.regions = [fSharpMajorRegion()];
    setNotes(project, "soprano", [
      note(
        "correct-f-sharp",
        0,
        PPQ,
        HARMONY_PHASE_B_GOLDEN.enharmonicChordTone.correctTone,
      ),
    ]);

    expect(
      checkHarmony(project).diagnostics.some(
        (item) => item.ruleId === "chord.unclassified-nonchord-tone",
      ),
    ).toBe(false);
  });

  it.each(HARMONY_PHASE_B_GOLDEN.writtenIntervals)(
    "按书写字母区分 $id",
    ({ from, to, expectedLabel }) => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      setNotes(project, "soprano", [
        note("from", 0, PPQ, from),
        note("to", PPQ, PPQ, to),
      ]);

      const ruleId = ["增4度", "减5度"].includes(expectedLabel)
        ? "melody.tritone"
        : expectedLabel.startsWith("减")
          ? "melody.diminished-interval"
          : "melody.augmented-interval";
      const diagnostic = checkHarmony(project).diagnostics.find(
        (item) => item.ruleId === ruleId,
      );
      expect(
        diagnostic?.evidence.find((item) => item.kind === "interval")?.value,
      ).toBe(expectedLabel);
    },
  );

  it("同和弦转换放宽书写增减音程", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      {
        ...fSharpMajorRegion(true),
        id: "same-1",
      },
      {
        ...fSharpMajorRegion(true),
        id: "same-2",
        startTick: PPQ,
      },
    ];
    setNotes(project, "soprano", [
      note("from", 0, PPQ, { step: "C", alter: 0, octave: 4 }),
      note("to", PPQ, PPQ, { step: "F", alter: 1, octave: 4 }),
    ]);

    expect(
      checkHarmony(project).diagnostics.some(
        (item) => item.ruleId === "melody.augmented-interval",
      ),
    ).toBe(false);
  });

  it("等于七个半音但书写为增四度的进行不算平行纯五度", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    setNotes(project, "soprano", [
      note("f-double-sharp", 0, PPQ, {
        step: "F",
        alter: 2,
        octave: 4,
      }),
      note("g-double-sharp", PPQ, PPQ, {
        step: "G",
        alter: 2,
        octave: 4,
      }),
    ]);
    setNotes(project, "bass", [
      note("c-natural", 0, PPQ, { step: "C", alter: 0, octave: 4 }),
      note("d-natural", PPQ, PPQ, { step: "D", alter: 0, octave: 4 }),
    ]);

    expect(
      checkHarmony(project).diagnostics.some(
        (item) => item.ruleId === "voice-leading.parallel-fifths",
      ),
    ).toBe(false);
  });

  it("识别同时对斜与先后对斜", () => {
    const simultaneous = createEmptyProject();
    simultaneous.lengthTicks = PPQ;
    setNotes(simultaneous, "soprano", [
      note("s-f-sharp", 0, PPQ, { step: "F", alter: 1, octave: 4 }),
    ]);
    setNotes(simultaneous, "alto", [
      note("a-f-natural", 0, PPQ, { step: "F", alter: 0, octave: 4 }),
    ]);
    expect(
      checkHarmony(simultaneous).diagnostics.find(
        (item) => item.ruleId === "voice-leading.cross-relation-simultaneous",
      )?.messageKey,
    ).toBe("voice-leading.cross-relation-simultaneous.simultaneous");

    const successive = createEmptyProject();
    successive.lengthTicks = PPQ * 2;
    setNotes(successive, "soprano", [
      note("s-f-natural", 0, PPQ, { step: "F", alter: 0, octave: 4 }),
    ]);
    setNotes(successive, "alto", [
      note("a-f-sharp", PPQ, PPQ, { step: "F", alter: 1, octave: 4 }),
    ]);
    expect(
      checkHarmony(successive).diagnostics.find(
        (item) => item.ruleId === "voice-leading.cross-relation-successive",
      )?.messageKey,
    ).toBe("voice-leading.cross-relation-successive.successive");
  });

  it("换调边界不报告先后对斜", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.keyEvents.push({
      id: "g-major",
      tick: PPQ,
      tonic: { step: "G", alter: 0 },
      mode: "major",
    });
    setNotes(project, "soprano", [
      note("f-natural", 0, PPQ, { step: "F", alter: 0, octave: 4 }),
    ]);
    setNotes(project, "alto", [
      note("f-sharp", PPQ, PPQ, { step: "F", alter: 1, octave: 4 }),
    ]);

    expect(
      checkHarmony(project).diagnostics.some(
        (item) => item.ruleId === "voice-leading.cross-relation-successive",
      ),
    ).toBe(false);
  });

  it("同音高的错误拼写不会被当作小调升高导音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.keyEvents = [
      {
        id: "a-minor",
        tick: 0,
        tonic: { step: "A", alter: 0 },
        mode: "minor",
      },
    ];
    setNotes(project, "soprano", [
      note("a-flat", 0, PPQ, { step: "A", alter: -1, octave: 4 }),
      note("a-natural", PPQ, PPQ, { step: "A", alter: 0, octave: 4 }),
    ]);

    expect(
      checkHarmony(project).diagnostics.some(
        (item) => item.ruleId === "resolution.leading-tone",
      ),
    ).toBe(false);
  });

  it("同音高的 E♯ 不会被当作 G7 的书写七音 F", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      {
        id: "g7",
        startTick: 0,
        durationTicks: PPQ,
        identity: tertianIdentity(
          { step: "G", alter: 0 },
          "dominant7",
          { step: "G", alter: 0 },
        ),
        semantics: semantics(5),
        locked: false,
      },
    ];
    setNotes(project, "alto", [
      note("e-sharp", 0, PPQ, { step: "E", alter: 1, octave: 4 }),
      note("g", PPQ, PPQ, { step: "G", alter: 0, octave: 4 }),
    ]);

    expect(
      checkHarmony(project).diagnostics.some(
        (item) => item.ruleId === "resolution.chord-seventh",
      ),
    ).toBe(false);
  });

  it("七和弦七音重复只在和弦上保留明确证据", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.chordTrack.regions = [
      {
        id: "g7",
        startTick: 0,
        durationTicks: PPQ,
        identity: tertianIdentity(
          { step: "G", alter: 0 },
          "dominant7",
          { step: "G", alter: 0 },
        ),
        semantics: semantics(5),
        locked: false,
      },
    ];
    setNotes(project, "soprano", [
      note("s-f", 0, PPQ, { step: "F", alter: 0, octave: 5 }),
    ]);
    setNotes(project, "alto", [
      note("a-f", 0, PPQ, { step: "F", alter: 0, octave: 4 }),
    ]);
    setNotes(project, "tenor", [
      note("t-b", 0, PPQ, { step: "B", alter: 0, octave: 3 }),
    ]);
    setNotes(project, "bass", [
      note("b-g", 0, PPQ, { step: "G", alter: 0, octave: 2 }),
    ]);

    const result = checkHarmony(project).diagnostics.find(
      (item) => item.ruleId === "chord.doubled-seventh",
    );
    expect(result?.chordIds).toEqual(["g7"]);
    expect(result?.noteIds).toEqual(["a-f", "s-f"]);
    expect(result?.evidence.some((item) => item.label === "和弦")).toBe(true);
  });

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
    ambiguous.semantics = semantics(2, { appliedTarget: 5 });
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
    expect(result.diagnostics.some((item) => item.ruleId === "function.retrogression")).toBe(false);
  });

  it("终止四六必须连续进入属功能", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      {
        id: "cadential-64",
        startTick: 0,
        durationTicks: PPQ,
        identity: tertianIdentity(
          { step: "C", alter: 0 },
          "major",
          { step: "G", alter: 0 },
        ),
        semantics: semantics(1, { cadenceRole: "cadential64" }),
        locked: false,
      },
      {
        id: "tonic",
        startTick: PPQ,
        durationTicks: PPQ,
        identity: tertianIdentity(
          { step: "C", alter: 0 },
          "major",
          { step: "C", alter: 0 },
        ),
        semantics: semantics(1),
        locked: false,
      },
    ];

    expect(
      checkHarmony(project).diagnostics.find(
        (item) => item.ruleId === "function.cadential64-target",
      )?.chordIds,
    ).toEqual(["cadential-64", "tonic"]);
  });

  it("相同输入生成稳定诊断 ID，并归并连续同根因区间", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      {
        ...fSharpMajorRegion(),
        durationTicks: PPQ * 2,
      },
    ];
    setNotes(project, "soprano", [
      note("held-g-flat", 0, PPQ * 2, { step: "G", alter: -1, octave: 4 }),
    ]);
    setNotes(project, "alto", [
      note("boundary-1", 0, PPQ, { step: "C", alter: 1, octave: 4 }),
      note("boundary-2", PPQ, PPQ, { step: "C", alter: 1, octave: 4 }),
    ]);
    const first = checkHarmony(project).diagnostics.filter(
      (item) =>
        item.ruleId === "chord.unclassified-nonchord-tone" &&
        item.noteIds.includes("held-g-flat"),
    );
    const second = checkHarmony(project).diagnostics.filter(
      (item) =>
        item.ruleId === "chord.unclassified-nonchord-tone" &&
        item.noteIds.includes("held-g-flat"),
    );
    expect(first).toHaveLength(1);
    expect(first[0].endTick).toBe(PPQ * 2);
    expect(second[0].id).toBe(first[0].id);
  });
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
