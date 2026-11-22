import { describe, expect, it } from "vitest";
import { parsePitchClass, type SpelledPitch } from "../../../../pitch";
import {
  createEmptyProject,
  PPQ,
  type ChordRegion,
  type NonChordToneRole,
  type VoiceId,
} from "../../../../project";
import { compileScoreText } from "../../../../scoreText";
import { buildHarmonyAnalysis } from "../../../analysis";
import { applyHarmonyInference, inferHarmony } from "../../../inference";
import { checkHarmony } from "../../../registry";
import {
  diagnosticFor,
  dominantNinthProject,
  functionalChord,
  manualCertain,
  pitch,
  setLine,
} from "../../../testing/fixtures/ruleProjects";
import { createHarmonyRuleContext } from "../../context/createRuleContext";
import { augmentedSixthResolutionRule } from "../connection";
import { isGermanToFrenchVoicing, isItalianToFrenchVoicing } from "../support/augmentedSixth";

describe("德式、意式到法式增六的延续", () => {
  const progression = `satb 1
key C minor
meter 3/4
bars 1..1 {
 S: | Eb5/4 D5/4 D5/4 |
 A: | C5/2 B4/4 |
 T: | F#4/2 G4/4 |
 B: | Ab2/2 G2/4 |
 H: | Ger+6/4 Fr+6/4 V/4 |
}`;

  function errors(score: string) {
    const { project } = compileScoreText(score);
    return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.augmented-sixth")
      .map(item => [item.tick, item.severity]);
  }

  describe("德增六先转为法增六再解决", () => {
    it("只有五音下行半音时，两端的解决由后续连接检验", () => {
      expect(errors(progression)).toEqual([]);
      expect(errors(progression.replace("F#4/2 G4/4", "F#4/2 F4/4"))).toEqual([[1920, "error"]]);
    });

    it.each([
      ["高端保持在错误八度", progression.replace("F#4/2 G4/4", "F#4/4 F#3/4 G3/4")],
      ["只有法增六标签，五音没有下行", progression.replace("Eb5/4 D5/4", "Eb5/4 Eb5/4")],
      ["半音下行但改到错误的八度", progression.replace("Eb5/4 D5/4", "Eb5/4 D4/4")],
      ["将源五音同响异名改写", progression.replace("Eb5", "D#5")],
      ["没有后继和声", progression.replace(" V/4", " r/4")],
    ])("%s 仍保留错误", (_title, score) => {
      expect(errors(score)).toContainEqual([960, "error"]);
    });
  });

  const italian = progression.replace("Eb5/4 D5/4", "C5/4 D5/4").replace("Ger+6/4", "It+6/4");

  describe("意式增六补入二级后连续成为法式", () => {
    it("两端和另一主音持续，只有重复主音上行二度", () => {
      expect(errors(italian)).toEqual([]);
      expect(errors(italian.replace("F#4/2 G4/4", "F#4/2 F4/4"))).toEqual([[1920, "error"]]);
    });

    it.each([
      ["一个端点同音重奏", italian.replace("F#4/2 G4/4", "F#4/4 F#4/4 G4/4")],
      ["移动的主音跳八度再到二级", italian.replace("C5/4 D5/4", "C5/4 D4/4")],
      ["法式缺少新加入的二级", italian.replace("C5/4 D5/4", "C5/4 Eb5/4")],
      ["后续和弦缺失", italian.replace(" V/4", " r/4")],
    ])("%s 保留变体交界报警", (_title, score) => {
      expect(errors(score)).toContainEqual([960, "error"]);
    });
  });

  describe("法式延续的共享证据和各自的持续要求", () => {
    it("德式允许同写重奏，意式要求另三个声部持续为原音符", () => {
      const reattack = (score: string) => score
        .replace("Ab2/2 G2/4", "Ab2/4 Ab2/4 G2/4")
        .replace("F#4/2 G4/4", "F#4/4 F#4/4 G4/4")
        .replace("C5/2 B4/4", "C5/4 C5/4 B4/4");
      expect(errors(reattack(progression))).toEqual([]);
      expect(errors(reattack(italian))).toEqual([[960, "error"]]);
    });

    it.each([
      ["同调号的另一个调性事件", (project: ReturnType<typeof compileScoreText>["project"]) => {
        project.keyEvents.push({ ...project.keyEvents[0], id: "next-key", tick: project.ppq });
      }],
      ["交界有明确句界", (project: ReturnType<typeof compileScoreText>["project"]) => {
        project.structure.phraseBoundaries.push({
          id: "split", tick: project.ppq, source: "manual", confidence: "certain",
        });
      }],
      ["实际低音使用降六级的等音写法", (project: ReturnType<typeof compileScoreText>["project"]) => {
        project.satbTracks.find(track => track.voice === "bass")!.notes[0].pitch = { step: "G", alter: 1, octave: 2 };
      }],
    ] as const)("%s 时两条路径均不成立", (_name, separate) => {
      for (const [score, admits] of [[progression, isGermanToFrenchVoicing], [italian, isItalianToFrenchVoicing]] as const) {
        const { project } = compileScoreText(score);
        separate(project);
        const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
        const before = context.sliceAt(0)!;
        const after = context.sliceAt(project.ppq)!;
        expect(admits(context, before, after, before.key)).toBe(false);
      }
    });
  });
});

