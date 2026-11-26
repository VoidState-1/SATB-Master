import { describe, expect, it } from "vitest";
import { chordDraftFromIdentity, type ChordQuality } from "../../../../chordModel";
import { updateChordRegion } from "../../../../editing";
import type { SpelledPitch } from "../../../../pitch";
import {
  createEmptyProject,
  PPQ,
  validateProject,
  type ChordRegion,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../../../../project";
import { compileScoreText } from "../../../../scoreText";
import { buildHarmonyAnalysis, type HarmonyAnalysis } from "../../../analysis";
import { applyHarmonyInference, inferChords, inferHarmony } from "../../../inference";
import { checkHarmony } from "../../../registry";
import type {
  RuleDiagnostic,
  RuleStateEnvelope,
  RuleStepContext,
  StatefulRuleDefinition,
} from "../../../runtime";
import {
  diagnosticFor,
  dominantNinthProject,
  dominantNinthRegion,
  pitch,
  triadRegion,
  twoChordProject,
} from "../../../testing/fixtures/ruleProjects";
import { defaultHarmonyRuleSeverities } from "../../catalog";
import { createHarmonyRuleContext } from "../../context/createRuleContext";
import type { ObligationRuntimeTraceEntry } from "../../state/obligation";
import { STATEFUL_RULES } from "../stateful";

describe("属七变五音与变化音的解决义务", () => {
  const FIFTH = "resolution.altered-dominant-fifth";
  const ALTERED_TONE = "resolution.altered-tone";

  const raised = `satb 1
key D major
meter 2/4
bars 1..2 {
 S: | G4/2 | F#4/2 |
 A: | E#4/2 | F#4/2 |
 T: | C#4/2 | A3/2 |
 B: | A2/2 | D3/2 |
}
`;

  const lowered = `satb 1
key Bb major
meter 2/4
bars 1..2 {
 S: | Eb5/2 | D5/2 |
 A: | A4/2 | F4/2 |
 T: | Cb4/2 | Bb3/2 |
 B: | F2/2 | Bb2/2 |
}
`;

  const wrongRaised = raised.replace("E#4/2 | F#4/2", "E#4/2 | D4/2");
  const wrongLowered = lowered.replace("Cb4/2 | Bb3/2", "Cb4/2 | D4/2");

  function check(score: string, { cut = false, keyChange = false, tendency, fifthOff = false }: {
    cut?: boolean;
    keyChange?: boolean;
    tendency?: "up" | "down";
    fifthOff?: boolean;
  } = {}) {
    const input = compileScoreText(score).project;
    const tick = 2 * input.ppq;
    if (cut) {
      input.structure.phraseBoundaries.push({ id: "cut", tick, source: "manual", confidence: "certain" });
    }
    if (keyChange) {
      input.keyEvents.push({ ...input.keyEvents[0], id: "new-key", tick, tonic: { step: "A", alter: 0 } });
    }
    const { project } = applyHarmonyInference(input, { chordInference: inferChords(input) },
      { mode: "replace-unlocked", writeNonChordToneRoles: true });
    if (tendency) {
      const makeRegion = (id: string, startTick: number, root: ChordRegion["identity"]["root"],
        quality: "dominant7" | "major"): ChordRegion => ({
        id, startTick, durationTicks: tick, locked: true,
        identity: {
          root, bass: root, structure: {
            kind: "tertian", quality, extensions: [],
            alterations: quality === "dominant7" ? [{ degree: 5, alter: 1, tendency }] : [],
          },
        },
      });
      project.chordTrack.regions = [
        makeRegion("written-dominant", 0, { step: "A", alter: 0 }, "dominant7"),
        makeRegion("written-tonic", tick, { step: "D", alter: 0 }, "major"),
      ];
    }
    const result = checkHarmony(project, {
      ...defaultHarmonyRuleSeverities(),
      ...(fifthOff && { [FIFTH]: "off" }),
    });
    expect(result.skippedRules.filter(skip => skip.ruleId === FIFTH)).toEqual([]);
    return {
      project, tick,
      diagnostics: result.diagnostics.filter(d => d.ruleId === FIFTH || d.ruleId === ALTERED_TONE),
    };
  }

  describe("E.6 实写属七变五音解决", () => {
    it.each([
      ["女低升五音", wrongRaised, "alto", "F♯", 1],
      ["男高降五音", wrongLowered, "tenor", "B♭", -1],
      ["目标省略五音时的男高降五音", wrongLowered.replace("A4/2 | F4/2", "A4/2 | D4/2"), "tenor", "B♭", -1],
    ] as const)("%s 在盲推后定位到错误落点", (_label, score, voice, destination, direction) => {
      const { project, tick, diagnostics } = check(score);
      const notes = project.satbTracks.find(track => track.voice === voice)!.notes;
      expect(diagnostics).toEqual([expect.objectContaining({
        ruleId: FIFTH, severity: "warning", tick, voiceIds: [voice],
        noteIds: notes.map(note => note.id).sort(),
        params: { destination, direction },
      })]);
    });

    it.each([
      ["升五音、完整主三和弦", raised],
      ["升五音、主和弦省略五音", raised.replace("C#4/2 | A3/2", "C#4/2 | D4/2")],
      ["降五音、完整主三和弦", lowered],
      ["降五音、主和弦省略五音", lowered.replace("A4/2 | F4/2", "A4/2 | D4/2")],
    ])("%s 正确解决", (_label, score) => {
      expect(check(score).diagnostics).toEqual([]);
    });

    it.each([
      ["缺少属七音", wrongRaised.replace("G4/2 | F#4/2", "A4/2 | F#4/2")],
      ["七音落点由另一声部提供", wrongRaised
        .replace("G4/2 | F#4/2", "G4/2 | A4/2").replace("C#4/2 | A3/2", "C#4/2 | F#4/2")],
      ["七音越八度到主三音", wrongRaised.replace("G4/2 | F#4/2", "G4/2 | F#5/2")],
      ["七音延留后才下行", wrongRaised.replace("G4/2 | F#4/2", "G4/2~ | G4/4 F#4/4")],
      ["变五音同声部延留后才离开", wrongRaised.replace("E#4/2 | D4/2", "E#4/2~ | E#4/4 D4/4")],
      ["变五音离开前有休止", wrongRaised.replace("E#4/2 | D4/2", "E#4/4 r/4 | D4/2")],
    ])("%s 时保持静默", (_label, score) => {
      expect(check(score).diagnostics).toEqual([]);
    });

    it.each([
      ["人工乐句边界", { cut: true }],
      ["换调边界", { keyChange: true }],
    ] as const)("不跨%s追踪变五音", (_label, options) => {
      expect(check(wrongRaised, options).diagnostics).toEqual([]);
    });

    it("通过仲裁只显示同一事件的 E.6，关闭 E.6 时仍显示 E.4", () => {
      const generic = check(wrongRaised, { tendency: "up", fifthOff: true }).diagnostics;
      const specific = check(wrongRaised, { tendency: "up" }).diagnostics;
      expect(generic.map(d => d.ruleId)).toEqual([ALTERED_TONE]);
      expect(specific.map(d => d.ruleId)).toEqual([FIFTH]);
      expect(specific[0]).toMatchObject({
        tick: generic[0].tick, voiceIds: generic[0].voiceIds,
        noteIds: generic[0].noteIds, chordIds: generic[0].chordIds,
      });
    });

    it("正确实奏若与显式反向倾向矛盾，E.4 仍指出标注方向", () => {
      const { diagnostics } = check(raised, { tendency: "down" });
      expect(diagnostics.map(d => d.ruleId)).toEqual([ALTERED_TONE]);
      expect(diagnostics[0].params).toMatchObject({ tendency: "down", actualSemitones: 1 });
    });
  });
});

describe("属九和弦的配置与九音解决义务", () => {
  function withWrittenSmallNinth(text: string) {
    const { project } = compileScoreText(text);
    const source = project.chordTrack.regions.find(chord =>
      chord.identity.structure.kind === "tertian" && chord.identity.structure.extensions.includes(9))!;
    const draft = chordDraftFromIdentity(source.identity, source.semantics!);
    const result = updateChordRegion(project, source.id, { draft: { ...draft, alterations: [{ degree: 9, alter: -1 }] } });
    expect(result.error).toBeUndefined();
    return result.project;
  }

  const ninthWarnings = (project: ReturnType<typeof withWrittenSmallNinth>) =>
    checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.dominant-ninth");

  const prepared = (soprano: string, tenor: string) => `satb 1
key C minor
meter 3/4
bars 1..1 {
 S: | Ab4/2 ${soprano}/4 |
 A: | F4/2 Eb4/4 |
 T: | C4/4 B3/4 ${tenor}/4 |
 B: | F2/4 G2/4 C3/4 |
 H: | s/4 V9/4 t/4 |
}`;

  describe("E.3 checks the saved written dominant ninth", () => {
    it("recognizes the prepared resolution of ex. 23–319 and reports a changed landing", () => {
      expect(ninthWarnings(withWrittenSmallNinth(prepared("G4", "C4")))).toEqual([]);
      const wrong = withWrittenSmallNinth(prepared("C5", "G3"));
      expect(ninthWarnings(wrong)).toMatchObject([{ tick: wrong.ppq * 2, voiceIds: ["soprano"] }]);
      const { chordTrack } = wrong;
      expect(ninthWarnings({ ...wrong, chordTrack: { ...chordTrack, regions: chordTrack.regions.slice(0, 2) } })).toEqual([]);
      expect(checkHarmony(wrong).diagnostics.map(item => item.ruleId)).not.toContain("resolution.altered-tone");
    });

    it.each([
      ["同根 9–8", "G4", "F4", "B3", "G2", "D7", 0],
      ["同根九音到七音", "F4", "D4", "B3", "G2", "D7", 0],
      ["下行减三度", "F#4", "C4", "A3", "D3", "V7/V", 1],
    ])("核对%s", (_name, arrival, alto, tenor, bass, harmony, expected) => {
      const project = withWrittenSmallNinth(`satb 1
key C minor
meter 2/4
bars 1..1 {
 S: | Ab4/4 ${arrival}/4 |
 A: | F4/4 ${alto}/4 |
 T: | B3/4 ${tenor}/4 |
 B: | G2/4 ${bass}/4 |
 H: | V9/4 ${harmony}/4 |
}`);
      expect(ninthWarnings(project)).toHaveLength(expected);
    });
  });

  describe("属九和弦的配置与解决", () => {
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
  });
});

describe("属二和弦换位时的低音七音义务", () => {
  function passage(key: string, chords: string[], voices: string[]) {
    const staff = (pitches: string[]) => pitches.map(pitch => pitch + "/4").join(" ");
    const tracks = voices.map((line, i) => `${"SATB"[i]}: | ${staff(line.split(" "))} |`);
    return compileScoreText([
      "satb 1", "key " + key, `meter ${chords.length}/4`, "bars 1..1 {",
      ...tracks, `H: | ${staff(chords)} |`, "}",
    ].join("\n")).project;
  }

  function warnings(project: ReturnType<typeof passage>) {
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === "resolution.chord-seventh");
  }

  function bassExchange() {
    return passage("C major", ["D2", "D7"], ["G5 F5", "B4 B4", "D4 D4", "F3 G3"]);
  }

  describe("属二和弦换位中的低音七音", () => {
    it("低音 F3 上二度到根音时，女高新起的七音不能免除原低音的告警", () => {
      const score = bassExchange();
      expect(warnings(score)).toEqual([expect.objectContaining({
        voiceIds: ["bass"], tick: score.ppq, endTick: 2 * score.ppq, severity: "warning",
      })]);
    });

    it("移调到 F 大调，同声重奏后从 Bb 上行，接手的女高随后正常解决", () => {
      const score = passage("F major", ["D2", "D2", "D7", "T"],
        ["C5 C5 Bb4 A4", "G4 G4 G4 F4", "E4 E4 E4 F4", "Bb2 Bb2 C3 F3"]);
      expect(warnings(score)).toEqual([expect.objectContaining({ voiceIds: ["bass"], tick: 2 * score.ppq })]);
    });

    it("辅导书改正的低音七音下三度到五音，女高接手七音", () => {
      expect(warnings(passage("C major", ["D2", "D43"], ["G5 F5", "B4 B4", "D4 G4", "F3 D3"]))).toEqual([]);
    });

    it("同和声重复后，男低七音在异和弦中下行解决", () => {
      expect(warnings(passage("C major", ["D2", "D2", "T6"],
        ["G5 G5 G5", "B4 B4 C5", "D4 D4 C4", "F3 F3 E3"]))).toEqual([]);
    });

    it("低音与新七音跨手动句界时保留原有交接处理", () => {
      const project = bassExchange();
      project.structure.phraseBoundaries.push({
        id: "end", tick: project.ppq, source: "manual", confidence: "certain",
      });
      expect(warnings(project)).toEqual([]);
    });

    it("男低落点标明为和弦外音时，不能按结构低音换位确定告警", () => {
      const project = bassExchange();
      project.satbTracks.find(track => track.voice === "bass")!.notes[1].nonChordToneRole = "anticipation";
      expect(warnings(project)).toEqual([]);
    });

    it("女高新起七音标作和弦外音时，不能据此确立新的结构交接", () => {
      const project = bassExchange();
      project.satbTracks.find(track => track.voice === "soprano")!.notes[1].nonChordToneRole = "passing";
      expect(warnings(project)).toEqual([]);
    });

    it("低音由根音下行接七音时，只提示原七音所在的女高", () => {
      const project = passage("C major", ["D7", "D2"], ["F5 G5", "G4 B4", "B3 D4", "G3 F3"]);
      expect(warnings(project)).toEqual([expect.objectContaining({
        tick: project.ppq, severity: "warning", voiceIds: ["soprano"], title: "属七和弦换位时根音与七音互换",
      })]);
    });

    it("原七音下行至五音、低音下行接七音时保持静默", () => {
      const project = passage("F major", ["D7", "D2"], ["Bb4 G4", "C4 E4", "E3 C4", "C3 Bb2"]);
      expect(warnings(project)).toEqual([]);
    });

    it.each([
      ["落点含变五音", "D4 Db4"],
      ["男高在实际低音下方", "D3 D3"],
    ])("%s 时不凭原位属七标签追报低音", (_name, tenor) => {
      const project = passage("C major", ["D2", "D7"], ["G5 F5", "B4 B4", tenor, "F3 G3"]);
      expect(warnings(project).filter(item => item.voiceIds.includes("bass"))).toEqual([]);
    });
  });
});

