import { describe, expect, it } from "vitest";
import {
  chordDraftFromIdentity,
  chordIdentityEquals,
  chordIdentityToneSpellings,
  chordVoicingPolicy,
  functionalTargetForDegree,
  resolveChordIdentity,
  semanticsFromChordDraft,
  type ChordDraft,
} from "./chordModel";
import { createChordRegion, formatChord, formatChordIdentity } from "./chords";
import { checkHarmony } from "./harmony";
import {
  FUNCTIONAL_BASE_DEFINITIONS,
  applyCadenceRole,
  applyFunctionalDefinition,
  applyFunctionalForm,
  applyFunctionalTarget,
  compatibleFunctionalInterpretations,
  functionalDefinition,
  type FunctionalBaseId,
  type FunctionalChordForm,
} from "./functionalHarmonyCatalog";
import { createEmptyProject, PPQ, validateProject } from "./project";
import { chordDraft } from "./scoreText/chords";

const C_MAJOR = {
  id: "c-major",
  tick: 0,
  tonic: { step: "C" as const, alter: 0 as const },
  mode: "major" as const,
};

function baseDraft(): ChordDraft {
  return {
    degree: 1,
    degreeAlteration: 0,
    quality: "major",
    extensions: [],
    alterations: [],
    inversion: 0,
    source: "manual",
    confidence: "certain",
  };
}

function functionalDraft(
  id: FunctionalBaseId,
  form?: FunctionalChordForm,
  inversion?: ChordDraft["inversion"],
) {
  const definition = functionalDefinition(id);
  let draft = applyFunctionalDefinition(baseDraft(), definition, "major");
  if (form) draft = applyFunctionalForm(draft, definition, form, "major");
  return inversion === undefined ? draft : { ...draft, inversion };
}