describe("增六和弦的配置与连接规则", () => {
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

  describe("增六和弦的配置与解决", () => {
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
  });
});

describe("句末辅助法增六的回归", () => {
  interface Example {
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    harmony?: string;
    continuing?: boolean;
    boundaryBeat?: number;
  }

  function exampleProject({
    soprano = "B4/2.",
    alto = "D4/4 C#4/4 D4/4",
    tenor = "F#3/4 E#3/4 F#3/4",
    bass = "B2/4 G2/4 B2/4",
    harmony = "i/4 Fr+6/4 i/4",
    continuing = false,
    boundaryBeat,
  }: Example = {}) {
    const { project } = compileScoreText(`satb 1
key B minor
meter 3/4
bars 1..${continuing ? 2 : 1} {
 S: | ${soprano} | ${continuing ? "B4/2. |" : ""}
 A: | ${alto} | ${continuing ? "G4/2. |" : ""}
 T: | ${tenor} | ${continuing ? "E4/2. |" : ""}
 B: | ${bass} | ${continuing ? "E3/2. |" : ""}
 H: | ${harmony} | ${continuing ? "iv/2. |" : ""}
}`);
    if (boundaryBeat !== undefined) {
      project.structure.phraseBoundaries.push({
        id: "test-boundary", tick: boundaryBeat * project.ppq, source: "manual", confidence: "certain",
      });
    }
    return project;
  }

  function resolutionErrors(project: ReturnType<typeof exampleProject>) {
    return checkHarmony(project).diagnostics.filter(diagnostic =>
      diagnostic.ruleId === "resolution.augmented-sixth" && diagnostic.severity === "error",
    );
  }

  describe("第30章句末辅助法增六", () => {
    it("法增六后回到原位小主和弦，内声部回原音、低音回原八度", () => {
      expect(resolutionErrors(exampleProject())).toEqual([]);
    });

    it("6/8 单个经过低音之后仍可辨认前一主和弦和完整回归", () => {
      const { project } = compileScoreText(`satb 1
key F# minor
meter 6/8
bars 1..1 {
 S: | F#5/2. |
 A: | A4/4 G#4/8 A4/4. |
 T: | C#4/4 B#3/8 C#4/4. |
 B: | F#2/8 E2/8 D2/8 F#2/4. |
 H: | i/8 r/8 Fr+6/8 i/4. |
}`);
      expect(resolutionErrors(project)).toEqual([]);
    });

    it("中途位置只有存在明确的句末边界才作为补充终止", () => {
      expect(resolutionErrors(exampleProject({ continuing: true, boundaryBeat: 3 }))).toEqual([]);
      expect(resolutionErrors(exampleProject({ continuing: true }))).toHaveLength(1);
    });

    it.each([false, true])("没有 endBoundary 时，继续发声=%s", continuing => {
      const project = exampleProject({ continuing, boundaryBeat: 3 });
      const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
      const result = augmentedSixthResolutionRule({
        ...context,
        phraseAt(tick) {
          const phrase = context.phraseAt(tick);
          return phrase && { ...phrase, endBoundary: undefined };
        },
      });
      expect(result).toHaveLength(continuing ? 1 : 0);
    });

    it.each<[string, Example]>([
      ["前一拍的主三和弦没有真实发全", { alto: "C#4/4 C#4/4 D4/4" }],
      ["没有主和弦锚点，只有相同音响", { harmony: "r/4 Fr+6/4 i/4" }],
      ["低音错八度返回", { bass: "B2/4 G2/4 B1/4" }],
      ["高端返回的是属音的另一八度", { tenor: "F#3/4 E#3/4 F#2/4", bass: "B1/4 G1/4 B1/4" }],
      ["高端的属音由别的声部接手", { alto: "D4/4 C#4/4 F#4/4", tenor: "F#3/4 E#3/4 D4/4" }],
      ["没有同声部保持共同主音", { soprano: "B4/2 D5/4", alto: "D4/4 C#4/4 B3/4" }],
      ["落点标为主和弦第一转位", { harmony: "i/4 Fr+6/4 i6/4" }],
      ["法增六的二级被同响音改写", { alto: "D4/4 Db4/4 D4/4" }],
      ["法增六另一个声部缺少应有构成音", { alto: "D4/4 D4/4 D4/4" }],
      ["增六变体是德增六", { harmony: "i/4 Ger+6/4 i/4", alto: "D4/2." }],
      ["增六到主和弦之间另有分句", { boundaryBeat: 2 }],
    ])("%s 时保留解决错误", (_label, example) => {
      const project = exampleProject(example);
      expect(resolutionErrors(project)).toEqual([expect.objectContaining({
        tick: 2 * project.ppq,
        params: expect.objectContaining({ target: "other" }),
      })]);
    });

    it.each([
      ["V", "B4/2 A#4/4", "D4/4 C#4/2", "C#3"],
      ["K46", "B4/2.", "D4/4 C#4/4 D4/4", "B3"],
    ])("常规趋向 %s 时仍要求原高端按半音解决", (target, soprano, alto, wrongArrival) => {
      const example = {
        soprano, alto, tenor: "F#3/4 E#3/4 F#3/4", bass: "B2/4 G2/4 F#2/4",
        harmony: `i/4 Fr+6/4 ${target}/4`,
      };
      expect(resolutionErrors(exampleProject(example))).toEqual([]);
      const broken = exampleProject({ ...example, tenor: `F#3/4 E#3/4 ${wrongArrival}/4` });
      expect(resolutionErrors(broken)).toEqual([expect.objectContaining({
        tick: 2 * broken.ppq,
        message: expect.stringContaining("增六高端未上行半音到属音"),
        params: expect.objectContaining({ target: target === "V" ? "D" : target, lowDelta: -1 }),
      })]);
      const octaveDisplaced = exampleProject({ ...example, bass: "B2/4 G2/4 F#1/4" });
      expect(resolutionErrors(octaveDisplaced)).toEqual([expect.objectContaining({
        tick: 2 * octaveDisplaced.ppq,
        message: expect.stringContaining("增六低端未下行半音到属音"),
        params: expect.objectContaining({ lowDelta: -13, highDelta: 1 }),
      })]);
    });
  });
});