describe("重属导减七至属七的导音、七音交接", () => {
  type Mechanism = "leading" | "exit" | "entry";
  const active = new Set<Mechanism>(["leading", "exit", "entry"]);

  interface Example {
    key?: string;
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    preparation?: string;
    source?: string;
    landing?: string;
    tonic?: string;
    manualBoundary?: number;
    keyBoundary?: number;
  }

  function example({
    key = "C major",
    soprano = "G4/4 F#4/4 F4/4 E4/4",
    alto = "C4/2 B3/4 C4/4",
    tenor = "G3/4 A3/4 G3/2",
    bass = "E3/4 Eb3/4 D3/4 C3/4",
    preparation = "I6",
    source = "viio42/V",
    landing = "V43",
    tonic = "I",
    manualBoundary,
    keyBoundary,
  }: Example = {}) {
    const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${preparation}/4 ${source}/4 ${landing}/4 ${tonic}/4 |
}`);
    if (manualBoundary !== undefined) project.structure.phraseBoundaries.push({
      id: "manual", source: "manual", confidence: "certain", tick: manualBoundary,
    });
    if (keyBoundary !== undefined) project.keyEvents.push({
      ...project.keyEvents[0], id: "next-signature", tick: keyBoundary,
    });
    return checkHarmony(project).diagnostics;
  }

  type Diagnostics = ReturnType<typeof example>;
  function at(list: Diagnostics, type: "leading" | "augmented" | "seventh", tick: number, voice: VoiceId) {
    const id = {
      leading: "resolution.leading-tone",
      augmented: "melody.augmented-interval",
      seventh: "resolution.chord-seventh",
    }[type];
    return list.some(d => d.ruleId === id && d.tick === tick && d.voiceIds.includes(voice));
  }

  function threeWarnings(list: Diagnostics) {
    return {
      leading: at(list, "leading", 1920, "soprano"),
      exit: at(list, "augmented", 1920, "soprano"),
      entry: at(list, "augmented", 960, "bass"),
    };
  }

  describe("第29章完整重属导减七到属七", () => {
    it("大调例 29-440a 型分别放行导音交接、旋律增一度与低音准备", () => {
      const rules = example();
      expect(threeWarnings(rules)).toEqual({
        leading: !active.has("leading"), exit: false, entry: false,
      });
      expect(at(rules, "seventh", 2880, "soprano")).toBe(false);
    });

    it("小调导音可用同一交接，低音实为自然降三级的原音", () => {
      const rules = example({
        key: "C minor", preparation: "i6", tonic: "i", bass: "Eb3/4 Eb3/4 D3/4 C3/4",
        soprano: "G4/4 F#4/4 F4/4 Eb4/4",
      });
      expect(threeWarnings(rules)).toEqual({
        leading: !active.has("leading"), exit: false, entry: false,
      });
      expect(at(rules, "seventh", 2880, "soprano")).toBe(false);
    });

    it("未填重属标签时可凭完整实音与已辨明 D7 识别两个旋律事件", () => {
      expect(threeWarnings(example({ source: "r" }))).toEqual({
        leading: false, exit: false, entry: false,
      });
    });

    it("导音完成交接以后，属七音上行的独立 E.2 报警仍在", () => {
      const rules = example({ soprano: "G4/4 F#4/4 F4/4 G4/4", tenor: "G3/4 A3/4 G3/4 E3/4" });
      expect(threeWarnings(rules).leading).toBe(!active.has("leading"));
      expect(at(rules, "seventh", 2880, "soprano")).toBe(true);
    });

    it("向上半音进属根仍由普通导音路线处理", () => {
      const rules = example({
        soprano: "G4/4 F#4/4 G4/4 E4/4", tenor: "G3/4 A3/4 F3/4 E3/4",
      });
      expect(at(rules, "leading", 1920, "soprano")).toBe(false);
      expect(at(rules, "augmented", 960, "bass")).toBe(false);
    });

    it.each<[string, Example]>([
      ["目标只有属三和弦", { landing: "V64" }],
      ["标作属七却没有奏出目标三音", { alto: "C4/2 D4/4 C4/4" }],
      ["中间少奏一音", { tenor: "G3/4 C4/4 G3/2" }],
      ["重属七音跳到属根", {
        alto: "C4/2 D4/4 C4/4", tenor: "G3/4 A3/4 B3/4 G3/4",
        bass: "E3/4 Eb3/4 G2/4 C3/4", landing: "V7",
      }],
      ["调号事件隔断两个实际和弦", { keyBoundary: 1920 }],
      ["明确的句界切在重属内部", { manualBoundary: 1440 }],
    ])("%s 时导音义务仍报告", (_label, options) => {
      expect(threeWarnings(example(options))).toEqual({ leading: true, exit: false, entry: false });
    });

    it("有低声部休止时不能结算导音义务，旋律沿用既有休止情境的处理", () => {
      expect(threeWarnings(example({ bass: "E3/4 Eb3/8 r/8 D3/4 C3/4" }))).toEqual({
        leading: true, exit: false, entry: false,
      });
    });

    it("低音来自 Am/E 时不借通用 B.3 报准备错误", () => {
      expect(threeWarnings(example({
        preparation: "vi64", soprano: "A4/4 F#4/4 F4/4 E4/4", tenor: "A3/2 G3/2",
      }))).toEqual({ leading: !active.has("leading"), exit: false, entry: false });
    });

    it("半音拼写但属七落点换了八度时拒绝接续", () => {
      const rules = example({ soprano: "G4/4 F#4/4 F5/4 E5/4" });
      expect(at(rules, "leading", 1920, "soprano")).toBe(true);
      expect(at(rules, "augmented", 960, "bass")).toBe(false);
    });

    it("同一教材连接中，低音直接承担升四级到属七音", () => {
      const rules = example({
        preparation: "I", source: "viio7/V", landing: "V42", tonic: "I6",
        soprano: "G4/4 Eb5/4 D5/4 C5/4",
        alto: "C4/4 C5/4 B4/4 G4/4",
        tenor: "E3/4 A3/4 G3/2",
        bass: "C3/4 F#2/4 F2/4 E2/4",
      });
      expect(at(rules, "leading", 1920, "bass")).toBe(!active.has("leading"));
      expect(at(rules, "augmented", 1920, "bass")).toBe(false);
      expect(at(rules, "seventh", 2880, "bass")).toBe(false);
    });
  });
});

describe("重属导减七至终止四六的七音义务", () => {
  const ruleId = "resolution.chord-seventh";
  const score = `satb 1
key F major
meter 4/4
bars 1..2 {
  S: | D5/4 Ab5/4 A5/4 Bb5/4 | C6/1 |
  A: | F4/2 F4/4 E4/4 | F4/1 |
  T: | Bb3/4 B3/4 C4/2 | A3/1 |
  B: | Bb2/4 D3/4 C3/4 C2/4 | F2/1 |
  H: | IV/4 DDVII65/4 K46/4 V7/4 | I/1 |
}
`;

  function seventhDiagnostics(text = score, severities = defaultHarmonyRuleSeverities()) {
    const { project } = compileScoreText(text);
    return checkHarmony(project, severities).diagnostics
      .filter(diagnostic => diagnostic.ruleId === ruleId)
      .map(({ tick, severity, voiceIds, subjects }) => ({
        tick, severity, voiceIds, sourceNoteId: subjects?.origin?.noteIds?.[0],
      }));
  }

  function unresolvedSeventh(sourceTick: number, tick: number, severity: "warning" | "error" = "warning") {
    return { tick, severity, voiceIds: ["soprano"], sourceNoteId: `note-S-${sourceTick}` };
  }

  describe("E.2 重属导减七至 K46", () => {
    it.each(["Ab5", "G#5"])("认可 %s 上行到 A5，仍报告后续属七音上行", seventh => {
      expect(seventhDiagnostics(score.replace("Ab5", seventh))).toEqual([unresolvedSeventh(3 * PPQ, 4 * PPQ)]);
    });

    it.each([
      ["原七音上行换八度", score.replace("A5/4", "A6/4")],
      ["其余声部互换 K46 的音", score.replace("F4/2 F4/4", "F4/2 C4/4").replace("B3/4 C4/2", "B3/4 F4/4 C4/4")],
      ["目标标作持续四六", score.replace("K46/4", "r/4").replace("}\n", `}
annotations {
  chord pedal range=[1:3,1:4) symbol=I64 role=pedal64
}\n`)],
    ])("%s 时保留 E.2", (_label, text) => {
      expect(seventhDiagnostics(text)).toContainEqual(unresolvedSeventh(PPQ, 2 * PPQ));
    });

    it("仍检查同声部从前一个和弦延续的独立七音义务", () => {
      const carried = score.replace("IV/4", "r/4").replace("D5/4 Ab5/4", "Ab5/4 Ab5/4")
        .replace("Bb3/4 B3/4", "D4/4 B3/4") + `annotations {
  chord prep range=[1:1,1:2) symbol=V7 localKey="Eb major"
}
`;
      expect(seventhDiagnostics(carried)).toEqual([
        unresolvedSeventh(0, 2 * PPQ),
        unresolvedSeventh(3 * PPQ, 4 * PPQ),
      ]);
    });

    it("重拼判断独立于 B.3 开关，也保留 E.2 的严重度与关闭设置", () => {
      const severities = defaultHarmonyRuleSeverities();
      severities["melody.augmented-interval"] = "off";
      severities[ruleId] = "error";
      expect(seventhDiagnostics(score, severities)).toEqual([unresolvedSeventh(3 * PPQ, 4 * PPQ, "error")]);
      severities[ruleId] = "off";
      expect(seventhDiagnostics(score, severities)).toEqual([]);
    });
  });
});

describe("实写转调与导音的重新辨认", () => {
  const pivot = `satb 1
key B minor
meter 2/4
bars 1..3 {
 S: | C#5/4 B4/4 | G4/4. G4/8 | G4/4 C5/4 |
 A: | E4/4 D4/4 | E4/4. E4/8 | E4/4 F4/4 |
 T: | F#3/2 | C#4/4. Db4/8 | C4/2 |
 B: | A#2/4 B2/4 | A#2/4. Bb2/8 | Bb2/4 A2/4 |
}`;
  const pivotLabels = `
annotations {
 chord c1 at=1:1 duration=1/4 symbol=D65
 chord c2 at=1:2 duration=1/4 symbol=t
 chord c3 range=[2:1,2:2+1/2) symbol=#viio7
 chord c4 at=2:2+1/2 duration=1/8 symbol=#viio43 localKey="F minor"
 chord c5 at=3:1 duration=1/4 symbol=D2 localKey="F major"
 chord c6 at=3:2 duration=1/4 symbol=T6 localKey="F major"
}`;
  const pivotBeat = 3.5;
  const majorPivot = pivot.replace("key B minor", "key B major").replace("E4/4 D4/4", "E4/4 D#4/4");
  const majorPivotLabels = pivotLabels.replace("symbol=t", "symbol=T").replace("symbol=#viio7", "symbol=viio7");

  const chain = `satb 1
key Ab major
meter 2/4
bars 1..2 {
 S: | G5/4. F#5/8 | F#5/4 E#5/4 |
 A: | Db5/4. B#4/8 | B#4/4 B4/4 |
 T: | Bb3/4. G#3/8 | G#3/2 |
 B: | Eb3/4. G#2/8 | G#2/4 C#3/4 |
}`;
  const chainLabels = `
annotations {
 chord c1 range=[1:1,1:2+1/2) symbol=D7
 chord c2 range=[1:2+1/2,2:2) symbol=D7 localKey="C# major"
 chord c3 at=2:2 duration=1/4 symbol=D7 localKey="F# major"
}`;
  const chainBeat = 1.5;

  function throughEntry(score: string, labels: string, mode: "blind" | "given") {
    const project = compileScoreText(mode === "given" ? score + labels : score).project;
    if (mode === "given") return project;
    expect(project.chordTrack.regions).toHaveLength(0);
    return applyHarmonyInference(project, inferHarmony(project), {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
  }

  function warningAt(project: ProjectDocument, beat: number, voice: "soprano" | "alto" | "bass") {
    expect(validateProject(project)).toBe(true);
    return checkHarmony(project).diagnostics.filter(d =>
      d.ruleId === "resolution.leading-tone" && d.tick === beat * project.ppq && d.voiceIds.includes(voice));
  }

  function expectWarning(project: ProjectDocument, beat: number, voice: "soprano" | "alto" | "bass", leadingTone: string) {
    expect(warningAt(project, beat, voice)).toMatchObject([{
      severity: "warning",
      voiceIds: [voice],
      params: { leadingTone },
      trace: [expect.objectContaining({ outcome: "continue", reason: "obligation-opened" }),
        expect.objectContaining({ outcome: "violate", reason: "leading-tone-moved-elsewhere" })],
    }]);
  }

  describe.each(["blind", "given"] as const)("E.1 written transitions through the %s entry", mode => {
    it("releases the original leading tone at a diminished pivot whose new dominant actually resolves", () => {
      expect(warningAt(throughEntry(pivot, pivotLabels, mode), pivotBeat, "bass")).toHaveLength(0);
    });

    it("requires the respelled bass to resolve as the new dominant's seventh, in its own voice", () => {
      const material = pivot.replace("A2/4 |", "A1/4 |");
      expectWarning(throughEntry(material, pivotLabels, mode), pivotBeat, "bass", "A♯");
    });

    it("uses the same full diminished pivot from harmonic major", () => {
      expect(warningAt(throughEntry(majorPivot, majorPivotLabels, mode), pivotBeat, "bass")).toHaveLength(0);
    });

    it("keeps the major-key obligation if the respelled bass skips its downward step", () => {
      const material = majorPivot.replace("A2/4 |", "A1/4 |");
      const project = throughEntry(material, majorPivotLabels, mode);
      expectWarning(project, pivotBeat, "bass", "A♯");
      expect(warningAt(project, pivotBeat, "bass")).toMatchObject([{ params: { key: "B major" } }]);
    });

    it("requires the new leading tone's resolution even when all tonic members still sound", () => {
      const material = pivot.replace("C5/4 |", "F5/4 |").replace("F4/4 |", "C4/4 |");
      expectWarning(throughEntry(material, pivotLabels, mode), pivotBeat, "bass", "A♯");
    });

    it("recognizes the change of spelling inside a witnessed dominant-seventh chain", () => {
      expect(warningAt(throughEntry(chain, chainLabels, mode), chainBeat, "soprano")).toHaveLength(0);
    });

    it("retains the warning when the next seventh is in the wrong octave", () => {
      const material = chain.replace("G5/4. F#5/8", "G5/4. F#4/8");
      expectWarning(throughEntry(material, chainLabels, mode), chainBeat, "soprano", "G");
    });

    it("keeps the warning when the adjoining chain link loses its same-voice exchange", () => {
      const material = chain.replace("F#5/4 E#5/4", "F#5/4 B5/4").replace("B#4/4 B4/4", "B#4/4 E#4/4");
      expectWarning(throughEntry(material, chainLabels, mode), chainBeat, "soprano", "G");
    });

    it.each([
      ["a held leading tone when another part reattacks", "G4/4. G4/8", "G4/8 G4/4 G4/8"],
      ["a same-pitch leading-tone reattack", "A#2/4. Bb2/8", "A#2/4 A#2/8 Bb2/8"],
      ["same-pitch reattacks in the new dominant", "E4/4 F4/4", "E4/8 E4/8 F4/4"],
    ])("verifies the pivot with %s", (_name, from, to) => {
      expect(warningAt(throughEntry(pivot.replace(from, to), pivotLabels, mode), pivotBeat, "bass")).toHaveLength(0);
    });

    it.each([
      ["a held leading tone when another part reattacks", "Db5/4. B#4/8", "Db5/8 Db5/4 B#4/8"],
      ["a same-pitch leading-tone reattack", "G5/4. F#5/8", "G5/4 G5/8 F#5/8"],
    ])("verifies the chain with %s", (_name, from, to) => {
      expect(warningAt(throughEntry(chain.replace(from, to), chainLabels, mode), chainBeat, "soprano")).toHaveLength(0);
    });

    it("uses the held source across a written reminder of the same key", () => {
      const material = chain.replace("meter 2/4", "meter 2/4\nat 1:1+1/2 key Ab major");
      const labels = chainLabels.replace("chord c1 range=[1:1,1:2+1/2) symbol=D7",
        "chord c1 at=1:1 duration=1/8 symbol=D7\n chord c1b range=[1:1+1/2,1:2+1/2) symbol=D7");
      expect(warningAt(throughEntry(material, labels, mode), chainBeat, "soprano")).toHaveLength(0);
    });
  });

  it("retains a wrong leading tone at an unlabelled tonic with the bass on its third", () => {
    const material = `satb 1
key A minor
meter 2/4
bars 1..1 {
 S: | B4/4 E5/4 |
 A: | G#4/4 E4/4 |
 T: | E4/4 A3/4 |
 B: | D3/4 C3/4 |
}`;
    const given = throughEntry(material, "\nannotations {\n chord c1 at=1:1 duration=1/4 symbol=D2\n}\n", "given");
    expect(given.chordTrack.regions).toHaveLength(1);
    expectWarning(given, 1, "alto", "G♯");
    expectWarning(throughEntry(material, "", "blind"), 1, "alto", "G♯");
  });

  it("does not borrow the new tonic past a manual phrase boundary", () => {
    const project = throughEntry(pivot, pivotLabels, "given");
    project.structure.phraseBoundaries.push({
      id: "break", tick: 5 * project.ppq, source: "manual", confidence: "certain",
    });
    expectWarning(project, pivotBeat, "bass", "A♯");
  });

  it("does not borrow a later tonic across a real score-key change", () => {
    const project = throughEntry(pivot, pivotLabels, "given");
    project.keyEvents.push({
      ...project.keyEvents[0], id: "changed-mode", tick: 4.5 * project.ppq, mode: "major",
    });
    expectWarning(project, pivotBeat, "bass", "A♯");
  });

  it("can verify the pivot from the written parts when the new harmonies are all unlabelled", () => {
    const oldKeyLabels = pivotLabels.replace(/ chord c4[\s\S]+}/, "}");
    const project = throughEntry(pivot, oldKeyLabels, "given");
    expect(project.chordTrack.regions).toHaveLength(3);
    expect(warningAt(project, pivotBeat, "bass")).toHaveLength(0);
  });

  it("keeps the obligation when the declared pivot does not agree with its written pitches", () => {
    const conflicting = pivotLabels.replace('localKey="F minor"', 'localKey="F# minor"');
    expectWarning(throughEntry(pivot, conflicting, "given"), pivotBeat, "bass", "A♯");
  });

  it("keeps the obligation when the next dominant is declared as a different harmony", () => {
    const conflicting = chainLabels.replace('symbol=D7 localKey="C# major"', 'symbol=T localKey="F major"');
    expectWarning(throughEntry(chain, conflicting, "given"), chainBeat, "soprano", "G");
  });

  it("continues to check a later leading tone after the exchange", () => {
    const material = chain.replace("bars 1..2", "bars 1..3")
      .replace("E#5/4 |", "E#5/4 | F#4/2 |").replace("B4/4 |", "B4/4 | A#4/2 |")
      .replace("G#3/2 |", "G#3/2 | C#4/2 |").replace("C#3/4 |", "C#3/4 | F#3/2 |");
    const labels = chainLabels.replace("}", ' chord c4 at=3:1 duration=1/2 symbol=T localKey="F# major"\n}');
    const project = throughEntry(material, labels, "given");
    expect(warningAt(project, chainBeat, "soprano")).toHaveLength(0);
    expectWarning(project, 4, "soprano", "E♯");
  });
});

describe("局部调性的导音及其解决目标", () => {
  function localCadence(sopranoLanding = "A4", localKey = "A major") {
    return compileScoreText(`satb 1
key F major
meter 2/4
bars 1..2 {
 S: | G#4/2 | ${sopranoLanding}/2 |
 A: | E4/2 | C#4/2 |
 T: | B3/2 | E4/2 |
 B: | E3/2 | A2/2 |
}
annotations {
 chord d range=[1:1,2:1) symbol=D localKey="${localKey}"
 chord t range=[2:1,3:1) symbol=T localKey="${localKey}"
}`).project;
  }

  describe("明示局部调性中的导音识别", () => {
    it("按局部 A 大调核对 G# 到 A，不把工程 F 大调的 E 当导音", () => {
      const diagnostics = checkHarmony(localCadence()).diagnostics;
      expect(diagnostics.filter(item => item.ruleId === "resolution.leading-tone")).toEqual([]);
    });

    it("仍报告局部调性中真正未解决的 G#，并保留目标主音 A", () => {
      const diagnostics = checkHarmony(localCadence("F#4")).diagnostics
        .filter(item => item.ruleId === "resolution.leading-tone");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].voiceIds).toContain("soprano");
      expect(diagnostics[0].debug?.obligation?.partitionKey).toBe("voice:soprano|target:A:0");
    });

    it("不把局部 A 大调属和弦的重复根音 E 当成重复导音", () => {
      const diagnostics = checkHarmony(localCadence()).diagnostics
        .filter(item => item.ruleId === "chord.doubled-leading-tone");
      expect(diagnostics).toHaveLength(0);
    });

    it("仍报告局部 A 大调真正重复的 G# 导音", () => {
      const project = localCadence();
      project.satbTracks.find(track => track.voice === "alto")!.notes[0].pitch = { step: "G", alter: 1, octave: 4 };
      const diagnostics = checkHarmony(project).diagnostics
        .filter(item => item.ruleId === "chord.doubled-leading-tone");
      expect(diagnostics).toHaveLength(1);
      expect(new Set(diagnostics[0].voiceIds)).toEqual(new Set(["soprano", "alto"]));
    });
  });

  const doubledLeading = "chord.doubled-leading-tone";
  const doubledAltered = "chord.doubled-altered-tendency-tone";

  function appliedVoicing(
    key: string,
    symbol: string,
    [soprano, alto, tenor, bass]: string[],
    localKey?: string,
  ) {
    return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..1 {
 S: | ${soprano}/2 |
 A: | ${alto}/2 |
 T: | ${tenor}/2 |
 B: | ${bass}/2 |
}
annotations {
 chord source range=[1:1,2:1) symbol=${symbol}${localKey ? ` localKey="${localKey}"` : ""}
}`).project;
  }

  function repeatedTendencyDiagnostics(project: ReturnType<typeof appliedVoicing>, disabled?: typeof doubledLeading | typeof doubledAltered) {
    const severities = defaultHarmonyRuleSeverities();
    if (disabled) severities[disabled] = "off";
    return checkHarmony(project, severities).diagnostics.filter(({ ruleId }) =>
      ruleId === doubledLeading || ruleId === doubledAltered,
    );
  }

  describe("副属与副导和弦的目标调重复导音", () => {
    it.each([
      { symbol: "V64/VI", pitches: ["B4", "G#4", "E4", "B2"] },
      { symbol: "viio6/VI", pitches: ["B4", "G#4", "D4", "B2"] },
    ])("$symbol 中本调 B 的重复仍是目标调的普通和弦音", ({ symbol, pitches }) => {
      expect(repeatedTendencyDiagnostics(appliedVoicing("C major", symbol, pitches))).toEqual([]);
    });

    it.each([
      { key: "G major", symbol: "V6/II", pitches: ["G#4", "E4", "B3", "G#3"], localKey: undefined, voices: ["bass", "soprano"] },
      { key: "Bb major", symbol: "viio6/IV", pitches: ["D5", "Ab4", "D4", "F3"], localKey: undefined, voices: ["soprano", "tenor"] },
      { key: "C major", symbol: "V6/II", pitches: ["D5", "Bb4", "F4", "D3"], localKey: "Db major", voices: ["bass", "soprano"] },
      { key: "C major", symbol: "viio6/III", pitches: ["B#4", "F#4", "B#3", "D#3"], localKey: "A major", voices: ["soprano", "tenor"] },
    ])("$key $symbol 的目标导音只产生一条诊断，两个单规则均可检测", ({ key, symbol, pitches, localKey, voices }) => {
      const fresh = () => appliedVoicing(key, symbol, pitches, localKey);
      expect(repeatedTendencyDiagnostics(fresh()).map(d => d.ruleId)).toEqual([doubledAltered]);
      expect(repeatedTendencyDiagnostics(fresh(), doubledLeading).map(d => d.ruleId)).toEqual([doubledAltered]);
      expect(repeatedTendencyDiagnostics(fresh(), doubledAltered)).toEqual([
        expect.objectContaining({ ruleId: doubledLeading, voiceIds: voices, severity: "error" }),
      ]);
    });

    it("小调本调的升 VII 仍由 D.8 检测", () => {
      const project = appliedVoicing("A minor", "D", ["G#4", "G#3", "B3", "E3"]);
      expect(repeatedTendencyDiagnostics(project)).toEqual([
        expect.objectContaining({ ruleId: doubledLeading, voiceIds: ["alto", "soprano"] }),
      ]);
    });

    it("同一副属中另一种方向性变化音仍独立报告", () => {
      const project = appliedVoicing("G major", "V6/II", ["G#4", "B#4", "B#3", "G#3"]);
      const { structure } = project.chordTrack.regions[0].identity;
      if (structure.kind !== "tertian") throw Error("预期三度叠置和弦");
      structure.alterations = [{ degree: 5, alter: 1, tendency: "up" }];
      const diagnostics = repeatedTendencyDiagnostics(project);
      expect(diagnostics.map(d => d.ruleId)).toEqual([doubledAltered, doubledAltered]);
      expect(diagnostics.map(d => d.params.degree).sort()).toEqual([5, 7]);
    });

    it("原位副属只让位于实际目标导音的重复诊断", () => {
      const doubling = "chord.triad-root-position-doubling";
      const check = (pitches: string[]) => checkHarmony(appliedVoicing("C major", "V/VI", pitches)).diagnostics;
      const fifthDoubled = check(["B4", "G#4", "B3", "E3"]);
      expect(fifthDoubled.some(d => d.ruleId === doubling)).toBe(true);
      const leadingDoubled = check(["G#5", "B4", "G#4", "E3"]);
      expect(leadingDoubled.some(d => d.ruleId === doubling)).toBe(false);
      expect(leadingDoubled.some(d => d.ruleId === doubledAltered)).toBe(true);
    });
  });
});

