import { describe, expect, it } from "vitest";
import { HARMONY_PHASE_B_GOLDEN } from "../../../../fixtures/harmonyPhaseB.v1";
import {
  createEmptyProject,
  PPQ,
  validateProject,
  type ChordRegion,
  type ProjectDocument,
} from "../../../../project";
import { compileScoreText } from "../../../../scoreText";
import { applyHarmonyInference, inferHarmony } from "../../../inference";
import { checkHarmony } from "../../../registry";
import {
  diagnosticFor,
  dominantNinthProject,
  functionalChord,
  manualCertain,
  pitch,
  setLine,
  triadRegion,
  twoChordProject,
} from "../../../testing/fixtures/ruleProjects";
import {
  fSharpMajorRegion,
  note,
  semantics,
  setNotes,
  tertianIdentity,
} from "../../../testing/fixtures/writtenPitchProject";

describe("重复变化音与实写倾向", () => {
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

  describe("变化音的拼写与解决", () => {
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
  });
});

describe("经过音取代的和弦构成音", () => {
  const exercise = `satb 1
key C major
meter 3/4
bars 1..1 {
  S: | C5/4. B4/8@p A4/4 |
  A: | F4/2 F4/4 |
  T: | A3/2 D4/4 |
  B: | F3/2 F3/4 |
  H: | IV/2 ii6/4 |
}
annotations {
  note p role=passing
}`;

  function missing(text: string, cut?: number) {
    const { project } = compileScoreText(text);
    if (cut !== undefined) project.structure.phraseBoundaries.push({
      id: "cut", tick: cut, source: "manual", confidence: "certain",
    });
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === "chord.incomplete-members" && d.tick === 1440);
  }

  describe("经过音离开后三和弦的实写成员", () => {
    it("弱细分上的经过音取代原来唯一的五音", () => {
      expect(missing(exercise)).toHaveLength(0);
    });
    it("六和弦唯一的根音向上经过至三音", () => {
      const text = exercise.replace("C5/4. B4/8@p A4/4", "F4/4. G4/8@p A4/4")
        .replace("F4/2 F4/4", "C4/2 C4/4").replace("A3/2 D4/4", "A3/2 F3/4")
        .replace("F3/2 F3/4", "A2/2 F2/4").replace("IV/2 ii6/4", "IV6/2 IV/4");
      expect(missing(text)).toHaveLength(0);
    });
    it.each([
      ["出发处已经缺五音", "C5/4.", "A4/4."],
      ["中间为另一次起奏", "F4/2 F4/4", "F4/4. F4/8 F4/4"],
      ["下一音改在另一八度", "A4/4 |", "A5/4 |"],
      ["落点的身份与四声部冲突", "ii6/4", "V6/4"],
      ["手写标签与方向冲突", "role=passing", "role=neighbor"],
    ])("%s时保留实际缺音警告", (_label, old, replacement) => {
      expect(missing(exercise.replace(old, replacement))).toHaveLength(1);
    });
    it.each([1440, 1720, 1920])("句界 %i 隔开依据时保留警告", tick => {
      expect(missing(exercise, tick)).toHaveLength(1);
    });
  });
});

