import { describe, expect, it } from "vitest";
import { HARMONY_PHASE_B_GOLDEN } from "./fixtures/harmonyPhaseB.v1";
import {
  BUILTIN_HARMONY_RULES,
  checkHarmony,
  createHarmonyRuleScheduler,
} from "./harmony";
import { RuleScheduler, type RuleDefinition } from "./harmonyRuntime";
import { defaultHarmonyRuleSeverities } from "./harmonyRules";
import {
  createEmptyProject,
  PPQ,
  type ChordRegion,
  type NoteEvent,
  type ProjectDocument,
  type SpelledPitch,
  type VoiceId,
} from "./model";

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

function fSharpMajorRegion(functionAnalysis = false): ChordRegion {
  return {
    id: "f-sharp-major",
    startTick: 0,
    durationTicks: PPQ,
    identity: {
      root: { ...HARMONY_PHASE_B_GOLDEN.enharmonicChordTone.chordRoot },
      quality: "major",
      extensions: [],
      alterations: [],
      bass: { step: "F", alter: 1 },
    },
    function: functionAnalysis
      ? {
          degree: 4,
          degreeAlteration: 1,
          quality: "major",
          inversion: 0,
          source: "manual",
        }
      : undefined,
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
      (item) => item.ruleId === "chord-membership",
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
        (item) => item.ruleId === "chord-membership",
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

      const diagnostic = checkHarmony(project).diagnostics.find(
        (item) => item.ruleId === "augmented-diminished-interval",
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
        (item) => item.ruleId === "augmented-diminished-interval",
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
        (item) => item.ruleId === "cross-relation",
      )?.messageKey,
    ).toBe("cross-relation.simultaneous");

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
        (item) => item.ruleId === "cross-relation",
      )?.messageKey,
    ).toBe("cross-relation.successive");
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
        (item) => item.ruleId === "cross-relation",
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
        (item) => item.ruleId === "leading-tone-resolution",
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
        identity: {
          root: { step: "G", alter: 0 },
          quality: "dominant7",
          extensions: [],
          alterations: [],
          bass: { step: "G", alter: 0 },
        },
        function: {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          source: "manual",
        },
        locked: false,
      },
    ];
    setNotes(project, "alto", [
      note("e-sharp", 0, PPQ, { step: "E", alter: 1, octave: 4 }),
      note("g", PPQ, PPQ, { step: "G", alter: 0, octave: 4 }),
    ]);

    expect(
      checkHarmony(project).diagnostics.some(
        (item) => item.ruleId === "chord-seventh-resolution",
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
        identity: {
          root: { step: "G", alter: 0 },
          quality: "dominant7",
          extensions: [],
          alterations: [],
          bass: { step: "G", alter: 0 },
        },
        function: {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          source: "manual",
        },
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
      (item) => item.ruleId === "chord-seventh-doubling",
    );
    expect(result?.chordIds).toEqual(["g7"]);
    expect(result?.noteIds).toEqual(["a-f", "s-f"]);
    expect(result?.evidence.some((item) => item.label === "和弦")).toBe(true);
  });

  it("结构化区分无和弦与缺少功能分析的跳过原因", () => {
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
          ruleId: "functional-retrogression",
          reason: "missing-function",
        }),
      ]),
    );
  });

  it("歧义功能不直接套用功能进行规则", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    const ambiguous = fSharpMajorRegion(true);
    ambiguous.function = {
      ...ambiguous.function!,
      degree: 2,
      applied: { targetDegree: 5 },
    };
    project.chordTrack.regions = [ambiguous];

    expect(checkHarmony(project).skippedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "functional-retrogression",
          reason: "ambiguous-function",
          partial: false,
        }),
      ]),
    );
  });

  it("终止四六必须连续进入属功能", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      {
        id: "cadential-64",
        startTick: 0,
        durationTicks: PPQ,
        identity: {
          root: { step: "C", alter: 0 },
          quality: "major",
          extensions: [],
          alterations: [],
          bass: { step: "G", alter: 0 },
        },
        function: {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 2,
          cadenceRole: "cadential64",
          source: "manual",
        },
        locked: false,
      },
      {
        id: "tonic",
        startTick: PPQ,
        durationTicks: PPQ,
        identity: {
          root: { step: "C", alter: 0 },
          quality: "major",
          extensions: [],
          alterations: [],
          bass: { step: "C", alter: 0 },
        },
        function: {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          source: "manual",
        },
        locked: false,
      },
    ];

    expect(
      checkHarmony(project).diagnostics.find(
        (item) => item.ruleId === "cadential64-resolution",
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
        item.ruleId === "chord-membership" &&
        item.noteIds.includes("held-g-flat"),
    );
    const second = checkHarmony(project).diagnostics.filter(
      (item) =>
        item.ruleId === "chord-membership" &&
        item.noteIds.includes("held-g-flat"),
    );
    expect(first).toHaveLength(1);
    expect(first[0].endTick).toBe(PPQ * 2);
    expect(second[0].id).toBe(first[0].id);
  });
});

describe("Phase B RuleScheduler", () => {
  it("较旧 revision 的异步结果不会覆盖新结果", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const base = BUILTIN_HARMONY_RULES.find(
      (definition) => definition.id === "voice-range",
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
      (definition) => definition.id === "voice-range",
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
        ruleId: "voice-range",
        reason: "rule-error",
      }),
    ]);
  });
});