describe("大调阻碍进行中的导音下行", () => {
  const rootPosition = {
    soprano: "D5 C5", alto: "G4 E4", tenor: "B3 A3", bass: "G2 A2", harmony: "D TSVI",
  };
  const firstInversion = {
    soprano: "D5 E5", alto: "G4 C5", tenor: "D4 C4", bass: "B3 A3", harmony: "D6 TSVI",
  };

  function pair({
    soprano, alto, tenor, bass, harmony,
    key = "C major",
    beatLengths = ["4", "4"],
  }: typeof rootPosition & { key?: string; beatLengths?: string[] }) {
    const durations = (notes: string) => notes.split(" ").map((note, i) => `${note}/${beatLengths[i]}`).join(" ");
    return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..1 {
 S: | ${durations(soprano)} |
 A: | ${durations(alto)} |
 T: | ${durations(tenor)} |
 B: | ${durations(bass)} |
 ${harmony ? `H: | ${durations(harmony)} |` : ""}
}`).project;
  }

  function leadingWarning(project: ProjectDocument, voice: VoiceId, tick: number = project.ppq) {
    return checkHarmony(project).diagnostics.some(item =>
      item.ruleId === "resolution.leading-tone" && item.tick === tick &&
      item.severity === "warning" && item.voiceIds.includes(voice));
  }

  describe("E.1 大调阻碍进行中的导音下行", () => {
    it.each([
      ["原位 D 的男高", rootPosition, "tenor"],
      ["原位 D 的女低", { soprano: "D5 C5", alto: "B4 A4", tenor: "G3 E3", bass: "G2 A2", harmony: "D TSVI" }, "alto"],
      ["D6 的低音", firstInversion, "bass"],
      ["移调至降 B 大调", {
        key: "Bb major", soprano: "C5 Bb4", alto: "F4 D4", tenor: "A3 G3", bass: "F2 G2", harmony: "D TSVI",
      }, "tenor"],
    ] as const)("%s 仅在有和声证据时放行", (_description, voicing, voice) => {
      expect(leadingWarning(pair(voicing), voice)).toBe(false);
      expect(leadingWarning(pair({ ...voicing, harmony: "" }), voice)).toBe(true);
    });

    it("D6 重根、在第二拍到第三拍进行也可放行", () => {
      const { project } = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | E4/4 G4/4 C5/4 |
 A: | C4/4 D4/4 C4/4 |
 T: | G3/4 G3/4 E3/4 |
 B: | C3/4 B2/4 A2/4 |
 H: | T/4 D6/4 TSVI/4 |
}`);
      expect(leadingWarning(project, "bass", 2 * project.ppq)).toBe(false);
    });

    it.each([
      ["女高导音下行", { ...rootPosition, soprano: "B4 A4", alto: "D4 E4", tenor: "G3 C4" }, "soprano"],
      ["目标为普通下属和弦且导音同样下大二度", {
        ...rootPosition, soprano: "D5 C5", alto: "G4 F4", tenor: "B3 A3", bass: "G2 F2", harmony: "D S",
      }, "tenor"],
      ["B3 跌至低八度的 A", { ...rootPosition, tenor: "B3 A2" }, "tenor"],
      ["B3 下行到与 A 同音的重升 G", { ...rootPosition, tenor: "B3 G##3" }, "tenor"],
      ["VI 标签下实奏缺三音", { ...rootPosition, soprano: "D5 E5" }, "tenor"],
      ["VI 转位标签与实际低音冲突", { ...rootPosition, harmony: "D TSVI6" }, "tenor"],
      ["标为原位 D 但实际由导音作低音", { ...firstInversion, harmony: "D TSVI" }, "bass"],
      ["只有三声部", { ...rootPosition, alto: "r E4" }, "tenor"],
      ["名义男高低于实际低音", { ...rootPosition, tenor: "B2 A2", bass: "G3 A3" }, "tenor"],
      ["D6→VI 实写重复根音", { ...firstInversion, tenor: "D4 A4" }, "bass"],
      ["原位 D→VI 配置齐全但平行五度", { ...rootPosition, soprano: "D5 E5", alto: "G4 C5" }, "tenor"],
    ] as const)("%s 时仍应报警", (_description, voicing, voice) => {
      expect(leadingWarning(pair(voicing), voice)).toBe(true);
    });

    it("普通 D→T 内声从 B3 错走到实际主和弦三音 E3，三种输入仍报警", () => {
      const voicing = { soprano: "D5 G5", alto: "G4 C5", tenor: "B3 E3", bass: "G2 C3", harmony: "D T" };
      const bare = pair({ ...voicing, harmony: "" });
      const blind = applyHarmonyInference(bare, { chordInference: inferChords(bare) },
        { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
      expect(blind.chordTrack.regions.map(region => region.startTick)).toEqual([0, blind.ppq]);
      for (const project of [bare, blind, pair(voicing)]) {
        expect(leadingWarning(project, "tenor")).toBe(true);
      }
    });

    it("落在拍内分割点的进行不借用此例外", () => {
      const project = pair({ ...rootPosition, beatLengths: ["8", "4."] });
      expect(leadingWarning(project, "tenor", project.ppq / 2)).toBe(true);
    });

    it("人工句界可阻断这条义务的取证", () => {
      const project = pair(firstInversion);
      project.structure.phraseBoundaries.push({
        id: "manual", tick: project.ppq, source: "manual", confidence: "certain",
      });
      expect(leadingWarning(project, "bass")).toBe(true);
    });

    it.each([
      ["男高", { soprano: "B4 A4", alto: "E4 C4", tenor: "G#3 F3", bass: "E2 F2", harmony: "D TSVI" }, "tenor"],
      ["女低", { soprano: "E5 C5", alto: "G#4 F4", tenor: "B3 A3", bass: "E3 F3", harmony: "D TSVI" }, "alto"],
      ["低音", { soprano: "B4 C5", alto: "E4 A4", tenor: "B3 A3", bass: "G#3 F3", harmony: "D6 TSVI" }, "bass"],
    ] as const)("小调%s下行增二度在裸音和给和弦时均报警", (_description, voicing, voice) => {
      expect(leadingWarning(pair({ ...voicing, key: "A minor" }), voice)).toBe(true);
      expect(leadingWarning(pair({ ...voicing, key: "A minor", harmony: "" }), voice)).toBe(true);
    });
  });
});

