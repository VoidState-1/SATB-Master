import { describe, expect, it } from "vitest";
import { createChordRegion } from "../../../../chords";
import type { SpelledPitch } from "../../../../pitch";
import {
  createEmptyProject,
  PPQ,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../../../../project";
import { compileScoreText } from "../../../../scoreText";
import { buildHarmonyAnalysis } from "../../../analysis";
import { checkHarmony } from "../../../registry";
import {
  diagnosticFor,
  functionalChord,
  manualCertain,
  pitch,
  setLine,
} from "../../../testing/fixtures/ruleProjects";
import { semantics, tertianIdentity } from "../../../testing/fixtures/writtenPitchProject";

describe("终止连接中的反行八度", () => {
  const major = `satb 1
key C major
meter 3/4
bars 1..2 {
 S: | A4/2 G4/4 | C5/2. |
 A: | F4/2 F4/4 | E4/2. |
 T: | C4/2 B3/4 | C4/2. |
 B: | F2/2 G3/4 | C3/2. |
 H: | IV/2 V7/4 | I/2. |
}`;

  const minor = `satb 1
key A minor
meter 3/4
bars 1..2 {
 S: | F5/2 E5/4 | A4/2. |
 A: | A4/2 G#4/4 | A4/2. |
 T: | D4/2 D4/4 | C4/2. |
 B: | D3/2 E3/4 | A3/2. |
 H: | iv/2 V7/4 | i/2. |
}`;

  function outerOctaves(project: ReturnType<typeof compileScoreText>["project"], tick = 2880) {
    return checkHarmony(project).diagnostics.filter(diagnostic =>
      diagnostic.ruleId === "voice-leading.parallel-octaves" && diagnostic.tick === tick &&
      diagnostic.voiceIds.includes("soprano") && diagnostic.voiceIds.includes("bass"),
    ).map(diagnostic => diagnostic.severity);
  }

  const ornamentedEnding = minor.replace("A4/2. |\n A:", "A4/2 r/4 |\n A:")
    .replace("A4/2. |\n T:", "A4/8 G#4/8 E4/4 r/4 |\n T:")
    .replace("C4/2.", "C4/8 B3/8 C4/4 r/4")
    .replace("A3/2.", "A3/4 A2/4 r/4").replace("i/2.", "i/8 r/8 i/4 r/4");

  describe("结束终止中的外声部反行八度", () => {
    it.each([
      ["大调扩张，保持准备音", major],
      ["小调收缩，保持准备音", minor],
      ["七音由连续下行级进进入", major.replace("F4/2 F4/4", "G4/2 F4/4")],
      ["实际静止至项目结束", major.replace("C5/2.", "C5/4 r/2")
        .replace("E4/2.", "E4/4 r/2").replace("C4/2.", "C4/4 r/2")
        .replace("C3/2.", "C3/4 r/2").replace("I/2.", "I/4 r/2")],
      ["持续主音上有短暂内声部装饰，末拍恢复主和弦", ornamentedEnding],
    ])("%s", (_label, text) => {
      expect(outerOctaves(compileScoreText(text).project)).toEqual([]);
    });

    it.each([
      ["普通八度复进，缺少实际功能依据", major.replace(" H: | IV/2 V7/4 | I/2. |\n", "")],
      ["主体继续，属主处不是全曲收束", major + `
bars 3..3 {
 S: | D5/2. |
 A: | B4/2. |
 T: | G4/2. |
 B: | G2/2. |
 H: | V/2. |
}`],
      ["没有前一实奏配音准备", major.replace("A4/2", "r/2")],
      ["男高实际低于属低音", major.replace("C4/2 B3/4 | C4/2.", "C3/2 B2/4 | C3/2.")],
      ["女低实际高于女高", major.replace("F4/2 F4/4 | E4/2.", "F5/2 F5/4 | E5/2.")],
      ["七音由四度跳入", major.replace("F4/2 F4/4", "C4/2 F4/4")],
      ["七音不在原声部解决", major.replace("E4/2.", "C4/2.").replace("C4/2. |\n B:", "E4/2. |\n B:")],
      ["导音等音改写", major.replace("C4/2. |\n B:", "B#3/2. |\n B:")],
      ["属五音取代导音", major.replace("C4/2 B3/4", "C4/2 D4/4")],
      ["外声部同向，即使实奏不完全属七到主和弦", major.replace("C3/2.", "C4/2.")],
      ["和弦标签与实响冲突", major.replace("I/2.", "vi/2.")],
      ["内声部装饰时低音同时换八度", ornamentedEnding.replace("A3/4 A2/4", "A3/8 A2/8 A2/4")],
    ])("%s 仍报", (_label, text) => {
      expect(outerOctaves(compileScoreText(text).project)).toEqual(["error"]);
    });

    it("跨过明确句界仍报", () => {
      const { project } = compileScoreText(major);
      project.structure.phraseBoundaries.push({ id: "manual-cut", tick: 2880, source: "manual", confidence: "certain" });
      expect(outerOctaves(project)).toEqual(["error"]);
    });

    it("斯波索宾例 10-120 第一组的原位属三到主仍报", () => {
      const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | G5/2 C5/2 |
 A: | B4/2 G4/2 |
 T: | D4/2 E4/2 |
 B: | G3/2 C4/2 |
 H: | V/2 I/2 |
}`);
      expect(outerOctaves(project, 1920)).toEqual(["error"]);
    });
  });
});

describe("终止四六的准备与属功能连接", () => {
  describe("Phase B v1 书写与和弦金样本", () => {
    it("终止四六必须连续进入属功能", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      project.chordTrack.regions = [
        {
          id: "cadential-64",
          startTick: 0,
          durationTicks: PPQ,
          identity: tertianIdentity({ step: "C", alter: 0 }, "major", {
            step: "G",
            alter: 0,
          }),
          semantics: semantics(1, { cadenceRole: "cadential64" }),
          locked: false,
        },
        {
          id: "tonic",
          startTick: PPQ,
          durationTicks: PPQ,
          identity: tertianIdentity({ step: "C", alter: 0 }, "major", {
            step: "C",
            alter: 0,
          }),
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
  });

  describe("终止四六的连接", () => {
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
  });
});

describe("终止四六中的双重延留连接", () => {
  type Source = "DD++43" | "Ger+6" | "viio7/V";
  function music(source: Source, overrides: Partial<Record<"soprano" | "alto" | "tenor" | "bass" | "target", string>> = {}) {
    const diminished = source === "viio7/V";
    return compileScoreText(`satb 1
key G major
meter 4/4
bars 1..2 {
  S: | E5/2 ${diminished ? "E5" : "C#5"}/2~ | ${overrides.soprano ?? (diminished ? "E5/4 D5/2." : "C#5/4 D5/2.")} |
  A: | G4/1~ | ${overrides.alto ?? "G4/1"} |
  T: | C4/2 A#3/2~ | ${overrides.tenor ?? "A#3/4 B3/2."} |
  B: | C3/2 ${diminished ? "C#3" : "Eb3"}/2 | ${overrides.bass ?? "D3/1"} |
  H: | IV/2 ${source}/2 | ${overrides.target ?? "K46/1"} |
}`).project;
  }

  const rule = "chord.unclassified-nonchord-tone";
  function outside(project: ReturnType<typeof music>) {
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === rule && d.tick === 4 * project.ppq);
  }

  describe("属低音先到，两个延留声部在 K46 内解决", () => {
    it.each(["DD++43", "Ger+6", "viio7/V"] as const)("根据实音核对 %s 的两个声部", source => {
      const project = music(source);
      const original = structuredClone(project);
      expect(outside(project)).toEqual([]);
      expect(project).toEqual(original);
      if (source === "Ger+6") {
        expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
          ruleId: "chord.augmented-sixth-voicing", tick: 2 * project.ppq,
        }));
      }
    });

    it.each(["DD++43", "viio7/V"] as const)("保留 %s 的显式角色及另一声部的独立提示", source => {
      const project = music(source);
      const held = project.satbTracks.find(t => t.voice === "tenor")!.notes[1];
      held.nonChordToneRole = "neighbor";
      expect(outside(project)).toContainEqual(expect.objectContaining({
        severity: "warning", voiceIds: ["soprano"],
      }));
      expect(held.nonChordToneRole).toBe("neighbor");
    });

    it.each(["DD++43", "viio7/V"] as const)("%s 的错音区、重奏、迟解和跨界保留 D.1", source => {
      const badRelease = music(source, { tenor: "A#3/4 B4/2." });
      const changedBass = music(source, { bass: "D3/4 D3/2." });
      const differentLabel = music(source, { target: "I64/1" });
      const newAttack = music(source);
      const track = newAttack.satbTracks.find(t => t.voice === "tenor")!;
      const held = track.notes.find(n => n.startTick === 2 * newAttack.ppq)!;
      held.durationTicks = 2 * newAttack.ppq;
      track.notes.push({ ...held, id: "new-tenor", startTick: 4 * newAttack.ppq, durationTicks: newAttack.ppq });
      track.notes.sort((a, b) => a.startTick - b.startTick);
      const boundary = music(source);
      boundary.structure.phraseBoundaries.push({ id: "cut", tick: 4 * boundary.ppq, source: "manual", confidence: "certain" });
      const late = music(source, { soprano: (source === "DD++43" ? "C#5" : "E5") + "/2 D5/2", tenor: "A#3/2 B3/2" });
      const wrongSpelling = music(source);
      const third = wrongSpelling.satbTracks.find(t => t.voice === "tenor")!.notes[1];
      third.pitch = { step: "B", alter: -1, octave: 3 };
      const repeatedCommon = music(source, { alto: "G4/4 G4/2." });
      for (const project of [badRelease, changedBass, differentLabel, newAttack, boundary, late, wrongSpelling, repeatedCommon]) {
        expect(outside(project)).toContainEqual(expect.objectContaining({
          severity: "warning", voiceIds: ["soprano", "tenor"],
        }));
      }
    });
  });
});

describe("属、下属和弦与基础连接规则", () => {
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

  describe("H 组和弦连接规则体系（斯波索宾金样本与 QueryAPI 升级）", () => {
    it("Case H1-A: 标准完全属七到不完全主和弦（省略五音，三根一三）不误报共同音与导音", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      project.chordTrack.regions = [
        functionalChord(project, "dominant-seventh", 0, {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
        functionalChord(project, "tonic-incomplete", 1, {
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

      // D7 -> I 完全到不完全（省略五音，三个根音，一个三音）
      // S: F4 -> E4 (七音下行二度)
      // A: D4 -> C4 (五音下行二度)
      // T: B3 -> C4 (导音上行二度)
      // B: G2 -> C3 (根音跳进四度)
      setLine(project, "soprano", [pitch("F", 0, 4), pitch("E", 0, 4)]);
      setLine(project, "alto", [pitch("D", 0, 4), pitch("C", 0, 4)]);
      setLine(project, "tenor", [pitch("B", 0, 3), pitch("C", 0, 4)]);
      setLine(project, "bass", [pitch("G", 0, 2), pitch("C", 0, 3)]);

      expect(diagnosticFor(project, "connection.dominant-seventh")).toBeUndefined();
    });

    it("Case H1-B: 经过三四和弦 I - D34 - I6（低音 1->2->3 上行级进）判定合规", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 3;
      project.chordTrack.regions = [
        functionalChord(project, "tonic-1", 0, {
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
        functionalChord(project, "dominant-34", 1, {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 2, // D34
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
        functionalChord(project, "tonic-6", 2, {
          degree: 1,
          degreeAlteration: 0,
          quality: "major",
          inversion: 1, // I6
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "tonic",
          },
          ...manualCertain,
        }),
      ];

      // I - D34 - I6
      // B: C3 -> D3 -> E3 (低音平稳经过级进)
      // S: C5 -> B4 -> C5
      // A: G4 -> F4 -> E4
      // T: E4 -> D4 -> C4
      setLine(project, "soprano", [pitch("C", 0, 5), pitch("B", 0, 4), pitch("C", 0, 5)]);
      setLine(project, "alto", [pitch("G", 0, 4), pitch("F", 0, 4), pitch("E", 0, 4)]);
      setLine(project, "tenor", [pitch("E", 0, 4), pitch("D", 0, 4), pitch("C", 0, 4)]);
      setLine(project, "bass", [pitch("C", 0, 3), pitch("D", 0, 3), pitch("E", 0, 3)]);

      expect(diagnosticFor(project, "connection.dominant-seventh")).toBeUndefined();
    });

    it("Case H1-C: 内声部导音自由解决（Tenor 导音下行小三度跳至主和弦五音）判定合规", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      project.chordTrack.regions = [
        functionalChord(project, "dominant-seventh", 0, {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
        functionalChord(project, "tonic-complete", 1, {
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

      // D7 -> 完全主和弦（含五音 G）
      // S: F4 -> E4 (七音下行)
      // A: D4 -> C4 (五音下行)
      // T: B3 -> G3 (Tenor 内声部导音自由跳进到主和弦五音，实现完全主和弦！)
      // B: G2 -> C3 (低音根音跳进)
      setLine(project, "soprano", [pitch("F", 0, 4), pitch("E", 0, 4)]);
      setLine(project, "alto", [pitch("D", 0, 4), pitch("C", 0, 4)]);
      setLine(project, "tenor", [pitch("B", 0, 3), pitch("G", 0, 3)]);
      setLine(project, "bass", [pitch("G", 0, 2), pitch("C", 0, 3)]);

      expect(diagnosticFor(project, "connection.dominant-seventh")).toBeUndefined();
    });

    it("Case H1-D: 同和弦换位与时值切分不误判为异功能解决（same-harmony 前置拦截）", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      // 连续两个切片均为 D7（换声部排列）
      project.chordTrack.regions = [
        functionalChord(project, "dominant-seventh-1", 0, {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
        functionalChord(project, "dominant-seventh-2", 1, {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
      ];

      setLine(project, "soprano", [pitch("F", 0, 4), pitch("D", 0, 5)]);
      setLine(project, "alto", [pitch("D", 0, 4), pitch("B", 0, 4)]);
      setLine(project, "tenor", [pitch("B", 0, 3), pitch("F", 0, 4)]);
      setLine(project, "bass", [pitch("G", 0, 2), pitch("G", 0, 2)]);

      expect(diagnosticFor(project, "connection.dominant-seventh")).toBeUndefined();
    });

    it("Case H2-A: 四部属九和弦省略五音解决至主和弦，不误报共同音", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      project.chordTrack.regions = [
        functionalChord(project, "dominant-ninth", 0, {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          extensions: [9],
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
        functionalChord(project, "tonic", 1, {
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

      // D9 -> I
      // S: A4 -> G4 (九音下行至五音)
      // A: F4 -> E4 (七音下行至三音)
      // T: B3 -> C4 (导音上行至主音)
      // B: G2 -> C3 (根音跳进至主音)
      setLine(project, "soprano", [pitch("A", 0, 4), pitch("G", 0, 4)]);
      setLine(project, "alto", [pitch("F", 0, 4), pitch("E", 0, 4)]);
      setLine(project, "tenor", [pitch("B", 0, 3), pitch("C", 0, 4)]);
      setLine(project, "bass", [pitch("G", 0, 2), pitch("C", 0, 3)]);

      expect(diagnosticFor(project, "connection.dominant-ninth")).toBeUndefined();
    });

    it("Case H3-A: 导七和弦解决至属七和弦（DVII7 -> D7），后继功能与声部收缩判定合规", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      project.chordTrack.regions = [
        functionalChord(project, "leading-tone-seventh", 0, {
          degree: 7,
          degreeAlteration: 0,
          quality: "diminished7",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "side-degree",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
        functionalChord(project, "dominant-seventh", 1, {
          degree: 5,
          degreeAlteration: 0,
          quality: "dominant7",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "dominant",
          },
          ...manualCertain,
        }),
      ];

      // DVII7 -> D7
      // B: B2 -> G2 (导音三音 B 保持在上方，低音进入属音)
      // S: A-1 4 -> G4 (七音下行)
      // A: F4 -> F4 (七音保持)
      // T: D4 -> D4
      setLine(project, "soprano", [pitch("A", -1, 4), pitch("G", 0, 4)]);
      setLine(project, "alto", [pitch("F", 0, 4), pitch("F", 0, 4)]);
      setLine(project, "tenor", [pitch("B", 0, 3), pitch("B", 0, 3)]);
      setLine(project, "bass", [pitch("D", 0, 3), pitch("G", 0, 2)]);

      expect(diagnosticFor(project, "connection.leading-tone-seventh")).toBeUndefined();
    });

    it("Case H4-A: SII7 解决至 K46 时七音保持同音挂留，判定合规", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
      project.chordTrack.regions = [
        functionalChord(project, "supertonic-seventh", 0, {
          degree: 2,
          degreeAlteration: 0,
          quality: "minor7",
          inversion: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "side-degree",
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
      ];

      // SII7 (D-F-A-C) -> K46 (G-C-E-G)
      // S: A4 -> G4
      // A: C4 -> C4 (七音 C 作为六度音保持在同一声部！)
      // T: F4 -> E4
      // B: D3 -> G2
      setLine(project, "soprano", [pitch("A", 0, 4), pitch("G", 0, 4)]);
      setLine(project, "alto", [pitch("C", 0, 4), pitch("C", 0, 4)]);
      setLine(project, "tenor", [pitch("F", 0, 4), pitch("E", 0, 4)]);
      setLine(project, "bass", [pitch("D", 0, 3), pitch("G", 0, 2)]);

      expect(diagnosticFor(project, "connection.supertonic-seventh")).toBeUndefined();
    });

    it("Case H6-A: DD7 三音（升4级属调导音）规范上行半音至属音判定通过，跳走则准确报警", () => {
      const makeProject = (resolvedPitch: SpelledPitch) => {
        const project = createEmptyProject();
        project.lengthTicks = PPQ * 2;
        project.chordTrack.regions = [
          functionalChord(project, "double-dominant-seventh", 0, {
            degree: 2,
            degreeAlteration: 0,
            quality: "dominant7",
            inversion: 0,
            designation: {
              notationSystem: "spasobin",
              kind: "double-dominant",
              primaryFunction: "dominant",
            },
            ...manualCertain,
          }),
          functionalChord(project, "dominant", 1, {
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

        // DD7 (D - F# - A - C) -> V (G - B - D - G)
        // S: C5 -> B4 (七音下行至导音)
        // A: F#4 -> resolvedPitch (三音升4级属调导音，应上行半音至 G4)
        // T: A4 -> G4
        // B: D3 -> G2
        setLine(project, "soprano", [pitch("C", 0, 5), pitch("B", 0, 4)]);
        setLine(project, "alto", [pitch("F", 1, 4), resolvedPitch]);
        setLine(project, "tenor", [pitch("A", 0, 4), pitch("G", 0, 4)]);
        setLine(project, "bass", [pitch("D", 0, 3), pitch("G", 0, 2)]);
        return project;
      };

      // 正确上行半音至 G4: 合规
      expect(
        diagnosticFor(makeProject(pitch("G", 0, 4)), "connection.double-dominant-seventh"),
      ).toBeUndefined();

      // 错误下行至非和弦音 E4: 由通用和弦音规则报警
      const errorDiag = diagnosticFor(
        makeProject(pitch("E", 0, 4)),
        "chord.unclassified-nonchord-tone",
      );
      expect(errorDiag).toBeDefined();
    });

    it("Case H-Incomplete: e小调 SII34 -> D 原位不完全属和弦（BBDB 三根一三配置）不触发任何专用误报", () => {
      const project = createEmptyProject();
      project.keyEvents = [{
        id: "key-e-minor",
        tick: 0,
        tonic: { step: "E", alter: 0 },
        mode: "minor",
      }];
      project.lengthTicks = PPQ * 2;
      project.chordTrack.regions = [
        functionalChord(project, "sii34", 0, {
          degree: 2,
          degreeAlteration: 0,
          quality: "halfDiminished7",
          inversion: 2,
          designation: {
            notationSystem: "spasobin",
            kind: "side-degree",
            primaryFunction: "subdominant",
          },
          ...manualCertain,
        }),
        functionalChord(project, "dominant", 1, {
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

      // SII34 (C3, A3, E4, F#4) -> D (B2, B3, D#4, B4)
      // S: F#4 -> B4
      // A: E4 -> D#4 (七音下行解决至导音)
      // T: A3 -> B3
      // B: C3 -> B2
      setLine(project, "soprano", [pitch("F", 1, 4), pitch("B", 0, 4)]);
      setLine(project, "alto", [pitch("E", 0, 4), pitch("D", 1, 4)]);
      setLine(project, "tenor", [pitch("A", 0, 3), pitch("B", 0, 3)]);
      setLine(project, "bass", [pitch("C", 0, 3), pitch("B", 0, 2)]);

      const diags = checkHarmony(project).diagnostics;
      expect(diags.some((d) => d.ruleId.startsWith("connection.dominant"))).toBe(false);
      expect(diags.some((d) => d.ruleId.startsWith("connection.supertonic"))).toBe(false);
    });

    it("Case I1-A: 四五度原位三和弦采用古典旋律连接法（上三声部全体与低音反向平稳进行）判定合规", () => {
      const project = createEmptyProject();
      project.lengthTicks = PPQ * 2;
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
        functionalChord(project, "subdominant", 1, {
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
      ];

      // 原位 I -> IV
      // B: C3 -> F3 (低音上行四度)
      // S: G4 -> F4 (上声部下行二度)
      // A: E4 -> C4 (中声部下行三度)
      // T: C4 -> A3 (次中音下行三度)
      // 上三声部全体与低音反向进行，无平行五八度，无保持共同音 C（标准旋律连接法）
      setLine(project, "soprano", [pitch("G", 0, 4), pitch("F", 0, 4)]);
      setLine(project, "alto", [pitch("E", 0, 4), pitch("C", 0, 4)]);
      setLine(project, "tenor", [pitch("C", 0, 4), pitch("A", 0, 3)]);
      setLine(project, "bass", [pitch("C", 0, 3), pitch("F", 0, 3)]);

      expect(
        diagnosticFor(project, "connection.common-tone-fourth-fifth"),
      ).toBeUndefined();
    });
  });
});