describe("属七替代六音与和弦外音", () => {
  function projectWithDominantSixth({
    key = "C major",
    soprano = "E5/1@source | C5/1",
    alto = "F4/1 | E4/1",
    tenor = "B3/1 | C4/1",
    bass = "G2/1 | C3/1",
    harmony = "V7/1 | I/1",
    annotations = "",
  } = {}) {
    return compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..2 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}
${annotations}`).project;
  }

  function sourceWarnings(project: ReturnType<typeof projectWithDominantSixth>) {
    return checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "chord.unclassified-nonchord-tone" && item.tick === 0 && item.severity === "warning");
  }

  function heldDominant({
    soprano = "G5/2 E5/2",
    alto = "B4/1",
    tenor = "F4/1",
    tonicTenor = "E4/1",
    harmony = "V7/1",
  } = {}) {
    return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | ${soprano} | C5/1 |
 A: | ${alto} | G4/1 |
 T: | ${tenor} | ${tonicTenor} |
 B: | G2/1 | C3/1 |
 H: | ${harmony} | I/1 |
}`).project;
  }

  function reportsAt(project: ReturnType<typeof heldDominant>, ruleId: string, voiceId: "soprano" | "alto", beat: number) {
    return checkHarmony(project).diagnostics.some(item =>
      item.ruleId === ruleId && item.tick === beat * project.ppq && item.voiceIds.includes(voiceId));
  }

  describe("原位属七的女高替代六音", () => {
    it.each([
      ["六音下行到属七五音", { soprano: "E5/2@source D5/2 | C5/1" }],
      ["六音下行到主音且内声分别解决", {}],
      ["内声导音下行大三度到完整原位主和弦五音", { tenor: "B3/1 | G3/1" }],
      ["小调六音下行到主音", { key: "C minor", soprano: "Eb5/1@source | C5/1", alto: "F4/1 | Eb4/1", harmony: "V7/1 | i/1" }],
    ])("%s 时放行", (_label, voicing) => {
      expect(sourceWarnings(projectWithDominantSixth(voicing))).toEqual([]);
    });

    it.each([
      ["同响小六音实写为增五音", { key: "C minor", soprano: "D#5/1@source | C5/1", alto: "F4/1 | Eb4/1", harmony: "V7/1 | i/1" }],
      ["导音跳到低八度的主和弦五音", { tenor: "B3/1 | G2/1" }],
      ["七音跳到主和弦五音", { alto: "F4/1 | G4/1" }],
      ["换声部解决导音与七音", { alto: "F4/1 | C4/1", tenor: "B3/1 | E4/1" }],
      ["实写低音非根音", { bass: "D3/1 | C3/1" }],
      ["标注转位非原位", { harmony: "V65/1 | I/1" }],
      ["六音为保留五音的附加音", { alto: "D4/1 | E4/1" }],
      ["下行到五音时内声有异动", { soprano: "E5/2@source D5/2 | C5/1", alto: "F4/2 F3/2 | E4/1" }],
      ["女高仍在邻音位置", { soprano: "E5/2@source F5/2 | C5/1" }],
      ["内声休止使解决上下文不完整", { tenor: "B3/1 | r/1" }],
      ["解决处标注与实际音响冲突", { harmony: "V7/1 | vi/1" }],
      ["局部主和声与题面调号不同", {
        key: "F major",
        harmony: "V7/1@dominant | I/1@tonic",
        annotations: 'annotations {\n chord dominant localKey="C major"\n chord tonic localKey="C major"\n}',
      }],
      ["副属六音下行到五音但无目标", { key: "F major", harmony: "V7/V/1 | I/1", soprano: "E5/2@source D5/2 | C5/1" }],
      ["人工标注持续低音", { bass: "G2/1@pedal | C3/1", annotations: "annotations {\n note pedal role=pedal\n}" }],
    ])("%s 时保留女高警告", (_label, voicing) => {
      const warnings = sourceWarnings(projectWithDominantSixth(voicing));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].voiceIds).toContain("soprano");
    });

    it("保留同一切片中真正的和弦外音", () => {
      const project = projectWithDominantSixth({ alto: "A4/1 | E4/1" });
      const warnings = sourceWarnings(project);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].voiceIds).toEqual(["alto", "soprano"]);
    });

    it("保留跨越和弦起点的持续低音上的警告", () => {
      const project = projectWithDominantSixth({
        soprano: "G4/2 E5/2@source | C5/1",
        alto: "D4/2 F4/2 | E4/1",
        harmony: "V/2 V7/2 | I/1",
      });
      expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
        ruleId: "chord.unclassified-nonchord-tone",
        tick: 2 * project.ppq,
        voiceIds: ["soprano"],
        severity: "warning",
      }));
    });

    it.each(["V7/1", "V7/2 V7/2", "V7/2. V7/4"])("同一书写的持续低音，V7 标注为 %s 时结论一致", (harmony) => {
      for (const soprano of ["G5/2 E5/2", "D5/2 E5/2"]) {
        const project = heldDominant({ soprano, harmony });
        expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 2)).toBe(false);
        expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 3)).toBe(false);
        expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(false);
      }
    });

    it.each([
      ["前和弦并非属七", { tenor: "E4/2 F4/2", harmony: "V/2 V7/2" }],
      ["前拍实写降五，标签合并", { soprano: "Db5/2 E5/2" }],
      ["前拍实写降五，标签拆分", { soprano: "Db5/2 E5/2", harmony: "V7/2 V7/2" }],
      ["前拍实写降五，标签在前拍内部拆分", { soprano: "Db5/2 E5/2", harmony: "V7/4 V7/2." }],
      ["七音未级进下行", { tonicTenor: "G4/1" }],
    ])("%s 时六音和导音例外均失效", (_label, voicing) => {
      const project = heldDominant(voicing);
      expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 2)).toBe(true);
      expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(true);
    });

    it("未写替代六音的普通省五属七保留导音义务", () => {
      const project = heldDominant({ soprano: "G5/1" });
      expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 0)).toBe(false);
      expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(true);
    });

    it.each([
      ["原音区重奏", "B4/4 B4/2.", false],
      ["从另一八度重奏", "B3/4 B4/2.", true],
    ] as const)("%s 时只解决对应的导音义务", (_label, alto, reports) => {
      const project = heldDominant({ soprano: "G5/4 G5/4 E5/2", alto });
      expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 2)).toBe(false);
      expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(reports);
    });

    it.each([1, 2, 3, 4])("在第 %s 拍的显式句界阻断跨界证据", (beat) => {
      const project = heldDominant({ harmony: "V7/4 V7/2." });
      project.structure.phraseBoundaries = [
        { id: "manual", tick: beat * project.ppq, source: "manual", confidence: "certain" },
      ];
      expect(reportsAt(project, "chord.unclassified-nonchord-tone", "soprano", 2)).toBe(true);
      expect(reportsAt(project, "resolution.leading-tone", "alto", 4)).toBe(true);
    });

    it.each([
      ["在属七区域内重新起奏", "E5/2 E5/4 D5/4 | C5/1", false],
      ["从上一和弦延入属七", "E5/2~ E5/4 D5/4 | C5/1", true],
    ] as const)("同一音高%s时，女高警告为 %s", (_label, soprano, reports) => {
      const project = projectWithDominantSixth({
        soprano,
        alto: "G4/2 F4/2 | E4/1",
        tenor: "C4/2 B3/2 | C4/1",
        bass: "C3/2 G2/2 | C3/1",
        harmony: "I/2 V7/2 | I/1",
      });
      const warnings = checkHarmony(project).diagnostics.filter(item =>
        item.ruleId === "chord.unclassified-nonchord-tone" && item.tick === 2 * project.ppq);
      expect(warnings).toEqual(reports ? [expect.objectContaining({
        voiceIds: ["soprano"],
        severity: "warning",
      })] : []);
    });
  });
});

describe("临时主和弦重三与重复导音", () => {
  const rootArrival = `satb 1
key D major
meter 3/4
bars 1..1 {
 S: | F4/4 E4/4 G4/4 |
 A: | D4/4 C#4/4 D4/4 |
 T: | B3/4 C#4/4 B3/4 |
 B: | G#3/4 A3/4 G3/4 |
 H: | viio7/V/4 V/4 IV/4 |
}`;

  const invertedArrival = `satb 1
key C minor
meter 4/4
bars 1..1 {
 S: | F#5/4 G5/4 F5/4 Eb5/4 |
 A: | C5/4 B4/4 G4/2 |
 T: | Eb4/4 D4/2 Eb4/4 |
 B: | A2/4 B2/2 C3/4 |
 H: | viio65/V/4 V6/4 V65/4 i/4 |
}`;

  function doubledLeadingTones(project: ProjectDocument) {
    return checkHarmony(project).diagnostics.filter(item => item.ruleId === "chord.doubled-leading-tone");
  }

  function inferred(text: string) {
    const { project } = compileScoreText(text.replace(/\n H:.*/, ""));
    return applyHarmonyInference(project, inferHarmony(project), {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
  }

  describe("导减七解决时收到临时主和弦的两个三音", () => {
    it("第28章书面6，正置应用导减七的两个级进同到 C♯4", () => {
      const given = compileScoreText(rootArrival).project;
      const blind = inferred(rootArrival);
      expect(blind.chordTrack.regions.find(region => region.startTick === blind.ppq)?.identity.root)
        .toMatchObject({ step: "A", alter: 0 });
      expect(doubledLeadingTones(given)).toEqual([]);
      expect(doubledLeadingTones(blind)).toEqual([]);
    });

    it("第46章型导减六五到主六，两声部 B 各自级进", () => {
      const { project } = compileScoreText(invertedArrival);
      expect(doubledLeadingTones(project)).toEqual([]);
    });

    it("实奏能纠正未锁定的推导等音解释，明文冲突须保留", () => {
      const { project } = compileScoreText(invertedArrival);
      const source = project.chordTrack.regions[0];
      source.identity.root = { step: "A", alter: 0 };
      source.semantics!.interpretations[0].source = "inferred";
      source.locked = false;
      expect(doubledLeadingTones(project)).toEqual([]);
      source.locked = true;
      expect(doubledLeadingTones(project)).toMatchObject([{ tick: project.ppq, voiceIds: ["alto", "bass"] }]);
    });

    it.each([
      ["音集相同但另一个声部离开减七", rootArrival.replace("F4/4 E4/4", "D5/4 E4/4").replace("D4/4 C#4/4", "F4/4 C#4/4")],
      ["书写等音改成不适合此处的音名", rootArrival.replace("G#3/4", "Ab3/4")],
      ["中间有真实休止", rootArrival.replace("G#3/4", "G#3/8 r/8")],
      ["实写外音角色", rootArrival.replace("F4/4 E4/4", "F4/4@outer E4/4") + "\nannotations {\nnote outer role=passing\n}"],
    ])("%s，保留重复导音", (_label, text) => {
      const { project } = compileScoreText(text);
      expect(doubledLeadingTones(project)).toMatchObject([{ tick: project.ppq, voiceIds: ["alto", "tenor"] }]);
    });

    it.each(["same-key", "new-key", "manual-boundary"] as const)("局部进入边界 %s", variant => {
      const { project } = compileScoreText(rootArrival);
      if (variant === "manual-boundary") {
        project.structure.phraseBoundaries.push({
          id: "cut", tick: project.ppq, source: "manual", confidence: "certain",
        });
      } else {
        project.keyEvents.push({
          ...project.keyEvents[0], id: "key-2", tick: project.ppq, mode: variant === "new-key" ? "minor" : "major",
        });
      }
      expect(doubledLeadingTones(project)).toHaveLength(variant === "same-key" ? 0 : 1);
    });

    it("进入时合法重复，后续 C♯ 真错解仍由 E.1 报告", () => {
      const wrongDeparture = rootArrival.replace("E4/4 G4/4", "E4/4 A4/4")
        .replace("D4/4 C#4/4 D4/4", "D4/4 C#4/4 F#4/4")
        .replace("B3/4 C#4/4 B3/4", "B3/4 C#4/4 D4/4")
        .replace("G#3/4 A3/4 G3/4", "G#3/4 A3/4 D3/4")
        .replace("V/4 IV/4", "V/4 I/4");
      const { project } = compileScoreText(wrongDeparture);
      expect(doubledLeadingTones(project)).toEqual([]);
      expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
        ruleId: "resolution.leading-tone", tick: 2 * project.ppq, voiceIds: ["alto"],
      }));
    });

    it("重复导音的普通属六仍是该调的重复", () => {
      const text = `satb 1
key Eb major
meter 3/4
bars 1..1 {
 S: | Eb4/4 F4/4 Bb4/4 |
 A: | Eb4/4 D4/4 Eb4/4 |
 T: | G3/4 Bb3/4 Bb3/4 |
 B: | C3/4 D3/4 G3/4 |
 H: | vi/4 V6/4 I6/4 |
}`;
      const { project } = compileScoreText(text);
      expect(doubledLeadingTones(project)).toMatchObject([{ tick: project.ppq, voiceIds: ["alto", "bass"] }]);
    });
  });
});