describe("经过属三四的七音义务", () => {
  const passing = `satb 1
key C major
meter 3/4
bars 1..1 {
  S: | E4/4 F4/4 G4/4 |
  A: | C4/4 B3/4 C4/4 |
  T: | G3/4 G3/4 G3/4 |
  B: | C3/4 D3/4 E3/4 |
  H: | I/4 V43/4 I6/4 |
}`;

  const unmarkedAnticipations = passing.replace("C3/4 D3/4 E3/4", "C3/8 D3/8@earlyD D3/8 E3/8@earlyE E3/4");
  const anticipations = unmarkedAnticipations + `
annotations {
  note earlyD role=anticipation
  note earlyE role=anticipation
}`;

  const descending = passing
    .replace("E4/4 F4/4 G4/4", "G4/4 F4/4 E4/4")
    .replace("C3/4 D3/4 E3/4", "E3/4 D3/4 C3/4")
    .replace("I/4 V43/4 I6/4", "I6/4 V43/4 I/4");

  function seventhWarnings(score: string) {
    const { project } = compileScoreText(score);
    return {
      landing: 2 * project.ppq,
      diagnostics: checkHarmony(project).diagnostics.filter(diagnostic => diagnostic.ruleId === "resolution.chord-seventh"),
    };
  }

  describe("经过三四和弦中的七音", () => {
    it.each([
      ["大调", passing],
      ["小调", passing.replace("key C major", "key C minor").replace("E4/4", "Eb4/4")
        .replace("E3/4", "Eb3/4").replace("I/4 V43/4 I6/4", "i/4 V43/4 i6/4")],
      ["中音承担七音并亲自落到五音", passing.replace("E4/4 F4/4 G4/4", "C5/4 B4/4 C5/4")
        .replace("C4/4 B3/4 C4/4", "E4/4 F4/4 G4/4").replace("G3/4 G3/4 G3/4", "G3/4 G3/4 C4/4")],
      ["两处弱位低音分别先现并在换和弦时同音重奏", anticipations],
      ["两处先现低音无角色标注但实音与时值吻合", unmarkedAnticipations],
    ])("%s的上行进行按教材解决", (_name, score) => {
      expect(seventhWarnings(score).diagnostics).toEqual([]);
    });

    it.each([
      ["另一声部奏出五音，七音原声部跳到根音", passing.replace("F4/4 G4/4", "F4/4 C5/4")
        .replace("B3/4 C4/4", "B3/4 G4/4")],
      ["前和弦是下属四六和弦", passing.replace("E4/4 F4/4", "A4/4 F4/4")
        .replace("C4/4 B3/4", "F4/4 B3/4").replace("G3/4 G3/4 G3/4", "C4/4 G3/4 G3/4")
        .replace("I/4 V43/4", "IV64/4 V43/4")],
      ["中间是属五六和弦", passing.replace("C4/4 B3/4 C4/4", "C4/4 D4/4 C4/4")
        .replace("C3/4 D3/4 E3/4", "C3/4 B2/4 E3/4").replace("V43/4", "V65/4")],
      ["落到主和弦原位", passing.replace("E3/4", "C3/4").replace("I6/4", "I/4")],
      ["同声部跳到高八度的五音", passing.replace("F4/4 G4/4", "F4/4 G5/4")],
      ["结构低音换八度", passing.replace("D3/4 E3/4", "D3/4 E2/4")],
      ["落点重复主和弦三音", passing.replace("B3/4 C4/4", "B3/4 E4/4")
        .replace("G3/4 G3/4 G3/4", "G3/4 G3/4 C4/4")],
      ["低音提前移动却标为经过音", anticipations.replace("note earlyE role=anticipation", "note earlyE role=passing")],
      ["低音提前移动后换和弦时未同音重奏", anticipations.replace("E3/8@earlyE", "Eb3/8@earlyE")],
      ["逆向进行中七音仍然上行", descending.replace("F4/4 E4/4", "F4/4 G4/4")
        .replace("B3/4 C4/4", "B3/4 E4/4")],
    ])("%s时仍在原七音声部报警", (_name, score) => {
      const { diagnostics, landing } = seventhWarnings(score);
      expect(diagnostics).toContainEqual(expect.objectContaining({
        tick: landing,
        severity: "warning",
        voiceIds: ["soprano"],
      }));
    });

    it("逆向的主六和弦到原位主和弦仍接受七音下行", () => {
      expect(seventhWarnings(descending).diagnostics).toEqual([]);
    });
  });
});