describe("斯波索宾功能标记目录", () => {
  it("按实际调式区分导音、自然七级和副属目标的导音", () => {
    const key = { ...C_MAJOR, mode: "minor" as const };
    const rootFor = (symbol: string, context: typeof key | typeof C_MAJOR = key) =>
      resolveChordIdentity(chordDraft(symbol, context.mode), context).root;
    expect(rootFor("DVII7")).toEqual({ step: "B", alter: 0 });
    expect(rootFor("VII")).toEqual({ step: "B", alter: -1 });
    expect(rootFor("DVII7", C_MAJOR)).toEqual({ step: "B", alter: 0 });
    const applied = chordDraft("DVII65/II", key.mode);
    expect(resolveChordIdentity(applied, key).root).toEqual({ step: "C", alter: 1 });
    expect(resolveChordIdentity(applyFunctionalTarget(applied, undefined, key.mode), key).root)
      .toEqual({ step: "B", alter: 0 });
  });

  it("基础三和弦、七和弦和复合功能生成唯一三种名称", () => {
    expect(formatChord(functionalDraft("T"), C_MAJOR)).toMatchObject({
      functional: "T",
      roman: "I",
      absolute: "C",
    });
    expect(
      formatChord(functionalDraft("T", "triad", 1), C_MAJOR),
    ).toMatchObject({
      functional: "T6",
      roman: "I6",
      absolute: "C/E",
    });
    expect(
      formatChord(functionalDraft("D", "seventh", 1), C_MAJOR),
    ).toMatchObject({
      functional: "D56",
      roman: "V6/5",
      absolute: "G7/B",
    });
    expect(
      formatChord(functionalDraft("D", "seventh", 2), C_MAJOR),
    ).toMatchObject({
      functional: "D34",
      roman: "V4/3",
      absolute: "G7/D",
    });
    expect(formatChord(functionalDraft("DTIII"), C_MAJOR).functional).toBe(
      "DTIII",
    );
    expect(formatChord(functionalDraft("TSVI"), C_MAJOR).functional).toBe(
      "TSVI",
    );
  });

  it("T46 与 K46 共享实体但保留不同语义", () => {
    const tonic64 = functionalDraft("T", "triad", 2);
    const cadential64 = functionalDraft("K46");
    const tonicIdentity = resolveChordIdentity(tonic64, C_MAJOR);
    const cadentialIdentity = resolveChordIdentity(cadential64, C_MAJOR);

    expect(chordIdentityEquals(tonicIdentity, cadentialIdentity)).toBe(true);
    expect(formatChord(tonic64, C_MAJOR).functional).toBe("T46");
    expect(formatChord(cadential64, C_MAJOR).functional).toBe("K46");
  });

  it("统一终止四六编辑结果并兼容旧式矛盾语义", () => {
    const legacy = {
      ...functionalDraft("T", "triad", 2),
      cadenceRole: "cadential64" as const,
    };
    const normalized = applyCadenceRole(
      functionalDraft("T"),
      "cadential64",
      "major",
    );

    expect(formatChord(legacy, C_MAJOR).functional).toBe("K46");
    expect(normalized).toMatchObject({
      degree: 1,
      inversion: 2,
      designation: {
        kind: "cadential64",
        primaryFunction: "dominant",
      },
      cadenceRole: "cadential64",
    });
  });

  it("离调目标和重属使用结构化目标而不是名称字符串", () => {
    const applied = applyFunctionalTarget(
      functionalDraft("D", "seventh"),
      functionalTargetForDegree(2),
    );
    expect(formatChord(applied, C_MAJOR)).toMatchObject({
      functional: "D7->SII",
      roman: "V7/II",
      absolute: "A7",
    });
    expect(formatChord(functionalDraft("DD"), C_MAJOR)).toMatchObject({
      functional: "DD",
      roman: "V/V",
      absolute: "D",
    });
  });

  it("N6 与三种增六和弦保留实际书写拼写", () => {
    expect(formatChord(functionalDraft("N6"), C_MAJOR)).toMatchObject({
      functional: "N6",
      roman: "♭II6",
      absolute: "D♭/F",
    });
    const expected = {
      "It+6": ["A♭", "C", "F♯"],
      "Fr+6": ["A♭", "C", "D", "F♯"],
      "Ger+6": ["A♭", "C", "E♭", "F♯"],
    } as const;
    for (const id of ["It+6", "Fr+6", "Ger+6"] as const) {
      const draft = functionalDraft(id);
      const identity = resolveChordIdentity(draft, C_MAJOR);
      expect(formatChord(draft, C_MAJOR).functional).toBe(id);
      expect(
        chordIdentityToneSpellings(identity).map(
          (pitch) =>
            `${pitch.step}${pitch.alter === -1 ? "♭" : pitch.alter === 1 ? "♯" : ""}`,
        ),
      ).toEqual(expected[id]);
    }
  });

  it("D9 固定原位并把省略五音表示为配器策略", () => {
    const draft = functionalDraft("D", "ninth");
    const identity = resolveChordIdentity(draft, C_MAJOR);
    expect(formatChord(draft, C_MAJOR)).toMatchObject({
      functional: "D9",
      roman: "V9",
      absolute: "G9",
    });
    expect(chordVoicingPolicy(identity)).toMatchObject({
      requiredDegrees: [1, 3, 7, 9],
      permittedDegrees: [1, 3, 7, 9],
      forbiddenDegrees: [5],
    });
  });

  it("D7 配器策略允许省略五音", () => {
    const identity = resolveChordIdentity(
      functionalDraft("D", "seventh"),
      C_MAJOR,
    );
    expect(chordVoicingPolicy(identity)).toMatchObject({
      requiredDegrees: [1, 3, 7],
      permittedDegrees: [1, 3, 5, 7],
      forbiddenDegrees: [],
    });
  });

  it("共同和弦同时格式化两个确认解释并可完整持久化", () => {
    const draft: ChordDraft = {
      ...functionalDraft("T"),
      secondaryInterpretation: {
        id: "pivot-g-major",
        localKey: { tonic: { step: "G", alter: 0 }, mode: "major" },
        degree: 4,
        degreeAlteration: 0,
        designation: functionalDefinition("S").designation,
        source: "confirmed",
        confidence: "ambiguous",
      },
      pedalContext: {
        pitch: { step: "C", alter: 0 },
        role: "continue",
      },
    };
    const identity = resolveChordIdentity(draft, C_MAJOR);
    const semantics = semanticsFromChordDraft(draft);
    expect(formatChordIdentity(identity, semantics)).toMatchObject({
      functional: "T = S",
      roman: "I = IV",
    });

    const project = createEmptyProject();
    project.chordTrack.regions.push({
      id: "pivot",
      startTick: 0,
      durationTicks: PPQ,
      identity,
      semantics,
      locked: false,
    });
    expect(validateProject(JSON.parse(JSON.stringify(project)))).toBe(true);
  });

  it("共同和弦候选只返回可映射为同一实体的调性与功能", () => {
    const identity = resolveChordIdentity(functionalDraft("T"), C_MAJOR);
    const candidates = compatibleFunctionalInterpretations(identity);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          baseId: "S",
          localKey: {
            tonic: { step: "G", alter: 0 },
            mode: "major",
          },
        }),
      ]),
    );
    expect(
      candidates.every((candidate) => {
        const semantics = {
          interpretations: [candidate.interpretation],
          primaryInterpretationId: candidate.interpretation.id,
        };
        return chordIdentityEquals(
          resolveChordIdentity(
            chordDraftFromIdentity(identity, semantics),
            candidate.localKey,
          ),
          identity,
        );
      }),
    ).toBe(true);
  });

  it("旧检查器跳过 D9 与增六和弦，不伪造构成音诊断", () => {
    for (const draft of [
      functionalDraft("D", "ninth"),
      functionalDraft("Ger+6"),
    ]) {
      const project = createEmptyProject();
      project.lengthTicks = PPQ;
      project.chordTrack.regions = [
        createChordRegion(project, 0, PPQ, draft, "unsupported-chord"),
      ];
      project.satbTracks[0].notes = [
        {
          id: "outside",
          startTick: 0,
          durationTicks: PPQ,
          pitch: { step: "C", alter: 1, octave: 5 },
          velocity: 88,
          locked: false,
          spellingSource: "manual",
        },
      ];
      expect(
        checkHarmony(project).diagnostics.some(
          (diagnostic) =>
            diagnostic.ruleId === "chord.unclassified-nonchord-tone" &&
            diagnostic.chordIds.includes("unsupported-chord"),
        ),
      ).toBe(false);
    }
  });

  it("注册表 ID 唯一且不包含 D 范围扩展", () => {
    const ids = FUNCTIONAL_BASE_DEFINITIONS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toEqual(expect.arrayContaining(["D11", "D13"]));
  });
});