describe("属七替代六音解决到省五主和弦", () => {
  const example = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | E5/4 C5/4 C5/2 |
 A: | F4/4 E4/4 E4/2 |
 T: | B3/4 C4/4 G3/2 |
 B: | G2/4 C3/4 E3/2 |
 H: | V7/4 I/4 I6/2 |
}`;

  function missing(score: string, keepSourceLabel = false, boundary = false) {
    const { project } = compileScoreText(score);
    if (!keepSourceLabel) project.chordTrack.regions.shift();
    if (boundary) project.structure.phraseBoundaries = [{
      id: "break", tick: project.ppq, source: "manual", confidence: "certain",
    }];
    return checkHarmony(project).diagnostics.filter(d =>
      d.ruleId === "chord.incomplete-members" && d.tick === project.ppq,
    ).map(d => d.params.missing);
  }

  describe("六音代五的属七实奏直解至省五主和弦", () => {
    it("源切片无标签时仍按四部实际解决判断", () => {
      expect(missing(example)).toEqual([]);
      expect(missing(example, true)).toEqual([]);
    });

    it.each([
      ["六音书写不合调式", example.replace("E5/4", "Eb5/4")],
      ["女高错过下行三度的音区", example.replace("E5/4 C5/4", "E5/4 C6/4")],
      ["内声不再是完整的三音与七音", example.replace("F4/4", "G4/4")],
      ["属与主之间四部齐休", example
        .replace("E5/4", "E5/8 r/8").replace("F4/4", "F4/8 r/8")
        .replace("B3/4", "B3/8 r/8").replace("G2/4", "G2/8 r/8")],
    ])("%s 保留落点缺五", (_reason, score) => {
      expect(missing(score)).toEqual(["G"]);
    });

    it("相冲突的明确源标签或句界阻断实奏证明", () => {
      expect(missing(example.replace("V7/4", "IV/4"), true)).toEqual(["G"]);
      expect(missing(example, false, true)).toEqual(["G"]);
    });
  });
});

describe("属七解决到省五主和弦", () => {
  const rootPosition = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | B4/4 C5/4 C5/2 |
 A: | F4/4 E4/4 E4/2 |
 T: | D4/4 C4/4 G3/2 |
 B: | G2/4 C3/4 E3/2 |
 H: | V7/4 I/4 I6/2 |
}`;
  const secondInversion = rootPosition
    .replace("B4/4 C5/4", "G4/4 C5/4")
    .replace("D4/4 C4/4", "B3/4 C4/4")
    .replace("G2/4 C3/4", "D3/4 C3/4")
    .replace("V7/4", "V43/4");

  function missing(score: string, split = false) {
    const { project } = compileScoreText(score);
    if (split) project.structure.phraseBoundaries = [{
      id: "break", tick: project.ppq, source: "manual", confidence: "certain",
    }];
    return checkHarmony(project).diagnostics.filter(d =>
      d.ruleId === "chord.incomplete-members" && d.tick === project.ppq,
    ).map(d => d.params.missing);
  }

  describe("由实奏属七解决证明主和弦省五", () => {
    it.each([rootPosition, secondInversion])("三根一三只需当前连接成立", score => {
      expect(missing(score)).toEqual([]);
    });

    it.each([
      ["属七先已省五", rootPosition.replace("D4/4 C4", "G3/4 C4")],
      ["五音跳到另一个八度", rootPosition.replace("D4/4 C4/4", "D4/4 C3/4")],
      ["三四和弦根音跳过落点八度", secondInversion.replace("G4/4 C5/4", "G4/4 C6/4")],
      ["目标没有三音", rootPosition.replace("F4/4 E4/4", "F4/4 C4/4")],
    ])("%s 保留缺音", (_reason, score) => {
      expect(missing(score)).toHaveLength(1);
    });

    it("显式分句截断解决", () => {
      expect(missing(rootPosition, true)).toEqual(["G"]);
    });
  });
});