describe("有准备的持续七音及其结算", () => {
  const root = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | F5/2 E5/4 |
 A: | A4/4 G4/2 |
 T: | C4/4 B3/4 E4/4 |
 B: | F3/4 G3/4 C3/4 |
 H: | S/4 D7/4 T/4 |
}`;

  const labelOnly = root.replace("A4/4 G4/2", "A4/2 G4/4")
    .replace("C4/4 B3/4 E4/4", "C4/2 E4/4").replace("F3/4 G3/4 C3/4", "F3/2 C3/4");

  const applied = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | C5/2 B4/4 |
 A: | E4/4 D4/2 |
 T: | G3/4 A3/4 B3/4 |
 B: | C3/4 F#3/4 G3/4 |
 H: | T/4 V65/V/4 V/4 |
}`;

  const neighbor = `satb 1
key Ab major
meter 2/4
bars 1..3 {
 S: | Ab4/2~ | Ab4/8 Bbb4/8 Ab4/4 | G4/2 |
 A: | Cb4/2 | Db4/2 | Db4/2 |
 T: | Ab3/2 | Fb3/2 | G3/2 |
 B: | Fb2/2 | Bbb2/2 | Eb3/2 |
 H: | bVI/2 | bII7/8 bII/8 bII7/4 | V7/2 |
}`;

  function seventhWarnings(project: ProjectDocument) {
    return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.chord-seventh");
  }

  function atExit(text: string, voice: string, expected: number) {
    const { project } = compileScoreText(text);
    const warnings = seventhWarnings(project);
    expect(warnings).toHaveLength(expected);
    if (expected) {
      expect(warnings[0]).toMatchObject({
        tick: 2 * project.ppq,
        voiceIds: [voice],
        debug: { obligation: { openedAt: { tick: project.ppq } } },
      });
    }
  }

  describe("七音从上一和弦的实写成员持续进入", () => {
    it.each([[root, 0], [root.replace("E5/4", "G5/4"), 1]] as const)(
      "复核 14–191 省五属七的准备音和主和弦着陆", (text, expected) => {
        atExit(text, "soprano", expected);
        const { project } = compileScoreText(text.replace(/\n H:.*/, ""));
        const written = applyHarmonyInference(project, inferHarmony(project), { mode: "fill-gaps" }).project;
        const slices = buildHarmonyAnalysis(written).slices;
        expect(slices.find(slice => slice.tick === 0)?.chord?.identity.root).toMatchObject({ step: "F", alter: 0 });
        expect(slices.find(slice => slice.tick === project.ppq)?.chord?.identity).toMatchObject({
          root: { step: "G", alter: 0 }, structure: { quality: "dominant7" },
        });
        expect(slices.find(slice => slice.tick === 2 * project.ppq)?.chord?.identity.root)
          .toMatchObject({ step: "C", alter: 0 });
        expect(seventhWarnings(written)).toHaveLength(expected);
      },
    );

    it("同音重奏仍走原来的起奏入口", () => {
      atExit(root.replace("F5/2 E5/4", "F5/4 F5/4 G5/4"), "soprano", 1);
    });

    it.each([[applied, 0], [applied.replace("B4/4", "D5/4"), 1]] as const)(
      "副属七的 D/F♯ 转位保留七音义务", (text, expected) => {
        atExit(text, "soprano", expected);
      },
    );

    it("属二的低音从下属根音保持，按实奏处理低音解决", () => {
      const text = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | A4/4 B4/4 C5/2 |
 A: | F4/4 G4/4 G4/2 |
 T: | C4/4 D4/4 C4/2 |
 B: | F3/2 E3/2 |
 H: | S/4 D2/4 T6/2 |
}`;
      // 15–208，左。错误版也保留一个完整的着陆和弦。
      atExit(text, "bass", 0);
      atExit(text.replace("G4/4 G4/2", "G4/4 E4/2").replace("E3/2", "G3/2").replace("T6/2", "I64/2"), "bass", 1);
    });

    it("持音开立后仍执行同根换位中禁止的七音交接", () => {
      const text = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | A4/4 B4/4 F4/4 |
 A: | F4/4 G4/4 D4/4 |
 T: | C4/4 D4/4 B3/4 |
 B: | F3/2 G3/4 |
 H: | S/4 D2/4 D7/4 |
}`;
      atExit(text, "bass", 1);
      expect(seventhWarnings(compileScoreText(text).project)[0]?.title).toBe("属七和弦换位时低音七音上行");
    });

    it.each(["label", "inversion", "reattack"])("同七音过切片或转位重写，只结算一次（%s）", variant => {
      const reinvert = variant === "inversion";
      const text = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${variant === "reattack" ? "F5/2 F5/4" : "F5/2."} G5/4 |
 A: | A4/4 G4/2 G4/4 |
 T: | C4/4 ${reinvert ? "B3/4 D4/4" : "B3/2"} E4/4 |
 B: | F3/4 ${reinvert ? "G3/4 B3/4" : "G3/2"} C3/4 |
 H: | S/4 D7/4 ${reinvert ? "D65/4" : "D7/4"} T/4 |
}`;
      const { project } = compileScoreText(text);
      const warnings = seventhWarnings(project);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        tick: 3 * project.ppq, debug: { obligation: { openedAt: { tick: project.ppq } } },
      });
    });

    it.each([
      ["只是改标签", labelOnly],
      ["把实写七音写成等音 E♯", root.replace("F5/2", "E#5/2")],
      ["前置和弦的三音错拼为等音", root.replace("A4/4", "G##4/4")],
      ["新和弦的结构三音错拼为等音", root.replace("B3/4", "Cb4/4")],
      ["旧和弦外音", root.replace("H: | S/4", "H: | T/4")],
      ["音符已标外音", root + "\nannotations {\nnote S@1:1 role=suspension\n}"],
      ["缺七和弦的实写三音", root.replace("B3/4 E4/4", "D4/4 E4/4")],
    ])("%s 时没有足够的持音开立证据", (_name, text) => {
      atExit(text.replace("E5/4", "G5/4"), "soprano", 0);
    });

    it("手工句界阻止持音开立，已确认的七音在无标签落点仍须解决", () => {
      const { project } = compileScoreText(root.replace("E5/4", "G5/4"));
      const cut = { id: "new-phrase", tick: project.ppq, source: "manual", confidence: "certain" } as const;
      expect(seventhWarnings({ ...project, structure: { ...project.structure, phraseBoundaries: [cut] } })).toEqual([]);
      const withoutLanding = { ...project, chordTrack: { ...project.chordTrack, regions: project.chordTrack.regions.slice(0, 2) } };
      expect(seventhWarnings(withoutLanding)).toMatchObject([{ tick: 2 * project.ppq, voiceIds: ["soprano"],
        chordIds: [project.chordTrack.regions[1].id], params: { resolutionSemitones: 2 } }]);
    });

    it("同调重申伴随真实和声变化时仍可开立", () => {
      const { project } = compileScoreText(root.replace("E5/4", "G5/4"));
      project.keyEvents.push({ ...project.keyEvents[0], id: "restated-key", tick: project.ppq });
      expect(seventhWarnings(project)).toMatchObject([{ tick: 2 * project.ppq, voiceIds: ["soprano"] }]);
    });

    it.each([["同调重申但无运动", labelOnly, "major"], ["实际变调", root, "minor"]] as const)(
      "调号事件并不提供持音开立证据（%s）", (_label, text, mode) => {
        const { project } = compileScoreText(text.replace("E5/4", "G5/4"));
        project.keyEvents.push({ ...project.keyEvents[0], mode, id: "new-key-event", tick: project.ppq });
        expect(seventhWarnings(project)).toEqual([]);
      },
    );

    it("下属六五的持音七音转为主根时仍可同音解决", () => {
      const text = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | C5/2. |
 A: | G4/4 A4/4 G4/4 |
 T: | E4/4 D4/4 E4/4 |
 B: | C3/4 F3/4 C3/4 |
 H: | T/4 SII65/4 T/4 |
}`;
      atExit(text, "soprano", 0);
      atExit(text.replace("C5/2.", "C5/2 G5/4"), "soprano", 1);
    });

    const annotatedNeighbor = neighbor.replace("Bbb4/8", "Bbb4/8@ornament") +
      "\nannotations {\nnote ornament role=neighbor\n}";
    it.each([["未标记", neighbor], ["明确标记", annotatedNeighbor]])(
      "N074 型回到同一七音时延后结算（%s）", (_label, text) => {
        const legal = compileScoreText(text).project;
        const ornament = legal.satbTracks.find(track => track.id === "soprano")?.notes
          .find(note => note.startTick === 2.5 * legal.ppq);
        expect(ornament?.nonChordToneRole).toBe(text === annotatedNeighbor ? "neighbor" : undefined);
        expect(seventhWarnings(legal)).toEqual([]);
        const wrong = compileScoreText(text.replace("Ab4/4 | G4/2", "Ab4/4 | Bb4/2")).project;
        const warnings = seventhWarnings(wrong);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({
          tick: 4 * wrong.ppq,
          debug: { obligation: { steps: expect.arrayContaining([
            expect.objectContaining({ reason: "chord-seventh-prepared-neighbor", outcome: "continue" }),
          ]) } },
        });
      },
    );

    it.each([2.25, 2.75])("同调重申切分持续音时仍在真正离开七音处结算（%s）", beat => {
      for (const [landing, exits] of [["G4", []], ["Bb4", [4]]] as const) {
        const { project } = compileScoreText(annotatedNeighbor.replace("G4/2 |", landing + "/2 |"));
        project.keyEvents.push({ ...project.keyEvents[0], id: "restated", tick: beat * project.ppq });
        expect(seventhWarnings(project).map(item => item.tick / project.ppq)).toEqual(exits);
      }
    });

    it.each(["key", "phrase"] as const)("真实调性或乐句变化中止辅助音延后结算（%s）", type => {
      const { project } = compileScoreText(annotatedNeighbor);
      const tick = 2.75 * project.ppq;
      if (type === "key") {
        project.keyEvents.push(
          { ...project.keyEvents[0], id: "change", mode: "minor", tick },
          { ...project.keyEvents[0], id: "restore", tick: 3 * project.ppq },
        );
      } else {
        project.structure.phraseBoundaries.push({ id: "new-phrase", source: "manual", confidence: "certain", tick });
      }
      expect(seventhWarnings(project)).toMatchObject([{ tick: 2.5 * project.ppq, voiceIds: ["soprano"] }]);
    });

    it.each([
      ["缺回归", neighbor.replace("Bbb4/8 Ab4/4", "Bbb4/4.").replace("bII/8 bII7/4", "bII/4.")],
      ["标注辅助音仍须实际回归", annotatedNeighbor.replace("Bbb4/8@ornament Ab4/4", "Bbb4/4.@ornament")
        .replace("bII/8 bII7/4", "bII/4.")],
      ["等音并非实写级进", neighbor.replace("Bbb4/8", "A4/8")],
      ["明文标为倚音", annotatedNeighbor.replace("role=neighbor", "role=appoggiatura")],
    ])("近似谱面仍在出发处结算（%s）", (_label, text) => {
      const { project } = compileScoreText(text);
      expect(seventhWarnings(project)).toMatchObject([{ tick: 2.5 * project.ppq, voiceIds: ["soprano"] }]);
    });
  });
});