describe("辅助倍增三四解决回主和弦", () => {
  const closingReturn = `satb 1
key F# major
meter 4/4
bars 1..1 {
 S: | G#4/4 F#4/2. |
 A: | E#4/4 C#4/4 B#3/4 C#4/4 |
 T: | B3/4 A#3/4 G##3/4 A#3/4 |
 B: | C#3/4 F#3/4 D3/4 F#3/4 |
 H: | D7/4 T/4 DD++43/4 T/4 |
}`;

  const transposedReturn = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | C5/2. |
 A: | G4/4 F#4/4 G4/4 |
 T: | E4/4 D#4/4 E4/4 |
 B: | C3/4 Ab2/4 C3/4 |
 H: | T/4 DD++43/4 T/4 |
}`;

  const descendingGermanEnd = `satb 1
key D minor
meter 4/4
bars 1..1 {
 S: | D5/4 D5/4 C#5/4 D5/4 |
 A: | G4/4 G#4/4 G4/4 F4/4 |
 T: | D4/4 F4/4 E4/4 D4/4 |
 B: | Bb2/4 Bb2/4 A2/4 D3/4 |
 H: | iv6/4 Ger+6/4 V7/4 i/4 |
}`;

  function inferFromNotes(notation: string) {
    const { project } = compileScoreText(notation.replace(/\n H:.*/, ""));
    return applyHarmonyInference(project, inferHarmony(project), {
      mode: "replace-unlocked",
      writeNonChordToneRoles: true,
    }).project;
  }

  type Project = ReturnType<typeof compileScoreText>["project"];

  function errors(project: Project) {
    return checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "resolution.augmented-sixth" && item.severity === "error",
    );
  }

  describe("实写增六的句末辅助性回归", () => {
    it("黄虎威第30章书面5末尾的倍增三四，盲推和给定均读为辅助回主", () => {
      for (const project of [inferFromNotes(closingReturn), compileScoreText(closingReturn).project]) {
        expect(buildHarmonyAnalysis(project).slices.map(slice => slice.chord?.identity.structure)).toEqual([
          expect.objectContaining({ quality: "dominant7" }),
          expect.objectContaining({ quality: "major" }),
          { kind: "augmented-sixth", variant: "doubleAugmented43" },
          expect.objectContaining({ quality: "major" }),
        ]);
        expect(errors(project)).toEqual([]);
      }
    });

    it("相同声部连接移调到 C 大调仍是辅助回归", () => {
      expect(errors(compileScoreText(transposedReturn).project)).toEqual([]);
    });

    it("内声交接后虽形成完整主和弦，仍报告错解", () => {
      const bad = transposedReturn.replace("F#4/4 G4/4", "F#4/4 E4/4")
        .replace("D#4/4 E4/4", "D#4/4 G3/4");
      for (const project of [inferFromNotes(bad), compileScoreText(bad).project]) {
        expect(buildHarmonyAnalysis(project).slices[2].chord?.identity.structure)
          .toMatchObject({ kind: "tertian", quality: "major" });
        expect(errors(project)).toMatchObject([{ tick: 2 * project.ppq }]);
      }
    });

    it.each([
      ["前置实音并不是同配置原位主和弦", transposedReturn.replace("G4/4 F#4/4", "A4/4 F#4/4")],
      ["把升二级错写为等音降三", transposedReturn.replace("D#4/4", "Eb4/4")],
      ["低音越八度返回", transposedReturn.replace("Ab2/4 C3/4", "Ab2/4 C2/4")],
    ])("%s 时仍报告", (_name, notation) => {
      const { project } = compileScoreText(notation);
      expect(errors(project)).toMatchObject([{ tick: 2 * project.ppq }]);
    });

    it("跨手工句末的相同音型不建立辅助回归", () => {
      const { project } = compileScoreText(transposedReturn);
      project.structure.phraseBoundaries.push({
        id: "phrase", tick: 2 * project.ppq, source: "manual", confidence: "certain",
      });
      expect(errors(project)).toMatchObject([{ tick: 2 * project.ppq }]);
    });
  });

  describe("保留常规增六要求及给定标签", () => {
    it("第32章书面8的实写德增六高端下行，属七身份不能豁免", () => {
      for (const project of [inferFromNotes(descendingGermanEnd), compileScoreText(descendingGermanEnd).project]) {
        expect(errors(project)).toMatchObject([{
          tick: 2 * project.ppq, params: { target: "D", lowDelta: -1, highDelta: -1 },
        }]);
      }
      const corrected = descendingGermanEnd.replace("G#4/4 G4/4", "G#4/4 A4/4").replace("V7/4", "V/4");
      expect(errors(compileScoreText(corrected).project)).toEqual([]);
    });

    it("第37章键盘二2的实写双延留属于倍增三四，显式德增六标签仍按输入检查", () => {
      const notation = `satb 1
key Eb major
meter 2/4
bars 1..2 {
 S: | Ab5/4 F#5/4~ | F#5/4 G5/4 |
 A: | Ab4/4 A4/4~ | A4/4 Bb4/4 |
 T: | Eb4/2~ | Eb4/2 |
 B: | C3/4 Cb3/4 | Bb2/2 |
 H: | IV6/4 DD++43/4 | K46/2 |
}`;
      expect(errors(compileScoreText(notation).project)).toEqual([]);
      const { project } = compileScoreText(notation.replace("DD++43", "Ger+6"));
      expect(errors(project)).toMatchObject([{
        tick: 2 * project.ppq, params: { target: "K46", lowDelta: -1, highDelta: 0 },
      }]);
    });
  });
});

describe("辅助法增六回归时的低音八度下移", () => {
  const germanPreparation = `satb 1
key C minor
meter 4/4
bars 1..2 {
 S: | B3/2 C4/2~ | C4/1 |
 A: | G3/2 G3/2 | F#3/2 G3/2 |
 T: | F3/2 F3/8 Eb3/4. | Eb3/4 D3/4 Eb3/2 |
 B: | G2/2 C3/2 | Ab2/2 C2/2 |
 H: | V7/2 r/8 i/4. | Ger+6/4 Fr+6/4 i/2 |
}`;

  const passingBass = `satb 1
key C minor
meter 3/4
bars 1..2 {
 S: | B3/4 C4/2~ | C4/2. |
 A: | G3/4 G3/2 | F#3/4 G3/2 |
 T: | F3/4 Eb3/2 | D3/4 Eb3/2 |
 B: | G2/4 C3/4 Bb2/4 | Ab2/4 C2/2 |
 H: | V7/4 i/4 r/4 | Fr+6/4 i/2 |
}`;

  function errorAtReturn(score: string) {
    const { project } = compileScoreText(score);
    const tick = project.lengthTicks - 2 * project.ppq;
    return checkHarmony(project).diagnostics.filter(d =>
      d.tick === tick && d.ruleId === "resolution.augmented-sixth" && d.severity === "error",
    );
  }

  describe("已收束主和弦的法增六辅助回归与低音八度下移", () => {
    it.each([germanPreparation, passingBass])("实奏内声半音回归，末主在下方八度复奏", score => {
      expect(errorAtReturn(score)).toEqual([]);
    });

    it.each([
      ["低音再低八度", germanPreparation.replace("C2/2", "C1/2")],
      ["原属七七音实奏有误", germanPreparation.replace("F3/2 F3/8", "F#3/2 F3/8")],
      ["德国到法国的共同音被改变", germanPreparation.replace("F#3/2 G3/2", "G3/4 F#3/4 G3/2")],
      ["保持的主音在辅助配置中重新起奏", passingBass.replace("C4/2~ | C4/2.", "C4/2 | C4/2.")],
      ["前置低音跳进", passingBass.replace("Bb2/4", "A2/4")],
    ])("%s时保留回归拍的解决错误", (_reason, score) => {
      expect(errorAtReturn(score)).toHaveLength(1);
    });
  });
});

describe("无标注意式增六的实奏识别", () => {
  interface Example {
    key?: string;
    keyEvents?: string;
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    before?: string;
    middle?: string;
    landing?: string;
    landingStart?: string;
    annotations?: string;
    boundary?: number;
  }

  function exampleProject({
    key = "D minor", keyEvents = "",
    soprano = "E5/4 D5/4 C#5/2",
    alto = "G4/4 G#4/4 A4/2",
    tenor = "C4/4 D4/4 E4/2",
    bass = "C3/4 Bb2/4 A2/2",
    before = "", middle = "", landing = "V", landingStart = "1:3",
    annotations = "", boundary,
  }: Example = {}) {
    const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
${keyEvents}
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
}
annotations {
 ${before ? "chord before range=[1:1,1:2) symbol=" + before : ""}
 ${middle ? "chord middle range=[1:2,1:3) symbol=" + middle : ""}
 ${landing ? "chord landing range=[" + landingStart + ",2:1) symbol=" + landing : ""}
 ${annotations}
}`);
    if (boundary !== undefined) {
      project.structure.phraseBoundaries.push({
        id: "boundary", tick: project.ppq * boundary, source: "manual", confidence: "certain",
      });
    }
    return project;
  }

  describe("从实音识别无标注的意大利增六", () => {
    it.each([
      ["两端均在原声部半音解决", "A4"],
      ["低端正确而高端改落属和弦五音", "E4"],
    ] as const)("checkHarmony 在%s时均不在女低入音处报 B.3", (_label, upperArrival) => {
      const project = exampleProject({ before: "V7/V confidence=probable", alto: `G4/4 G#4/4 ${upperArrival}/2` });
      const warnings = checkHarmony(project).diagnostics.filter(item =>
        item.ruleId === "melody.augmented-interval" &&
        item.tick === project.ppq &&
        item.voiceIds.includes("alto"),
      );
      expect(warnings).toEqual([]);
    });

  });
});