describe("旋律小调的经过低音与结构低音", () => {
  const score = `satb 1
key A minor
meter 4/4
bars 1..1 {
  S: | B4/2 D5/4 C5/4 |
  A: | G#4/2 E4/2 |
  T: | E4/2 B3/4 A3/4 |
  B: | E3/4. F#3/8@passing G#3/4 A3/4 |
  H: | V/2 V65/4 i/4 |
}
annotations {
  note passing role=passing
}`;

  const inversion = "chord.inversion-bass";
  const doubling = "chord.triad-root-position-doubling";
  function findings(text = score, boundary?: number) {
    const { project } = compileScoreText(text);
    if (boundary !== undefined) project.structure.phraseBoundaries.push({
      source: "manual", confidence: "certain", id: "cut", tick: boundary,
    });
    return checkHarmony(project).diagnostics.filter(d => d.tick === 1440).map(d => d.ruleId);
  }

  describe("旋律小调属和弦上行经过低音", () => {
    it("五至主的连续低音经过升六级，属和弦的结构低音仍是根音", () => {
      const ids = findings();
      expect(ids).not.toContain(inversion);
      expect(ids).not.toContain(doubling);
    });

    it("原位属三和弦经过同一写法到属六时也能核实", () => {
      const triad = score.replace("D5/4 C5/4", "E5/4 C5/4").replace("V65/4", "V6/4");
      expect(findings(triad)).not.toContain(inversion);
    });

    it("经过音占据次强拍时仍查转位", () => {
      const text = `satb 1
key A minor
meter 4/4
bars 1..2 {
  S: | B4/2. D5/4 | C5/1 |
  A: | G#4/2. E4/4 | E4/1 |
  T: | E4/2. B3/4 | A3/1 |
  B: | E3/2 F#3/4@passing G#3/4 | A3/1 |
  H: | V/2. V65/4 | i/1 |
}
annotations {
  note passing role=passing
}`;
      const { project } = compileScoreText(text);
      expect(checkHarmony(project).diagnostics.some(d => d.tick === 1920 && d.ruleId === inversion)).toBe(true);
    });

    it.each([
      ["导音移高八度", "G#3/4", "G#4/4"],
      ["在另一声部到达小调主音", "G#3/4 A3/4", "G#3/4 C4/4"],
      ["属七音反向", "D5/4 C5/4", "D5/4 E5/4"],
      ["不同的外音角色", "role=passing", "role=neighbor"],
      ["上方声部在经过音处重新起奏", "G#4/2", "G#4/4. G#4/8"],
      ["省掉结构五音", "B4/2", "E5/2"],
      ["回主之前有休止", "G#3/4 A3/4", "G#3/8 r/8 A3/4"],
      ["到点标成属原位", "V65/4", "V7/4"],
    ])("%s时保留转位错误", (_label, from, to) => {
      expect(findings(score.replace(from, to))).toContain(inversion);
    });

    it.each([1440, 1920, 2400, 2880])("句界 %i 隔开取证时保留原诊断", cut => {
      expect(findings(score, cut)).toContain(inversion);
    });
  });
});

describe("同步外声部辅助音与转位低音", () => {
  function example({ soprano = "F5", bass = "B2", returnBass = "C3", first = "I6", last = "I6" } = {}) {
    return compileScoreText(`satb 1
key Ab major
meter 2/4
bars 1..2 {
  S: | Eb5/4 Eb5/8 ${soprano}/8 | Eb5/4 C5/4 |
  A: | Ab4/2 | Ab4/2 |
  T: | Ab3/2~ | Ab3/2 |
  B: | C3/4. ${bass}/8 | ${returnBass}/2 |
  H: | ${first}/2 | ${last}/2 |
}`).project;
  }

  function inversionErrors(project: ReturnType<typeof example>) {
    return checkHarmony(project).diagnostics.filter(item => item.ruleId === "chord.inversion-bass");
  }

  describe("转位检查识别外声部同步辅助音", () => {
    it.each(["F5", "D5"])("两个外声同时按书写级进折返 %s，两个内声保留支持", soprano => {
      const project = example({ soprano });
      // The two authored regions are separate even though their meanings agree.
      expect(project.chordTrack.regions).toHaveLength(2);
      expect(inversionErrors(project)).toEqual([]);
    });

    it("两侧标注的局部调字段顺序不影响转位检查，真正换调仍报", () => {
      const project = example();
      const [first, last] = project.chordTrack.regions.map(region => region.semantics!.interpretations[0]);
      first.localKey = { tonic: { step: "A", alter: -1 }, mode: "major" };
      last.localKey = { mode: "major", tonic: { alter: -1, step: "A" } };
      expect(inversionErrors(project)).toEqual([]);

      last.localKey.mode = "minor";
      expect(inversionErrors(project)).toContainEqual(expect.objectContaining({
        tick: 1.5 * project.ppq, voiceIds: ["bass"],
      }));
    });

    it.each([
      ["落点改成真实根位", { returnBass: "Ab2", last: "I" }],
      ["出发标注转位写错", { first: "I" }],
      ["返回仍是其它标注转位", { last: "I" }],
      ["同音异名离开", { bass: "Cb3" }],
      ["中间实写一个完整的下属三和弦", { bass: "Db3", soprano: "F5" }],
    ])("%s 时仍报低音与转位不一致", (_description, options) => {
      const project = example(options);
      expect(inversionErrors(project)).toEqual(expect.arrayContaining([
        expect.objectContaining({ tick: 1.5 * project.ppq, severity: "error", voiceIds: ["bass"] }),
      ]));
    });

    it("出发和弦位置没有装饰时，有实写三音低音仍需标成第一转位", () => {
      const project = example({ first: "I" });
      expect(inversionErrors(project)).toEqual(expect.arrayContaining([
        expect.objectContaining({ tick: 0, severity: "error" }),
      ]));
    });

    it("回到同一和弦前的手工句界阻止合并", () => {
      const project = example();
      project.structure.phraseBoundaries = [{
        id: "phrase-cut", tick: 2 * project.ppq, source: "manual", confidence: "certain",
      }];
      expect(inversionErrors(project)).toEqual(expect.arrayContaining([
        expect.objectContaining({ tick: 1.5 * project.ppq, severity: "error" }),
      ]));
    });

    it("平行纯五度不视为这类平行辅助音，原规则和转位均报告", () => {
      const project = compileScoreText(`satb 1
key Ab major
meter 2/4
bars 1..2 {
  S: | Eb5/4 Eb5/8 D5/8 | Eb5/2 |
  A: | C5/2 | C5/2 |
  T: | Ab3/2~ | Ab3/2 |
  B: | Ab2/4. G2/8 | Ab2/2 |
  H: | I/2 | I/2 |
}`).project;
      const tick = 1.5 * project.ppq;
      const diagnostics = checkHarmony(project).diagnostics.filter(item => item.tick === tick);
      expect(diagnostics.map(item => item.ruleId)).toEqual(expect.arrayContaining([
        "voice-leading.parallel-fifths", "chord.inversion-bass",
      ]));
    });
  });
});