describe("升五属七的变五音解决", () => {
  const melody = "melody.augmented-interval";
  const missing = "chord.incomplete-members";
  const progression = `satb 1
key F major
meter 4/4
bars 1..1 {
  S: | G4/4 G#4/4 A4/2 |
  A: | E4/2 F4/2 |
  T: | Bb3/2 A3/2 |
  B: | C3/2 F3/2 |
}
annotations {
  chord target range=[1:3,2:1) symbol=I
}`;

  function diagnoses(score: string, breakAtLanding = false) {
    const { project } = compileScoreText(score);
    if (breakAtLanding) project.structure.phraseBoundaries = [{
      id: "break", tick: 2 * project.ppq, source: "manual", confidence: "certain",
    }];
    const { diagnostics } = checkHarmony(project, undefined, {}, {
      [melody]: { "same-harmony": "strict", arpeggiation: "strict" },
    });
    return {
      spelling: diagnostics.some(d => d.ruleId === melody && d.voiceIds.includes("soprano") && d.tick === project.ppq),
      fifth: diagnostics.some(d => d.ruleId === missing && d.tick === 2 * project.ppq),
    };
  }

  describe("升五属七解决时主和弦重复三音（第46章第4节）", () => {
    it.each([
      ["F大调，低音上行四度", progression],
      ["F大调，低音下行五度", progression.replace("C3/2 F3/2", "C3/2 F2/2")],
      ["移调至C大调", progression.replace("F major", "C major")
        .replace("G4/4 G#4/4 A4", "D5/4 D#5/4 E5").replace("E4/2 F4", "B3/2 C4")
        .replace("Bb3/2 A3", "F3/2 E3").replace("C3/2 F3", "G2/2 C3")],
    ])("%s 时升五音和七音各自由原声部解决到三音", (_name, score) => {
      expect(diagnoses(score)).toEqual({ spelling: false, fifth: false });
    });

    it.each([
      ["七音越过八度", progression.replace("Bb3/2 A3", "Bb3/2 A4")],
      ["导音越过八度", progression.replace("E4/2 F4", "E4/2 F5")],
      ["升五音越过八度", progression.replace("G#4/4 A4", "G#4/4 A5")],
      ["低音解决前有休止", progression.replace("C3/2 F3/2", "C3/4. r/8 F3/2")],
      ["低音越过八度", progression.replace("C3/2 F3/2", "C3/2 F1/2")],
    ])("%s 时仍指出缺五音而无入音 B.3", (_name, score) => {
      expect(diagnoses(score)).toEqual({ spelling: false, fifth: true });
    });

    it("显式标注普通属七时也不从半音入音推断错拼", () => {
      const score = progression.replace("  chord target", "  chord source range=[1:2,1:3) symbol=V7\n  chord target");
      expect(diagnoses(score).spelling).toBe(false);
    });

    it("盲推后由 E.6 区分升五音的两种解决走向", () => {
      const unmarked = `satb 1
key F major
meter 4/4
bars 1..2 {
  S: | F4/4 G4/t2400 G#4/8 | A4/1 |
  A: | C4/4 E4/2. | F4/1 |
  T: | A3/4 Bb3/2. | A3/1 |
  B: | F3/4 C3/2. | F3/1 |
}`;
      for (const [text, violatesResolution] of [[unmarked, false], [unmarked.replace("A4/1", "C5/1"), true]] as const) {
        const input = compileScoreText(text).project;
        const { project } = applyHarmonyInference(input, { chordInference: inferChords(input) }, {
          mode: "replace-unlocked", writeNonChordToneRoles: true,
        });
        const { diagnostics } = checkHarmony(project);
        expect(diagnostics.some(d => d.ruleId === melody && d.tick === 3.5 * input.ppq &&
          d.voiceIds.includes("soprano"))).toBe(false);
        expect(diagnostics.some(d => d.ruleId === "resolution.altered-dominant-fifth" && d.tick === 4 * input.ppq &&
          d.voiceIds.includes("soprano"))).toBe(violatesResolution);
      }
    });

    it("解决不能跨显式句界", () => {
      expect(diagnoses(progression, true)).toEqual({ spelling: false, fifth: true });
    });
  });
});