describe("德式增六前的旋律减三度", () => {
  interface Example {
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    harmony?: string;
    boundary?: number;
    turnIntoPassing64?: boolean;
    keyDetour?: boolean;
  }

  function warnings({
    soprano = "Eb5/4 C#5/4 D5/4 F#5/4", alto = "Bb4/4 Bb4/4 Bb4/4 A4/4",
    tenor = "G4/4 G4/4 G4/4 C4/4", bass = "Eb3/4 Eb3/4 D3/4 D3/4",
    harmony = "", boundary, turnIntoPassing64, keyDetour,
  }: Example = {}) {
    const { project } = compileScoreText(`satb 1
key G minor
meter 4/4
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
  ${harmony ? "H: | " + harmony + " |" : ""}
}`);
    if (boundary !== undefined) project.structure.phraseBoundaries.push({
      id: "manual-cut", tick: boundary * project.ppq, source: "manual", confidence: "certain",
    });
    if (turnIntoPassing64) {
      const landing = project.chordTrack.regions.find(chord => chord.startTick === 2 * project.ppq)!;
      landing.semantics!.cadenceRole = "passing64";
    }
    if (keyDetour) project.keyEvents.push(
      { id: "detour", tick: project.ppq / 2, tonic: { step: "C", alter: 0 }, mode: "minor" },
      { id: "return", tick: project.ppq, tonic: { step: "G", alter: 0 }, mode: "minor" },
    );
    return checkHarmony(project, undefined, {}, {
      "melody.diminished-interval": { "same-harmony": "strict" },
    }).diagnostics.filter(item =>
      item.ruleId === "melody.diminished-interval" && item.tick === project.ppq && item.voiceIds.includes("soprano"));
  }

  describe("德国增六前的下行减三度", () => {
    it.each([
      ["裸四声部", {}],
      ["升六级在原声部经过且进入属和弦时低音下移八度", {
        soprano: "Eb5/4 C#5/4 D5/8 E5/8 F#5/4", bass: "Eb3/4 Eb3/4 D3/4 D2/4",
      }],
      ["完整给定和声", { harmony: "VI/4 Ger+6/4 K46/4 V7/4" }],
      ["普通主四六标签并有实际属和弦", { harmony: "VI/4 Ger+6/4 i64/4 V7/4" }],
      ["第一转位的 VI 准备", { bass: "G3/4 Eb3/4 D3/4 D3/4", tenor: "Eb4/4 G4/4 G4/4 C4/4" }],
    ] satisfies [string, Example][])("%s 有明确半音解决", (_label, example) => {
      expect(warnings(example)).toHaveLength(0);
    });

    it.each([
      ["后音重奏升四级", { soprano: "Eb5/4 C#5/4 C#5/4 F#5/4" }],
      ["后音缺失", { soprano: "Eb5/4 C#5/4 r/4 F#5/4" }],
      ["解决音错八度", { soprano: "Eb5/4 C#5/4 D6/4 F#5/4" }],
      ["低音没有半音下行", { bass: "Eb3/4 Eb3/4 Eb3/4 D3/4" }],
      ["到属和弦时低音越过两个八度", { bass: "Eb3/4 Eb3/4 D3/4 D1/4" }],
      ["经过音从其他声部才到导音", { soprano: "Eb5/4 C#5/4 D5/8 E5/8 A5/4",
          alto: "Bb4/4 Bb4/4 Bb4/4 F#4/4" }],
      ["未标和弦的四六与属之间另起和声", { alto: "Bb4/4 Bb4/4 Bb4/8 C5/8 A4/4" }],
      ["德国增六的内声错误", { alto: "Bb4/4 A4/4 Bb4/4 A4/4" }],
      ["德国增六的内声低过实际低音", { tenor: "G4/4 G2/4 G4/4 C4/4" }],
      ["两个共同音之一搬八度", { tenor: "G4/4 G4/4 G3/4 C4/4" }],
      ["减三度之前是另一个和弦", { alto: "C5/4 Bb4/4 Bb4/4 A4/4" }],
      ["中间标签明确冲突", { harmony: "VI/4 Fr+6/4 K46/4 V7/4" }],
      ["落点明确标为经过四六", { harmony: "VI/4 Ger+6/4 i64/4 V7/4", turnIntoPassing64: true }],
      ["四六无后续实际属和弦", { soprano: "Eb5/4 C#5/4 D5/2", alto: "Bb4/4 Bb4/4 Bb4/2",
          tenor: "G4/4 G4/4 G4/2", bass: "Eb3/4 Eb3/4 D3/2" }],
      ["属音重奏后才到属和弦", { soprano: "Eb5/4 C#5/4 D5/8 D5/8 F#5/4",
          alto: "Bb4/4 Bb4/4 Bb4/4 A4/4", bass: "Eb3/4 Eb3/4 D3/8 D3/8 D3/4" }],
      ["源音内有句界", { boundary: 0.5 }],
      ["四六和属之间有句界", { boundary: 2.5 }],
      ["源音内暂时换调", { keyDetour: true }],
    ] satisfies [string, Example][])("%s 时保留 B.4", (_label, example) => {
      expect(warnings(example)).toEqual([expect.objectContaining({ severity: "warning", voiceIds: ["soprano"] })]);
    });
  });
});

