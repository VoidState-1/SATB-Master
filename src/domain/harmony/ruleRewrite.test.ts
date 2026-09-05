import { describe, expect, it } from "vitest";
import { createChordRegion } from "../chords";
import { buildHarmonyAnalysis } from "./analysis";
import { checkHarmony } from "./registry";
import { defaultHarmonyRuleSeverities } from "./rules/catalog";
import {
  createEmptyProject,
  PPQ,
  validateProject,
  type ChordRegion,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../project";
import { spellMidi, type SpelledPitch } from "../pitch";
import {
  resolveBuiltinRuleProfile,
  setBuiltinRuleConfig,
  setBuiltinRuleException,
  setBuiltinRuleSeverity,
} from "../ruleProfile";

function note(id: string, startTick: number, pitch: SpelledPitch): NoteEvent {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    pitch,
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function setLine(
  project: ProjectDocument,
  voiceId: VoiceId,
  pitches: readonly SpelledPitch[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = pitches.map(
    (pitch, index) => note(`${voiceId}-${index}`, index * PPQ, pitch),
  );
}

function pitch(step: SpelledPitch["step"], alter: -1 | 0 | 1, octave: number) {
  return { step, alter, octave } satisfies SpelledPitch;
}

function diagnosticFor(project: ProjectDocument, ruleId: string) {
  return checkHarmony(project).diagnostics.find(
    (diagnostic) => diagnostic.ruleId === ruleId,
  );
}

function unequalFifthsProject(options: {
  outer: boolean;
  bassStepUp: boolean;
}) {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 2;
  if (options.outer) {
    setLine(project, "bass", [pitch("C", 0, 3), pitch("D", 0, 3)]);
    setLine(project, "soprano", [pitch("G", -1, 4), pitch("A", 0, 4)]);
  } else {
    setLine(project, "tenor", [pitch("C", 0, 4), pitch("D", 0, 4)]);
    setLine(project, "alto", [pitch("G", -1, 4), pitch("A", 0, 4)]);
    setLine(project, "bass", [
      pitch("C", 0, 3),
      options.bassStepUp ? pitch("D", 0, 3) : pitch("C", 0, 3),
    ]);
  }
  return project;
}

function dominantNinthRegion(): ChordRegion {
  return {
    id: "dominant-ninth",
    startTick: 0,
    durationTicks: PPQ,
    identity: {
      root: { step: "G", alter: 0 },
      bass: { step: "G", alter: 0 },
      structure: {
        kind: "tertian",
        quality: "dominant7",
        extensions: [9],
        alterations: [],
      },
    },
    locked: false,
  };
}

function dominantNinthProject(pitchesByVoice: Record<VoiceId, SpelledPitch>) {
  const project = createEmptyProject();
  project.lengthTicks = PPQ;
  project.chordTrack.regions = [dominantNinthRegion()];
  for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const)
    setLine(project, voiceId, [pitchesByVoice[voiceId]]);
  return project;
}

function augmentedSixthRegion(
  variant: "italian" | "french" | "german",
): ChordRegion {
  return {
    id: `augmented-sixth-${variant}`,
    startTick: 0,
    durationTicks: PPQ,
    identity: {
      root: { step: "A", alter: -1 },
      bass: { step: "A", alter: -1 },
      structure: { kind: "augmented-sixth", variant },
    },
    locked: false,
  };
}

function alteredChordRegion(
  id: string,
  startTick: number,
  options: { tendency?: "up" | "down" } = {},
): ChordRegion {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    identity: {
      root: { step: "C", alter: 0 },
      bass: { step: "C", alter: 0 },
      structure: {
        kind: "tertian",
        quality: "major",
        extensions: [],
        alterations: [
          {
            degree: 5,
            alter: 1,
            ...(options.tendency ? { tendency: options.tendency } : {}),
          },
        ],
      },
    },
    locked: false,
  };
}

function triadRegion(
  id: string,
  startTick: number,
  root: SpelledPitch["step"],
  quality: "major" | "minor",
): ChordRegion {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    identity: {
      root: { step: root, alter: 0 },
      bass: { step: root, alter: 0 },
      structure: {
        kind: "tertian",
        quality,
        extensions: [],
        alterations: [],
      },
    },
    locked: false,
  };
}

function twoChordProject(
  first: ChordRegion,
  second: ChordRegion,
  lines: Record<VoiceId, readonly SpelledPitch[]>,
) {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 2;
  project.chordTrack.regions = [first, second];
  for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const)
    setLine(project, voiceId, lines[voiceId]);
  return project;
}

