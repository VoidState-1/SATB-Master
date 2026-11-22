import { describe, expect, it, vi } from "vitest";
import { functionalTargetForDegree } from "../../../../chordModel";
import { createEmptyProject, PPQ, validateProject, type ProjectDocument } from "../../../../project";
import { compileScoreText } from "../../../../scoreText";
import { buildHarmonyAnalysis } from "../../../analysis";
import { applyHarmonyInference, inferChords } from "../../../inference";
import { checkHarmony } from "../../../registry";
import {
  diagnosticFor,
  functionalChord,
  manualCertain,
  pitch,
  setLine,
} from "../../../testing/fixtures/ruleProjects";
import { functionalTargetMatches } from "../../connector";
import { createHarmonyRuleContext } from "../../context/createRuleContext";
import { augmentedIntervalRule, diminishedIntervalRule, tritoneRule } from "../melody";
import * as localProof from "../support/appliedAndDeceptive";
import { isProvenHeldDoubleDominantContinuation } from "../support/doubleDominant";

describe("副属目标、功能延长与目标转移", () => {
  type Frame = readonly [string, string, string, string, string];

  function exercise(frames: readonly Frame[], key = "C major") {
    const lines = ["S", "A", "T", "B", "H"].map((part, index) =>
      ` ${part}: | ${frames.map(frame => frame[index] + "/4").join(" ")} |`);
    return compileScoreText(`satb 1
key ${key}
meter ${frames.length}/4
bars 1..1 {
${lines.join("\n")}
}`).project;
  }

  const ruleId = "function.applied-dominant-target";

  function check(project: ProjectDocument) {
    const result = checkHarmony(project);
    expect(result.skippedRules.filter(skip => skip.ruleId === ruleId)).toEqual([]);
    const warnings = result.diagnostics.filter(item => item.ruleId === ruleId);
    return { warnings, beats: warnings.map(item => item.tick / project.ppq) };
  }

  function cutPhrase(project: ProjectDocument, beat: number) {
    project.structure.phraseBoundaries.push({
      id: "split", tick: beat * project.ppq, source: "manual", confidence: "certain",
    });
  }

  function chordIds(project: ProjectDocument, ...indices: number[]) {
    return indices.map(index => project.chordTrack.regions[index].id).sort();
  }

  const dd: Frame = ["A4", "D4", "F#3", "D3", "V/V"];
  const dd7: Frame = ["A4", "C4", "F#3", "D3", "V7/V"];
  const dd43: Frame = ["F#4", "C4", "D3", "A2", "V43/V"];
  const dominant: Frame = ["D5", "B4", "G3", "G2", "V"];
  const tonic: Frame = ["E4", "G3", "C3", "C2", "I"];
  const subdominant: Frame = ["A4", "C4", "F3", "F2", "IV"];

  describe("G.2 同目标的属功能延长", () => {
    it.each([{ first: dd }, { first: dd7 }])("三变七或同根换位后，只在最后的错误出口报警", ({ first }) => {
      expect(check(exercise([first, dd43, dominant])).beats).toEqual([]);
      const wrongExit = exercise([first, dd43, subdominant]);
      const { beats, warnings } = check(wrongExit);
      expect(beats).toEqual([2]);
      expect(warnings[0].chordIds).toEqual(chordIds(wrongExit, 1, 2));
      expect(check(exercise([first, subdominant])).beats).toEqual([1]);
    });

    it("同目标标签与实写三音拼写相冲突时保留交界警告", () => {
      const wrongSpelling: Frame = ["Gb4", "C4", "D3", "A2", "V43/V"];
      expect(check(exercise([dd7, wrongSpelling, subdominant])).beats).toEqual([1, 2]);
    });

    it("实写 DD 到 DDVII 可经 K46 解决，DDVII 的错误出口仍须报警", () => {
      const applied: Frame = ["C#5", "G4", "A3", "E3", "DD43"];
      const leading: Frame = ["E5", "G4", "A#3", "C#3", "DDVII7"];
      const sixFour: Frame = ["D5", "G4", "B3", "D3", "K46"];
      const goal: Frame = ["D5", "F#4", "A3", "D3", "V"];
      const wrongExit: Frame = ["E5", "C5", "G3", "C3", "IV"];
      expect(check(exercise([applied, leading, sixFour, goal], "G major")).beats).toEqual([]);
      const rejected = exercise([applied, leading, sixFour, wrongExit], "G major");
      expect(check(rejected)).toMatchObject({ beats: [3], warnings: [{ chordIds: chordIds(rejected, 1, 3) }] });
      expect(check(exercise([applied, leading, wrongExit], "G major")).beats).toEqual([1, 2]);
      const otherVoice: Frame = ["B4", "G4", "D4", "D3", "K46"];
      expect(check(exercise([applied, leading, otherVoice, goal], "G major")).beats).toEqual([1]);
      const conventionalSpelling: Frame = ["E5", "G4", "Bb3", "C#3", "DDVII7"];
      expect(check(exercise([applied, conventionalSpelling, wrongExit], "G major")).beats).toEqual([2]);
    });

    it("一转导减七的升二级实写解决也可经 K46 延续", () => {
      const applied: Frame = ["C#5", "G4", "A3", "E3", "DD43"];
      const leading: Frame = ["A#4", "G4", "C#4", "E3", "DDVII65"];
      const sixFour: Frame = ["B4", "G4", "D4", "D3", "K46"];
      const goal: Frame = ["D5", "F#4", "A3", "D3", "V"];
      expect(check(exercise([applied, leading, sixFour, goal], "G major")).beats).toEqual([]);
      const wrongRole = exercise([applied, leading, sixFour, goal], "G major");
      wrongRole.chordTrack.regions[2].semantics!.cadenceRole = "passing64";
      expect(check(wrongRole).beats).toContain(1);
    });

    it("同响的减七枢纽保留原警告，标签不能替谱面的 D♯/E♭ 决定目标", () => {
      const applied: Frame = ["D#5", "A4", "B3", "F#3", "DD43"];
      const leading: Frame = ["F#5", "A4", "C4", "D#3", "DDVII7"];
      const pivot: Frame = ["F#5", "A4", "C4", "Eb3", "DDVII7"];
      const goal: Frame = ["G#5", "B4", "E4", "E3", "V"];
      const newTonic: Frame = ["G5", "Bb4", "Eb4", "Eb3", "bV"];
      expect(check(exercise([applied, leading, goal], "A minor")).beats).toEqual([]);
      expect(check(exercise([applied, pivot, newTonic], "A minor")).beats).toEqual([1, 2]);
    });

    const german: Frame = ["Eb5", "C5", "F#4", "Ab2", "Ger+6"];
    const french: Frame = ["D5", "C5", "F#4", "Ab2", "Fr+6"];

    it("实写增六变体连续指向属根，增六后的错误出口仍须报警", () => {
      expect(check(exercise([dd7, german, french, dominant])).beats).toEqual([]);
      const rejected = exercise([dd7, german, french, subdominant]);
      expect(check(rejected)).toMatchObject({ beats: [3], warnings: [{ chordIds: chordIds(rejected, 2, 3) }] });
    });

    it("实写 DDVII 也可继续进入同目标增六", () => {
      const leading: Frame = ["Eb5", "C5", "F#4", "A2", "DDVII65"];
      expect(check(exercise([leading, german, dominant])).beats).toEqual([]);
      expect(check(exercise([leading, german, subdominant])).beats).toEqual([2]);
    });

    it.each([
      ["缺少高端", ["D5", "C5", "G4", "Ab2", "Fr+6"]],
      ["低端等音改写", ["D5", "C5", "F#4", "G#2", "Fr+6"]],
      ["两端各自指向别的根音", ["D5", "C5", "G#4", "Ab2", "Fr+6"]],
    ] satisfies [string, Frame][])("同一增六标签但%s时保留交界警告", (_name, wrong) => {
      expect(check(exercise([dd7, wrong, dominant])).beats).toEqual([1]);
    });

    it.each([0.5, 1])("人工句界在第 %s 拍时仍检查原交界", (beat) => {
      const project = exercise([dd7, dd43, dominant]);
      cutPhrase(project, beat);
      expect(check(project).beats).toEqual([1]);
    });
  });

  const e7: Frame = ["G#4", "D4", "E3", "E2", "V7/VI"];
  const a7: Frame = ["G4", "C#4", "E3", "A2", "V7/II"];
  const dMinor: Frame = ["F4", "D4", "A3", "D3", "ii"];

  describe("G.2 连续属七的目标转移", () => {
    it("以两条实写半音线到达旧根，再独立检查后一个属七的目标", () => {
      const project = exercise([e7, a7, tonic]);
      const { beats, warnings } = check(project);
      expect(beats).toEqual([2]);
      expect(warnings[0].chordIds).toEqual(chordIds(project, 1, 2));
      expect(check(exercise([e7, a7, dMinor])).beats).toEqual([]);
      const analysis = buildHarmonyAnalysis(project);
      const [source, arrival] = analysis.harmonySpans;
      expect(functionalTargetMatches(analysis, source.id, arrival.id,
        source.semantics!.interpretations[0].appliedTarget!)).toBe(false);
      expect(analysis.targetChains.find(chain => chain.sourceSpanId === source.id))
        .toMatchObject({ status: "violated", terminalSpanId: arrival.id });
    });

    it.each([
      ["属七标签与实写小三度相冲突", ["G4", "C4", "E3", "A2", "V7/II"]],
      ["后三音等音错拼", ["G4", "Db4", "E3", "A2", "V7/II"]],
      ["后三音由其他声部接手", ["G4", "E4", "C#4", "A2", "V7/II"]],
      ["后七音在错误八度", ["G5", "C#4", "E3", "A2", "V7/II"]],
      ["低音碰到旧目标但后根不同", ["F#4", "C4", "D3", "A2", "V43/V"]],
    ] satisfies [string, Frame][])("%s时，旧目标和新目标各自报警", (_name, wrong) => {
      expect(check(exercise([e7, wrong, tonic])).beats).toEqual([1, 2]);
    });

    it("属七间标出人工句界或实际休止时仍保留原警告", () => {
      const separated = exercise([e7, a7, tonic]);
      cutPhrase(separated, 1);
      expect(check(separated).beats).toEqual([1, 2]);
      const rest = exercise([e7, a7, tonic]);
      rest.satbTracks[0].notes[0].durationTicks /= 2;
      expect(check(rest).beats).toEqual([1, 2]);
    });

    it("和声覆盖有空隙或局部调已改换时沿用原规则的跳过行为", () => {
      const gap = exercise([e7, a7, tonic]);
      gap.chordTrack.regions[0].durationTicks /= 2;
      expect(check(gap).beats).toEqual([2]);
      const modulated = exercise([e7, a7, tonic]);
      modulated.chordTrack.regions[1].semantics!.interpretations[0].localKey =
        { tonic: { step: "D", alter: 0 }, mode: "minor" };
      expect(check(modulated).beats).toEqual([]);
    });
  });
});