describe("外声部辅助音与和弦构成音诊断", () => {
  const score = `satb 1
key G minor
meter 2/4
bars 1..2 {
 S: | G5/4. F#5/8 | G5/2 |
 A: | D4/2~ | D4/2 |
 T: | G3/2~ | G3/2 |
 B: | Bb2/4. C3/8 | Bb2/2 |
 H: | i6/2 | i6/2 |
}`;
  const inversion = "chord.inversion-bass";
  const unclassified = "chord.unclassified-nonchord-tone";
  const incomplete = "chord.incomplete-members";
  const ruleIds = [inversion, unclassified, incomplete];

  const projectFor = (input = score) => compileScoreText(input).project;

  function atNeighbors(project: ReturnType<typeof projectFor>) {
    return checkHarmony(project).diagnostics.filter(d => d.tick >= project.ppq * 1.5 && d.tick < project.ppq * 2 && ruleIds.includes(d.ruleId));
  }

  describe("Chord diagnostics use the proved outer-voice neighbors", () => {
    it("identifies the pair and the bracketed complete voicings", () => {
      expect(atNeighbors(projectFor())).toEqual([]);
    });

    it("follows the same written key through a repeated declaration", () => {
      const project = projectFor();
      project.keyEvents.push({ ...project.keyEvents[0], id: "reminder", tick: 1.75 * project.ppq });
      expect(atNeighbors(project)).toEqual([]);
    });

    it("keeps the reports when the mode changes and returns within the neighbor", () => {
      const project = projectFor();
      project.keyEvents.push(
        { ...project.keyEvents[0], mode: "major", id: "changed", tick: 1.625 * project.ppq },
        { ...project.keyEvents[0], id: "restored", tick: 1.875 * project.ppq },
      );
      expect(new Set(atNeighbors(project).map(item => item.ruleId))).toEqual(new Set(ruleIds));
    });

    it.each([
      ["an unresolved bass", score.replace("Bb2/2 |", "A2/2 |")],
      ["a soprano leap", score.replace("F#5/8", "E5/8")],
      ["a contradictory return inversion", score.replace("i6/2 | i6/2", "i6/2 | i/2")],
    ])("preserves every report for %s", (_description, text) => {
      expect(atNeighbors(projectFor(text)).map(item => item.ruleId).sort()).toEqual([...ruleIds].sort());
    });

    it("reports a simultaneous unrelated inner error", () => {
      const project = projectFor(score.replace("D4/2~ | D4/2", "D4/4. Eb4/8 | D4/2"));
      const result = atNeighbors(project);
      expect(result).toContainEqual(expect.objectContaining({
        ruleId: unclassified, voiceIds: expect.arrayContaining(["alto"]),
      }));
      expect(result.map(item => item.ruleId).sort()).toEqual([...ruleIds].sort());
    });

    it("keeps the existing role veto for both a required fifth and a repeated root", () => {
      const required = projectFor();
      required.satbTracks.find(track => track.voice === "alto")!.notes[0].nonChordToneRole = "other";
      expect(atNeighbors(required).map(item => item.ruleId).sort()).toEqual([...ruleIds].sort());
      const redundant = projectFor();
      redundant.satbTracks.find(track => track.voice === "tenor")!.notes[0].nonChordToneRole = "other";
      expect(atNeighbors(redundant).map(item => item.ruleId).sort()).toEqual([...ruleIds].sort());
    });
  });
});