describe("导音、七音、九音与变化音的状态转换", () => {
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
});

describe("下属七的根音与七音交换", () => {
  const exchange = ["F5 F5", "A4 A4", "C4 D4", "D3 C3"];
  function score(voices = exchange, chords = "SII7 SII2", key = "C major") {
    const parts = [...voices, chords].map((line, index) => {
      const notes = line.split(" ").map(pitch => `${pitch}/4`).join(" ");
      return line && ` ${["S", "A", "T", "B", "H"][index]}: | ${notes} |`;
    });
    return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..1 {
${parts.join("\n")}
}`).project;
  }
  function atExchange(project: ProjectDocument, voice: VoiceId = "tenor") {
    return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.chord-seventh" &&
      item.tick === project.ppq && item.voiceIds.includes(voice));
  }

  describe("下属七和弦重新排列时的根音和七音", () => {
    it("男高七音与低音根音互换，给定和弦及盲推均指出原七音声部", () => {
      const bare = score(exchange, "");
      const blind = applyHarmonyInference(bare, { chordInference: inferChords(bare) }, { mode: "replace-unlocked" }).project;
      for (const project of [score(), blind]) {
        expect(atExchange(project)).toMatchObject([{severity:"warning", title:"下属七和弦的七音与根音互换", voiceIds:["tenor"]}]);
      }
      expect(atExchange(bare)).toHaveLength(0);
    });
    it("降B大调属前功能相同，一转位不动低音时内声和女高也能发生互换", () => {
      const project = score(["Bb4 C5","G4 G4","C4 Bb3","Eb3 Eb3"],"SII65 SII65","Bb major");
      expect(atExchange(project,"soprano")).toMatchObject([{severity:"warning",title:"下属七和弦的七音与根音互换"}]);
    });
    it.each([
      ["下属七的七音与五音交换", ["A4 C5","D4 D4","C4 A3","F2 F2"],"SII65 SII65"],
      ["七音由低音引入，起点是下属二级三和弦", ["F5 F5","A4 A4","D4 D4","D3 C3"],"SII SII2"],
      ["七音与三音交换，非根音接手", ["A4 A4","F4 C4","C4 F4","D3 D3"],"SII7 SII7"],
      ["原五音声部接走七音，同时原根音移至五音", ["A4 C5","F4 F4","C4 D4","D3 A2"],"SII7 SII43"],
      ["两端声部没有写全和弦", ["A4 F4","F4 F4","C4 D4","D3 C3"],"SII7 SII2"],
      ["实际低音与标注不合", exchange, "SII65 SII2"],
    ] as const)("%s 时保留原有判断", (_label, notes, harmony) => {
      expect(atExchange(score([...notes], harmony))).toHaveLength(0);
    });
    it("人工作出的乐句边界切断原七音义务的声部证据", () => {
      const project = score();
      project.structure.phraseBoundaries.push({id:"phrase",tick:project.ppq,source:"manual",confidence:"certain"});
      expect(atExchange(project)).toHaveLength(0);
    });
  });
});

describe("下属七至实写主四六的七音义务", () => {
  function score(held = false, key = "C major", harmony = "", first = "4", second = "4", meter = "2/4") {
    const voices = key === "D major"
      ? ["D5 F#5", "B4 A4", "E4 D4", "G3 A3"]
      : [held ? "C5 C5" : "C5 E5", held ? "D4 E4" : "D4 C4", "A3 G3", "F3 G3"];
    return compileScoreText(["satb 1", "key " + key, "meter " + meter, "bars 1..1 {",
      ...voices.map((notes, i) => "SATB"[i] + ": | " + notes.split(" ").map((n, j) => n + "/" + [first, second][j]).join(" ") + " |"),
      harmony && "H: | SII65/" + first + " " + harmony + "/" + second + " |", "}"].join("\n")).project;
  }

  function blind(bare: ProjectDocument) {
    const inference = inferChords(bare);
    expect(inference.regions[1].status).toBe("ambiguous");
    return applyHarmonyInference(bare, { chordInference: inference },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
  }

  function seventh(project: ProjectDocument, tick: number = project.ppq) {
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === "resolution.chord-seventh" &&
      d.tick === tick && d.voiceIds.includes("soprano"));
  }

  describe("supertonic seventh entering the written tonic six-four", () => {
    it.each(["C major", "D major"])("detects the upward third while retaining the open function in %s", key => {
      const project = blind(score(false, key));
      expect(project.chordTrack.regions).toHaveLength(1);
      const [d] = seventh(project);
      expect(d).toMatchObject({ severity: "warning", voiceIds: ["soprano"], params: { resolutionSemitones: 4 },
        chordIds: [project.chordTrack.regions[0].id] });
      expect(d.params).not.toHaveProperty("targetChord");
      expect(d.trace?.at(-1)?.reason).toBe("supertonic-seventh-leaps-to-six-four");
    });

    it("accepts the correction with a rearticulated seventh in the original octave", () => {
      expect(seventh(blind(score(true)))).toHaveLength(0);
      expect(seventh(score(true, "C major", "K46"))).toHaveLength(0);
    });

    it("uses the ordinary obligation when the supplied target is K46", () => {
      const project = score(false, "C major", "K46");
      const [d] = seventh(project);
      expect(d.chordIds).toHaveLength(2);
      expect(d.trace?.at(-1)?.reason).toBe("chord-seventh-moved-elsewhere");
    });

    it("requires a confirmed source seventh", () => {
      expect(seventh(score())).toHaveLength(0);
    });

    it.each([
      ["4", "2", "3/4", 1],
      ["8", "4", "3/8", 0.5],
    ] as const)("checks stable unequal chord durations in %s and %s notes", (first, second, meter, beats) => {
      const project = score(false, "C major", "r", first, second, meter);
      expect(seventh(project, beats * project.ppq)).toHaveLength(1);
    });

    const breaks: [string, (p: ProjectDocument) => void][] = [
      ["missing tonic", p => { p.satbTracks[2].notes.pop(); }],
      ["enharmonic third", p => { p.satbTracks[0].notes[1].pitch = {step:"F",alter:-1,octave:5}; }],
      ["displaced bass octave", p => { p.satbTracks[3].notes[1].pitch.octave--; }],
      ["marked inner non-chord tone", p => { p.satbTracks[1].notes[1].nonChordToneRole = "passing"; }],
      ["broken inner motion", p => { p.satbTracks[1].notes[1].pitch.octave--; }],
      ["short decoration", p => { p.satbTracks.forEach(t => { t.notes[1].durationTicks /= 2; }); }],
      ["source rest", p => { p.satbTracks[0].notes[0].durationTicks /= 2; }],
      ["new key", p => { p.keyEvents.push({ ...p.keyEvents[0], id: "other", tick: p.ppq, mode: "minor" }); }],
      ["manual phrase break", p => {
        p.structure.phraseBoundaries.push({ id: "boundary", tick: p.ppq, source: "manual", confidence: "certain" });
      }],
      ["different source function", p => {
        p.chordTrack.regions[0].semantics = undefined;
      }],
    ];
    it.each(breaks)("leaves the unlabelled landing open with a %s", (_name, change) => {
      const project = blind(score());
      change(project);
      expect(seventh(project)).toHaveLength(0);
    });
  });
});

describe("属七换位中的上声部七音交接", () => {
  function passage(chords: string, voices: string[], key = "C major") {
    const line = (sequence: string) => sequence.split(" ").map(p => p + "/4").join(" ");
    return compileScoreText([
      "satb 1", "key " + key, "meter 2/4", "bars 1..1 {",
      ...voices.map((sequence, i) => `${"SATB"[i]}: | ${line(sequence)} |`),
      `H: | ${line(chords)} |`, "}",
    ].join("\n")).project;
  }

  function warnings(project: ReturnType<typeof passage>) {
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === "resolution.chord-seventh");
  }

  const rising = ["F4 G4", "D4 D4", "B3 F3", "G2 B2"];
  const falling = ["F5 G4", "B4 F4", "G4 D4", "D3 B2"];
  const swap = ["D5 D5", "F4 G4", "G4 F4", "B2 B2"];

  describe("属七和弦上声部换位的实音交接", () => {
    it.each([
      ["七音上二度，接手者下增四度", "D7 D65", rising, "soprano", "F3"],
      ["七音下七度，接手者下增四度", "D43 D65", falling, "soprano", "F4"],
      ["内声部原音区互换", "D65 D65", swap, "alto", "F4"],
    ] as const)("%s 时仅向原七音声部发出 E.2", (_, chords, voices, voice, seventh) => {
      const project = passage(chords, voices);
      const found = warnings(project);
      expect(found).toEqual([expect.objectContaining({
        tick: project.ppq, endTick: 2 * project.ppq, voiceIds: [voice], severity: "warning",
      })]);
      expect(found[0].evidence).toContainEqual(expect.objectContaining({ label: "接手的七音", value: seventh }));
    });

    it.each([
      ["女高保持七音", "D7 D65", ["F4 F4", "D4 D4", "B3 G3", "G2 B2"]],
      ["女高移至五音，低音接七音", "D7 D2", ["F5 D5", "G4 G4", "B3 B3", "G3 F3"]],
      ["女高保持，女低下三度", "D43 D65", ["F5 F5", "B4 G4", "G4 D4", "D3 B2"]],
      ["内声部保持，男高改变音区", "D65 D43", ["D5 G4", "F4 F4", "G3 B3", "B2 D3"]],
      ["七音与五音原音区互换", "D65 D65", ["G4 G4", "F4 D4", "D4 F4", "B2 B2"]],
    ] as const)("%s 时保留七音交接或重奏", (_, chords, voices) => {
      expect(warnings(passage(chords, [...voices]))).toEqual([]);
    });

    it("小调的属七和弦同样按拼写核对根音和七音", () => {
      const score = passage("D65 D65", ["B4 B4", "D4 E4", "E4 D4", "G#2 G#2"], "A minor");
      expect(warnings(score)).toEqual([expect.objectContaining({ tick: score.ppq, voiceIds: ["alto"] })]);
    });

    it("跨手动句界或接手者是显式外音时放行", () => {
      const boundary = passage("D65 D65", swap);
      boundary.structure.phraseBoundaries.push({ id: "phrase-end", tick: boundary.ppq, source: "manual", confidence: "certain" });
      expect(warnings(boundary)).toEqual([]);
      const ornament = passage("D65 D65", swap);
      ornament.satbTracks.find(track => track.voice === "tenor")!.notes[1].nonChordToneRole = "anticipation";
      expect(warnings(ornament)).toEqual([]);
    });

    it("来源七音持续期间，接手者只在末半拍唱根音时保留原交接", () => {
      const score = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
  S: | G5/4 D5/4 |
  A: | F4/4 G4/4 |
  T: | D4/8 G4/8 F4/4 |
  B: | B2/4 B2/4 |
  H: | D65/4 D65/4 |
}`).project;
      expect(warnings(score)).toEqual([]);
    });
  });
});