describe("功能解释、副属、重属与阻碍进行", () => {
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

  describe("功能和弦的解释与连接", () => {
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
  });
});

describe("半减七和弦的上行四度链", () => {
  const score = `satb 1
key D major
meter 2/4
bars 1..3 {
  S: | B5/4 A5/4 | A5/4 G5/4 | G5/4 F5/4 |
  A: | E5/4 E5/4 | D5/4 D5/4 | C5/4 C5/4 |
  T: | G4/4 F#4/4 | F4/4 E4/4 | Eb4/4 D4/4 |
  B: | C#4/4 C4/4 | B3/4 Bb3/4 | A3/4 Ab3/4 |
}`;
  const head = "chord head at=1:1 duration=1/4 symbol=viiø7";
  const example = (labels = head) => compileScoreText(score + "\nannotations {\n" + labels + "\n}").project;
  const augmented = "melody.augmented-interval";
  const leading = "resolution.leading-tone";

  function events(project: ProjectDocument, ruleId = augmented) {
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === ruleId)
      .map(d => [d.tick, ...d.voiceIds]);
  }

  describe("half-diminished seventh chain in ascending fourths", () => {
    it("accepts the internal written semitone in alternating voices, with sparse or absent labels", () => {
      for (const project of [example(), compileScoreText(score).project]) {
        expect(events(project)).toEqual([]);
      }
    });

    it("recognizes a leading root entering the next seventh during a proven sequence", () => {
      expect(events(example(), leading)).not.toContainEqual([960, "bass"]);
      expect(events(compileScoreText(score).project, leading)).not.toContainEqual([960, "bass"]);
    });

    it("retains the leading obligation if a later voice breaks the sequence", () => {
      const project = example();
      project.satbTracks.find(track => track.voice === "tenor")!.notes[4].pitch.octave++;
      expect(events(project, leading)).toContainEqual([960, "bass"]);
    });

    it("does not borrow repetitions across an authored phrase boundary", () => {
      const project = example();
      project.structure.phraseBoundaries.push({ id: "cut", source: "manual", tick: 3 * project.ppq, confidence: "certain" });
      expect(events(project, leading)).toContainEqual([960, "bass"]);
    });

    it("preserves the obligation when the starting chord carries a different interpretation", () => {
      const project = example();
      const reading = project.chordTrack.regions[0].semantics!.interpretations[0];
      reading.degree = 2;
      expect(events(project, leading)).toContainEqual([960, "bass"]);
    });

    const breaks: [string, (p: ProjectDocument) => void][] = [
      ["missing seventh", p => { p.satbTracks[0].notes.splice(2, 1); }],
      ["enharmonic misspelling", p => { p.satbTracks[2].notes[2].pitch = { step: "E", alter: 1, octave: 4 }; }],
      ["wrong voice motion at the same pitch classes", p => { p.satbTracks[2].notes[2].pitch.octave++; }],
      ["non-chord tone in an accompanying voice", p => { p.satbTracks[1].notes[3].nonChordToneRole = "passing"; }],
      ["gap inside the last corroborating slot", p => { p.satbTracks[0].notes[5].durationTicks /= 2; }],
      ["manual phrase ending", p => {
        p.structure.phraseBoundaries.push({ id: "end", tick: 960, source: "manual", confidence: "certain" });
      }],
      ["new written key", p => {
        p.keyEvents.push({ ...p.keyEvents[0], id: "new-key", tick: 2880, mode: "minor" });
      }],
    ];
    it.each(breaks)("keeps the leading obligation with a %s", (_name, change) => {
      const project = example();
      change(project);
      expect(events(project, leading)).toContainEqual([960, "bass"]);
      expect(events(project)).not.toContainEqual([960, "bass"]);
    });

    it("reports the unresolved leading tone independently of the chromatic step of an ordinary dominant seventh", () => {
      const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..2 {
  S: | B4/4 Bb4/4 | G4/2 |
  A: | F4/2 | E4/2 |
  T: | D4/2 | C4/2 |
  B: | G3/4 A3/4 | C3/2 |
  H: | V7/4 ii/4 | I/2 |
}`).project;
      expect(events(project)).not.toContainEqual([960, "soprano"]);
      expect(events(project, leading)).toContainEqual([960, "soprano"]);
    });

    const respeltScore = `satb 1
key D major
meter 2/4
bars 1..3 {
  S: | G5/4 F5/4 | F5/4 D#5/4 | D#5/4 C#5/4 |
  A: | C5/4 C5/4 | Bb4/4 A#4/4 | G#4/4 G#4/4 |
  T: | Eb4/4 D4/4 | Db4/4 B#3/4 | B3/4 A#3/4 |
  B: | A3/4 Ab3/4 | G3/4 F#3/4 | E#3/4 E3/4 |
}`;
    const diminished = "melody.diminished-interval";
    const atRespelling = (p: ProjectDocument) => events(p, diminished).filter(([tick]) => tick === 2880);
    const reportedThirds = [[2880, "soprano"], [2880, "tenor"]];

    it("accepts both respelt thirds at a whole-chord change in D major", () => {
      for (const labels of ["", '\nannotations {\nchord seam at=2:2 duration=1/4 symbol=viiø43 localKey="C# major"\n}']) {
        const project = compileScoreText(respeltScore + labels).project;
        expect(events(project)).toEqual([]);
        expect(events(project, diminished)).toEqual([]);
      }
    });

    it("follows the diminished fifth into the root when an inner voice carries it", () => {
      const revoiced = respeltScore.replace("C5/4 C5/4 | Bb4/4 A#4/4 | G#4/4 G#4/4",
        "Eb5/4 D5/4 | Db5/4 B#4/4 | B4/4 A#4/4").replace("Eb4/4 D4/4 | Db4/4 B#3/4 | B3/4 A#3/4",
        "C4/4 C4/4 | Bb3/4 A#3/4 | G#3/4 G#3/4");
      const project = compileScoreText(revoiced).project;
      expect(atRespelling(project)).toEqual([]);
      project.satbTracks[3].notes[5].durationTicks /= 2;
      expect(atRespelling(project)).toEqual([[2880, "soprano"], [2880, "alto"]]);
    });

    const invalidSeams: [string, (p: ProjectDocument) => void][] = [
      ["only a partial respelling at the same sounding pitches", p => {
        p.satbTracks[1].notes[3].pitch = { step: "B", alter: -1, octave: 4 };
      }],
      ["octave-displaced inner voice at identical pitch classes", p => { p.satbTracks[1].notes[3].pitch.octave--; }],
      ["one missing tone after the seam", p => { p.satbTracks[1].notes.splice(4, 1); }],
      ["non-chord role on the common tone", p => { p.satbTracks[1].notes[3].nonChordToneRole = "passing"; }],
      ["a manual phrase break", p => {
        p.structure.phraseBoundaries.push({ id: "split", tick: 2880, source: "manual", confidence: "certain" });
      }],
      ["a written key change", p => {
        p.keyEvents.push({ ...p.keyEvents[0], id: "minor", tick: 2880, mode: "minor" });
      }],
      ["a second whole-chord respelling in the same six slots", p => {
        // Aø7 -> G double-sharp ø7 at identical absolute pitches.
        p.satbTracks[0].notes[0].pitch = { step: "F", alter: 2, octave: 5 };
        p.satbTracks[1].notes[0].pitch = { step: "B", alter: 1, octave: 4 };
        p.satbTracks[2].notes[0].pitch = { step: "D", alter: 1, octave: 4 };
        p.satbTracks[3].notes[0].pitch = { step: "G", alter: 2, octave: 3 };
      }],
    ];
    it.each(invalidSeams)("keeps both thirds with %s", (_reason, damage) => {
      const project = compileScoreText(respeltScore).project;
      damage(project);
      for (const event of reportedThirds) expect(atRespelling(project)).toContainEqual(event);
    });

    it.each(["V7", "viiø7"])("keeps both thirds under a conflicting %s annotation", symbol => {
      const labels = '\nannotations {\nchord seam at=2:2 duration=1/4 symbol=' + symbol + ' localKey="C# major"\n}';
      expect(atRespelling(compileScoreText(respeltScore + labels).project)).toEqual(reportedThirds);
    });

    it("keeps both thirds when the respelt arrival is the end of a six-chord chain", () => {
      const ending = `satb 1
key C major
meter 2/4
bars 1..3 {
  S: | G5/4 F5/4 | F5/4 Eb5/4 | Eb5/4 C#5/4 |
  A: | C5/4 C5/4 | Bb4/4 Bb4/4 | Ab4/4 G#4/4 |
  T: | Eb4/4 D4/4 | Db4/4 C4/4 | Cb4/4 A#3/4 |
  B: | A3/4 Ab3/4 | G3/4 Gb3/4 | F3/4 E3/4 |
}`;
      expect(events(compileScoreText(ending).project, diminished)).toEqual([[4800, "soprano"], [4800, "tenor"]]);
    });


    it("keeps both thirds when the change precedes the first corroborating fourth", () => {
      const start = `satb 1
key C major
meter 2/4
bars 1..3 {
  S: | Eb5/4 C#5/4 | C#5/4 B4/4 | B4/4 A4/4 |
  A: | Ab4/4 G#4/4 | F#4/4 F#4/4 | E4/4 E4/4 |
  T: | Cb4/4 A#3/4 | A3/4 G#3/4 | G3/4 F#3/4 |
  B: | F3/4 E3/4 | D#3/4 D3/4 | C#3/4 C3/4 |
}`;
      expect(events(compileScoreText(start).project, diminished)).toEqual([[960, "soprano"], [960, "tenor"]]);
    });

    it("checks the last half-diminished chord and its real tonic resolution", () => {
      const text = score.replace("D major", "Ab major").replace("1..3", "1..4")
        .replace("G5/4 F5/4 |", "G5/4 F5/4 | F5/4 Eb5/4 |")
        .replace("C5/4 C5/4 |", "C5/4 C5/4 | Bb4/4 C5/4 |")
        .replace("Eb4/4 D4/4 |", "Eb4/4 D4/4 | Db4/4 Eb4/4 |")
        .replace("A3/4 Ab3/4 |", "A3/4 Ab3/4 | G3/4 Ab3/4 |");
      const labels = "\nannotations {\nchord terminal at=4:1 duration=1/4 symbol=viiø7\nchord tonic at=4:2 duration=1/4 symbol=I\n}";
      const resolved = compileScoreText(text + labels).project;
      expect(events(resolved)).not.toContainEqual([5760, "tenor"]);
      expect(events(resolved, leading)).not.toContainEqual([6720, "bass"]);
      const broken = compileScoreText(text.replace("G3/4 Ab3/4", "G3/4 C3/4")
        .replace("Db4/4 Eb4/4", "Db4/4 Ab3/4") + labels.replace("symbol=I\n", "symbol=I6\n")).project;
      expect(events(broken, leading)).toContainEqual([6720, "bass"]);
    });
  });

  describe("a reattacked scale degree seven inside a half-diminished chain", () => {
    const reattack = `satb 1
key Ab major
meter 2/4
bars 1..3 {
  S: | E5/4 E5/4 | D5/4 D5/4 | C5/4 C5/4 |
  A: | B4/4 A4/4 | A4/4 G4/4 | G4/4 F4/4 |
  T: | G4/4 F#4/4 | F4/4 E4/4 | Eb4/4 D4/4 |
  B: | C#4/4 C4/4 | B3/4 Bb3/4 | A3/4 Ab3/4 |
}`;
    const withSeventh = '\nannotations {\n' +
      'chord seven at=3:1 duration=1/4 symbol=viiø7 localKey="Bb major"\n' +
      'chord arrival at=3:2 duration=1/4 symbol=viiø43 localKey="Eb major"\n}';
    const seventh = "resolution.chord-seventh";

    it.each(["", withSeventh])("recognizes the alto third becoming a seventh and descending", labels => {
      const project = compileScoreText(reattack + labels).project;
      expect(events(project, leading)).not.toContainEqual([4800, "alto"]);
      expect(events(project, seventh)).not.toContainEqual([4800, "alto"]);
    });

    it("reports the alto seventh and the bass leading root when the alto leaps", () => {
      // Both harmonies remain complete. Only the voice assignment at the arrival is different.
      const score = reattack.replace("| C5/4 C5/4 |", "| C5/4 F5/4 |")
        .replace("| G4/4 F4/4 |", "| G4/4 C5/4 |");
      const project = compileScoreText(score + withSeventh).project;
      expect(events(project, leading).filter(([tick]) => tick === 4800)).toEqual([[4800, "bass"]]);
      expect(events(project, seventh)).toContainEqual([4800, "alto"]);
    });
  });
});

describe("持续重属导音低音上的功能延续", () => {
  interface Example {
    soprano?: string;
    tenor?: string;
    bass?: string;
    harmony?: string;
    boundary?: number;
    changeMiddleTarget?: boolean;
    localKeyDetour?: boolean;
    passing64?: boolean;
  }

  function exercise({
    soprano = "Bb4/4 A4/4 G4/4 | G4/2 F#4/4 | G4/2.",
    tenor = "G3/4 A3/4 Bb3/4 | Bb3/2 C4/4 | Bb3/2.",
    bass = "C#3/2. | D3/2. | G2/2.",
    harmony = "viio7/V/4 V6/V/4 viio7/V/4 | K46/2 V7/4 | i/2.",
    boundary, changeMiddleTarget, localKeyDetour, passing64,
  }: Example = {}) {
    const { project } = compileScoreText(`satb 1
key G minor
meter 3/4
bars 1..3 {
 S: | ${soprano} |
 A: | E4/2. | D4/2. | D4/2. |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}`);
    if (boundary !== undefined) project.structure.phraseBoundaries.push({
      id: "manual-cut", tick: boundary * project.ppq, source: "manual", confidence: "certain",
    });
    if (changeMiddleTarget) {
      project.chordTrack.regions[1].semantics!.interpretations[0].appliedTarget =
        functionalTargetForDegree(4);
    }
    if (localKeyDetour) {
      project.chordTrack.regions[1].semantics!.interpretations[0].localKey =
        { tonic: { step: "D", alter: 0 }, mode: "minor" };
    }
    if (passing64) {
      project.chordTrack.regions[3].semantics!.cadenceRole = "passing64";
    }
    return project;
  }

  function warnings(project: ProjectDocument) {
    return checkHarmony(project).diagnostics.filter(item => item.ruleId === "function.applied-dominant-target");
  }

  describe("G.2 同一重属导音低音上的功能延续", () => {
    it("完整导减七和属六交替后，经实际 K46 至省五音属七", () => {
      expect(warnings(exercise())).toEqual([]);
    });

    it("同一个实写导音低音上，由重属六到重属五六再到原位属", () => {
      const { project } = compileScoreText(`satb 1
key G major
meter 3/4
bars 1..1 {
 S: | A4/2. |
 A: | E4/2 D4/4 |
 T: | A3/4 G3/4 F#3/4 |
 B: | C#3/2 D3/4 |
 H: | V6/V/4 V65/V/4 V/4 |
}`);
      expect(warnings(project)).toEqual([]);
    });

    it.each([
      ["低音只是同音重奏", { bass: "C#3/4 C#3/4 C#3/4 | D3/2. | G2/2." }],
      ["导音落到目标音级的错误八度", { bass: "C#3/2. | D2/2. | G2/2." }],
      ["导音以下另有声部穿越", { tenor: "G3/4 A2/4 Bb3/4 | Bb3/2 C4/4 | Bb3/2." }],
      ["中间实谱缺少分析标签所需的根音", { soprano: "Bb4/4 E4/4 G4/4 | G4/2 F#4/4 | G4/2.",
        tenor: "G3/4 E3/4 Bb3/4 | Bb3/2 C4/4 | Bb3/2." }],
      ["中间标签指向另一局部目标", { changeMiddleTarget: true }],
      ["持音链末端改为另一个和弦", { harmony: "viio7/V/4 V6/V/4 viiø7/II/4 | K46/2 V7/4 | i/2." }],
      ["落点标为经过四六", { passing64: true }],
      ["有 K46 标签却缺实际属和弦", { soprano: "Bb4/4 A4/4 G4/4 | G4/2. | G4/2.",
        tenor: "G3/4 A3/4 Bb3/4 | Bb3/2. | Bb3/2.", harmony: "viio7/V/4 V6/V/4 viio7/V/4 | K46/2. | i/2." }],
      ["属七省五音却重复导音", { tenor: "G3/4 A3/4 Bb3/4 | Bb3/2 F#3/4 | Bb3/2.",
        soprano: "Bb4/4 A4/4 G4/4 | G4/2 F#4/4 | G4/2." }],
      ["源首音内部有句界", { boundary: 0.5 }],
      ["四六到属之间有句界", { boundary: 4.5 }],
    ] satisfies [string, Example][])("%s 时保留链内真实未达提醒", (_label, options) => {
      const project = exercise(options);
      expect(warnings(project)).toContainEqual(expect.objectContaining({ tick: project.ppq, severity: "warning" }));
    });

    it("中间标签另有局部调时证据失败，并沿用跨局部调不评估的策略", () => {
      const project = exercise({ localKeyDetour: true });
      const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
      const view = rules.spanAt(project.ppq);
      const connection = view && rules.connections({ targetSpanId: view.span.id }).first();
      expect(connection).toBeDefined();
      expect(isProvenHeldDoubleDominantContinuation(rules, connection!)).toBe(false);
      expect(warnings(project)).toEqual([]);
    });

    it("超出一小节长度的持音链不延后真实未达提醒", () => {
      const project = exercise();
      project.lengthTicks *= 2;
      for (const track of project.satbTracks) for (const note of track.notes) {
        note.startTick *= 2;
        note.durationTicks *= 2;
      }
      for (const chord of project.chordTrack.regions) {
        chord.startTick *= 2;
        chord.durationTicks *= 2;
      }
      expect(warnings(project)).toContainEqual(expect.objectContaining({ tick: 2 * project.ppq, severity: "warning" }));
    });
  });
});

describe("副属至局部小调六级的阻碍进行", () => {
  interface Example {
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    harmony?: string;
    later?: string;
    key?: string;
  }

  function example({
    soprano = "G4/4 G#4/4 | A4/2 | G4/2 | A4/2",
    alto = "E4/4 D4/4 | C4/2 | E4/2 | E4/2",
    tenor = "C4/4 B3/4 | A3/2 | C4/2 | C4/2",
    bass = "C3/4 E3/4 | F3/2 | C3/2 | A2/2",
    harmony = "I/4 V7/VI/4 | IV/2 | I/2 | vi/2",
    later = "",
    key = "C major",
  }: Example = {}) {
    return compileScoreText(`satb 1
key ${key}
meter 2/4
${later}
bars 1..4 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}`).project;
  }

  function warnings(project: ProjectDocument) {
    return checkHarmony(project).diagnostics.filter(item => item.ruleId === "function.applied-dominant-target")
      .map(({ tick, severity, message }) => ({ tick, severity, message }));
  }

  function warningsWithoutException(project: ProjectDocument) {
    // The G.2 change is only this guard. Disable it to compare the same input with the old warning path.
    const guard = vi.spyOn(localProof, "isProvenLocalDeceptiveTarget").mockReturnValue(false);
    try {
      return warnings(project);
    } finally {
      guard.mockRestore();
    }
  }

  function proofApplies(project: ProjectDocument) {
    const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    const target = context.spanAt(2 * project.ppq);
    const landing = target && context.connections({ targetSpanId: target.span.id }).first();
    return !!landing && localProof.isProvenLocalDeceptiveTarget(context, landing);
  }

  function replaceReading(project: ProjectDocument, change: Partial<
    NonNullable<ProjectDocument["chordTrack"]["regions"][number]["semantics"]>["interpretations"][number]
  >) {
    const source = project.chordTrack.regions[1];
    const semantics = source.semantics!;
    source.semantics = { ...semantics, interpretations: [{ ...semantics.interpretations[0], ...change }] };
  }

  describe("G.2 副属到局部小调 VI 的实谱核对", () => {
    it("完整 E7→F 同声部解决，已标为指向 a 小调时认可阻碍", () => {
      const project = example();
      expect(proofApplies(project)).toBe(true);
      expect(warningsWithoutException(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
      expect(warnings(project)).toEqual([]);
    });

    it.each<[string, Example]>([
      ["拼写错误的导音", { soprano: "G4/4 Ab4/4 | A4/2 | G4/2 | A4/2" }],
      ["导音到落点同名音的另一八度", { soprano: "G4/4 G#4/4 | A3/2 | G4/2 | A4/2" }],
      ["七音改由另一声部接手，落点实音仍相同", {
        alto: "E4/4 D4/4 | A3/2 | E4/2 | E4/2",
        tenor: "C4/4 B3/4 | C4/2 | C4/2 | C4/2",
      }],
      ["属七五音跳到局部主音的另一八度", { tenor: "C4/4 B3/4 | A4/2 | C4/2 | C4/2" }],
      ["降八度的七音声部落到名义低音下方", { alto: "E4/4 D4/4 | C3/2 | E4/2 | E4/2" }],
      ["各声部按级进但男高音实为最低音", { tenor: "C4/4 B2/4 | A2/2 | C4/2 | C4/2" }],
      ["落点根、三、五俱全但重根", { tenor: "C4/4 B3/4 | F3/2 | C4/2 | C4/2" }],
      ["源标成普通副属三和弦", { harmony: "I/4 V/VI/4 | IV/2 | I/2 | vi/2" }],
      ["源缺五音", { tenor: "C4/4 E4/4 | A3/2 | C4/2 | C4/2" }],
      ["实际低音换八度", { bass: "C3/4 E3/4 | F2/2 | C3/2 | A2/2" }],
      ["实谱是 F 而标注到 F 第一转位", { harmony: "I/4 V7/VI/4 | IV6/2 | I/2 | vi/2" }],
    ])("%s 时照常保留 warning", (_label, options) => {
      const project = example(options);
      expect(proofApplies(project)).toBe(false);
      expect(warnings(project)).toEqual(warningsWithoutException(project));
      expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq, severity: "warning" })]);
    });

    it.each([
      ["另一个级数", functionalTargetForDegree(2)],
      ["相同级数但不同功能", functionalTargetForDegree(6, { primaryFunction: "dominant" })],
    ] as const)("目标标成%s 时不能由音响改写", (_label, appliedTarget) => {
      const project = example();
      replaceReading(project, { appliedTarget });
      expect(proofApplies(project)).toBe(false);
      expect(warnings(project)).toEqual(warningsWithoutException(project));
      expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
    });

    it("目标是调内大三和弦时，后面出现同主音小和弦也不免除 G.2", () => {
      const project = example({ key: "E major", harmony: "I/4 V7/IV/4 | bII/2 | I/2 | iv/2" });
      expect(proofApplies(project)).toBe(false);
      expect(warnings(project)).toEqual(warningsWithoutException(project));
      expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
    });

    it("落点被明确标为另一副属时，实际 F 三和弦也不能代替关系证明", () => {
      const project = example({ harmony: "I/4 V7/VI/4 | V/VII/2 | I/2 | vi/2" });
      const arrival = project.chordTrack.regions[2];
      arrival.identity = {
        ...arrival.identity, root: { step: "F", alter: 0 }, bass: { step: "F", alter: 0 },
      };
      expect(proofApplies(project)).toBe(false);
      expect(warnings(project)).toEqual(warningsWithoutException(project));
      expect(warnings(project).map(item => item.tick)).toEqual([2 * project.ppq, 4 * project.ppq]);
    });

    it("隔一和弦才出现同一 F 配置，稍后也出现 vi，仍在直接落点报警", () => {
      const project = example({
        soprano: "G4/4 G#4/4 | G4/2 | A4/2 | A4/2",
        alto: "E4/4 D4/4 | E4/2 | C4/2 | E4/2",
        tenor: "C4/4 B3/4 | C4/2 | A3/2 | C4/2",
        bass: "C3/4 E3/4 | C3/2 | F3/2 | A2/2",
        harmony: "I/4 V7/VI/4 | I/2 | IV/2 | vi/2",
      });
      expect(proofApplies(project)).toBe(false);
      expect(warnings(project)).toEqual(warningsWithoutException(project));
      expect(warnings(project).map(item => item.tick)).toEqual([2 * project.ppq]);
    });

    it("目标不确定时声部外形没有豁免资格，沿用 G.2 对未决标注的处理", () => {
      const project = example();
      const source = project.chordTrack.regions[1];
      const semantics = source.semantics!;
      source.semantics = { ...semantics, alternatives: [{
        ...semantics.interpretations[0], id: "competing-target", appliedTarget: functionalTargetForDegree(2),
      }] };
      expect(proofApplies(project)).toBe(false);
      expect(warnings(project)).toEqual(warningsWithoutException(project));
      expect(warnings(project)).toEqual([]);
    });

    it("实际调号改变时，即使两段分析沿用同一局部调也不豁免", () => {
      const project = example({ later: "at 2:1 key G major", harmony: "I/4 V7/VI/4 | bVII/2 | IV/2 | ii/2" });
      const sourceKey = { tonic: { step: "C", alter: 0 }, mode: "major" } as const;
      replaceReading(project, { localKey: sourceKey });
      const arrival = project.chordTrack.regions[2];
      const semantics = arrival.semantics!;
      arrival.semantics = { ...semantics, interpretations: [{
        ...semantics.interpretations[0], localKey: sourceKey, degree: 4, degreeAlteration: 0,
      }] };
      expect(proofApplies(project)).toBe(false);
      expect(warnings(project)).toEqual(warningsWithoutException(project));
      expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
    });

    it.each([0, 0.5])("句界在落点前 %s 拍时不把两侧当作一次局部解决", beforeLanding => {
      const project = example();
      project.structure.phraseBoundaries.push({
        id: "phrase-edge", tick: (2 - beforeLanding) * project.ppq, source: "manual", confidence: "certain",
      });
      expect(proofApplies(project)).toBe(false);
      expect(warnings(project)).toEqual(warningsWithoutException(project));
      expect(warnings(project)).toEqual([expect.objectContaining({ tick: 2 * project.ppq })]);
    });

    it("原有直接目标解决仍然通过", () => {
      const project = example({
        alto: "E4/4 D4/4 | C4/2 | E4/2 | E4/2",
        tenor: "C4/4 B3/4 | E4/2 | C4/2 | C4/2",
        bass: "C3/4 E3/4 | A2/2 | C3/2 | A2/2",
        harmony: "I/4 V7/VI/4 | vi/2 | I/2 | vi/2",
      });
      expect(proofApplies(project)).toBe(false);
      expect(warnings(project)).toEqual(warningsWithoutException(project));
      expect(warnings(project)).toEqual([]);
    });
  });
});

describe("大调三级至下属的功能连接", () => {
  const progression = `satb 1
key C major
meter 4/4
bars 1..2 {
 S: | C5/4 B4/4 A4/2 | G4/2 G4/2 |
 A: | G4/4 G4/4 F4/2 | D4/2 E4/2 |
 T: | E4/4 E4/4 C4/2 | B3/2 C4/2 |
 B: | C3/4 E3/4 F3/2 | G2/2 C3/2 |
 H: | I/4 iii/4 IV/2 | V/2 I/2 |
}`;

  function alerts(text: string, blind = false, local = false) {
    const input = compileScoreText(blind ? text.replace(/^ H:.*$/m, "") : text).project;
    if (local) {
      input.keyEvents[0].tonic = { step: "F", alter: 0 };
      for (const region of input.chordTrack.regions) {
        for (const meaning of region.semantics!.interpretations)
          meaning.localKey = { tonic: { step: "C", alter: 0 }, mode: "major" };
      }
    }
    const project = blind
      ? applyHarmonyInference(input, { chordInference: inferChords(input) }, { mode: "replace-unlocked" }).project
      : input;
    return checkHarmony(project).diagnostics.filter(item => item.tick === 1920).map(item => item.ruleId);
  }

  const retrogression = "function.retrogression";
  const leading = "resolution.leading-tone";

  describe("大调三级三和弦到下属", () => {
    it.each([false, true])("VII–VI 在 iii→IV 的旋律里成立，盲推 %s", blind => {
      const result = alerts(progression, blind);
      expect(result).not.toContain(retrogression);
      expect(result).not.toContain(leading);
    });

    it("换成属三和弦时，同样的女高下行仍报导音和逆功能", () => {
      const dominant = progression.replace("iii/4", "V/4").replace("E4/4 E4/4", "E4/4 D4/4")
        .replace("C3/4 E3/4", "C3/4 G3/4");
      expect(alerts(dominant)).toEqual(expect.arrayContaining([retrogression, leading]));
    });

    it("三级五音跳进到另一和弦成员也可接下属，不触发 E.1", () => {
      const leap = progression.replace("B4/4 A4/2", "B4/4 F4/2").replace("G4/4 G4/4 F4/2", "G4/4 G4/4 A4/2");
      const result = alerts(leap);
      expect(result).not.toContain(retrogression);
      expect(result).not.toContain(leading);
    });

    it("实际三音与三级标注矛盾时仍报逆功能", () => {
      const result = alerts(progression.replace("G4/4 G4/4", "G4/4 G#4/4"));
      expect(result).toContain(retrogression);
      expect(result).not.toContain(leading);
    });

    it("两端均明确标为局部 C 大调时，按这个调的 VII–VI 判定", () => {
      const result = alerts(progression, false, true);
      expect(result).not.toContain(retrogression);
      expect(result).not.toContain(leading);
    });
  });
});

describe("自然小调属六至下属六的逆功能", () => {
  interface Example {
    source?: readonly string[];
    target?: readonly string[];
    sourceChord?: string;
    targetChord?: string;
    writtenKey?: string;
    localKey?: boolean;
    keyChange?: boolean;
    blind?: boolean;
  }

  function progression({
    source = ["E5", "G4", "B3", "G3"],
    target = ["F5", "A4", "D4", "F3"],
    sourceChord = "v6",
    targetChord = "iv6",
    writtenKey = "A minor",
    localKey = false,
    keyChange = false,
    blind = false,
  }: Example = {}) {
    const voices = ["S", "A", "T", "B"];
    const opening = ["E5", "C5", "A3", "A2"];
    const closing = ["E5", "A4", "C4", "A2"];
    const cadence = ["E5/2 E5/2", "G#4/2 A4/2", "B3/2 A3/2", "E3/2 A2/2"];
    const lines = voices.map((voice, index) =>
      voice + ": | " + [opening[index], source[index], target[index], closing[index]]
        .map(pitch => pitch + "/4").join(" ") + " | " + cadence[index] + " |",
    );
    const localAnnotation = localKey ? ' localKey="A minor"' : "";
    const labels = [
      ["1:1", "1/4", "i"],
      ["1:2", "1/4", sourceChord],
      ["1:3", "1/4", targetChord],
      ["1:4", "1/4", "i"],
      ["2:1", "1/2", "V"],
      ["2:3", "1/2", "i"],
    ];
    const annotations = labels.map(([at, duration, chord], index) =>
      `chord chord-${index} at=${at} duration=${duration} symbol=${chord}${localAnnotation}`,
    );
    return compileScoreText([
      "satb 1",
      "key " + writtenKey,
      "meter 4/4",
      keyChange ? "at 1:3 key C major" : "",
      "bars 1..2 {", ...lines, "}",
      ...(blind ? [] : ["annotations {", ...annotations, "}"]),
    ].join("\n")).project;
  }

  function retrogressionAtThirdBeat(project: ReturnType<typeof progression>) {
    return checkHarmony(project).diagnostics.filter(diagnostic =>
      diagnostic.ruleId === "function.retrogression" &&
      diagnostic.tick === 2 * project.ppq,
    );
  }

  describe("自然小调的小属六到小下属六", () => {
    it("自然七级低音下行全音，两个小三和弦均完整", () => {
      expect(retrogressionAtThirdBeat(progression())).toEqual([]);
    });

    it("以两端共同的局部小调判断，允许它和书写调号不同", () => {
      const project = progression({ writtenKey: "F# minor", localKey: true });
      expect(retrogressionAtThirdBeat(project)).toEqual([]);
    });

    it("从未标和弦的同一四部谱盲推导，仍通过 checkHarmony", () => {
      const raw = progression({ blind: true });
      expect(raw.chordTrack.regions).toEqual([]);
      const { project } = applyHarmonyInference(raw, { chordInference: inferChords(raw) }, {
        mode: "replace-unlocked",
        writeNonChordToneRoles: true,
      });
      const pair = project.chordTrack.regions.filter(region =>
        region.startTick === raw.ppq || region.startTick === 2 * raw.ppq,
      );
      expect(pair.map(region => region.identity)).toEqual([
        expect.objectContaining({ root: { step: "E", alter: 0 }, bass: { step: "G", alter: 0 } }),
        expect.objectContaining({ root: { step: "D", alter: 0 }, bass: { step: "F", alter: 0 } }),
      ]);
      expect(retrogressionAtThirdBeat(project)).toEqual([]);
    });

    it.each<[string, Example]>([
      ["和声小调的升七级大属六", { source: ["E5", "G#4", "B3", "G#3"], sourceChord: "V6" }],
      ["大属实音被错标为小属六", { source: ["E5", "G#4", "B3", "G#3"] }],
      ["小属原位", { source: ["E5", "G4", "B3", "E3"], sourceChord: "v" }],
      ["小下属原位", { target: ["F5", "A4", "D4", "D3"], targetChord: "iv" }],
      ["构成音缺失", { target: ["F5", "D4", "D4", "F3"] }],
      ["有声部休止", { target: ["F5", "A4", "r", "F3"] }],
      ["目的低音是等音异名", { target: ["F5", "A4", "D4", "E#3"] }],
      ["目的低音错八度", { target: ["F5", "A4", "D4", "F2"] }],
      ["同局部标签跨过书写换调", { keyChange: true, localKey: true }],
    ])("%s，仍报告逆功能", (_label, example) => {
      expect(retrogressionAtThirdBeat(progression(example))).toEqual([
        expect.objectContaining({ severity: "warning" }),
      ]);
    });

    it("和弦构成音带有明确外音角色时保持警告", () => {
      const project = progression();
      project.satbTracks.find(track => track.id === "tenor")!.notes[1].nonChordToneRole = "passing";
      expect(retrogressionAtThirdBeat(project)).toHaveLength(1);
    });
  });
});

describe("那不勒斯六和弦的低音换位", () => {
  const leapRule = "melody.large-leap";

  function passage({
    key = "A minor", soprano = "F5/2.", alto = "Bb4/2.", tenor = "D4/2.",
    bass = "Bb2/4 D2/2", labels = "bII/4 N6/2",
  } = {}) {
    return compileScoreText(`satb 1
key ${key}
meter 3/4
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
  H: | ${labels} |
}`).project;
  }

  function reports(project: ReturnType<typeof passage>, voice = "bass", strict = false) {
    const overrides = strict ? { [leapRule]: { "same-harmony": "strict" as const } } : {};
    return checkHarmony(project, undefined, {}, overrides).diagnostics.some(d =>
      d.ruleId === leapRule && d.tick === project.ppq && d.voiceIds.some(part => part === voice));
  }

  it.each([
    ["Bb2/4 D2/2", "bII/4 N6/2"],
    ["D2/4 Bb2/2", "N6/4 bII/2"],
  ])("同调降二级的原位与那不勒斯六和弦以实际低音换位 %s", (bass, labels) => {
    const project = passage({ bass, labels });
    expect(reports(project)).toBe(false);
    expect(reports(project, "bass", true)).toBe(true);
  });

  it.each([
    ["低音与声明转位相反", { bass: "D2/4 Bb2/2" }],
    ["实际最低音落在男高", { tenor: "D2/2." }],
    ["上声部独立起奏", { tenor: "D4/4 D4/2" }],
    ["缺五音", { soprano: "D5/2." }],
    ["有异名实音", { alto: "A#4/2." }],
    ["换为另一和弦", { labels: "bII/4 iv/2", alto: "Bb4/4 A4/2" }],
    ["属七解决到另一和弦", { key: "D minor", labels: "D7/4 t6/2", soprano: "E5/4 A4/2",
      alto: "G4/4 F4/2", tenor: "C#4/4 D4/2", bass: "A2/4 F3/2" }],
  ] as const)("%s时保留低音六度建议", (_reason, options) => {
    expect(reports(passage(options))).toBe(true);
  });

  it("同实音保留确实改变首选局部调的低音建议", () => {
    const project = passage();
    const chord = project.chordTrack.regions[1];
    const semantics = chord.semantics!;
    chord.semantics = { ...semantics, interpretations: semantics.interpretations.map(i => ({
      ...i, localKey: { tonic: { step: "A", alter: 0 }, mode: "major" },
    })) };
    expect(reports(project)).toBe(true);
  });

  it("同样的原位与一转保留其他特殊功能的区别", () => {
    const project = passage();
    const chord = project.chordTrack.regions[1];
    const semantics = chord.semantics!;
    chord.semantics = { ...semantics, interpretations: semantics.interpretations.map(i => ({
      ...i, designation: { notationSystem: "spasobin", kind: "double-dominant", primaryFunction: "dominant" },
    })) };
    expect(reports(project)).toBe(true);
  });

  it("属七保持原声部七音的换位沿用已有的同和弦配置", () => {
    const project = passage({ key: "C major", labels: "D7/4 D65/2", soprano: "F5/2.", alto: "D5/2.",
      tenor: "B3/4 G3/2", bass: "G3/4 B2/2" });
    expect(reports(project)).toBe(false);
    expect(reports(project, "bass", true)).toBe(true);
  });

  it("普通主四六与终止四六实音相同仍区分用途", () => {
    const project = passage({ soprano: "C5/4 A5/2", alto: "A4/2.", tenor: "C4/2.", bass: "E3/2.",
      labels: "i64/4 K46/2" });
    expect(reports(project, "soprano")).toBe(true);
  });
});

describe("那不勒斯大七至属七的低音连接", () => {
  const score = `satb 1
key G major
meter 4/4
bars 1..1 {
  S: | C5/4 C5/4 B4/2 |
  A: | G4/4 F#4/4 G4/2 |
  T: | Eb4/4 D4/4 D4/2 |
  B: | Ab2/4 D3/4 G2/2 |
}
annotations {
  chord n range=[1:1,1:2) symbol=bII7
  chord d range=[1:2,1:3) symbol=D7
  chord t range=[1:3,2:1) symbol=T
}`;
  const ids = ["melody.tritone", "melody.augmented-interval", "melody.diminished-interval"];
  function bassReports(text: string) {
    const { project } = compileScoreText(text);
    const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    const isBass = (d: { tick: number; voiceIds: readonly string[]; ruleId: string }) =>
      d.tick === project.ppq && d.voiceIds.includes("bass") && ids.includes(d.ruleId);
    return {
      raw: [...tritoneRule(context), ...augmentedIntervalRule(context), ...diminishedIntervalRule(context)]
        .filter(isBass).map(d => d.ruleId),
      published: checkHarmony(project).diagnostics.filter(isBass).map(d => d.ruleId),
    };
  }

  describe("原位降Ⅱ大七至本调原位属七的低音", () => {
    it.each([
      ["上行增四", score],
      ["下行减五", score.replace("Ab2/4 D3/4", "Ab2/4 D2/4")],
      ["属七四音齐全", score.replace("Eb4/4 D4/4", "Eb4/4 A3/4")],
      ["稳定的局部调与工程调不同", score.replace("key G major", "key Bb major")
        .replaceAll(/symbol=(\S+)/g, 'symbol=$1 localKey="G major"')],
      ["小调内的同一连接", score.replace("G major", "G minor").replace("B4/2", "Bb4/2").replace("symbol=T", "symbol=t")],
      ["首次属七之后没有主和弦", score.replace("symbol=T", "symbol=vi").replace("D4/2", "E4/2").replace("G2/2", "E3/2")],
    ])("%s 允许，三个音程规则均不留下重复诊断", (_name, text) => {
      expect(bassReports(text)).toEqual({ raw: [], published: [] });
    });

    it.each([
      ["七音还未出现", score.replace("G4/4 F#4/4", "Ab4/4 F#4/4")],
      ["降Ⅱ七变成大小七", score.replace("G4/4 F#4/4", "Gb4/4 F#4/4")],
      ["降Ⅱ七五音同音异名", score.replace("Eb4/4", "D#4/4")],
      ["不同调性解释", score.replace("symbol=bII7", 'symbol=bII7 localKey="G minor"')],
      ["目标仅标成副属", score.replace("symbol=D7", 'symbol=V7/V localKey="C major"')],
      ["目标指定转位", score.replace("symbol=D7", "symbol=D65")],
      ["源标签只有三和弦", score.replace("symbol=bII7", "symbol=bII")],
      ["低声部之下还有他声部", score.replace("Eb4/4", "Eb2/4")],
      ["属七实音缺七音", score.replace("C5/4 C5/4", "C5/4 D5/4")],
      ["省五时重复导音", score.replace("Eb4/4 D4/4", "Eb4/4 F#4/4")],
      ["属七有外音", score.replace("Eb4/4 D4/4", "Eb4/4 E4/4")],
      ["调号事件在连接上", score.replace("bars 1..1", "at 1:2 key G minor\nbars 1..1")],
    ])("%s 仍报告低音三全音", (_name, text) => {
      const reports = bassReports(text);
      expect(reports.raw).toContain("melody.augmented-interval");
      expect(reports.published).toContain("melody.tritone");
    });

    it("下行减五度缺少源七音，仍能查到 B.4 和 B.5", () => {
      const lower = score.replace("Ab2/4 D3/4", "Ab2/4 D2/4").replace("G4/4 F#4/4", "Ab4/4 F#4/4");
      const reports = bassReports(lower);
      expect(reports.raw).toEqual(["melody.tritone", "melody.diminished-interval"]);
      expect(reports.published).toContain("melody.tritone");
    });

    it("实写低音休止和真正的句界不能为下一连接提供依据", () => {
      const { project } = compileScoreText(score);
      project.structure.phraseBoundaries = [{ id: "cut", source: "manual", confidence: "certain", tick: project.ppq }];
      expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
        tick: project.ppq, voiceIds: ["bass"], ruleId: "melody.tritone",
      }));
      expect(bassReports(score.replace("Ab2/4", "Ab2/8 r/8")).raw).toEqual([]);
    });

    it("裸谱推导并应用后，仍由两个实际和弦给出放行依据", () => {
      const bare = compileScoreText(score.split("annotations {")[0]).project;
      const inferred = applyHarmonyInference(bare, { chordInference: inferChords(bare) },
        { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
      const context = createHarmonyRuleContext(buildHarmonyAnalysis(inferred));
      expect(context.sliceAt(0)?.chord?.identity.structure).toMatchObject({ quality: "major7" });
      expect(context.sliceAt(bare.ppq)?.chord?.identity.structure).toMatchObject({ quality: "dominant7" });
      expect(tritoneRule(context).filter(d => d.tick === bare.ppq && d.voiceIds.includes("bass"))).toEqual([]);
    });

    it("后续属七的七音上行时照报原声部", () => {
      const text = score.replace("C5/4 C5/4 B4/2", "C5/4 C5/4 D5/2")
        .replace("Eb4/4 D4/4 D4/2", "Eb4/4 D4/4 B3/2");
      const { project } = compileScoreText(text);
      expect(bassReports(text)).toEqual({ raw: [], published: [] });
      expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
        ruleId: "resolution.chord-seventh", tick: 2 * project.ppq, voiceIds: ["soprano"],
      }));
    });

    it("同位置另一个声部的三全音照报", () => {
      const text = score.replace("C5/4 C5/4", "Eb5/4 A4/4").replace("Eb4/4 D4/4", "C4/4 C4/4");
      const { project } = compileScoreText(text);
      const atBoundary = checkHarmony(project).diagnostics.filter(d => d.tick === project.ppq && d.ruleId === "melody.tritone");
      expect(atBoundary.map(d => d.voiceIds)).toEqual([["soprano"]]);
    });
  });
});

describe("主音持续低音与降六级的功能连接", () => {
  const ruleId = "melody.augmented-interval";
  function example({
    soprano = "C5/1", alto = "E4/2 Eb4/2", tenor = "G3/2 Ab3/2", bass = "C3/1", harmony = "",
  } = {}) {
    return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 ${harmony ? "H: | " + harmony + " |" : ""}
}`).project;
  }

  function blind(project: ReturnType<typeof example>) {
    return applyHarmonyInference(project, { chordInference: inferChords(project) }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
  }

  function warnings(project: ReturnType<typeof example>) {
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === ruleId && d.tick === 2 * project.ppq);
  }


  function expectNoAltoWarning(project: ReturnType<typeof example>) {
    expect(warnings(project).filter(d => d.voiceIds.includes("alto"))).toEqual([]);
  }
  describe("第 50 章主音持续低音上的降 VI 连接", () => {
    it.each([
      ["进入，女低变化", "E4/2 Eb4/2", "G3/2 Ab3/2", "I/2 bVI6/2"],
      ["返回，女低变化", "Eb4/2 E4/2", "Ab3/2 G3/2", "bVI6/2 I/2"],
      ["进入，男高变化", "G4/2 Ab4/2", "E4/2 Eb4/2", "I/2 bVI6/2"],
      ["返回，男高变化", "Ab4/2 G4/2", "Eb4/2 E4/2", "bVI6/2 I/2"],
    ])("%s 时在两种入口均无 B.3", (_name, alto, tenor, harmony) => {
      const project = example({ alto, tenor });
      expect(warnings(blind(project))).toEqual([]);
      expect(warnings(example({ alto, tenor, harmony }))).toEqual([]);
    });

    it.each([
      ["进入", "E4/2 Eb4/2", "G3/2 F#3/2", "I/2 bVI6/2"],
      ["返回", "Eb4/2 E4/2", "Ab3/2 F#3/2", "bVI6/2 I/2"],
    ])("%s时把伴随声部的目标改为冲突音，原声部增一度不报警", (_direction, alto, tenor, harmony) => {
      const project = example({ alto, tenor });
      for (const input of [blind(project), example({ alto, tenor, harmony })]) {
        expectNoAltoWarning(input);
      }
    });

    it("持续低音之下还有实音时不因增一度报警", () => {
      const score = { bass: "C4/1" };
      expectNoAltoWarning(blind(example(score)));
      expectNoAltoWarning(example({ ...score, harmony: "I/2 bVI6/2" }));
    });

    it.each([
      ["alto", 1],
      ["tenor", 0],
      ["bass", 0],
    ] as const)("%s 第 %i 个音标为经过音时不因增一度报警", (voice, index) => {
      const marked = (harmony = "") => {
        const project = example({ harmony });
        project.satbTracks.find(track => track.id === voice)!.notes[index].nonChordToneRole = "passing";
        return project;
      };
      expectNoAltoWarning(blind(marked()));
      expectNoAltoWarning(marked("I/2 bVI6/2"));
    });

    it("允许已标为持续音的最低主音作证", () => {
      const project = example({ harmony: "I/2 bVI6/2" });
      project.satbTracks.find(track => track.id === "bass")!.notes[0].nonChordToneRole = "pedal";
      expect(warnings(project)).toEqual([]);
    });

    it.each([1, 2])("显式句界位于 q%i 时不因增一度报警", q => {
      const marked = (harmony = "") => {
        const project = example({ harmony });
        project.structure.phraseBoundaries.push({
          id: "manual", tick: q * project.ppq, confidence: "certain", source: "manual",
        });
        return project;
      };
      expectNoAltoWarning(blind(marked()));
      expectNoAltoWarning(marked("I/2 bVI6/2"));
    });
  });
});