describe("经过、先现低音与和弦转位", () => {
  function bassProject(previous: string, ornament: string, target: string, role: string,
    bassLine = `${previous}/2 ${previous}/4 ${ornament}/4@ornament | ${target}/1`,
    chords = "I/1 | I6/1", soprano = "G4/1 | C5/1") {
    return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | ${soprano} |
 A: | E4/1 | G4/1 |
 T: | C4/1 | C4/1 |
 B: | ${bassLine} |
 H: | ${chords} |
}
${role ? "annotations {\n note ornament role=" + role + "\n}" : ""}`).project;
  }

  describe("经过低音与标注转位", () => {
    it.each([
      ["C3", "D3", "E3", "passing", false],
      ["C3", "D3", "E3", "", true],
      ["C3", "D3", "E3", "other", true],
      ["E3", "D3", "E3", "passing", true],
      ["C3", "D3", "F3", "passing", true],
      ["C3", "G3", "E3", "passing", true],
      ["C3", "D4", "E3", "passing", true],
    ] as const)("%s–%s–%s, role=%s, 应报=%s", (previous, passing, target, role, reports) => {
      const project = bassProject(previous, passing, target, role);
      const errors = checkHarmony(project).diagnostics.filter(item =>
        item.ruleId === "chord.inversion-bass" && item.tick === 3 * project.ppq && item.severity === "error");
      expect(errors.length > 0).toBe(reports);
    });

    it.each([
      ["改变前转位", "C3/2 C3/4 D3/4@ornament | E3/1", "I6/1 | I6/1", 3, true],
      ["改变后转位", "C3/2 C3/4 D3/4@ornament | E3/1", "I/1 | I/1", 3, true],
      ["终点前休止", "C3/2 D3/4@ornament r/4 | E3/1", "I/1 | I6/1", 2, true],
      ["经过音长于前音", "C3/4 D3/2.@ornament | E3/1", "I/1 | I6/1", 1, true],
      ["变化经过音", "E3/2 F#3/4@ornament G3/4 | G3/1", "I6/2. I64/4 | I64/1", 2, true],
      ["次强拍", "C3/2 D3/2@ornament | E3/1", "I/1 | I6/1", 2, false],
      ["下行连接转位", "E3/2 E3/4 D3/4@ornament | C3/1", "I6/1 | I/1", 3, false],
    ] as const)("%s", (_label, bassLine, chords, beat, reports) => {
      const project = bassProject("C3", "D3", "E3", "passing", bassLine, chords);
      expect(checkHarmony(project).diagnostics.some(item =>
        item.ruleId === "chord.inversion-bass" && item.tick === beat * project.ppq)).toBe(reports);
    });

    it("上声部重新起奏不把持续的经过音变成结构音", () => {
      const project = bassProject("C3", "D3", "E3", "passing", undefined, undefined, "G4/2. G4/8 G4/8 | C5/1");
      expect(checkHarmony(project).diagnostics.some(item => item.ruleId === "chord.inversion-bass")).toBe(false);
    });

    it.each([3.5, 4])("在拍位 %s 起奏，占据下一小节强拍时仍报错", onset => {
      const project = bassProject("C3", "D3", "E3", "passing");
      const notes = project.satbTracks.find(track => track.voice === "bass")!.notes;
      const start = onset * project.ppq;
      const landing = start + project.ppq;
      notes[1].durationTicks = start - notes[1].startTick;
      notes[2].startTick = start;
      notes[3].startTick = landing;
      notes[3].durationTicks = project.lengthTicks - landing;
      const [source, target] = project.chordTrack.regions;
      source.durationTicks = landing;
      target.startTick = landing;
      target.durationTicks = project.lengthTicks - landing;
      expect(checkHarmony(project).diagnostics.some(item =>
        item.ruleId === "chord.inversion-bass" && item.tick === start)).toBe(true);
    });
  });

  describe("先现低音与标注转位", () => {
    it.each([
      ["目标重奏过短", "C3/2 C3/4 B2/4@ornament | B2/8 B2/8 B2/2.", "I/1 | V6/1", 3],
      ["换和弦后才重奏", "C3/2 C3/4 B2/4@ornament~ | B2/8 B2/8 B2/2.", "I/1 | V6/1", 3],
      ["次强拍提前起奏", "C3/2 B2/2@ornament | B2/1", "I/1 | V6/1", 2],
    ] as const)("%s 时不豁免", (_label, line, chords, onset) => {
      const project = bassProject("C3", "B2", "B2", "anticipation", line, chords);
      expect(checkHarmony(project).diagnostics.some(item => item.ruleId === "chord.inversion-bass" &&
        item.tick === onset * project.ppq && item.severity === "error")).toBe(true);
    });

    it.each([
      ["弱拍先现并在换和弦时重奏", "C3", "B2", "B2", "anticipation", "I/1 | V6/1", false],
      ["未标角色", "C3", "B2", "B2", "", "I/1 | V6/1", true],
      ["无明确角色", "C3", "B2", "B2", "other", "I/1 | V6/1", true],
      ["重奏时换八度", "C3", "B2", "B3", "anticipation", "I/1 | V6/1", true],
      ["同音异名", "C3", "Cb3", "B2", "anticipation", "I/1 | V6/1", true],
      ["前一和弦转位不符", "C3", "B2", "B2", "anticipation", "I6/1 | V6/1", true],
      ["后一和弦转位不符", "C3", "B2", "B2", "anticipation", "I/1 | V/1", true],
      ["中间低音是当前和弦的三音", "C3", "E3", "E3", "anticipation", "I/1 | I6/1", true],
    ] as const)("%s", (_label, previous, ornament, target, role, chords, reports) => {
      const project = bassProject(previous, ornament, target, role, undefined, chords);
      expect(checkHarmony(project).diagnostics.some(item => item.ruleId === "chord.inversion-bass" &&
        item.tick === 3 * project.ppq && item.severity === "error")).toBe(reports);
    });
  });
});

describe("重属改记后的构成音与外音", () => {
  interface Example {
    key?: string;
    event?: string;
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    preparation?: string;
    source?: string;
    landing?: string;
    dominant?: string;
    noteRole?: string;
  }

  function make({
    key = "F major", event = "",
    soprano = "G4/4 G#4/4 A4/4 G4/4",
    alto = "D4/4 F4/4 F4/4 E4/4",
    tenor = "D3/4 D3/4 C3/4 C3/4",
    bass = "Bb2/4 B2/4 C3/2",
    preparation = "ii6", source = "DDVII7", landing = "K46", dominant = "V",
    noteRole = "",
  }: Example = {}) {
    return compileScoreText(`satb 1
key ${key}
meter 4/4
${event}
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
}
annotations {
 chord prep range=[1:1,1:2) symbol=${preparation}
 ${source ? `chord dd range=[1:2,1:3) symbol=${source}` : ""}
 ${landing ? `chord landing range=[1:3,1:4) symbol=${landing}` : ""}
 ${dominant ? `chord target range=[1:4,2:1) symbol=${dominant}` : ""}
 ${noteRole}
}`).project;
  }

  function diagnostics(project: ProjectDocument) {
    return checkHarmony(project).diagnostics;
  }

  function memberWarnings(project: ProjectDocument) {
    return diagnostics(project).filter(d => d.tick === project.ppq &&
      ["chord.incomplete-members", "chord.unclassified-nonchord-tone"].includes(d.ruleId))
      .map(({ ruleId, noteIds }) => ({ ruleId, noteIds }));
  }

  function expectBoth(project: ProjectDocument) {
    expect(memberWarnings(project).map(item => item.ruleId).sort()).toEqual([
      "chord.incomplete-members", "chord.unclassified-nonchord-tone",
    ]);
  }

  const firstInversion: Example = {
    soprano: "D5/4 G#5/4 A5/4 Bb5/4",
    alto: "F4/4 F4/4 F4/4 E4/4",
    tenor: "Bb3/4 B3/4 C4/4 C4/4",
    bass: "Bb2/4 D3/4 C3/4 C2/4",
    preparation: "IV", source: "DDVII65", dominant: "V7",
  };

  describe("D.1/D.2: dominant preparation with a written raised second", () => {
    it("accepts the explicit DDVII functional label", () => {
      expect(memberWarnings(make())).toEqual([]);
    });

    it("accepts an unlabelled K46 only with a written fourth resolving into the dominant", () => {
      expect(memberWarnings(make({ landing: "" }))).toEqual([]);
      expectBoth(make({
        landing: "",
        alto: "D4/4 F4/4 F4/4 C4/4", tenor: "D3/4 D3/4 C3/4 E3/4",
      }));
    });

    it("also accepts the explicit vii°7/V spelling of DDVII", () => {
      expect(memberWarnings(make({ source: "viio7/V" }))).toEqual([]);
    });

    it("accepts a first inversion with the actual lowest voice moving down to V", () => {
      expect(memberWarnings(make(firstInversion))).toEqual([]);
    });

    it("accepts a four-voice root-position dominant seventh with an omitted fifth and doubled root", () => {
      expect(memberWarnings(make(firstInversion))).toEqual([]);
      expect(memberWarnings(make({ ...firstInversion, tenor: "Bb3/4 B3/4 C4/4 G3/4" }))).toEqual([]);
      expect(memberWarnings(make({ ...firstInversion, tenor: "Bb3/4 B3/4 C4/4 E3/4" })))
        .toHaveLength(2);
    });

    it("accepts an explicitly consistent local major key", () => {
      expect(memberWarnings(make({
        key: "D minor",
        preparation: 'ii6 localKey="F major"', source: 'DDVII7 localKey="F major"',
        landing: 'K46 localKey="F major"', dominant: 'V localKey="F major"',
      }))).toEqual([]);
    });

    it.each<[string,Example]>([
      ["wrong written pitch at source", {soprano:"G4/4 A4/4 A4/4 G4/4"}],
      ["conventional member in a wrong enharmonic spelling elsewhere", {bass:"Bb2/4 Cb3/4 C3/2"}],
      ["incomplete source", {alto:"D4/4 D4/4 F4/4 E4/4"}],
      ["source voice missing", {alto:"D4/4 r/4 F4/4 E4/4"}],
      ["unresolved raised second despite a complete K46", {
        soprano:"G4/4 G#4/4 F4/4 G4/4", alto:"D4/4 F4/4 A4/4 E4/4",
      }],
      ["substitute reaches its third an octave away", {soprano:"G4/4 G#4/4 A5/4 G4/4"}],
      ["DD leading note moves to V in the wrong octave", {bass:"Bb2/4 B2/4 C2/2"}],
      ["nominal bass is above a real voice", {...firstInversion, tenor:"Bb3/4 B2/4 C4/4 C4/4"}],
      ["common note transferred to another voice", {
        soprano:"G4/4 G#4/4 A4/4 G4/4", alto:"D4/4 F4/4 C4/4 E4/4", tenor:"D3/4 D3/4 F3/4 C3/4",
      }],
      ["unresolved functional interpretation", {source:"DDVII7 confidence=ambiguous"}],
      ["different functional target", {source:"viio7/II"}],
      ["contradicted inversion", {source:"DDVII65"}],
      ["plain tonic six-four", {landing:"I64 role=pedal64"}],
      ["unvoiced cadential third", {soprano:"G4/4 G#4/4 C5/4 G4/4"}],
      ["missing dominant label", {dominant:""}],
      ["missing sounding dominant", {alto:"D4/4 F4/4 F4/4 F4/4"}],
      ["conflicting predominant", {preparation:"I6"}],
      ["change of actual key inside the resolution", {
        event:"at 1:4 key C major", dominant:'V localKey="F major"',
      }],
    ])("keeps an applicable D.1/D.2 warning with %s", (_name, example) => {
      const project = make(example);
      const warnings = memberWarnings(project);
      expect(warnings.map(item => item.ruleId)).toContain("chord.unclassified-nonchord-tone");
      if (_name !== "source voice missing") expectBoth(project);
    });

    it.each([960, 1440, 1920, 2400, 2880])("keeps both reports across a manual boundary at %i", tick => {
      const project = make();
      project.structure.phraseBoundaries.push({ id:"cut",tick,source:"manual",confidence:"certain" });
      expectBoth(project);
    });

    it("retains the missing member if the written raised second is already marked non-chord", () => {
      expect(memberWarnings(make({ noteRole:"note S@1:2 role=passing" })).map(item => item.ruleId))
        .toEqual(["chord.incomplete-members"]);
    });

    it("does not treat a configured competing interpretation as permission", () => {
      const project = make();
      const chord = project.chordTrack.regions.find(region=>region.startTick === project.ppq)!;
      const semantics = chord.semantics!;
      const other = { ...semantics.interpretations[0], id:"other", localKey:{tonic:{step:"C",alter:0},mode:"major"} } as const;
      chord.semantics = { ...semantics, alternatives: [other] };
      expectBoth(project);
      chord.semantics = { ...semantics, interpretations: [...semantics.interpretations,other] };
      expectBoth(project);
    });

    it("also preserves the traditional seventh obligation", () => {
      const correct = make({
        soprano:"G4/4 Ab4/4 G4/4 G4/4",
        alto:"D4/4 F4/4 E4/4 E4/4",
        preparation:"ii6", landing:"V", bass:"Bb2/4 B2/4 C3/2",
      });
      const risingSeventh = { soprano:"G4/4 Ab4/4 A4/4 G4/4" };
      const cadential = make(risingSeventh);
      const pedal = make({ ...risingSeventh, landing:"I64 role=pedal64" });
      const seventhWarnings = (project: ProjectDocument) => diagnostics(project).filter(d =>
        d.ruleId === "resolution.chord-seventh" && d.noteIds.includes("note-S-960"));
      expect(seventhWarnings(correct)).toEqual([]);
      expect(seventhWarnings(cadential)).toEqual([]);
      expect(diagnostics(cadential)).toContainEqual(expect.objectContaining({
        ruleId: "melody.augmented-interval", tick: 1920,
        voiceIds: ["soprano"], message: expect.stringContaining("A♭4 宜写为 G♯"),
      }));
      expect(seventhWarnings(pedal).map(d=>[d.tick,d.severity])).toEqual([[1920,"warning"]]);
    });
  });


  describe("D.1/D.2: boundaries of the written member exemption", () => {
    it.each([
      ["extra preparation tone", { alto: "E4/4 F4/4 F4/4 E4/4" }],
      ["dominant seventh doubles the third", { ...firstInversion, tenor: "Bb3/4 B3/4 C4/4 E3/4" }],
      ["reattack inside K46", { alto: "D4/4 F4/4 F4/8 F4/8 E4/4" }],
    ] satisfies [string, Example][])("keeps both reports with %s", (_name, example) => {
      expectBoth(make(example));
    });
  });
});

describe("七和弦换位后的构成音", () => {
  const exercise = `satb 1
key D major
meter 4/4
bars 1..1 {
  S: | A4/2 A4/2 |
  A: | G4/2 F#4/2 |
  T: | E4/4 A3/4 D4/2 |
  B: | C#3/2 D3/2 |
  H: | D65/2 T/2 |
}`;
  const missingRule = "chord.incomplete-members";
  const missingAt = (project: ProjectDocument, tick: number = project.ppq) =>
    checkHarmony(project).diagnostics.filter(d => d.ruleId === missingRule && d.tick === tick);
  const score = (text = exercise) => compileScoreText(text).project;

  describe("member check after a complete written seventh", () => {
    it("assesses the complete first inversion when only the tenor substitutes the root for the fifth", () => {
      expect(missingAt(score())).toEqual([]);
    });

    it.each([
      ["minor7", `satb 1
key G major
meter 2/4
bars 1..1 {
  S: | E5/8 A5/8 F#5/4 |
  A: | C5/4 A4/4 |
  T: | A3/4 D4/4 |
  B: | G3/4 D3/4 |
  H: | ii2/4 V/4 |
}`],
      ["major7", `satb 1
key G major
meter 2/4
bars 1..1 {
  S: | D5/8 G5/8 E5/4 |
  A: | B4/4 C5/4 |
  T: | G4/4 G4/4 |
  B: | F#3/4 E3/4 |
  H: | I2/4 IV6/4 |
}`],
    ])("assesses the full %s in third inversion before the soprano exchanges the fifth", (_quality, text) => {
      const project = score(text);
      expect(missingAt(project, project.ppq / 2)).toEqual([]);
    });

    it.each([
      ["incomplete first statement", "E4/4 A3/4", "A4/4 A3/4"],
      ["a second moving part", "G4/2 F#4/2", "G4/4 G3/4 F#4/2"],
      ["a second rearticulated upper part", "A4/2 A4/2", "A4/4 A4/4 A4/2"],
      ["the original bass rearticulating", "C#3/2 D3/2", "C#3/4 C#3/4 D3/2"],
      ["an enharmonic fifth in the first statement", "E4/4 A3/4", "Fb4/4 A3/4"],
      ["an upper part sounding below the stated bass", "E4/4 A3/4", "E2/4 A2/4"],
      ["a separate same-name short chord", "D65/2 T/2", "D65/4 D65/4 T/2"],
    ])("continues to report fifth omission with %s", (_label, from, to) => {
      const project = score(exercise.replace(from, to));
      expect(missingAt(project)).toMatchObject([{ params: { missing: "E" } }]);
    });

    it("keeps the omitted seventh warning when the seventh is the member that moves", () => {
      const changed = exercise.replace("G4/2 F#4/2", "E4/2 F#4/2").replace("E4/4 A3/4", "G4/4 A3/4");
      expect(missingAt(score(changed))).toMatchObject([{ params: { missing: "G" } }]);
    });

    it("keeps the warning on an independent incomplete first attack in the next region", () => {
      const changed = exercise.replace("D65/2 T/2", "D65/4 vi2/4 T/2")
        .replace("G4/2 F#4/2", "G4/4 A4/4 F#4/2");
      const project = score(changed);
      expect(missingAt(project)).toHaveLength(1);
    });

    it.each([960, 1200])("respects the manual phrase boundary at %i", tick => {
      const project = score();
      project.structure.phraseBoundaries.push({ id: "cut", tick, source: "manual", confidence: "certain" });
      expect(missingAt(project)).toHaveLength(1);
    });

    it("retains an omission when the alleged fifth is already labelled as passing", () => {
      const project = score();
      project.satbTracks[2].notes[0].nonChordToneRole = "passing";
      expect(missingAt(project)).toHaveLength(1);
    });

    it("retains the warning when the key event changes between the two attacks", () => {
      const project = score();
      project.keyEvents.push({ ...project.keyEvents[0], id: "new-key", tick: project.ppq, mode: "minor" });
      expect(missingAt(project)).toHaveLength(1);
    });

    it("retains the configured result for an applied-function interpretation", () => {
      const project = score(exercise.replace("key D major", "key G major").replace("D65/2 T/2", "V65/V/2 V/2"));
      expect(missingAt(project)).toMatchObject([{ params: { missing: "E" } }]);
    });

    it("retains an omitted fifth in a half-diminished seventh", () => {
      const halfDiminished = `satb 1
key C minor
meter 2/4
bars 1..1 {
  S: | Ab4/8 D5/8 Eb5/4 |
  A: | F4/4 G4/4 |
  T: | D4/4 C4/4 |
  B: | C3/4 C3/4 |
  H: | iiø2/4 i/4 |
}`;
      const project = score(halfDiminished);
      expect(missingAt(project, project.ppq / 2)).toMatchObject([{ params: { missing: "A♭" } }]);
    });

    it("retains an omitted fifth for a span longer than a quarter", () => {
      const sustained = `satb 1
key D major
meter 4/4
bars 1..1 {
  S: | A4/1 |
  A: | G4/1 |
  T: | E4/2 A3/2 |
  B: | C#3/1 |
  H: | D65/1 |
}`;
      const project = score(sustained);
      expect(missingAt(project, 2 * project.ppq)).toHaveLength(1);
    });

    it("retains an omitted fifth at an equally strong metric position", () => {
      const bothWeak = `satb 1
key D major
meter 3/4
bars 1..1 {
  S: | A4/4 A4/2 |
  A: | F#4/4 G4/2 |
  T: | D4/4 E4/4 A3/4 |
  B: | D3/4 C#3/2 |
  H: | T/4 D65/2 |
}`;
      const project = score(bothWeak);
      expect(missingAt(project, 2 * project.ppq)).toHaveLength(1);
    });

    it("still records an unresolved seventh on the next real harmony", () => {
      const project = score(exercise.replace("G4/2 F#4/2", "G4/2 A4/2"));
      const diagnostics = checkHarmony(project).diagnostics;
      expect(missingAt(project)).toEqual([]);
      expect(diagnostics).toContainEqual(expect.objectContaining({ ruleId: "resolution.chord-seventh", tick: 1920 }));
    });
  });
});

describe("三和弦尾部装饰中的外音和缺音", () => {
  const contrary = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | E5/8 D5/8 C5/2. |
 A: | G4/1 |
 T: | C4/8 D4/8 E4/2. |
 B: | C3/1 |
 H: | I/1 |
}`;

  const neighbor = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | C4/1 |
 A: | G3/1 |
 T: | E3/8 D3/8 E3/2. |
 B: | G2/1 |
 H: | I64/1 |
}`;

  function warnings(score: string, boundary = false) {
    const { project } = compileScoreText(score);
    project.chordTrack.regions[0].durationTicks = project.ppq;
    if (boundary) project.structure.phraseBoundaries = [{
      id: "break", tick: project.ppq, source: "manual", confidence: "certain",
    }];
    return checkHarmony(project).diagnostics.filter(d =>
      d.tick === project.ppq / 2 && ["chord.unclassified-nonchord-tone", "chord.incomplete-members"].includes(d.ruleId),
    ).map(d => d.ruleId).sort();
  }

  const bothWarnings = ["chord.incomplete-members", "chord.unclassified-nonchord-tone"];

  describe("从标签后的实际配置核对弱位外音和缺音", () => {
    it("反向经过音与单下辅助音均可通过同一和声的实奏核对", () => {
      expect(warnings(contrary)).toEqual([]);
      expect(warnings(neighbor)).toEqual([]);
    });

    it.each([
      ["右端缺少应回的三音", neighbor.replace("D3/8 E3", "D3/8 D3")],
      ["另一声部重新起奏", contrary.replace("G4/1", "G4/4 G4/2.")],
      ["不同书写的实际音级", contrary.replace("D4/8", "D#4/8")],
      ["右端另有明确标签", contrary.replace("I/1", "I/4 vi/2.")],
    ])("%s 保留原拍两条警告", (_reason, score) => {
      expect(warnings(score)).toEqual(bothWarnings);
    });

    it("手动句界在恢复音处切断证据", () => {
      expect(warnings(neighbor, true)).toEqual(bothWarnings);
    });
  });
});

describe("和弦构成音拼写与 Phase B 金样本", () => {
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

    it("和弦双重解释不妨碍基于 identity 的拼写检查", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ;
      const chord = fSharpMajorRegion(true);
      chord.semantics = {
        ...chord.semantics!,
        interpretations: [
          ...chord.semantics!.interpretations,
          {
            id: "confirmed-pivot-reading",
            localKey: { tonic: { step: "B", alter: 0 }, mode: "major" },
            degree: 5,
            degreeAlteration: 0,
            source: "confirmed",
            confidence: "certain",
          },
        ],
      };
      project.chordTrack.regions = [chord];
      setNotes(project, "soprano", [
        note(
          "wrong-g-flat-with-pivot",
          0,
          PPQ,
          HARMONY_PHASE_B_GOLDEN.enharmonicChordTone.wrongEnharmonicTone,
        ),
      ]);

      expect(
        checkHarmony(project).diagnostics.find(
          (item) => item.ruleId === "chord.unclassified-nonchord-tone",
        )?.noteIds,
      ).toEqual(["wrong-g-flat-with-pivot"]);
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
          identity: tertianIdentity({ step: "G", alter: 0 }, "dominant7", {
            step: "G",
            alter: 0,
          }),
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
          identity: tertianIdentity({ step: "G", alter: 0 }, "dominant7", {
            step: "G",
            alter: 0,
          }),
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
  });
});