describe.each(["blind", "given"] as const)("E.1 小七过渡与属持续音交接 (%s)", mode => {
  const rule = "resolution.leading-tone";
  const sequence = [
    "G4/4 F4/4 F#4/8 F4/8 G4/4",
    "C#4/4 C4/4. B3/8 B3/4",
    "A3/4 A3/4. G3/8 G3/4",
    "A2/4 D3/4. G2/8 G2/4",
  ];
  const pedal = [
    "r/4 Bb4/8 Ab4/8 G4/8 F4/8 | Eb4/2.",
    "r/4 F4/8 Eb4/8 D4/4 | Eb4/2.",
    "r/4 D4/8 C4/8 Bb3/8 Ab3/8 | G3/2.",
    "r/4 Bb2/2 | Eb2/2.",
  ];

  function check(lines: readonly string[], mechanism: "sequence" | "pedal", boundary?: number, localPedal = false) {
    const isSequence = mechanism === "sequence";
    const harmony = isSequence ? "V7/4 r/2." : "r/4 V/8 r/4. | I/2.";
    const localLabels = [
      "annotations {",
      ' chord dominant range=[1:3+1/2,2:1) symbol=V7 localKey="Eb major"',
      ' chord tonic range=[2:1,3:1) symbol=I localKey="Eb major"',
      "}",
    ];
    const { project: raw } = compileScoreText([
      "satb 1", isSequence ? "key D minor" : localPedal ? "key A minor" : "key Eb major",
      isSequence ? "meter 4/4" : "meter 3/4",
      isSequence ? "bars 1..1 {" : "bars 1..2 {",
      ...["S", "A", "T", "B"].map((voice, i) => ` ${voice}: | ${lines[i]} |`),
      ...(mode === "given" && !localPedal ? [` H: | ${harmony} |`] : []), "}",
      ...(mode === "given" && localPedal ? localLabels : []),
    ].join("\n"));
    if (boundary !== undefined) raw.structure.phraseBoundaries.push({
      id: "manual", tick: boundary * raw.ppq, source: "manual", confidence: "certain",
    });
    const project = mode === "blind"
      ? applyHarmonyInference(raw, { chordInference: inferChords(raw) },
          { mode: "replace-unlocked", writeNonChordToneRoles: true }).project
      : raw;
    expect(validateProject(project)).toBe(true);
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === rule &&
      d.tick === (isSequence ? 1 : 1.5) * project.ppq && d.voiceIds.includes(isSequence ? "alto" : "tenor"));
  }

  it("V06 小七转属七再下行五度时保留建议", () => {
    expect(check(sequence, "sequence")).toMatchObject([{
      severity: "suggestion",
      title: "模进中导音经小七和弦过渡",
      trace: expect.arrayContaining([expect.objectContaining({
        outcome: "violate", reason: "leading-tone-sequential-minor-seventh",
      })]),
    }]);
  });

  it.each([
    ["小七的三音没有升高", sequence.map(line => line.replace("F#4/8", "F4/8")), undefined],
    ["新属七没有落向五度下行目标", ["G4/4 F4/4 F#4/8 E4/8 E4/4", "C#4/4 C4/4. C4/8 C4/4",
      "A3/4 A3/4. C4/8 C4/4", "A2/4 D3/4. C3/8 C3/4"], undefined],
    ["导音未半音下行成七音", [sequence[0], "C#4/4 A4/4. B3/8 B3/4", "A3/4 C4/4. G3/8 G3/4", sequence[3]], undefined],
    ["中介后有人工句界", sequence, 2.5],
    ["进入中介处有人工句界", sequence, 1],
  ] as const)("V06 %s时仍报黄警", (_name, lines, boundary) => {
    expect(check(lines, "sequence", boundary)).toMatchObject([{ severity: "warning", title: "导音未上行解决" }]);
  });

  it("V07 另一声部隔一个弱位切片接手并在主和弦解决", () => {
    expect(check(pedal, "pedal")).toEqual([]);
    expect(check(pedal, "pedal", undefined, true)).toEqual([]);
  });

  it.each([
    ["持续低音中途换音", [...pedal.slice(0, 3), "r/4 Bb2/8 C3/8 Bb2/4 | Eb2/2."], undefined],
    ["持续低音中途休止", [...pedal.slice(0, 3), "r/4 Bb2/8 r/8 Bb2/4 | Eb2/2."], undefined],
    ["同音重奏切断持续低音", [...pedal.slice(0, 3), "r/4 Bb2/8 Bb2/8 Bb2/4 | Eb2/2."], undefined],
    ["接手声部没有上行解决", [pedal[0], "r/4 F4/8 Eb4/8 D4/4 | G4/2.", pedal[2], pedal[3]], undefined],
    ["接手处有人工句界", pedal, 2],
    ["落主处有人工句界", pedal, 3],
  ] as const)("V07 %s时仍报原声部黄警", (_name, lines, boundary) => {
    const warning = [{ severity: "warning", title: "导音未上行解决" }];
    expect(check(lines, "pedal", boundary)).toMatchObject(warning);
    if (mode === "given") expect(check(lines, "pedal", boundary, true)).toMatchObject(warning);
  });
});