describe("增六和弦的局部调性与解决", () => {
  function connection(key: string, localKey: string, voices: string[], target = "D") {
    return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..2 {
 S: | ${voices[0]}/2 | ${voices[1]}/2 |
 A: | ${voices[2]}/2 | ${voices[3]}/2 |
 T: | ${voices[4]}/2 | ${voices[5]}/2 |
 B: | ${voices[6]}/2 | ${voices[7]}/2 |
}
annotations {
 chord aug range=[1:1,2:1) symbol=Ger+6 ${localKey ? `localKey="${localKey}"` : ""}
 chord goal range=[2:1,3:1) symbol=${target} ${localKey ? `localKey="${localKey}"` : ""}
}`).project;
  }

  function errors(project: ReturnType<typeof connection>) {
    return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.augmented-sixth");
  }

  describe("增六解决使用源和弦的局部调性", () => {
    it("局部G大调Eb/C#反向到D，不要求工程Ab大调的Eb属音", () => {
      expect(errors(connection("Ab major", "G major", ["C#5", "D5", "Bb3", "A3", "G3", "F#3", "Eb3", "D3"]))).toEqual([]);
    });

    it("局部C#小调A/F##反向到G#，保留重升拼写", () => {
      expect(errors(connection("A minor", "C# minor", ["F##4", "G#4", "E4", "D#4", "C#4", "B#3", "A2", "G#2"]))).toEqual([]);
    });

    it("局部调的增六仍可按原规则解决到K46", () => {
      expect(errors(connection("Ab major", "G major", ["C#5", "D5", "Bb3", "B3", "G3", "G3", "Eb3", "D3"], "K46"))).toEqual([]);
    });

    it("没有局部调性时仍使用工程调性", () => {
      expect(errors(connection("C major", "", ["F#4", "G4", "Eb4", "D4", "C4", "B3", "Ab2", "G2"]))).toEqual([]);
    });

    it("局部调性下高端没有上行半音时仍报错", () => {
      const result=errors(connection("Ab major", "G major", ["C#5", "F#5", "Bb3", "A3", "G3", "F#3", "Eb3", "D3"]));
      expect(result).toHaveLength(1);
      expect(result[0].message).toContain("高端未上行半音");
      expect(result[0].message).not.toContain("低端未下行半音");
    });

    it("端点半音正确但目标非属或K46时仍报错", () => {
      const result=errors(connection("Ab major", "G major", ["C#5", "D5", "Bb3", "B3", "G3", "G3", "Eb3", "D3"], "T"));
      expect(result).toHaveLength(1);
      expect(result[0].message).toContain("目标不是明确的属功能或 K46");
    });
  });
});

describe("倍增三四至主四六的二重延留", () => {
  function example({
    soprano = "C#5/4 B#4/4~ | B#4/4 C#5/4 | B4/2",
    alto = "E4/4 D#4/4~ | D#4/4 E4/4 | E4/2",
    tenor = "A3/2~ | A3/2 | G#3/2",
    bass = "A2/4 F3/4 | E3/2 | E3/2",
    source = "DD++43",
    middle = "K46/2",
    boundary,
    keyChange = false,
  }: {
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    source?: string;
    middle?: string;
    boundary?: number;
    keyChange?: boolean;
  } = {}) {
    const { project } = compileScoreText(`satb 1
key A major
meter 2/4
bars 1..3 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | I/4 ${source}/4 | ${middle} | V/2 |
}`);
    if (boundary !== undefined) {
      project.structure.phraseBoundaries.push({
        id: "test-boundary", tick: boundary * project.ppq, source: "manual", confidence: "certain",
      });
    }
    if (keyChange) {
      project.keyEvents.push({
        id: "other-key", tick: 3 * project.ppq, tonic: { step: "E", alter: 0 }, mode: "major",
      });
    }
    return project;
  }

  function errors(project: ReturnType<typeof example>, ruleId = "resolution.augmented-sixth") {
    return checkHarmony(project).diagnostics.filter(diagnostic => diagnostic.ruleId === ruleId);
  }

  describe("倍增三四进入同一主四六的二重有准备延留", () => {
    it("升二和升四连持到弱拍，低音在强拍先到且保持到解决", () => {
      expect(errors(example())).toEqual([]);
    });

    it("立即解决走原路径，普通主四六记法也可凭实音证明延期", () => {
      expect(errors(example({
        soprano: "C#5/4 B#4/4 | C#5/2 | B4/2",
        alto: "E4/4 D#4/4 | E4/2 | E4/2",
      }))).toEqual([]);
      expect(errors(example({ middle: "I64/2" }))).toEqual([]);
    });

    it.each([
      ["升四在原位朝错方向走", { alto: "E4/4 D#4/4~ | D#4/4 D4/4 | E4/2" }],
      ["升二到错误八度", { soprano: "C#5/4 B#4/4~ | B#4/4 C#4/4 | B4/2" }],
      ["声部重起同音", { alto: "E4/4 D#4/4 | D#4/4 E4/4 | E4/2" }],
      ["低音延留中换八度", { bass: "A2/4 F3/4 | E3/4 E2/4 | E3/2" }],
      ["主音在延留中途重奏", { tenor: "A3/2~ | A3/4 A3/4 | G#3/2" }],
      ["主四六在解决前结束", { middle: "K46/4 V/4" }],
      ["目标标签是普通属和弦", { middle: "V/2" }],
      ["没有同一目标内的任何后继", {
        soprano: "C#5/4 B#4/4~ | B#4/2 | B4/2",
        alto: "E4/4 D#4/4~ | D#4/2 | E4/2",
      }],
      ["源拍内部有手动句界", { boundary: 1.5 }],
      ["解决拍有手动句界", { boundary: 3 }],
      ["解决拍发生调号变化", { keyChange: true }],
    ] satisfies Array<[string, Parameters<typeof example>[0]]>)("%s 时保留落点错误", (_name, changes) => {
      const project = example(changes);
      expect(errors(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
    });

    it("终点虽有正确实音，延至同一小节第三拍仍保留错误", () => {
      const project = compileScoreText(`satb 1
key D major
meter 4/4
bars 1..2 {
 S: | F#5/2. E#5/4~ | E#5/2 F#5/2 |
 A: | A4/2. G#4/4~ | G#4/2 A4/2 |
 T: | D4/1~ | D4/1 |
 B: | D3/2. Bb2/4 | A2/1 |
 H: | I/2. DD++43/4 | K46/1 |
}`).project;
      expect(errors(project)).toEqual([expect.objectContaining({ tick: 4 * project.ppq })]);
    });

    it("误给同响德增六的标签不构成延期证据，配置错误仍在", () => {
      const project = example({ source: "Ger+6" });
      expect(errors(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
      expect(errors(project, "chord.augmented-sixth-voicing")).toHaveLength(1);
    });
  });
});

describe("增六和弦的降六级与实写拼写", () => {
  const ruleId = "melody.augmented-interval";
  const spelling = { messageKey: ruleId + ".structural-spelling", message: expect.stringContaining("C♯") };

  function example(entry = "C#5", peer = "A#3", middleBass = "Eb3", goalBass = "D3") {
    return compileScoreText([
      "satb 1", "key G major", "meter 3/4", "bars 1..1 {",
      " S: | C5/4 " + entry + "/4 D5/4 |", " A: | G4/2. |",
      " T: | A3/4 " + peer + "/4 B3/4 |", " B: | " + middleBass + "/2 " + goalBass + "/4 |",
      " H: | I/4 I/4 I/4 |", "}",
    ].join("\n")).project;
  }

  function focus(project: ReturnType<typeof example>) {
    return checkHarmony(project).diagnostics.filter(d =>
      d.ruleId === ruleId && d.tick === project.ppq && d.voiceIds.includes("soprano"));
  }

  function role(project: ReturnType<typeof example>, voice: VoiceId, beat: number, mark: NonChordToneRole) {
    project.satbTracks.find(track => track.voice === voice)!.notes
      .find(note => note.startTick === beat * project.ppq)!.nonChordToneRole = mark;
  }

  function markIdentities(project: ReturnType<typeof example>, conflicting: boolean) {
    const [before, middle, goal] = project.chordTrack.regions;
    before.identity = {
      root: parsePitchClass("A:0")!, bass: parsePitchClass("E:-1")!,
      structure: { kind: "tertian", quality: "halfDiminished7", extensions: [], alterations: [] },
    };
    const flatSix = parsePitchClass("E:-1")!;
    middle.identity = {
      root: flatSix, bass: flatSix,
      structure: conflicting ? { kind: "tertian", quality: "dominant7", extensions: [], alterations: [] }
        : { kind: "augmented-sixth", variant: "doubleAugmented43" },
    };
    goal.identity = {
      root: parsePitchClass("G:0")!, bass: parsePitchClass("D:0")!,
      structure: { kind: "tertian", quality: "major", extensions: [], alterations: [] },
    };
  }

  describe("Written resolution of a lowered-sixth augmented-sixth sonority", () => {
    it("distinguishes the examined ascending alteration from an enharmonic error", () => {
      for (const [pitch, expected] of [["C#5", []], ["Db5", [spelling]]] as const) {
        const project = example(pitch);
        project.chordTrack.regions = [];
        expect(focus(project)).toMatchObject(expected);
      }
    });

    it.each([1, 2])("retains the proof when the same key is restated at beat %i", beat => {
      const project = example("Db5");
      project.chordTrack.regions = [];
      project.keyEvents.push({ ...project.keyEvents[0], id: "restated", tick: beat * project.ppq });
      expect(focus(project)).toMatchObject([spelling]);
    });

    it.each([0, 1])("rejects a change and return between attacks after beat %i", beat => {
      const project = example("Db5");
      project.chordTrack.regions = [];
      const startKey = project.keyEvents[0];
      project.keyEvents.push(
        { ...startKey, id: "detour", tick: (beat + 0.5) * project.ppq, mode: "minor" },
        { ...startKey, id: "return", tick: (beat + 1) * project.ppq },
      );
      const transition = buildHarmonyAnalysis(project).melodyTransitions.find(item =>
        item.voiceId === "soprano" && item.current.startTick === project.ppq);
      expect(transition?.sameKey).toBe(true);
      expect(focus(project)).not.toContainEqual(expect.objectContaining({ messageKey: spelling.messageKey }));
    });

    it("can prove the entry without a marked redundant member of the preparation", () => {
      const project = example("Db5", "A#3");
      project.chordTrack.regions = [];
      const tenor = project.satbTracks.find(track => track.voice === "tenor")!;
      tenor.notes[0].pitch = { step: "G", alter: 0, octave: 3 };
      role(project, "tenor", 0, "other");
      expect(focus(project)).toMatchObject([spelling]);
    });

    it("requires the other written alteration and its true resolution", () => {
      for (const project of [example("Db5", "Bb3"), example("Db5", "A#3", "Eb3", "G3"),
        example("Db5", "A#3", "Eb5", "D5")]) {
        project.chordTrack.regions = [];
        expect(focus(project)).not.toContainEqual(expect.objectContaining({ messageKey: spelling.messageKey }));
      }
    });

    it.each([
      { source: "inferred", trackLocked: false },
      { source: "manual", trackLocked: false },
      { source: "inferred", trackLocked: true },
    ] as const)("uses identical written identities under %o", ({ source, trackLocked }) => {
      const project = example("Db5");
      markIdentities(project, false);
      project.chordTrack.locked = trackLocked;
      for (const chord of project.chordTrack.regions) {
        for (const meaning of chord.semantics!.interpretations) meaning.source = source;
      }
      expect(focus(project)).toMatchObject([spelling]);
    });

    it.each([
      { source: "inferred", trackLocked: false, expected: [spelling] },
      { source: "manual", trackLocked: false, expected: [] },
      { source: "inferred", trackLocked: true, expected: [] },
    ] as const)("honors an enharmonic identity conflict under %o", ({ source, trackLocked, expected }) => {
      const project = example("Db5");
      markIdentities(project, true);
      project.chordTrack.locked = trackLocked;
      for (const chord of project.chordTrack.regions) {
        for (const meaning of chord.semantics!.interpretations) meaning.source = source;
      }
      expect(focus(project)).toMatchObject(expected);
    });

    it("vetoes required preparation, peer, and landing roles", () => {
      for (const [voice, beat, mark] of [
        ["soprano", 0, "passing"], ["tenor", 1, "neighbor"], ["bass", 2, "pedal"],
      ] as const) {
        const project = example("Db5");
        project.chordTrack.regions = [];
        role(project, voice, beat, mark);
        expect(focus(project)).not.toContainEqual(expect.objectContaining({ messageKey: spelling.messageKey }));
      }
    });
  });
});