function deceptiveProject(options: {
  marked: boolean;
  target: "submediant" | "tonic";
  doubleThird?: boolean;
}) {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 2;
  project.loop.endTick = PPQ * 2;
  const dominant = functionalChord(project, "deceptive-dominant", 0, {
    degree: 5,
    degreeAlteration: 0,
    quality: "major",
    inversion: 0,
    designation: {
      notationSystem: "spasobin",
      kind: "primary",
      primaryFunction: "dominant",
    },
    ...(options.marked ? { cadenceRole: "deceptive" as const } : {}),
    ...manualCertain,
  });
  const target = functionalChord(
    project,
    options.target === "submediant" ? "deceptive-submediant" : "plain-tonic",
    1,
    options.target === "submediant"
      ? {
          degree: 6,
          degreeAlteration: 0,
          quality: "minor",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "side-degree",
            primaryFunction: "tonic",
            secondaryFunction: "dominant",
          },
          ...manualCertain,
        }
      : {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "tonic",
          },
          ...manualCertain,
        },
  );
  project.chordTrack.regions = [dominant, target];
  if (options.target === "submediant") {
    setLine(project, "soprano", [pitch("B", 0, 4), pitch("C", 0, 5)]);
    setLine(
      project,
      "alto",
      options.doubleThird
        ? [pitch("G", 0, 3), pitch("C", 0, 4)]
        : [pitch("G", 0, 3), pitch("A", 0, 3)],
    );
    setLine(project, "tenor", [pitch("D", 0, 3), pitch("E", 0, 3)]);
    setLine(project, "bass", [pitch("G", 0, 2), pitch("A", 0, 2)]);
  }
  return project;
}

function functionalChord(
  project: ProjectDocument,
  id: string,
  index: number,
  draft: Parameters<typeof createChordRegion>[3],
) {
  return createChordRegion(project, index * PPQ, PPQ, draft, id);
}

const manualCertain = {
  source: "manual",
  confidence: "certain",
} as const;

describe("下一代规则配置与斯波索宾金样本", () => {
  it("默认关闭纯五度到减五度，显式启用后才报告", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    setLine(project, "bass", [pitch("C", 0, 3), pitch("E", 0, 3)]);
    setLine(project, "soprano", [pitch("G", 0, 4), pitch("B", -1, 4)]);
    const ruleId = "voice-leading.unequal-fifths-perfect-to-diminished";

    expect(diagnosticFor(project, ruleId)).toBeUndefined();
    const severities = defaultHarmonyRuleSeverities();
    severities[ruleId] = "warning";
    expect(
      checkHarmony(project, severities).diagnostics.some(
        (diagnostic) => diagnostic.ruleId === ruleId,
      ),
    ).toBe(true);
  });

  it("外声部减五度到纯五度按错误报告", () => {
    const diagnostic = diagnosticFor(
      unequalFifthsProject({ outer: true, bassStepUp: true }),
      "voice-leading.unequal-fifths-outer-diminished-to-perfect",
    );
    expect(diagnostic?.severity).toBe("error");
  });

  it("内声部减五度到纯五度仅在低音上行级进时默认豁免", () => {
    const ruleId =
      "voice-leading.unequal-fifths-inner-diminished-to-perfect" as const;
    expect(
      diagnosticFor(
        unequalFifthsProject({ outer: false, bassStepUp: false }),
        ruleId,
      )?.severity,
    ).toBe("warning");
    const bassStepUp = unequalFifthsProject({
      outer: false,
      bassStepUp: true,
    });
    expect(diagnosticFor(bassStepUp, ruleId)).toBeUndefined();

    const severities = defaultHarmonyRuleSeverities();
    const strict = checkHarmony(
      bassStepUp,
      severities,
      {},
      {
        [ruleId]: { "bass-step-up": "strict" },
      },
    ).diagnostics.find((diagnostic) => diagnostic.ruleId === ruleId);
    const downgraded = checkHarmony(
      bassStepUp,
      severities,
      {},
      {
        [ruleId]: { "bass-step-up": "downgrade" },
      },
    ).diagnostics.find((diagnostic) => diagnostic.ruleId === ruleId);
    expect(strict?.severity).toBe("warning");
    expect(downgraded?.severity).toBe("suggestion");
  });

  it("D9 的 1/3/7/9 配置及复九度间距通过", () => {
    const project = dominantNinthProject({
      soprano: pitch("B", 0, 3),
      alto: pitch("A", 0, 3),
      tenor: pitch("F", 0, 3),
      bass: pitch("G", 0, 2),
    });
    const ids = checkHarmony(project).diagnostics.map((item) => item.ruleId);
    expect(ids).not.toContain("chord.dominant-ninth-voicing");
    expect(ids).not.toContain("chord.dominant-ninth-root-spacing");
  });

  it("D9 出现五音并缺少九音时只报告配置问题", () => {
    const project = dominantNinthProject({
      soprano: pitch("B", 0, 3),
      alto: pitch("F", 0, 3),
      tenor: pitch("D", 0, 3),
      bass: pitch("G", 0, 2),
    });
    const ids = checkHarmony(project).diagnostics.map((item) => item.ruleId);
    expect(ids).toContain("chord.dominant-ninth-voicing");
    expect(ids).not.toContain("chord.dominant-ninth-root-spacing");
  });

  it("D9 九音位于根音上方八度内时报告间距错误", () => {
    const project = dominantNinthProject({
      soprano: pitch("F", 0, 4),
      alto: pitch("B", 0, 3),
      tenor: pitch("A", 0, 3),
      bass: pitch("G", 0, 3),
    });
    expect(
      diagnosticFor(project, "chord.dominant-ninth-root-spacing")?.severity,
    ).toBe("error");
  });

  it("建议音域诊断显示当前 profile 的实际上下界", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    setLine(project, "soprano", [pitch("C", 0, 4)]);
    const severities = defaultHarmonyRuleSeverities();
    const diagnostic = checkHarmony(project, severities, {
      "voice.range": {
        soprano: { minMidi: 61, maxMidi: 79 },
      },
    }).diagnostics.find((item) => item.ruleId === "voice.range");

    expect(diagnostic?.message).toContain("MIDI 61-79");
    expect(diagnostic?.params).toMatchObject({ minimum: 61, maximum: 79 });
  });

  it("明确变化和弦构成音的先后半音化不误报为对斜", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      triadRegion("plain-tonic", 0, "C", "major"),
      functionalChord(project, "double-dominant", 1, {
        degree: 2,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "double-dominant",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
    ];
    setLine(project, "soprano", [pitch("F", 0, 4)]);
    project.satbTracks.find((track) => track.id === "alto")!.notes = [
      note("altered-third", PPQ, pitch("F", 1, 4)),
    ];

    expect(
      diagnosticFor(project, "voice-leading.cross-relation-successive"),
    ).toBeUndefined();
  });

  it("D9 仍建立通用导音与七音解决状态", () => {
    const project = twoChordProject(
      dominantNinthRegion(),
      triadRegion("tonic", PPQ, "C", "major"),
      {
        soprano: [pitch("B", 0, 4), pitch("A", 0, 4)],
        alto: [pitch("F", 0, 4), pitch("G", 0, 4)],
        tenor: [pitch("A", 0, 3), pitch("G", 0, 3)],
        bass: [pitch("G", 0, 2), pitch("C", 0, 3)],
      },
    );

    const ids = checkHarmony(project).diagnostics.map((item) => item.ruleId);
    expect(ids).toContain("resolution.leading-tone");
    expect(ids).toContain("resolution.chord-seventh");
  });

  it("副属和弦按目标调性识别局部导音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      functionalChord(project, "applied-dominant", 0, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        appliedTarget: 2,
        designation: {
          notationSystem: "spasobin",
          kind: "applied-dominant",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "supertonic", 1, {
        degree: 2,
        degreeAlteration: 0,
        quality: "minor",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "side-degree",
          primaryFunction: "subdominant",
        },
        ...manualCertain,
      }),
    ];
    setLine(project, "soprano", [pitch("C", 1, 5), pitch("B", 0, 4)]);

    const diagnostic = diagnosticFor(project, "resolution.leading-tone");
    expect(diagnostic?.params).toMatchObject({
      leadingTone: "C♯",
      targetTonic: "D",
    });
  });

  it("It+6、Fr+6、Ger+6 的审定四声部配置均通过", () => {
    const legal: Record<
      "italian" | "french" | "german",
      Record<VoiceId, SpelledPitch>
    > = {
      italian: {
        soprano: pitch("F", 1, 4),
        alto: pitch("C", 0, 4),
        tenor: pitch("C", 0, 3),
        bass: pitch("A", -1, 2),
      },
      french: {
        soprano: pitch("F", 1, 4),
        alto: pitch("C", 0, 4),
        tenor: pitch("D", 0, 3),
        bass: pitch("A", -1, 2),
      },
      german: {
        soprano: pitch("F", 1, 4),
        alto: pitch("C", 0, 4),
        tenor: pitch("E", -1, 3),
        bass: pitch("A", -1, 2),
      },
    };
    for (const variant of ["italian", "french", "german"] as const) {
      const project = dominantNinthProject(legal[variant]);
      project.chordTrack.regions = [augmentedSixthRegion(variant)];
      expect(
        diagnosticFor(project, "chord.augmented-sixth-voicing"),
      ).toBeUndefined();
    }
  });

  it("It+6 重复增六端点而未重复中间音时报告和弦级错误", () => {
    const project = dominantNinthProject({
      soprano: pitch("F", 1, 4),
      alto: pitch("C", 0, 4),
      tenor: pitch("A", -1, 3),
      bass: pitch("A", -1, 2),
    });
    project.chordTrack.regions = [augmentedSixthRegion("italian")];
    const result = diagnosticFor(project, "chord.augmented-sixth-voicing");
    expect(result?.severity).toBe("error");
    expect(result?.chordIds).toEqual(["augmented-sixth-italian"]);
    expect(result?.noteIds).toEqual([]);
  });

  it("D9 九音在离开同和弦范围时级进下行到目标和弦音", () => {
    const target = {
      ...dominantNinthRegion(),
      id: "tonic",
      startTick: PPQ,
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
    } satisfies ChordRegion;
    const legal = twoChordProject(dominantNinthRegion(), target, {
      soprano: [pitch("B", 0, 3), pitch("C", 0, 4)],
      alto: [pitch("A", 0, 3), pitch("G", 0, 3)],
      tenor: [pitch("F", 0, 3), pitch("E", 0, 3)],
      bass: [pitch("G", 0, 2), pitch("C", 0, 3)],
    });
    expect(diagnosticFor(legal, "resolution.dominant-ninth")).toBeUndefined();

    const invalid = twoChordProject(dominantNinthRegion(), target, {
      soprano: [pitch("B", 0, 3), pitch("C", 0, 4)],
      alto: [pitch("A", 0, 3), pitch("B", 0, 3)],
      tenor: [pitch("F", 0, 3), pitch("E", 0, 3)],
      bass: [pitch("G", 0, 2), pitch("C", 0, 3)],
    });
    const result = diagnosticFor(invalid, "resolution.dominant-ninth");
    expect(result?.severity).toBe("warning");
    expect(result?.chordIds).toEqual(["dominant-ninth", "tonic"]);
    expect(result?.noteIds).toEqual(["alto-0", "alto-1"]);
  });

  it("D9 九音状态跨连续同和弦切片传递后再结算", () => {
    const sourceA = dominantNinthRegion();
    sourceA.durationTicks = PPQ / 2;
    const sourceB = {
      ...dominantNinthRegion(),
      id: "dominant-ninth-b",
      startTick: PPQ / 2,
      durationTicks: PPQ / 2,
    };
    const target = {
      ...dominantNinthRegion(),
      id: "tonic-after-span",
      startTick: PPQ,
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
    } satisfies ChordRegion;
    const project = twoChordProject(sourceA, target, {
      soprano: [pitch("B", 0, 3), pitch("C", 0, 4)],
      alto: [pitch("A", 0, 3), pitch("G", 0, 3)],
      tenor: [pitch("F", 0, 3), pitch("E", 0, 3)],
      bass: [pitch("G", 0, 2), pitch("C", 0, 3)],
    });
    project.chordTrack.regions = [sourceA, sourceB, target];
    expect(diagnosticFor(project, "resolution.dominant-ninth")).toBeUndefined();
  });

  it("只对明确标注方向且书写一致的重复变化音报告 D.10", () => {
    const project = dominantNinthProject({
      soprano: pitch("G", 1, 4),
      alto: pitch("G", 1, 3),
      tenor: pitch("E", 0, 3),
      bass: pitch("C", 0, 3),
    });
    project.chordTrack.regions = [
      alteredChordRegion("altered-up", 0, { tendency: "up" }),
    ];
    const result = diagnosticFor(
      project,
      "chord.doubled-altered-tendency-tone",
    );
    expect(result?.severity).toBe("error");
    expect(result?.chordIds).toEqual(["altered-up"]);
    expect(result?.noteIds).toEqual([]);

    project.satbTracks.find((track) => track.id === "soprano")!.notes[0].pitch =
      pitch("A", -1, 4);
    expect(
      diagnosticFor(project, "chord.doubled-altered-tendency-tone"),
    ).toBeUndefined();
  });

  it("D.10 从重属目标识别变化导音，但保留等音拼写差异", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.chordTrack.regions = [
      functionalChord(project, "double-dominant-tendency", 0, {
        degree: 2,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "double-dominant",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
    ];
    setLine(project, "soprano", [pitch("F", 1, 5)]);
    setLine(project, "alto", [pitch("F", 1, 4)]);
    setLine(project, "tenor", [pitch("A", 0, 3)]);
    setLine(project, "bass", [pitch("D", 0, 3)]);
    expect(
      diagnosticFor(project, "chord.doubled-altered-tendency-tone")?.severity,
    ).toBe("error");

    project.satbTracks.find((track) => track.id === "soprano")!.notes[0].pitch =
      pitch("G", -1, 5);
    expect(
      diagnosticFor(project, "chord.doubled-altered-tendency-tone"),
    ).toBeUndefined();
  });

  it("旧 V3 变音未声明方向时保持合法并跳过方向性规则", () => {
    const project = dominantNinthProject({
      soprano: pitch("G", 1, 4),
      alto: pitch("G", 1, 3),
      tenor: pitch("E", 0, 3),
      bass: pitch("C", 0, 3),
    });
    project.chordTrack.regions = [alteredChordRegion("legacy-altered", 0)];
    project.loop.endTick = PPQ;
    expect(validateProject(project)).toBe(true);
    expect(
      diagnosticFor(project, "chord.doubled-altered-tendency-tone"),
    ).toBeUndefined();
    expect(diagnosticFor(project, "resolution.altered-tone")).toBeUndefined();

    const invalid = structuredClone(project) as unknown as ProjectDocument;
    const structure = invalid.chordTrack.regions[0].identity.structure;
    if (structure.kind === "tertian") {
      (structure.alterations[0] as { tendency?: string }).tendency = "either";
    }
    expect(validateProject(invalid)).toBe(false);
  });

  it("明确标注上行的升五音必须上行半音解决到目标和弦音", () => {
    const source = alteredChordRegion("altered-source", 0, {
      tendency: "up",
    });
    const aMinor = triadRegion("a-minor-target", PPQ, "A", "minor");
    const legal = twoChordProject(source, aMinor, {
      soprano: [pitch("C", 0, 4), pitch("C", 0, 4)],
      alto: [pitch("G", 1, 3), pitch("A", 0, 3)],
      tenor: [pitch("E", 0, 3), pitch("E", 0, 3)],
      bass: [pitch("C", 0, 3), pitch("A", 0, 2)],
    });
    expect(diagnosticFor(legal, "resolution.altered-tone")).toBeUndefined();

    const cMajor = triadRegion("c-major-target", PPQ, "C", "major");
    const invalid = twoChordProject(source, cMajor, {
      soprano: [pitch("C", 0, 4), pitch("C", 0, 4)],
      alto: [pitch("G", 1, 3), pitch("G", 0, 3)],
      tenor: [pitch("E", 0, 3), pitch("E", 0, 3)],
      bass: [pitch("C", 0, 3), pitch("C", 0, 3)],
    });
    const result = diagnosticFor(invalid, "resolution.altered-tone");
    expect(result?.severity).toBe("warning");
    expect(result?.chordIds).toEqual(["altered-source", "c-major-target"]);
    expect(result?.noteIds).toEqual(["alto-0", "alto-1"]);
  });

  it("增六两端反向半音解决到属功能或 K46 时通过", () => {
    const makeTarget = (cadential64: boolean) => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      project.loop.endTick = PPQ * 2;
      const target = cadential64
        ? functionalChord(project, "cadential64-target", 1, {
            degree: 1,
            degreeAlteration: 0,
            quality: "major",
            inversion: 2,
            designation: {
              notationSystem: "spasobin",
              kind: "cadential64",
              primaryFunction: "tonic",
            },
            cadenceRole: "cadential64",
            ...manualCertain,
          })
        : functionalChord(project, "dominant-target", 1, {
            degree: 5,
            degreeAlteration: 0,
            quality: "major",
            inversion: 0,
            designation: {
              notationSystem: "spasobin",
              kind: "primary",
              primaryFunction: "dominant",
            },
            ...manualCertain,
          });
      project.chordTrack.regions = [augmentedSixthRegion("italian"), target];
      setLine(project, "soprano", [pitch("F", 1, 4), pitch("G", 0, 4)]);
      setLine(
        project,
        "alto",
        cadential64
          ? [pitch("C", 0, 4), pitch("E", 0, 4)]
          : [pitch("C", 0, 4), pitch("D", 0, 4)],
      );
      setLine(
        project,
        "tenor",
        cadential64
          ? [pitch("C", 0, 3), pitch("C", 0, 3)]
          : [pitch("C", 0, 3), pitch("B", 0, 2)],
      );
      setLine(project, "bass", [pitch("A", -1, 2), pitch("G", 0, 2)]);
      return project;
    };

    const directDominant = makeTarget(false);
    expect(
      diagnosticFor(directDominant, "resolution.augmented-sixth"),
    ).toBeUndefined();
    expect(
      diagnosticFor(directDominant, "connection.italian-augmented-sixth"),
    ).toBeUndefined();
    expect(
      diagnosticFor(makeTarget(true), "resolution.augmented-sixth"),
    ).toBeUndefined();
  });

  it("增六低端未下行到属音时报告跨和弦解决错误", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const target = functionalChord(project, "dominant-target-invalid", 1, {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      designation: {
        notationSystem: "spasobin",
        kind: "primary",
        primaryFunction: "dominant",
      },
      ...manualCertain,
    });
    project.chordTrack.regions = [augmentedSixthRegion("italian"), target];
    setLine(project, "soprano", [pitch("F", 1, 4), pitch("G", 0, 4)]);
    setLine(project, "alto", [pitch("C", 0, 4), pitch("D", 0, 4)]);
    setLine(project, "tenor", [pitch("C", 0, 3), pitch("B", 0, 2)]);
    setLine(project, "bass", [pitch("A", -1, 2), pitch("A", 0, 2)]);

    const result = diagnosticFor(project, "resolution.augmented-sixth");
    expect(result?.severity).toBe("error");
    expect(result?.chordIds).toEqual([
      "augmented-sixth-italian",
      "dominant-target-invalid",
    ]);
    expect(result?.noteIds).toContain("bass-0");
    expect(result?.noteIds).toContain("bass-1");
  });

  it("旧式 T46 终止角色连接无显式标记的 D7 时通过", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.loop.endTick = PPQ * 3;
    project.chordTrack.regions = [
      functionalChord(project, "subdominant-sixth", 0, {
        degree: 4,
        degreeAlteration: 0,
        quality: "major",
        inversion: 1,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "subdominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "legacy-tonic-64", 1, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 2,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "tonic",
        },
        cadenceRole: "cadential64",
        ...manualCertain,
      }),
      functionalChord(project, "inferred-dominant-7", 2, {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 0,
        ...manualCertain,
      }),
    ];
    setLine(project, "soprano", [
      pitch("F", 0, 4),
      pitch("G", 0, 4),
      pitch("G", 0, 4),
    ]);
    setLine(project, "alto", [
      pitch("C", 0, 4),
      pitch("E", 0, 4),
      pitch("F", 0, 4),
    ]);
    setLine(project, "tenor", [
      pitch("F", 0, 3),
      pitch("C", 0, 4),
      pitch("B", 0, 3),
    ]);
    setLine(project, "bass", [
      pitch("A", 0, 2),
      pitch("G", 0, 2),
      pitch("G", 0, 2),
    ]);

    const analysis = buildHarmonyAnalysis(project, 1);
    expect(analysis.connections[1]).toMatchObject({
      relation: "cadential64-target",
      targetMatched: true,
    });
    expect(
      diagnosticFor(project, "function.cadential64-target"),
    ).toBeUndefined();
    expect(
      diagnosticFor(project, "connection.second-inversion-context"),
    ).toBeUndefined();
  });

  it("终止四六允许属音低音跨八度进入属和弦", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions = [
      functionalChord(project, "subdominant-sixth", 0, {
        degree: 4,
        degreeAlteration: 0,
        quality: "major",
        inversion: 1,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "subdominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "cadential64-octave", 1, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 2,
        designation: {
          notationSystem: "spasobin",
          kind: "cadential64",
          primaryFunction: "dominant",
        },
        cadenceRole: "cadential64",
        ...manualCertain,
      }),
      functionalChord(project, "dominant-octave", 2, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
    ];
    setLine(project, "bass", [
      pitch("A", 0, 2),
      pitch("G", 0, 2),
      pitch("G", 0, 3),
    ]);

    expect(
      diagnosticFor(project, "connection.second-inversion-context"),
    ).toBeUndefined();
  });

  it("四六语境错误只标记四六和弦自身的低音", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions = [
      functionalChord(project, "subdominant", 0, {
        degree: 4,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "subdominant",
        },
        ...manualCertain,
      }),
      functionalChord(project, "cadential64", 1, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 2,
        designation: {
          notationSystem: "spasobin",
          kind: "cadential64",
          primaryFunction: "dominant",
        },
        cadenceRole: "cadential64",
        ...manualCertain,
      }),
      functionalChord(project, "dominant", 2, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      }),
    ];
    setLine(project, "bass", [
      pitch("C", 0, 3),
      pitch("G", 0, 2),
      pitch("A", 0, 2),
    ]);

    const result = diagnosticFor(project, "connection.second-inversion-context");
    expect(result?.noteIds).toEqual(["bass-0", "bass-1", "bass-2"]);
    expect(result?.subjects).toMatchObject({
      origin: { noteIds: ["bass-1"] },
      context: { noteIds: ["bass-0", "bass-2"] },
    });
  });

  it("Fr+6 增六两端反向解决时由通用规则判断合规", () => {
    const makeProject = (targetTenor: SpelledPitch) => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      const target = functionalChord(project, "french-dominant", 1, {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      });
      project.chordTrack.regions = [augmentedSixthRegion("french"), target];
      setLine(project, "soprano", [pitch("F", 1, 4), pitch("G", 0, 4)]);
      setLine(project, "alto", [pitch("C", 0, 4), pitch("B", 0, 3)]);
      setLine(project, "tenor", [pitch("D", 0, 4), targetTenor]);
      setLine(project, "bass", [pitch("A", -1, 2), pitch("G", 0, 2)]);
      return project;
    };
    expect(
      diagnosticFor(
        makeProject(pitch("D", 0, 3)),
        "resolution.augmented-sixth",
      ),
    ).toBeUndefined();
  });

  it("Ger+6 经 K46 时仍按同声部由通用增六规则检查两端", () => {
    const makeProject = (targetSoprano: SpelledPitch) => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      const target = functionalChord(project, "german-cadential64", 1, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 2,
        designation: {
          notationSystem: "spasobin",
          kind: "cadential64",
          primaryFunction: "tonic",
        },
        cadenceRole: "cadential64",
        ...manualCertain,
      });
      project.chordTrack.regions = [augmentedSixthRegion("german"), target];
      setLine(project, "soprano", [pitch("F", 1, 4), targetSoprano]);
      setLine(project, "alto", [pitch("C", 0, 4), pitch("C", 0, 4)]);
      setLine(project, "tenor", [pitch("E", -1, 3), pitch("E", 0, 3)]);
      setLine(project, "bass", [pitch("A", -1, 2), pitch("G", 0, 2)]);
      return project;
    };
    expect(
      diagnosticFor(
        makeProject(pitch("G", 0, 4)),
        "resolution.augmented-sixth",
      ),
    ).toBeUndefined();
    expect(
      diagnosticFor(
        makeProject(pitch("F", 0, 4)),
        "resolution.augmented-sixth",
      )?.severity,
    ).toBe("error");
  });

  it("Ger+6 直入 D 的真实平行五度只由基础规则报错", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    const target = functionalChord(project, "german-direct-dominant", 1, {
      degree: 5,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      designation: {
        notationSystem: "spasobin",
        kind: "primary",
        primaryFunction: "dominant",
      },
      ...manualCertain,
    });
    project.chordTrack.regions = [augmentedSixthRegion("german"), target];
    setLine(project, "soprano", [pitch("F", 1, 4), pitch("G", 0, 4)]);
    setLine(project, "alto", [pitch("C", 0, 4), pitch("B", 0, 3)]);
    setLine(project, "tenor", [pitch("E", -1, 3), pitch("D", 0, 3)]);
    setLine(project, "bass", [pitch("A", -1, 2), pitch("G", 0, 2)]);

    expect(
      diagnosticFor(project, "voice-leading.parallel-fifths")?.severity,
    ).toBe("error");
    expect(
      diagnosticFor(project, "connection.german-augmented-sixth"),
    ).toBeUndefined();
  });

  it("只有人工标注的 D→TSVI 才进入阻碍进行规则", () => {
    const unmarked = deceptiveProject({
      marked: false,
      target: "submediant",
      doubleThird: false,
    });
    expect(
      diagnosticFor(unmarked, "function.deceptive-cadence-target"),
    ).toBeUndefined();
    expect(
      diagnosticFor(unmarked, "connection.deceptive-voice-leading"),
    ).toBeUndefined();

    const marked = deceptiveProject({
      marked: true,
      target: "submediant",
      doubleThird: true,
    });
    expect(validateProject(marked)).toBe(true);
    expect(
      diagnosticFor(marked, "function.deceptive-cadence-target"),
    ).toBeUndefined();
    expect(
      diagnosticFor(marked, "connection.deceptive-voice-leading"),
    ).toBeUndefined();
  });

  it("人工阻碍标注未进入 TSVI 时报告功能目标错误", () => {
    const project = deceptiveProject({
      marked: true,
      target: "tonic",
    });
    const result = diagnosticFor(project, "function.deceptive-cadence-target");
    expect(result?.severity).toBe("warning");
    expect(result?.chordIds).toEqual(["deceptive-dominant", "plain-tonic"]);
  });

  it("阻碍进行的 TSVI 未重复三音时不强制阻断，避免死板误报", () => {
    const project = deceptiveProject({
      marked: true,
      target: "submediant",
      doubleThird: false,
    });
    expect(
      diagnosticFor(project, "connection.deceptive-voice-leading"),
    ).toBeUndefined();
  });

  it("同主大小调借用按声明来源重建根音与三和弦性质", () => {
    const majorProject = createEmptyProject();
    majorProject.lengthTicks = PPQ;
    majorProject.chordTrack.regions = [
      functionalChord(majorProject, "borrowed-flat-six", 0, {
        degree: 6,
        degreeAlteration: -1,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "side-degree",
          primaryFunction: "tonic",
          secondaryFunction: "dominant",
        },
        mixture: "parallel-minor",
        ...manualCertain,
      }),
    ];
    expect(
      diagnosticFor(majorProject, "tonality.mixture-source"),
    ).toBeUndefined();

    const wrongSource = structuredClone(majorProject);
    wrongSource.chordTrack.regions[0].semantics!.mixture = "parallel-major";
    const mismatch = diagnosticFor(wrongSource, "tonality.mixture-source");
    expect(mismatch?.severity).toBe("error");
    expect(mismatch?.chordIds).toEqual(["borrowed-flat-six"]);

    wrongSource.chordTrack.regions[0].semantics!.mixture = "modal";
    expect(
      diagnosticFor(wrongSource, "tonality.mixture-source"),
    ).toBeUndefined();
  });

  it("小调中的同主大调 IV 级借用通过来源检查", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.keyEvents[0].mode = "minor";
    project.chordTrack.regions = [
      functionalChord(project, "borrowed-major-four", 0, {
        degree: 4,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "subdominant",
        },
        mixture: "parallel-major",
        ...manualCertain,
      }),
    ];
    expect(diagnosticFor(project, "tonality.mixture-source")).toBeUndefined();
  });

  it("功能解释与实体一致时不报告防御性冲突", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.chordTrack.regions = [
      functionalChord(project, "tonic", 0, {
        degree: 1,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "primary",
          primaryFunction: "tonic",
        },
        ...manualCertain,
      }),
    ];

    expect(
      diagnosticFor(project, "chord.interpretation-identity-conflict"),
    ).toBeUndefined();
  });

  it("损坏的功能解释与实体组合报告和弦级冲突", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    const chord = functionalChord(project, "corrupt-tonic", 0, {
      degree: 1,
      degreeAlteration: 0,
      quality: "major",
      inversion: 0,
      designation: {
        notationSystem: "spasobin",
        kind: "primary",
        primaryFunction: "tonic",
      },
      ...manualCertain,
    });
    chord.identity = {
      ...chord.identity,
      root: { step: "D", alter: 0 },
    };
    project.chordTrack.regions = [chord];

    const result = diagnosticFor(
      project,
      "chord.interpretation-identity-conflict",
    );
    expect(result?.severity).toBe("error");
    expect(result?.chordIds).toEqual(["corrupt-tonic"]);
    expect(result?.noteIds).toEqual([]);
  });

  it("重属进入属功能或终止四六时通过，进入主功能时报错", () => {
    const makeProject = (target: "dominant" | "cadential64" | "tonic") => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      const doubleDominant = functionalChord(project, "double-dominant", 0, {
        degree: 2,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "double-dominant",
          primaryFunction: "dominant",
        },
        ...manualCertain,
      });
      const next =
        target === "dominant"
          ? functionalChord(project, "dominant", 1, {
              degree: 5,
              degreeAlteration: 0,
              quality: "major",
              inversion: 0,
              designation: {
                notationSystem: "spasobin",
                kind: "primary",
                primaryFunction: "dominant",
              },
              ...manualCertain,
            })
          : target === "cadential64"
            ? functionalChord(project, "cadential64", 1, {
                degree: 1,
                degreeAlteration: 0,
                quality: "major",
                inversion: 2,
                designation: {
                  notationSystem: "spasobin",
                  kind: "cadential64",
                  primaryFunction: "tonic",
                },
                cadenceRole: "cadential64",
                ...manualCertain,
              })
            : functionalChord(project, "tonic", 1, {
                degree: 1,
                degreeAlteration: 0,
                quality: "major",
                inversion: 0,
                designation: {
                  notationSystem: "spasobin",
                  kind: "primary",
                  primaryFunction: "tonic",
                },
                ...manualCertain,
              });
      project.chordTrack.regions = [doubleDominant, next];
      return project;
    };

    expect(
      diagnosticFor(makeProject("dominant"), "function.double-dominant-target"),
    ).toBeUndefined();
    expect(
      diagnosticFor(
        makeProject("cadential64"),
        "function.double-dominant-target",
      ),
    ).toBeUndefined();
    const invalid = diagnosticFor(
      makeProject("tonic"),
      "function.double-dominant-target",
    );
    expect(invalid?.severity).toBe("warning");
    expect(invalid?.chordIds).toEqual(["double-dominant", "tonic"]);
  });

  it("工程规则配置会规范化、持久化并覆盖目录默认值", () => {
    const project = createEmptyProject();
    setBuiltinRuleSeverity(project, "voice.range", "suggestion");
    setBuiltinRuleConfig(project, "voice.range", {
      soprano: { minMidi: 58, maxMidi: 84 },
    });
    setBuiltinRuleException(
      project,
      "voice-leading.unequal-fifths-inner-diminished-to-perfect",
      { "bass-step-up": "strict" },
    );

    const serialized = JSON.parse(JSON.stringify(project));
    expect(validateProject(serialized)).toBe(true);
    const resolved = resolveBuiltinRuleProfile(serialized);
    expect(resolved.severities["voice.range"]).toBe("suggestion");
    expect(resolved.configs["voice.range"]).toMatchObject({
      soprano: { minMidi: 58, maxMidi: 84 },
      alto: { minMidi: 55, maxMidi: 74 },
    });
    expect(
      resolved.exceptions[
        "voice-leading.unequal-fifths-inner-diminished-to-perfect"
      ]?.["bass-step-up"],
    ).toBe("strict");
  });

  it("损坏或颠倒的音域配置回退到规则默认值", () => {
    const project = createEmptyProject();
    project.ruleProfile.shared.voiceRanges.soprano = {
      minMidi: 100,
      maxMidi: 40,
    };
    const range = resolveBuiltinRuleProfile(project).configs["voice.range"];
    expect(range).toMatchObject({
      soprano: { minMidi: 60, maxMidi: 81 },
      alto: { minMidi: 55, maxMidi: 74 },
    });
  });

  it("自定义音域会立即改变音域规则结论", () => {
    const project = createEmptyProject();
    setLine(project, "soprano", [spellMidi(58)]);
    const severities = defaultHarmonyRuleSeverities();
    expect(
      checkHarmony(project, severities).diagnostics.some(
        (item) => item.ruleId === "voice.range",
      ),
    ).toBe(true);
    expect(
      checkHarmony(project, severities, {
        "voice.range": { soprano: { minMidi: 58, maxMidi: 81 } },
      }).diagnostics.some((item) => item.ruleId === "voice.range"),
    ).toBe(false);
  });
});
