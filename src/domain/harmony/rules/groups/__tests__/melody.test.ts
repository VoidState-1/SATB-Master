import { describe, expect, it } from "vitest";
import type { ChordIdentity, ChordQuality, HarmonyInterpretation } from "../../../../chordModel";
import { parsePitchClass, toMidi } from "../../../../pitch";
import {
  PPQ,
  validateProject,
  type NonChordToneRole,
  type ProjectDocument,
  type VoiceId,
} from "../../../../project";
import { resolveBuiltinRuleProfile, setBuiltinRuleException } from "../../../../ruleProfile";
import { compileScoreText } from "../../../../scoreText";
import { buildHarmonyAnalysis } from "../../../analysis";
import { applyHarmonyInference, inferChords, inferHarmony } from "../../../inference";
import { checkHarmony } from "../../../registry";
import {
  correctionNote,
  correctionProject,
  setCorrectionVoice,
} from "../../../testing/fixtures/harmonyProject";
import { defaultHarmonyRuleSeverities } from "../../catalog";
import { createHarmonyRuleContext } from "../../context/createRuleContext";
import type { RuleExceptionPolicy } from "../../types";
import { augmentedIntervalRule, diminishedIntervalRule, tritoneRule } from "../melody";

describe("属和弦变五音的旋律准备", () => {
  const rule = "melody.augmented-interval";
  const lowered = `satb 1
key C major
meter 4/4
bars 1..1 {
  S: | B4/2 C5/2 |
  A: | G4/1 |
  T: | D4/4 Db4/4 C4/2 |
  B: | F3/2 E3/2 |
}`;
  const raised = `satb 1
key C major
meter 4/4
bars 1..1 {
  S: | G4/1 |
  A: | D4/4 D#4/4 E4/2 |
  T: | B3/2 C4/2 |
  B: | G3/4 F3/4 E3/2 |
}`;

  function warnsAtChange(score: string, voice: "tenor" | "alto") {
    const { project } = compileScoreText(score);
    return checkHarmony(project, undefined, {}, {
      [rule]: { "same-harmony": "strict", arpeggiation: "strict" },
    }).diagnostics.some(item => item.ruleId === rule && item.tick === project.ppq && item.voiceIds.includes(voice));
  }

  describe("属和弦变五音的半音准备（第46章）", () => {
    it("降五音在原声部下行到主音，主六和弦也可确认落点", () => {
      expect(warnsAtChange(lowered, "tenor")).toBe(false);
    });
    it("升五音在原声部上行到大调主三音", () => {
      expect(warnsAtChange(raised, "alto")).toBe(false);
    });
    it("升五音延续期间，属三和弦可增加七音", () => {
      const score = raised.replace("G3/4 F3/4 E3/2", "G3/4. F3/8 E3/2");
      expect(warnsAtChange(score, "alto")).toBe(false);
    });
    it("本调属准备与外观相同的主到下属均无半音入音警告", () => {
      const triad = raised.replace("G3/4 F3/4 E3/2", "G3/2 E3/2");
      expect(warnsAtChange(triad, "alto")).toBe(false);
      expect(warnsAtChange(triad.replace("key C major", "key G major"), "alto")).toBe(false);
    });
    it.each([
      ["落点由另一声部代奏", lowered.replace("Db4/4 C4/2", "Db4/4 E4/2")],
      ["错拼落点", lowered.replace("Db4/4 C4/2", "Db4/4 B#3/2")],
      ["隔休止才出现主音", lowered.replace("Db4/4 C4/2", "Db4/8 r/8 C4/2")],
      ["无属三音", lowered.replace("B4/2 C5/2", "A4/2 C5/2")],
      ["后继另成和弦", lowered.replace("F3/2 E3/2", "F3/2 A2/2")],
      ["中间改换和声", lowered.replace("B4/2 C5/2", "B4/4. A4/8 C5/2")],
    ])("%s 时缺少变五音解决证据，入音仍无 B.3", (_why, score) => {
      expect(warnsAtChange(score, "tenor")).toBe(false);
    });
  });

  describe("连续两个属和弦引入外调的增三和弦", () => {
    const progression = `satb 1
key F# minor
meter 3/4
bars 1..1 {
 S: | B4/4 B#4/4 C#5/4 |
 A: | F#4/4 E4/4 A4/4 |
 T: | D#4/4 E4/4 E4/4 |
 B: | B2/4 G#2/4 A2/4 |
}`;

    function hasWarning(text: string) {
      const { project } = compileScoreText(text);
      return checkHarmony(project, undefined, {}, {
        [rule]: { "same-harmony": "strict", arpeggiation: "strict" },
      }).diagnostics.some(item => item.ruleId === rule && item.tick === project.ppq && item.voiceIds.includes("soprano"));
    }

    it.each([
      ["属三和弦", progression],
      ["先行属七和弦的七音同声部下行", progression.replace("B2/4 G#2/4", "A2/4 G#2/4")],
      ["移调后的局部 C 大调", progression.replace("F# minor", "A minor")
        .replace("B4/4 B#4/4 C#5/4", "D5/4 D#5/4 E5/4")
        .replace("F#4/4 E4/4 A4/4", "A4/4 G4/4 C5/4")
        .replace("D#4/4 E4/4 E4/4", "F#4/4 G4/4 G4/4")
        .replace("B2/4 G#2/4 A2/4", "D3/4 B2/4 C3/4")],
    ])("%s 的两个导音和升五音各自解决", (_label, text) => {
      expect(hasWarning(text)).toBe(false);
    });

    it.each([
      ["先行和弦成为小三和弦", progression.replace("D#4/4", "D4/4")],
      ["另一个声部到达根音，先行导音越八度", progression.replace("D#4/4 E4/4", "D#4/4 E5/4")],
      ["增和弦三音越八度落主音", progression.replace("G#2/4 A2/4", "G#2/4 A3/4")],
      ["先行属七的七音未在原音区解决", progression.replace("B2/4 G#2/4 A2/4", "A2/4 G#3/4 A3/4")],
      ["中间和弦标注与实奏冲突", progression + "\nannotations {\n chord other range=[1:2,1:3) symbol=IV\n}"],
    ])("%s 时缺少完整的局部属解决链", (_label, text) => {
      expect(hasWarning(text)).toBe(false);
    });
  });
});

describe("副属七和弦的同声部半音准备", () => {
  function score(key: string, parts: string[], labels: string[] = [], origin = "T") {
    return compileScoreText(`satb 1
key ${key}
meter 3/4
bars 1..1 {
${parts.map((part, i) => " " + ["S","A","T","B"][i] + ": | " + part.split(" ").map(n => n + "/4").join(" ") + " |").join("\n")}
}
annotations {
 chord origin range=[1:1,1:2) symbol=${origin}
 ${labels.join("\n ")}
}`).project;
  }
  function warns(project: ReturnType<typeof score>, voice: string) {
    return checkHarmony(project).diagnostics.some(d => d.ruleId === "melody.augmented-interval" &&
      d.tick === project.ppq && d.voiceIds.some(v => v === voice));
  }

  describe("Same-voice chromatic preparation of a directly resolving applied seventh", () => {
    const dominant = ["B4 B4 A4", "G#4 G#4 F#4", "B3 C#4 C#4", "E3 E#3 F#3"];
    const diminished = ["F5 F5 E5", "A4 Ab4 G4", "C4 B3 C4", "F3 D3 C3"];
    it("reads the bass entering the third of V65/ii from the literal four parts", () => {
      const input = score("E major", dominant);
      expect(warns(input, "bass")).toBe(false);
    });
    it("reads a lowered seventh of vii diminished 65/V in the alto", () => {
      const input = score("F major", diminished);
      expect(warns(input, "alto")).toBe(false);
    });
    it("accepts an explicit matching applied seventh and rejects a contradictory middle label", () => {
      const conflict = score("F major", diminished, ["chord wrong range=[1:2,1:3) symbol=IV"]);
      expect(warns(conflict, "alto")).toBe(false);
    });
    it.each([
      ["leading tone moves in another part", ["F5 F5 C5", "A4 Ab4 G4", "C4 B3 E4", "F3 D3 C3"]],
      ["wrong octave of the seventh resolution", ["F5 F5 E5", "A4 Ab4 G5", "C4 B3 C4", "F3 D3 C3"]],
      ["same keys on the keyboard but misspelled diminished seventh", ["F5 F5 E5", "A4 Ab4 G4", "C4 Cb4 C4", "F3 D3 C3"]],
      ["unresolved or deceptive target", ["F5 F5 E5", "A4 Ab4 G4", "C4 B3 C4", "F3 D3 A2"]],
      ["incomplete seventh", ["F5 D5 E5", "A4 Ab4 G4", "C4 B3 C4", "F3 D3 C3"]],
    ])("does not infer a spelling error at A–A♭ with %s", (_reason, parts) => {
      const input = score("F major", parts);
      expect(warns(input, "alto")).toBe(false);
    });
    it("requires the seventh of V7 to descend in its original voice even when the leading note resolves", () => {
      const parts = ["B4 B4 C#5", "G#4 G#4 A4", "B3 C#4 F#3", "E3 E#3 F#3"];
      const input = score("E major", parts);
      expect(warns(input, "bass")).toBe(false);
    });
    it("distinguishes a doubled source tone moving in the same or opposite direction", () => {
      // G in both tenor and bass of I64. Only G4–F4 opposes the bass G–G# by step.
      const doubled = (tenor: string) => score("C major", ["E5 D5 C5", "C5 B4 A4", tenor, "G2 G#2 A2"], [], "I64");
      expect(warns(doubled("G4 F4 E4"), "bass")).toBe(false);
      expect(warns(doubled("G3 F4 E4"), "bass")).toBe(false);
    });
    it("withholds preparation evidence for a contradictory target label despite the sounding triad", () => {
      expect(warns(score("F major", diminished, ["chord wrong range=[1:3,2:1) symbol=vi"]), "alto")).toBe(false);
    });
    it("does not use the same letter alone to exempt a chromatic leap or a chromatic double alteration", () => {
      for (const line of ["A4 A#5 G4", "A4 Abb4 G4"]) {
        expect(warns(score("F major", [diminished[0], line, diminished[2], diminished[3]]), "alto")).toBe(true);
      }
    });
    it("does not bridge a phrase or use an explicitly ornamental seventh", () => {
      const cut = score("F major", diminished);
      cut.structure.phraseBoundaries = [{ id: "cut", tick: cut.ppq * 2, source: "manual", confidence: "certain" }];
      expect(warns(cut, "alto")).toBe(false);
      const decorated = score("E major", dominant);
      decorated.satbTracks[0].notes[1].nonChordToneRole = "neighbor";
      expect(warns(decorated, "bass")).toBe(false);
    });
  });
});

describe("重属导减七音改记与旋律增一度", () => {
  interface Example {
    key?: string;
    keyEvent?: string;
    voiceId?: VoiceId;
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    departure?: string;
    middle?: string;
    landing?: string;
    landingStart?: string;
    noteRole?: string;
  }

  function compileExample({
    key = "C major", keyEvent = "",
    soprano = "D5/4 D#5/4 E5/2", alto = "A4/4 A4/4 C5/2",
    tenor = "F4/4 C4/4 G4/2", bass = "F3/4 F#3/4 G3/2",
    departure = "ii6", middle = "viio7/V", landing = "K46",
    landingStart = "1:3", noteRole = "",
  }: Example = {}) {
    return compileScoreText(`satb 1
key ${key}
meter 4/4
${keyEvent}
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
}
annotations {
  chord departure range=[1:1,1:2) symbol=${departure}
  chord middle range=[1:2,1:3) symbol=${middle}
  chord landing range=[${landingStart},2:1) symbol=${landing}
  ${noteRole}
}`).project;
  }

  describe("第28章重属导减七音改记", () => {
    it("升 II 的入音在两种解决走向中均无 B.3", () => {
      const legal = compileExample();
      const wrongResolution = compileExample({ soprano: "D5/4 D#5/4 G5/2" });
      const respellingWarnings = (project: ReturnType<typeof compileExample>) =>
        checkHarmony(project).diagnostics.filter(diagnostic =>
          diagnostic.ruleId === "melody.augmented-interval" &&
          diagnostic.tick === project.ppq &&
          diagnostic.voiceIds.includes("soprano"),
        );

      expect(respellingWarnings(legal)).toEqual([]);
      expect(respellingWarnings(wrongResolution)).toEqual([]);
    });

  });
});

describe("半音经过的旋律音程", () => {
  interface Example {
    line: string;
    key?: string;
    from?: string;
    to?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    middleChord?: string;
    offsetBeats?: number;
  }

  function warnings({ line, key = "C major", from = "I", to = "IV",
    alto = "E4/2 F4/2", tenor = "C4/1", bass = "C3/2 F3/2", middleChord, offsetBeats = 0 }: Example) {
    const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
  S: | ${line} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
}
annotations {
  chord before range=[1:1,1:2) symbol=${from}
  ${middleChord ? "chord middle range=[1:2,1:3) symbol=" + middleChord : ""}
  chord after range=[1:3,2:1) symbol=${to}
}`);
    const offset = offsetBeats * project.ppq;
    project.lengthTicks += offset;
    for (const track of project.satbTracks)
      for (const note of track.notes) note.startTick += offset;
    for (const region of project.chordTrack.regions) region.startTick += offset;
    return checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "melody.augmented-interval" && item.voiceIds.includes("soprano"));
  }

  describe("半音经过时的旋律增一度", () => {
    it("弱拍升高 G 后同向到达下属和弦的 A", () => {
      expect(warnings({ line: "G4/4 G#4/4 A4/2" })).toHaveLength(0);
    });

    it.each([
      ["后继下行增二度", { line: "G4/4 G#4/4 F4/2" }, true],
      ["前段上行增二度", { line: "G4/4 A#4/4 B4/2" }, true],
      ["经过音的伴随声部不支持两侧和弦", { line: "G4/4 G#4/4 A4/2", tenor: "C4/4 B3/4 C4/2" }, false],
      ["中间已标为和弦内音", { line: "G4/4 G#4/4 A4/2", middleChord: "III" }, false],
      ["同音异名改变两个端点的书写二度", { line: "G4/4 G#4/4 Bbb4/2" }, false],
      ["中间音位于小节强拍", { line: "G4/4 G#4/4 A4/2", offsetBeats: 3 }, false],
    ] as const)("%s 时 B.3 是否有独立证据", (_label, example, reports) => {
      expect(warnings(example).length > 0).toBe(reports);
    });

    const descending = { from: "V", to: "IV", alto: "D4/2 F4/2", tenor: "G3/2 A3/2", bass: "G2/2 F2/2" };
    it("无独立错拼证据时，B–B♭–A 和 B–A♯–A 均无 B.3", () => {
      expect(warnings({ ...descending, line: "B4/4 Bb4/4 A4/2" })).toHaveLength(0);
      expect(warnings({ ...descending, line: "B4/4 A#4/4 A4/2" })).toHaveLength(0);
    });

    it.each(["C major", "A minor"])("%s 上行 A–B♭–B 的半音写法", key => {
      const accompaniment = {
        key, from: key === "C major" ? "IV" : "VI", to: key === "C major" ? "V" : "VII",
        alto: "F4/2 D4/2", tenor: "C4/2 B3/2", bass: "F3/2 G3/2",
      };
      expect(warnings({ ...accompaniment, line: "A4/4 Bb4/4 B4/2" })).toHaveLength(0);
      expect(warnings({ ...accompaniment, line: "A4/4 A#4/4 B4/2" }).length).toBeGreaterThan(0);
    });
  });
});

describe("半音经过与分解和弦的实写拼写", () => {
  const rule = "melody.augmented-interval";

  function score(passing: string, key = "C major") {
    const transposed = key === "D major";
    const parts = transposed
      ? [`D5/2 A4/4. ${passing}/8 | G4/2 F#4/2`, "F#4/1 | E4/2 D4/2", "A3/2 D4/2 | C#4/2 A3/2", "D3/1 | A2/2 D3/2"]
      : [`C5/2 G4/4. ${passing}/8 | F4/2 E4/2`, "E4/1 | D4/2 C4/2", "G3/2 C4/2 | B3/2 G3/2", "C3/1 | G2/2 C3/2"];
    return compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..2 {
${parts.map((part, index) => ` ${["S", "A", "T", "B"][index]}: | ${part} |`).join("\n")}
}`).project;
  }

  function infer(project: ReturnType<typeof score>) {
    return applyHarmonyInference(project, { chordInference: inferChords(project) }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
  }

  describe("单声部半音经过与前一拍的和弦分解", () => {
    it.each([
      ["C major", "Gb4", "F#4", "F♯4"],
      ["D major", "Ab4", "G#4", "G♯4"],
    ])("%s 中降五级的经过音提示其等音拼写，升四级正常放行", (key, bad, good, spelling) => {
      for (const [pitch, expected] of [[bad, true], [good, false]] as const) {
        const project = infer(score(pitch, key));
        for (const overrides of [{}, { [rule]: { arpeggiation: "exempt" as const } }]) {
          const warnings = checkHarmony(project, undefined, {}, overrides).diagnostics
            .filter(item => item.ruleId === rule && item.voiceIds.includes("soprano"));
          if (!expected) {
            expect(warnings).toEqual([]);
            continue;
          }
          expect(warnings).toHaveLength(1);
          expect(warnings[0]).toMatchObject({
            tick: project.ppq * 3.5, severity: "warning",
            messageKey: `${rule}.passing-spelling`, message: expect.stringContaining(spelling),
            noteIds: ["note-S-1920", "note-S-3360"],
          });
          expect(warnings[0]).not.toHaveProperty("melodyTransitionId");
        }
      }
    });

    it("在显式句界前结束取证", () => {
      const project = infer(score("Gb4"));
      project.structure.phraseBoundaries.push({
        id: "boundary", tick: project.ppq * 4, source: "manual", confidence: "certain",
      });
      expect(checkHarmony(project).diagnostics.some(item => item.messageKey === `${rule}.passing-spelling`)).toBe(false);
    });
  });

  function withAltoReattack(accompaniment: string) {
    return infer(compileScoreText(`satb 1
key D major
meter 4/4
bars 1..2 {
  S: | D5/2 A4/4. Ab4/8 | G4/2 F#4/2 |
  A: | F#4/t3360 ${accompaniment}/8 | E4/2 D4/2 |
  T: | A3/2 D4/2 | B3/2 A3/2 |
  B: | D3/1 | E3/2 D3/2 |
}`).project);
  }

  describe("半音经过点的伴随声部重击", () => {
    it.each([
      ["伴随音保持书写音高", "F#4", true],
      ["伴随声部实际平行下行", "F4", false],
    ] as const)("%s 时核对降五级的拼写建议", (_description, accompaniment, expected) => {
      const diagnostics = checkHarmony(withAltoReattack(accompaniment)).diagnostics.filter(item =>
        item.ruleId === rule && item.tick === 3360 && item.voiceIds.includes("soprano"),
      );
      if (!expected) {
        expect(diagnostics).toEqual([]);
        return;
      }
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ messageKey: `${rule}.passing-spelling`, severity: "warning" });
      expect(diagnostics[0].message).toContain("G♯4");
    });
    it("伴随声部重击并标明和弦外音时暂缓拼写建议", () => {
      const project = withAltoReattack("F#4");
      const alto = project.satbTracks.find(track => track.voice === "alto")!;
      alto.notes.find(note => note.startTick === 3360)!.nonChordToneRole = "other";
      expect(checkHarmony(project).diagnostics.some(item => item.tick === 3360 &&
        item.messageKey === `${rule}.passing-spelling`)).toBe(false);
    });
  });
});

describe("重属及副属导音的半音准备", () => {
  function warnings(target: string, before: string, after: string, localKey = "", source = "S6") {
    const project = compileScoreText(`satb 1
key G major
meter 2/4
bars 1..2 {
 S: | ${before}/2 | ${after}/2 |
 A: | G4/2 | G4/2 |
 T: | C4/2 | Bb3/2 |
 B: | E3/2 | Eb3/2 |
}
annotations {
 chord prev range=[1:1,2:1) symbol=${source} ${localKey}
 chord next range=[2:1,3:1) symbol=${target} ${localKey}
}`).project;
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === "melody.augmented-interval");
  }

  describe("重属和弦的同声部半音准备", () => {
    it.each(["viio7/V", "DD7", "V7/V", "Ger+6"])("允许 IV 上行增一度进入 %s 的升 IV", symbol => {
      expect(warnings(symbol, "C5", "C#5").some(d => d.voiceIds.includes("soprano"))).toBe(false);
    });

    it("允许大调 VI 半音下行进入德增六的降 VI", () => {
      expect(warnings("Ger+6", "C5", "C#5").some(d => d.voiceIds.includes("bass"))).toBe(false);
    });

    it("按目标和弦的局部调核对升 IV", () => {
      expect(warnings("V7/V", "F5", "F#5", 'localKey="C major"').some(d => d.voiceIds.includes("soprano"))).toBe(false);
    });

    it("小调 s6→D6 的低音增二度仍须提示", () => {
      const project = compileScoreText(`satb 1
key C minor
meter 2/4
bars 1..1 {
 S: | F4/4 G4/4 |
 A: | C4/4 D4/4 |
 T: | F3/4 D3/4 |
 B: | Ab2/4 B2/4 |
 H: | s6/4 D6/4 |
}`).project;
      expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
        ruleId: "melody.augmented-interval", tick: project.ppq, voiceIds: ["bass"],
      }));
    });

    it.each([
      ["D", "C5", "C#5", false],
      ["Ger+6", "C#5", "C5", false],
      ["Ger+6", "B4", "C##5", true],
      ["viio7/V", "A4", "A#4", false],
      ["D", "F4", "G#4", true],
    ] as const)("目标 %s 的 %s→%s 是否报告 B.3", (symbol, before, after, reports) => {
      expect(warnings(symbol, before, after).some(d => d.voiceIds.includes("soprano"))).toBe(reports);
    });
  });

  describe("其他副属和弦的导音半音引入", () => {
    it.each([
      { nextNote: "A4", nextChord: "vi", reports: false },
      { nextNote: "E4", nextChord: "vi", reports: false },
      { nextNote: "A4", nextChord: "IV", reports: false },
    ])("G–G#–$nextNote 落在 $nextChord 时，增一度警告为 $reports", ({ nextNote, nextChord, reports }) => {
      const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
 S: | G4/2 | G#4/2 | ${nextNote}/2 |
 A: | E4/2 | D4/2 | C4/2 |
 T: | C4/2 | B3/2 | E3/2 |
 B: | C3/2 | E3/2 | A2/2 |
 H: | I/2 | V7/VI/2 | ${nextChord}/2 |
}`).project;
      expect(checkHarmony(project).diagnostics.some(diagnostic =>
        diagnostic.ruleId === "melody.augmented-interval" &&
        diagnostic.tick === project.ppq * 2 && diagnostic.voiceIds.includes("soprano"),
      )).toBe(reports);
    });
  });
});

describe("进入重新起奏七音的半音进行", () => {
  const motif = `satb 1
key C major
meter 3/4
bars 1..2 {
 S: | G5/2 G#5/4 | A5/2. |
 A: | F#5/4 E5/4 E5/4 | E5/2. |
 T: | B4/2 B4/4 | A4/2. |
 B: | E4/2 D4/4 | D4/4 C4/2 |
}
`;

  const annotations = `
annotations {
 chord dominant range=[1:3,2:1) symbol=D2 localKey="A minor"
 chord tonic range=[2:1,3:1) symbol=t6 localKey="A minor"
}
`;

  function project(text = motif) {
    return compileScoreText(text).project;
  }

  function warns(input: ProjectDocument) {
    return checkHarmony(input, undefined, {}, { "melody.augmented-interval": { "same-harmony": "strict" } })
      .diagnostics.some(d => d.ruleId === "melody.augmented-interval" && d.tick === 2 * input.ppq &&
        d.severity === "warning" && d.voiceIds.includes("soprano"));
  }

  describe("chromatic preparation of a V7 with a reattacked seventh", () => {
    it("reads the two resolutions directly and checks through blind inference", () => {
      const input = project();
      expect(warns(input)).toBe(false);
      const blind = applyHarmonyInference(input, { chordInference: inferChords(input) },
        { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
      expect(warns(blind)).toBe(false);
    });

    it("accepts compatible labels even when the displaced bass has a suspension role", () => {
      const input = project(motif + annotations);
      input.satbTracks.find(t => t.voice === "bass")!.notes[2].nonChordToneRole = "suspension";
      expect(warns(input)).toBe(false);
    });

    it.each([
      ["wrong written third", motif.replace("D4/4 C4/2", "D4/4 C#4/2")],
      ["reattack at the wrong register", motif.replace("| D4/4 C4/2", "| D3/4 C4/2")],
      ["seventh goes to a tonic member in another voice", motif.replace("| D4/4 C4/2", "| D4/4 A3/2").replace("A4/2.", "A4/4 C4/2")],
      ["late leading tone", motif.replace("A5/2.", "E5/4 A5/2")],
      ["a rest before the reattack", motif.replace("| D4/4 C4/2", "| r/8 D4/8 C4/2")],
      ["the third is supplied by a sustained rather than reattacked note", motif.replace("D4/4 | D4/4", "D4/4~ | D4/4")],
      ["another voice changes at the same late arrival", motif.replace("A4/2.", "A4/4 E4/2")],
      ["another copy of the natural note", motif.replace("E4/2 D4/4", "G4/2 D4/4")],
      ["a separate written D minor at the delayed onset", motif.replace("| E5/2. |","| F5/4 E5/2 |")],
      ["incompatible middle labels", motif + annotations.replace("symbol=t6", "symbol=iv")],
    ])("keeps the soprano G–G♯ free of B.3 with %s", (_name, text) => {
      const input = project(text);
      expect(warns(input)).toBe(false);
    });

    it("does not infer a spelling error at G–G♯ before a manual phrase boundary", () => {
      const cut = project();
      cut.structure.phraseBoundaries.push({ id: "phrase-cut", tick: 4 * cut.ppq, source: "manual", confidence: "certain" });
      expect(warns(cut)).toBe(false);
    });
  });
});

describe("属三音转作下一属七的七音时的半音拼写", () => {
  const rule = "melody.augmented-interval";
  const structural = rule + ".structural-spelling";
  const strict = { "same-harmony": "strict", arpeggiation: "strict" } as const;
  const defaultExempt = { "same-harmony": "exempt" } as const;
  const sequence = `satb 1
key C major
meter 4/4
bars 1..1 {
  S: | G4/4 F#4/4 F4/4 E4/4 |
  A: | C#4/4 C4/4 B3/4 C4/4 |
  T: | E3/4 D3/2 E3/4 |
  B: | A2/4 D3/4 G2/4 C3/4 |
}`;

  function check(project: ProjectDocument, beat: number, voice: string, policy?: RuleExceptionPolicy) {
    expect(validateProject(project)).toBe(true);
    return checkHarmony(project, undefined, {}, policy && { [rule]: policy }).diagnostics
      .filter(d => d.ruleId === rule && d.tick === beat * project.ppq && d.voiceIds.some(id => id === voice));
  }

  function score(text = sequence) {
    return compileScoreText(text).project;
  }

  function withAnnotations(text: string, explicit: boolean, conflict = false) {
    const labels = conflict ? "T/1" : "V7/II/4 V7/V/4 D7/4 T/4";
    const project = score(text.replace("}", " H: | " + labels + " |\n}"));
    for (const chord of project.chordTrack.regions) {
      chord.locked = explicit;
      for (const interpretation of chord.semantics!.interpretations) {
        interpretation.source = explicit ? "manual" : "inferred";
      }
    }
    return project;
  }

  describe("Written third becoming the next dominant seventh", () => {
    it("accepts a written fifth omitted from either root-position seventh", () => {
      const input = score();
      expect(check(input, 1, "alto", strict)).toEqual([]);
      expect(check(input, 2, "soprano", strict)).toEqual([]);
      const explicit = withAnnotations(sequence, true);
      expect(check(explicit, 1, "alto", strict)).toEqual([]);
      expect(check(explicit, 2, "soprano", strict)).toEqual([]);
    });

    it("uses sound for the inspected part and attaches the correction only to its actual link", () => {
      const respelt = sequence.replace("F4/4 E4/4", "E#4/4 E4/4");
      const bad = score(respelt);
      const clean = score();
      expect(bad.satbTracks[0].notes.map(note => toMidi(note.pitch)))
        .toEqual(clean.satbTracks[0].notes.map(note => toMidi(note.pitch)));
      const wrongOverOneInferredRegion = withAnnotations(respelt, false, true);
      for (const project of [bad, wrongOverOneInferredRegion, withAnnotations(respelt, true)]) {
        expect(check(project, 1, "alto")).toEqual([]);
        expect(check(project, 2, "soprano", defaultExempt)).toMatchObject([{
          messageKey: structural, message: expect.stringContaining("F"),
          voiceIds: ["soprano"], noteIds: ["note-S-1920", "note-S-960"],
          evidence: [
            { kind: "note", label: "前一音" }, { kind: "note", label: "当前音" },
            { kind: "note", label: "另一声部的原七音" }, { kind: "note", label: "同次进行解决到新三音" },
          ],
        }]);
        expect(check(project, 2, "alto").every(d => d.messageKey !== structural)).toBe(true);
      }
      const explicitConflict = withAnnotations(respelt, true, true);
      expect(check(explicitConflict, 2, "soprano").every(d => d.messageKey !== structural)).toBe(true);
    });

    it("reports the misspelling when the preceding reattack is inside a separately marked D7", () => {
      const original = sequence.replace("F#4/4 F4/4", "F#4/8 F#4/8 F4/4");
      const bad = original.replace("F#4/8 F4/4", "E##4/8 E#4/4");
      for (const policy of [undefined, defaultExempt]) {
        expect(check(withAnnotations(original, true), 2, "soprano", policy)).toEqual([]);
        expect(check(withAnnotations(bad, true), 2, "soprano", policy)).toMatchObject([{
          messageKey: structural, noteIds: ["note-S-1440", "note-S-1920"],
          message: expect.stringMatching(/F♯.*F/),
        }]);
      }
    });

    it("keeps a later unrelated augmented leap diagnosable after a proved link", () => {
      const later = score(sequence.replace("F4/4 E4/4", "F4/4 Fb3/4"));
      expect(check(later, 2, "soprano")).toEqual([]);
      expect(check(later, 3, "soprano")).toMatchObject([{
        noteIds: ["note-S-1920", "note-S-2880"], messageKey: rule + ".增",
      }]);
    });

    it.each([
      ["peer resolves in another voice", sequence.replace("C4/4 B3/4", "C4/4 D4/4")
        .replace("D3/2 E3/4", "D3/4 B3/4 E3/4"), 2],
      ["inspected voice enters one subdivision after the peer has resolved",
        sequence.replace("F#4/4 F4/4", "F#4/4. F4/8"), 2.5],
      ["only the independent pitch sounds in the wrong octave",
        sequence.replace("C4/4 B3/4", "C4/4 B2/4"), 2],
    ] as const)("does not infer a spelling error at the written semitone when %s", (_label, material, beat) => {
      expect(check(score(material), beat, "soprano", strict)).toEqual([]);
    });

    it("respects contradictory absolute labels and a locked chord track", () => {
      const respelt = sequence.replace("F4/4 E4/4", "E#4/4 E4/4");
      const absolute = withAnnotations(respelt, false, true);
      absolute.chordTrack.regions[0].semantics = undefined;
      const lockedTrack = withAnnotations(respelt, false, true);
      lockedTrack.chordTrack.locked = true;
      for (const project of [absolute, lockedTrack]) {
        expect(check(project, 2, "soprano").every(d => d.messageKey !== structural)).toBe(true);
      }
    });

    it("does not use another part's marked ornament to establish an essential chord member", () => {
      const input = score();
      const tenor = input.satbTracks.find(track => track.voice === "tenor")!;
      tenor.notes.find(note => note.startTick === input.ppq)!.nonChordToneRole = "other";
      expect(check(input, 2, "soprano", strict)).toEqual([]);
    });

    it("does not move evidence across an explicit phrase boundary", () => {
      const input = score();
      input.structure.phraseBoundaries.push({ id: "boundary", tick: input.ppq * 2, source: "manual", confidence: "certain" });
      expect(check(input, 2, "soprano", strict)).toEqual([]);
    });
  });
});

describe("属七换位中的旋律三全音", () => {
  const rule = "melody.tritone";
  const target = 960;

  function makeScore(lines: readonly string[], harmony = "", key = "F major", meter = "2/4") {
    return compileScoreText([
      "satb 1", "key " + key, "meter " + meter, "bars 1..1 {",
      ...["S", "A", "T", "B"].map((voice, i) => " " + voice + ": | " + lines[i] + " |"),
      ...(harmony ? [" H: | " + harmony + " |"] : []), "}",
    ].join("\n")).project;
  }

  function infer(project: ReturnType<typeof makeScore>) {
    return applyHarmonyInference(project, { chordInference: inferChords(project) },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
  }

  function tritones(project: ReturnType<typeof makeScore>) {
    const profile = resolveBuiltinRuleProfile(project);
    return checkHarmony(project, profile.severities, profile.configs, profile.exceptions)
      .diagnostics.filter(item => item.ruleId === rule);
  }

  const handoff = ["Bb4/4 G4/4", "E4/4 Bb3/4", "G3/4 E3/4", "C3/4 C3/4"];
  const correct = ["Bb4/4 G4/4", "C4/4 Bb3/4", "E3/4 E3/4", "C3/4 C3/4"];

  describe("属七换位时实写增四度接手七音", () => {
    it.each(["C3/4 C3/4", "C3/2"])("整体移调，低音 %s 仍保留同一个属七与女低音诊断", bass => {
      const project = infer(makeScore([...handoff.slice(0, 3), bass]));
      expect(project.chordTrack.regions).toEqual([expect.objectContaining({
        startTick: 0, durationTicks: 2 * target,
        identity: expect.objectContaining({ structure: expect.objectContaining({ quality: "dominant7" }) }),
      })]);
      expect(tritones(project)).toEqual([expect.objectContaining({
        tick: target, voiceIds: ["alto"], severity: "warning",
        noteIds: ["note-A-0", "note-A-960"],
        evidence: expect.arrayContaining([expect.objectContaining({ kind: "note", id: "note-S-0", label: "原声部的七音" })]),
      })]);
    });

    it.each(["D7/2", "D7/4 D7/4"])("显式标注 %s 时默认仍报告", harmony => {
      expect(tritones(makeScore(handoff, harmony))).toEqual([expect.objectContaining({
        tick: target, voiceIds: ["alto"], severity: "warning",
      })]);
    });

    it.each([
      [{ "same-harmony": "exempt" }, undefined],
      [{ "same-harmony": "downgrade" }, "suggestion"],
      [{ "same-harmony": "strict" }, "warning"],
      [{ arpeggiation: "exempt" }, undefined],
    ] as const)("保留已有显式策略 %j", (policy: RuleExceptionPolicy, severity) => {
      const score = makeScore(handoff);
      score.ruleProfile.builtin[rule].exceptions = policy;
      const project = infer(score);
      expect(project.ruleProfile.builtin[rule].exceptions).toEqual(policy);
      expect(tritones(project).map(d => d.severity)).toEqual(severity ? [severity] : []);
    });

    it("旧工程显式豁免可在恢复规则默认并重开后重新检查", () => {
      const project = infer(makeScore(handoff));
      setBuiltinRuleException(project, rule, { "same-harmony": "exempt" });
      const reopened = JSON.parse(JSON.stringify(project)) as typeof project;
      expect(tritones(reopened)).toEqual([]);
      setBuiltinRuleException(reopened, rule, undefined);
      expect(tritones(JSON.parse(JSON.stringify(reopened)))).toMatchObject([
        { tick: target, voiceIds: ["alto"], severity: "warning" },
      ]);
    });

    it("原书根音级进接手七音的修正保持静默", () => {
      expect(tritones(infer(makeScore(correct)))).toEqual([]);
    });

    it("七音在原声部持续时保持静默", () => {
      const p = infer(makeScore(["F4/2", "D4/2", "B3/4 G3/4", "G2/4 B2/4"], "", "C major"));
      expect(p.satbTracks.find(t => t.id === "soprano")!.notes).toEqual([
        expect.objectContaining({ startTick: 0, durationTicks: 2 * target }),
      ]);
      expect(tritones(p)).toEqual([]);
    });

    it("准备后持续并级进解决的真正 4–3 延留保持静默", () => {
      const lines = ["C5/2 B4/4", "E4/4 F4/2", "G3/4 D4/2", "C3/4 G2/2"];
      const blind = infer(makeScore(lines, "", "C major", "3/4"));
      const conditioned = makeScore(lines, "I/4 V7/2", "C major", "3/4");
      for (const project of [blind, conditioned]) {
        expect(project.satbTracks.find(t => t.id === "soprano")!.notes).toEqual([
          expect.objectContaining({ startTick: 0, durationTicks: 2 * target }),
          expect.objectContaining({ startTick: 2 * target, pitch: { step: "B", alter: 0, octave: 4 } }),
        ]);
        expect(tritones(project)).toEqual([]);
      }
    });

    it("保留旧七音的配置不能证明接手，默认同和声处理继续生效", () => {
      const p = makeScore(["Bb4/2", "E4/4 Bb3/4", "G3/4 E3/4", "C3/2"], "D7/2");
      expect(tritones(p)).toEqual([]);
      p.ruleProfile.builtin[rule].exceptions = { "same-harmony": "strict" };
      expect(tritones(p)).toEqual([expect.objectContaining({ tick: target, voiceIds: ["alto"] })]);
    });
  });
});

describe("重属解决前的升二级拼写", () => {
  const rootPosition = `satb 1
key G major
meter 4/4
bars 1..2 {
 S: | C5/4 SOURCE/4 B4/4 A4/4 | G4/1 |
 A: | G4/2. F#4/4 | G4/1 |
 T: | E4/2 D4/2 | D4/1 |
 B: | C3/4 C#3/4 D3/2 | G2/1 |
}`;

  const firstInversion = `satb 1
key Bb major
meter 4/4
bars 1..2 {
 S: | Bb4/2. A4/4 | Bb4/1 |
 A: | Eb4/4 SOURCE/4 D4/4 C4/4 | D4/1 |
 T: | Eb3/4 E3/4 F3/2 | F3/1 |
 B: | G2/2 F2/2 | Bb2/1 |
}`;

  const tied = `satb 1
key G major
meter 4/4
bars 1..2 {
 S: | C5/2 SOURCE/4~ SOURCE/4 | B4/4 A4/4 G4/2 |
 A: | G4/1~ | G4/4 F#4/4 G4/2 |
 T: | E4/1 | D4/1 |
 B: | C3/2 C#3/2 | D3/2 G2/2 |
}`;

  const ordinary = `satb 1
key G major
meter 4/4
bars 1..1 {
 S: | Bb4/4 B4/4 A4/4 G4/4 |
 A: | G4/2 F#4/4 G4/4 |
 T: | D4/1 |
 B: | G3/2 D3/4 G3/4 |
}`;

  const twoChords = `satb 1
key G major
meter 2/4
bars 1..1 {
 S: | Bb4/4 B4/4 |
 A: | G4/2 |
 T: | E4/4 D4/4 |
 B: | C#3/4 D3/4 |
}`;

  const spellingRule = "melody.augmented-interval";
  const seventhRule = "resolution.chord-seventh";
  const rootHarmony = "| IV/4 DDVII7/4 K46/4 V/4 | I/1 |";
  const rootCorrection = "B♭4 宜写为 A♯";

  function compile(score: string, harmony?: string) {
    const { project } = compileScoreText(harmony ? score.replace(/\}$/, ` H: ${harmony}\n}`) : score);
    return harmony ? project : applyHarmonyInference(project, inferHarmony(project), { mode: "fill-gaps" }).project;
  }

  function atLanding(project: ProjectDocument, voice: VoiceId, beat: number) {
    const { diagnostics, skippedRuleIds } = checkHarmony(project);
    expect(skippedRuleIds).not.toContain(spellingRule);
    return diagnostics.filter(d => d.tick === beat * project.ppq && d.voiceIds.includes(voice) &&
      [spellingRule, seventhRule].includes(d.ruleId));
  }

  function expectSpelling(project: ProjectDocument, voice: VoiceId, from: number, to: number, correction: string) {
    const notes = project.satbTracks.find(track => track.voice === voice)!.notes;
    const noteIds = [from, to].map(beat => notes.find(note => note.startTick === beat * project.ppq)!.id);
    const diagnostics = atLanding(project, voice, to);
    expect(diagnostics).toMatchObject([{
      ruleId: spellingRule, messageKey: `${spellingRule}.structural-spelling`,
      voiceIds: [voice], noteIds: expect.arrayContaining(noteIds),
      message: expect.stringContaining(correction),
    }]);
    expect(diagnostics[0].message.match(/宜写为/g)).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/K46.*上行|上行.*K46/);
  }

  describe.each(["推导写回", "给定和弦"])("重属减七向终止四六的拼写（%s）", entry => {
    const projectFor = (score: string, harmony: string) => compile(score, entry === "给定和弦" ? harmony : undefined);

    describe.each([
      { name: "G 大调原位高音", score: rootPosition, harmony: rootHarmony,
        voice: "soprano", from: 1, to: 2, correct: "A#4", wrong: "Bb4", correction: rootCorrection },
      { name: "降 B 大调第一转位中音", score: firstInversion, harmony: "| IV6/4 DDVII65/4 K46/4 V/4 | I/1 |",
        voice: "alto", from: 1, to: 2, correct: "C#4", wrong: "Db4", correction: "D♭4 宜写为 C♯" },
      { name: "前音连音且主音跨落点保持", score: tied, harmony: "| IV/2 DDVII7/2 | K46/4 V/4 I/2 |",
        voice: "soprano", from: 2, to: 4, correct: "A#4", wrong: "Bb4", correction: rootCorrection },
    ] as const)("$name", ({ score, harmony, voice, from, to, correct, wrong, correction }) => {
      it("正确升 II 静默", () => {
        expect(atLanding(projectFor(score.replaceAll("SOURCE", correct), harmony), voice, to)).toEqual([]);
      });

      it("只提示把前音改写为升 II", () => {
        expectSpelling(projectFor(score.replaceAll("SOURCE", wrong), harmony), voice, from, to, correction);
      });
    });

    it("保持两拍的纵向音高，交换中音与次中音落点后仍检查七音", () => {
      const exchanged = rootPosition.replace("SOURCE", "Bb4")
        .replace("G4/2. F#4/4", "G4/2 D4/4 F#4/4")
        .replace("E4/2 D4/2", "E4/2 G4/4 D4/4");
      expect(atLanding(projectFor(exchanged, rootHarmony), "soprano", 2)).toMatchObject([{ ruleId: seventhRule }]);
    });

    it("普通同声部变化半音保持静默", () => {
      expect(atLanding(projectFor(ordinary, "| i/4 I/4 V/4 I/4 |"), "soprano", 1)).toEqual([]);
    });

    it("同主音小调中不套用大调拼写", () => {
      const minor = rootPosition.replace("G major", "G minor").replace("SOURCE", "Bb4");
      expect(atLanding(projectFor(minor, rootHarmony), "soprano", 2).map(d => d.ruleId)).not.toContain(spellingRule);
    });
  });

  it("两组音盲推写回后，清除落点标签前后均提示前音改写", () => {
    const project = compile(twoChords);
    expectSpelling(project, "soprano", 0, 1, rootCorrection);

    const landingTick = project.ppq;
    project.chordTrack.regions = project.chordTrack.regions
      .filter(region => region.startTick !== landingTick)
      .map(region => region.startTick < landingTick
        ? { ...region, durationTicks: Math.min(region.durationTicks, landingTick - region.startTick) }
        : region);
    expect(project.chordTrack.regions.some(region => region.startTick <= landingTick &&
      landingTick < region.startTick + region.durationTicks)).toBe(false);
    expectSpelling(project, "soprano", 0, 1, rootCorrection);
  });

  it("同一未锁定的推导标签覆盖两组音时，默认同和弦豁免仍保留落点提示", () => {
    const project = compile(twoChords);
    const source = project.chordTrack.regions.find(region => region.startTick === 0)!;
    expect(project.chordTrack.locked).toBe(false);
    expect(source).toMatchObject({
      locked: false,
      identity: { root: { step: "C", alter: 1 }, structure: { quality: "diminished7" } },
    });
    project.chordTrack.regions = [{ ...source, durationTicks: project.lengthTicks }];
    expectSpelling(project, "soprano", 0, 1, rootCorrection);
  });
});

describe("自然与和声大调下属六之间的半音进行", () => {
  const supertonic = `satb 1
key B major
meter 3/2
bars 1..1 {
 S: | E5/2 C#5/2 B4/2 |
 A: | C#4/2 E4/2 D#4/2 |
 T: | G#3/2 G3/2 F#3/2 |
 B: | E3/1 F#2/2 |
}
annotations {
 chord natural range=[1:1,1:2) symbol=ii6
 chord lowered range=[1:2,1:3) symbol=iio6
 chord cadence range=[1:3,2:1) symbol=K46
}`;
  const subdominant = `satb 1
key B major
meter 3/2
bars 1..1 {
 S: | B4/1 B4/2 |
 A: | E4/1 D#4/2 |
 T: | B3/2 E3/2 F#3/2 |
 B: | G#2/2 G2/2 F#2/2 |
 H: | IV6/2 iv6/2 K46/2 |
}`;
  const rule = "melody.augmented-interval";
  function result(text: string, voice: string, boundary?: number) {
    const { project } = compileScoreText(text);
    if (boundary !== undefined) project.structure.phraseBoundaries.push({
      id: "cut", tick: boundary, source: "manual", confidence: "certain",
    });
    const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    const atEntry = (d: {ruleId: string; tick: number; voiceIds: readonly string[]}) =>
      d.ruleId === rule && d.tick === 1920 && d.voiceIds.includes(voice);
    return [
      augmentedIntervalRule(rules).some(atEntry),
      checkHarmony(project, undefined, {}, { [rule]: { "same-harmony": "strict", arpeggiation: "strict" } }).diagnostics.some(atEntry),
    ];
  }

  describe("natural to harmonic major subdominant sixths", () => {
    it("checks the tenor of ii6 and the bass of IV6", () => {
      expect(result(supertonic, "tenor")).toEqual([false, false]);
      expect(result(subdominant, "bass")).toEqual([false, false]);
    });
    it.each([
      ["wrong target pitch", supertonic.replace("F#3/2 |", "D#3/2 |")],
      ["wrong octave", supertonic.replace("F#3/2 |", "F#4/2 |")],
      ["a different voice takes over the descending step", supertonic.replace("F#3/2 |", "D#3/2 |").replace("D#4/2 |", "F#4/2 |")],
      ["different subdominant identity", supertonic.replace("symbol=iio6", "symbol=iv")],
      ["missing middle root", supertonic.replace("C#5/2", "E5/2")],
      ["ordinary six-four", supertonic.replace("symbol=K46", "symbol=I64")],
      ["different local key", supertonic.replace("symbol=iio6", 'symbol=iio6 localKey="A major"')],
      ["nonchord role", supertonic.replace(" chord natural", " note T@1:2 role=passing\n chord natural")],
    ])("%s leaves the tenor semitone free of B.3", (_, text) => expect(result(text, "tenor")).toEqual([false, false]));
    it.each([1920, 3840])("does not span a phrase boundary at %i", cut => {
      expect(result(supertonic, "tenor", cut)).toEqual([false, false]);
    });
  });
});

describe("持续三声部上的下行半音经过", () => {
  const diatonicRun = `satb 1
key A major
meter 2/4
bars 1..2 {
 S: | A4/8 G#4/8 F#4/8 F4/8 | E4/4 A4/4 |
 A: | A3/2~ | A3/4 A3/4 |
 T: | E3/2~ | E3/4 E3/4 |
 B: | C#3/2~ | C#3/4 A2/4 |
}
`;

  const preparedNinth = `satb 1
key D minor
meter 3/4
bars 1..3 {
 S: | F5/2 D5/4~ | D5/8 Db5/8 C5/4 G4/4 | F4/2. |
 A: | A4/2 Ab4/4 | G4/2 E4/4 | F4/2. |
 T: | F4/2 F4/4 | E4/2 Bb3/4 | A3/2. |
 B: | D3/2 B2/4 | C3/2. | F2/2. |
}
annotations {
 chord preparation range=[1:3,2:1) symbol=DDVII7 localKey="F major"
 chord dominant range=[2:3,3:1) symbol=V7 localKey="F major"
 chord tonic range=[3:1,4:1) symbol=I localKey="F major"
}
`;

  function make(score: string) {
    return compileScoreText(score).project;
  }

  function warnings(project: ProjectDocument, tick: number) {
    return checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "melody.augmented-interval" && item.tick === tick)
      .map(({voiceIds, params}) => ({voiceIds, semitones:params.semitones}));
  }

  function expectNoSopranoB3(project: ProjectDocument, tick: number) {
    expect(warnings(project,tick).filter(item => item.voiceIds.includes("soprano"))).toEqual([]);
  }

  describe("下降的半音经过收束于三声持续的大三和弦", () => {
    const weakTick = 1440;
    it("允许两个自然经过音之后的变化半音，和弦标签可以缺省", () => {
      expect(warnings(make(diatonicRun),weakTick)).toEqual([]);
    });

    it("相符的给定和弦不改变通过结果", () => {
      expect(warnings(make(diatonicRun + 'annotations {\n chord backing range=[1:1,1:2) symbol=I6\n}\n'),weakTick)).toEqual([]);
    });

    it.each([
      ["伴随声部在变化处重新起奏", (score: string) => score.replace("E3/2~", "E3/4. E3/8~")],
      ["三声部中一音改成别的拼写", (score: string) => score.replace("E3", "Fb3").replace("E3/4", "Fb3/4")],
      ["经过音没有同向到达", (score: string) => score.replace("E4/4", "G#4/4")],
      ["错八度的解决", (score: string) => score.replace("E4/4", "E3/4")],
      ["没有有据的级进引入", (score: string) => score.replace("G#4/8", "B4/8")],
      ["强拍的变化", (score: string) => score.replace("G#4/8 F#4/8 F4/8", "F#4/8 F4/4")],
    ])("%s 时同声部半音不报 B.3", (description, edit) => {
      const tick = description === "强拍的变化" ? 960 : weakTick;
      expectNoSopranoB3(make(edit(diatonicRun)),tick);
    });

    it("手动句界不使邻接半音产生 B.3", () => {
      const project=make(diatonicRun);
      project.structure.phraseBoundaries.push({id:"cut",tick:1680,source:"manual",confidence:"certain"});
      expectNoSopranoB3(project,weakTick);
    });

    it("冲突和弦标签不导致增一度警告", () => {
      const score=diatonicRun + 'annotations {\n chord conflict range=[1:1,1:2) symbol=I\n}\n';
      expectNoSopranoB3(make(score),weakTick);
    });

    it("第 41 章的目标条件不决定降 V 半音的 B.3", () => {
      const wrong=diatonicRun.replace("A4/8 G#4/8 F#4/8 F4/8 | E4/4 A4/4","F#4/8 F#4/8 E4/8 Eb4/8 | D4/4 A4/4")
        .replace("E3/2~ | E3/4 E3/4", "D3/2~ | D3/4 E3/4")
        .replace("C#3/2~ | C#3/4 A2/4","F#2/2~ | F#2/4 A2/4");
      expectNoSopranoB3(make(wrong),weakTick);
    });
  });

  describe("真实属低音上预备的九度经过半音到八度", () => {
    const weakTick=3360;
    it("允许延音与属和弦的实际解决，并核对由 V7–I 支持的局部大调", () => {
      expect(warnings(make(preparedNinth),weakTick)).toEqual([]);
      expect(warnings(make(preparedNinth.replace(/ chord preparation[^\n]+\n/,"")),weakTick)).toEqual([]);
    });

    it.each([
      ["临时同音重新起奏", (score: string) => score.replace("D5/4~", "D5/4")],
      ["冲突的副属目标标签", (score: string) => score.replace("DDVII7", "viio7/II")],
      ["不成立的七音拼写", (score: string) => score.replace("Ab4/4", "G#4/4")],
      ["实际属七缺三音", (score: string) => score.replace("G4/2 E4/4", "G4/2 D4/4")],
      ["没有终止主功能", (score: string) => score.replace(/ chord tonic[^\n]+\n/,"")],
      ["错误主功能", (score: string) => score.replace('symbol=I localKey="F major"','symbol=ii localKey="F major"')],
      ["属低音在同音区重奏", (score: string) => score.replace("C3/2.", "C3/2 C3/4")],
    ])("%s 时预备九度的半音不报 B.3", (_description, edit) => {
      expectNoSopranoB3(make(edit(preparedNinth)),weakTick);
    });

    it("目标调歧义或句界不使同声部半音产生 B.3", () => {
      const ambiguous=make(preparedNinth.replace('symbol=V7 localKey="F major"',
        'symbol=V7 localKey="F major" confidence=ambiguous'));
      expectNoSopranoB3(ambiguous,weakTick);
      const cut=make(preparedNinth);
      cut.structure.phraseBoundaries.push({id:"cut",tick:5280,source:"manual",confidence:"certain"});
      expectNoSopranoB3(cut,weakTick);
    });

    const preparationTick=1920;

    it("允许完整 vi 的自然三级在原声部改作重属导七的降三级七音", () => {
      expect(warnings(make(preparedNinth),preparationTick)).toEqual([]);
    });

    it("不以晚到的属和弦代替进入时的完整 vi 或 vi7", () => {
      const foreignPreparation=make(preparedNinth.replace("F5/2 D5/4~","E5/2 D5/4~"));
      expect(warnings(foreignPreparation,preparationTick)).toEqual([]);
      expect(warnings(foreignPreparation,weakTick)).toEqual([]);
    });

    it("前置标签冲突时仍不在降三级入音处报 B.3", () => {
      const conflict=make(preparedNinth.replace("annotations {\n",
        'annotations {\n chord before range=[1:1,1:3) symbol=iv localKey="A minor"\n'));
      expect(warnings(conflict,preparationTick)).toEqual([]);
      expect(warnings(conflict,weakTick)).toEqual([]);
    });

    it("升四不进属根也不借 B.3 代报解决错误", () => {
      const unresolved=make(preparedNinth.replace("C3/2.","C4/2."));
      expect(warnings(unresolved,preparationTick)).toEqual([]);
      expectNoSopranoB3(unresolved,weakTick);
    });
  });
});

describe("插入半音后的旋律解决", () => {
  const textbook = `satb 1
key C major
meter 2/4
bars 1..3 {
  S: | C5/2 | B4/4. G5/8~ | G5/2 |
  A: | G4/2~ | G4/2~ | G4/2 |
  T: | E4/2 | E4/8 Eb4/8 D4/4~ | D4/8 Db4/8 C4/4 |
  B: | C3/2 | F3/2 | E3/2 |
}`;

  const ascending = `satb 1
key Eb major
meter 6/8
bars 1..2 {
  S: | F5/4.~ F5/4.~ | F5/8 F#5/8 G5/2 |
  A: | Bb4/4.~ Bb4/4. | Bb4/4 Bb4/2 |
  T: | F4/4.~ F4/4. | Eb4/4.~ Eb4/4. |
  B: | Db3/4.~ Db3/4. | Eb3/4 Db3/2 |
}`;

  const parallel = `satb 1
key G minor
meter 2/4
bars 1..2 {
  S: | A4/2~ | A4/8 Ab4/8 G4/4 |
  A: | D4/2~ | D4/2 |
  T: | C4/2~ | C4/8 Cb4/8 Bb3/4 |
  B: | F#2/2 | G2/2 |
}`;

  function warningsAt(score: string, quarters: number, harmony?: string) {
    const source = harmony ? score.replace(/\}$/, `  H: ${harmony}\n}`) : score;
    const { project } = compileScoreText(source);
    const input = harmony ? project : applyHarmonyInference(project, { chordInference: inferChords(project) }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
    // Test this evidence separately from the product's general same-harmony exemption.
    const result = checkHarmony(input, undefined, {}, { "melody.augmented-interval": { "same-harmony": "strict" } });
    expect(result.skippedRuleIds).not.toContain("melody.augmented-interval");
    return result.diagnostics.filter(d => d.ruleId === "melody.augmented-interval" &&
      d.tick === quarters * input.ppq).flatMap(d => d.voiceIds);
  }

  describe("第 45 章插入半音后解决", () => {
    it.each([undefined, "| I/2 | V42/2 | I6/2 |"])("例 45-661 两次单声部下行 %s", harmony => {
      expect(warningsAt(textbook, 2.5, harmony)).toEqual([]);
      expect(warningsAt(textbook, 4.5, harmony)).toEqual([]);
      // The octave change is before the tested E–E♭ entry.
      expect(warningsAt(textbook.replace("E4/2 |", "E3/2 |"), 2.5, harmony)).not.toContain("tenor");
    });

    it.each([undefined, "| v6/4. v6/4. | I/4 I42/2 |"])("单声部上行与低音增七 %s", harmony => {
      expect(warningsAt(ascending, 3.5, harmony)).toEqual([]);
      expect(warningsAt(ascending.replace("G5/2", "E5/2"), 3.5, harmony)).not.toContain("soprano");
      // The respelling alone gives no independent correction at the ensuing G♭–G.
      expect(warningsAt(ascending.replace("F#5/8", "Gb5/8"), 4, harmony)).not.toContain("soprano");
    });

    it.each([undefined, "| V65/2 | i/2 |"])("同时进行的平行六度 %s", harmony => {
      expect(warningsAt(parallel, 2.5, harmony)).toEqual([]);
      expect(warningsAt(parallel.replace("Bb3/4", "B3/4"), 2.5, harmony)).toEqual([]);
    });
  });
});

describe("借用二级和弦降五音的低音半音进行", () => {
  function warning({ key = "Ab major", soprano = "C5 Db5 C5 Db5 C5",
      alto = "Ab4 Ab4 Ab4 G4 Ab4", tenor = "F4 Bb3 Eb4 Bb3 Eb4",
      bass = "F3 Fb3 Eb3 Eb3 C3", labels = "", cut = -1 } = {}) {
    const parts = [soprano, alto, tenor, bass].map((s, i) =>
      " " + ["S", "A", "T", "B"][i] + ": | " + s.split(" ").map(n => n + "/4").join(" ") + " |");
    const { project } = compileScoreText(`satb 1
key ${key}
meter 5/4
bars 1..1 {
${parts.join("\n")}
}${labels ? "\nannotations {\n " + labels + "\n}" : ""}`);
    if (cut >= 0) project.structure.phraseBoundaries = [{
      id: "cut", source: "manual", confidence: "certain", tick: cut * project.ppq,
    }];
    return checkHarmony(project).diagnostics.some(d => d.tick === project.ppq &&
      d.ruleId === "melody.augmented-interval" && d.voiceIds.includes("bass"));
  }

  describe("Borrowed supertonic fifth in the bass", () => {
    it("reads vi–ii half-diminished 43–I64 in the prevailing major key", () => {
      expect(warning()).toBe(false);
    });
    it("accepts an independently confirmed major target after the parallel minor", () => {
      expect(warning({ key: "F major" })).toBe(false);
    });
    it.each([
      ["seventh transferred to another voice", { soprano: "C5 Db5 Ab4 Db5 C5", alto: "Ab4 Ab4 C5 G4 Ab4" }],
      ["same pitch class but not the same octave", { alto: "Ab4 Ab4 Ab3 G4 Ab4" }],
      ["enharmonic third", { soprano: "C5 C#5 C5 Db5 C5" }],
      ["incomplete supertonic", { soprano: "C5 Bb4 C5 Db5 C5" }],
      ["wrong preceding minor triad", { tenor: "D4 Bb3 Eb4 Bb3 Eb4" }],
      ["foreign key without the confirming seventh", { key: "F major", soprano: "C5 Db5 C5 Bb4 C5" }],
      ["foreign leading tone handed to the soprano", { key: "F major", soprano: "C5 Db5 C5 Db5 Ab4", alto: "Ab4 Ab4 Ab4 G4 C5" }],
      ["different annotated target", { labels: "chord bad range=[1:3,1:4) symbol=V" }],
      ["boundary at six-four", { cut: 2 }],
      ["boundary inside the local confirmation", { key: "F major", cut: 4 }],
    ] as const)("does not infer a bass spelling error from inconclusive evidence: %s", (_label, input) => {
      expect(warning(input)).toBe(false);
    });
  });

  function borrowedSupertonicToDominantWarning({ alto = "G4", tenor = "B3", phraseCut = false } = {}) {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
  S: | E5/4 F5/2 F5/4 | E5/1 |
  A: | C5/4 A4/4 Ab4/4 ${alto}/4 | G4/1 |
  T: | G4/4 D4/4 C4/4 ${tenor}/4 | C4/1 |
  B: | C3/4 D3/2 D3/4 | C3/1 |
}`);
    if (phraseCut) project.structure.phraseBoundaries = [{
      id: "cut", source: "manual", confidence: "certain", tick: 3 * project.ppq,
    }];
    return checkHarmony(project).diagnostics.some(d => d.tick === 2 * project.ppq &&
      d.ruleId === "melody.augmented-interval" && d.voiceIds.includes("alto"));
  }

  describe("Borrowed supertonic fifth descending into the dominant", () => {
    it("allows ii–iiø7–V7 when the fifth and seventh both resolve downward", () => {
      expect(borrowedSupertonicToDominantWarning()).toBe(false);
    });

    it.each([
      ["the fifth drops an extra octave", { alto: "G3" }],
      ["the seventh leaps up", { tenor: "B4" }],
      ["the dominant begins a new phrase", { phraseCut: true }],
    ] as const)("does not infer an alto spelling error when %s", (_label, input) => {
      expect(borrowedSupertonicToDominantWarning(input)).toBe(false);
    });
  });
});

describe("旋律增音程的辨识", () => {
  const ruleId = "melody.augmented-interval";

  function evaluate(notes: string[]) {
    const score = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${notes.map(note => `${note}/4`).join(" ")} |
 A: empty
 T: empty
 B: empty
}`).project;
    return checkHarmony(score).diagnostics.filter(diagnostic => diagnostic.ruleId === ruleId);
  }

  describe("实写旋律增音程", () => {
    it.each([
      ["F4", "F#4", "F4", "E4"],
      ["Bb4", "B4", "Bb4", "A4"],
      ["A4", "Ab4", "G4", "F4"],
    ])("无和弦标注时允许半音往返及经过 %s %s %s %s", (...notes) => {
      expect(evaluate(notes)).toEqual([]);
    });

    it.each([
      ["Fb4", "F4", "G#4", "增2度", 2, 3],
      ["E4", "E#4", "Eb4", "倍增1度", 1, 2],
      ["Cb4", "C4", "C#5", "增8度", 8, 13],
      ["Cb4", "C4", "F##4", "倍增4度", 4, 7],
    ] as const)("%s 到 %s 的半音不影响下一音 %s 的%s诊断", (chromaticApproach, from, to, label, number, semitones) => {
      const diagnostics = evaluate([chromaticApproach, from, to, to]);
      expect(diagnostics).toEqual([expect.objectContaining({
        tick: 1920, voiceIds: ["soprano"], messageKey: `${ruleId}.增`,
        params: { intervalNumber: number, quality: "增", semitones },
        message: expect.stringContaining(label),
      })]);
    });
  });
});

describe("旋律跳进与换位、延留的上下文", () => {
  const leapRule = "melody.large-leap";

  it.each([[true, false], [false, true]])("核对其他声部延留准备的同音加倍 %s", (doubled, reports) => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | C5/4 ${doubled ? "G4" : "E5"}/4 A4/2 |
 A: | G4/4 G4/2 F4/4 |
 T: | E4/4 C4/4 C4/2 |
 B: | C4/4 E3/4 F3/2 |
 H: | I/4 I6/4 IV/2 |
}`);
    project.satbTracks.find(track => track.voice === "alto")!.notes[1].nonChordToneRole = "suspension";
    const hasLeap = (strict: boolean) =>
      checkHarmony(project, undefined, {}, strict ? { [leapRule]: { "same-harmony": "strict" } } : {})
        .diagnostics.some(d => d.ruleId === leapRule && d.tick === project.ppq && d.voiceIds.includes("bass"));
    expect(hasLeap(true)).toBe(true);
    expect(hasLeap(false)).toBe(reports);
  });

  function leaps(score: string, strict = false) {
    const { project } = compileScoreText(score);
    return checkHarmony(project, undefined, {}, strict ? { [leapRule]: { "same-harmony": "strict" } } : {})
      .diagnostics.filter(d => d.ruleId === leapRule);
  }

  it("保留跨和弦的女高八度，先前在同一和弦内的换位只解释当时的进行", () => {
    const score = `satb 1
key Bb major
meter 4/4
bars 1..1 {
 S: | C5/4 F4/2 F5/4 |
 A: | F4/2 Eb4/4 D4/4 |
 T: | A3/2 A3/4 Bb3/4 |
 B: | F3/2 Eb3/4 D3/4 |
 H: | V/2 V2/4 I6/4 |
}`;
    expect(leaps(score)).toContainEqual(expect.objectContaining({ tick: 2880, voiceIds: ["soprano"] }));
  });

  it("长音经过换和弦后，在实际起跳的位置核对转位和实音", () => {
    const score = `satb 1
key D minor
meter 3/4
bars 1..1 {
 S: | Bb4/4 A4/4 D5/4 |
 A: | G4/4 F4/4 A4/4 |
 T: | Bb3/4 D4/4 A3/4 |
 B: | D3/2 F2/4 |
 H: | iv64/4 i/4 i6/4 |
}`;
    const bassLeap = expect.objectContaining({ tick: 1920, voiceIds: ["bass"] });
    expect(leaps(score, true)).toContainEqual(bassLeap);
    expect(leaps(score)).not.toContainEqual(bassLeap);
  });
});

describe("旋律大跳、超八度与低音八度跳进", () => {
  function diagnosticsFor(bass: string, soprano = "E5/2 | D5/2", labels = "") {
    const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..2 {
  S: | ${soprano} |
  A: | C5/2 | B4/2 |
  T: | E4/2 | G4/2 |
  B: | ${bass} |
  ${labels}
}`);
    return checkHarmony(project).diagnostics;
  }

  describe("较大旋律跳进的低音八度", () => {
    it.each([
      ["下行", "G3/2 | G2/2"],
      ["上行", "G2/2 | G3/2"],
    ])("%s书写纯八度在和弦转换处不报 B.2", (_direction, bass) => {
      for (const labels of ["", "H: | I64/2 | V/2 |"]) {
        expect(diagnosticsFor(bass, undefined, labels)).not.toContainEqual(expect.objectContaining({
          ruleId: "melody.large-leap", voiceIds: ["bass"], tick: 1920,
        }));
      }
    });

    it.each([
      ["低音大六度", "C3/2 | A3/2", "E5/2 | D5/2", "bass", 9],
      ["低音等音减九度", "C#3/2 | Db4/2", "E5/2 | D5/2", "bass", 12],
      ["高音纯八度", "C3/2 | G2/2", "E4/2 | E5/2", "soprano", 12],
    ])("%s 仍报 B.2", (_name, bass, soprano, voice, semitones) => {
      expect(diagnosticsFor(bass, soprano)).toContainEqual(expect.objectContaining({
        ruleId: "melody.large-leap", voiceIds: [voice], tick: 1920, params: { semitones },
      }));
    });

    it("低音越过纯八度仍报 B.1", () => {
      expect(diagnosticsFor("C3/2 | D4/2")).toContainEqual(expect.objectContaining({
        ruleId: "melody.leap-over-octave", voiceIds: ["bass"], tick: 1920, params: { semitones: 14 },
      }));
    });

    it("低音与高音同向形成连续八度仍报声部进行错误", () => {
      expect(diagnosticsFor("G2/2 | G3/2", "G4/2 | G5/2")).toContainEqual(expect.objectContaining({
        ruleId: "voice-leading.parallel-octaves", voiceIds: ["bass", "soprano"], tick: 1920,
      }));
    });
  });

  describe("规则引擎修正基线", () => {
    it("旋律规则不能跨过休止关联两个起奏音", () => {
      const project = correctionProject(PPQ * 3);
      setCorrectionVoice(project, "soprano", [
        correctionNote("before-rest", 0, { step: "C", alter: 0, octave: 4 }),
        correctionNote("after-rest", PPQ * 2, { step: "C", alter: 0, octave: 6 }),
      ]);

      expect(
        checkHarmony(project).diagnostics.some(
          (diagnostic) =>
            diagnostic.ruleId === "melody.leap-over-octave" ||
            diagnostic.ruleId === "melody.large-leap",
        ),
      ).toBe(false);
    });
  });
});

describe("小调低音的下行减七度", () => {
  interface Example {
    bass?: string;
    soprano?: string;
    tenor?: string;
    harmony?: string;
    solo?: boolean;
    key?: string;
    boundary?: number;
  }

  function warnings({
    bass = "C4/4 D#3/4 E3/2", soprano = "E5/4 F#5/4 E5/2",
    tenor = "A4/4 B3/4 B3/2", harmony = "", solo = false,
    key = "E minor", boundary,
  }: Example = {}) {
    const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
  S: ${solo ? "empty" : "| " + soprano + " |"}
  A: ${solo ? "empty" : "| C5/4 D#5/4 G4/2 |"}
  T: ${solo ? "empty" : "| " + tenor + " |"}
  B: | ${bass} |
  ${harmony ? "H: | " + harmony + " |" : ""}
}`);
    if (boundary !== undefined) project.structure.phraseBoundaries.push({
      id: "manual-cut", tick: boundary * project.ppq, source: "manual", confidence: "certain",
    });
    return checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "melody.diminished-interval" &&
      item.voiceIds.includes("bass") && item.tick === project.ppq);
  }

  describe("小调低音下行减七度的解决", () => {
    it.each([
      ["四声部实音", {}],
      ["四声部与正确标签", { harmony: "iv6/4 V6/4 i/2" }],
      ["单低音", { solo: true }],
    ] satisfies [string, Example][])("%s 支持反向半音解决", (_label, example) => {
      expect(warnings(example)).toHaveLength(0);
    });

    it.each([
      ["借用音区导致低音上方成为实际低音", { tenor: "A3/4 B3/4 B3/2", harmony: "iv6/4 V6/4 i/2" }],
      ["主音到达处有更低的男高", { tenor: "A4/4 B3/4 B2/2" }],
      ["属和弦转位与实谱冲突", { harmony: "iv6/4 V/4 i/2" }],
      ["表面音型的出发和弦标为 VI", { harmony: "VI/4 V6/4 i/2" }],
      ["主音到达处的标签冲突", { harmony: "iv6/4 V6/4 iv/2" }],
      ["多声部未凑全下属三和弦", { soprano: "A5/4 F#5/4 E5/2" }],
      ["错八度", { bass: "C4/4 D#3/4 E4/2", solo: true }],
      ["没有后继", { bass: "C4/4 D#3/4 r/2", solo: true }],
      ["后继前有休止", { bass: "C4/4 D#3/4 r/4 E3/4", solo: true }],
      ["源音内部有句界", { solo: true, boundary: 0.5 }],
      ["到达主音处有句界", { solo: true, boundary: 2 }],
      ["音高并非当前小调的对应音级", { solo: true, key: "B minor" }],
    ] satisfies [string, Example][])("%s 时保留警告", (_label, example) => {
      expect(warnings(example)).toEqual([expect.objectContaining({ severity: "warning", voiceIds: ["bass"] })]);
    });
  });
});

describe("小调升六级低音与属六和弦", () => {
  interface Example {
    bass?: string;
    alto?: string;
    tenor?: string;
    harmony?: string;
    solo?: boolean;
    key?: string;
    boundary?: number;
    bassDeclaredAsTenor?: boolean;
  }

  function warnings({
    bass = "Eb3/4 E3/2 F#3/4", alto = "Eb4/4 E4/2 A4/4",
    tenor = "G3/4 G3/2 A3/4", harmony = "", solo = false,
    key = "G minor", boundary, bassDeclaredAsTenor,
  }: Example = {}) {
    const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
  S: ${solo ? "empty" : "| C5/4 C5/2 D5/4 |"}
  A: ${solo ? "empty" : "| " + alto + " |"}
  T: ${solo || tenor === "empty" ? "empty" : "| " + tenor + " |"}
  B: | ${bass} |
  ${harmony ? "H: | " + harmony + " |" : ""}
}`);
    if (boundary !== undefined) project.structure.phraseBoundaries.push({
      id: "manual-cut", tick: boundary * project.ppq, source: "manual", confidence: "certain",
    });
    if (bassDeclaredAsTenor) {
      const bassTrack = project.satbTracks.find(track => track.voice === "bass")!;
      bassTrack.voice = "tenor";
    }
    return checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "melody.augmented-interval" &&
      item.voiceIds.includes("bass") && item.tick === project.ppq);
  }

  describe("小调低音变化半音接属六和弦", () => {
    it.each([
      ["四声部实音", {}],
      ["四声部与正确标签", { harmony: "iv6/4 IV6/2 V6/4" }],
      ["单低音", { solo: true }],
    ] satisfies [string, Example][])("%s 支持变化半音", (_label, example) => {
      expect(warnings(example)).toHaveLength(0);
    });

    it.each([
      ["出发处实际最低音是男高", { tenor: "G2/4 G3/2 A3/4", harmony: "iv6/4 IV6/2 V6/4" }],
      ["中间和弦内部有较低的男高", { tenor: "G3/4 G3/4 G2/4 A3/4" }],
      ["到达处实际最低音是男高", { tenor: "G3/4 G3/2 A2/4" }],
      ["中间标签与大下属六和弦冲突", { harmony: "iv6/4 i6/2 V6/4" }],
      ["到达属和弦的标签转位错误", { harmony: "iv6/4 IV6/2 V/4" }],
      ["标签在音高正确时仍明确与小下属六和弦冲突", { harmony: "VI/4 IV6/2 V6/4" }],
      ["伴随音破坏大下属和弦", { alto: "Eb4/4 Eb4/2 A4/4" }],
      ["四声部缺少男高", { tenor: "empty" }],
      ["轨道 ID 为 bass 但 voice 并非低音", { solo: true, bassDeclaredAsTenor: true }],
      ["没有后继", { bass: "Eb3/4 E3/2 r/4", solo: true }],
      ["隔休止后才到导音", { bass: "Eb3/4 E3/4 r/4 F#3/4", solo: true }],
      ["后继错八度", { bass: "Eb3/4 E3/2 F#4/4", solo: true }],
      ["音阶缺少本调关系", { key: "D minor", solo: true }],
      ["源音内部有句界", { solo: true, boundary: 0.5 }],
      ["到达导音处有句界", { solo: true, boundary: 3 }],
    ] satisfies [string, Example][])("%s 时低音半音不报 B.3", (_label, example) => {
      expect(warnings(example)).toHaveLength(0);
    });

    it("直接上行增二度仍报 B.3", () => {
      expect(warnings({ bass: "Eb3/4 F#3/2 r/4", solo: true })).toEqual([
        expect.objectContaining({ severity: "warning", voiceIds: ["bass"], params: expect.objectContaining({ intervalNumber: 2 }) }),
      ]);
    });
  });
});

describe("小三音升为局部属导音时的旋律增一度", () => {
  const raisedTriad = `satb 1
key D minor
meter 2/4
bars 1..2 {
  S: | F4/4. F#4/8 | G4/2 |
  A: | D4/2~ | D4/2 |
  T: | A3/2 | G3/2 |
  B: | D3/2 | Bb2/2 |
}`;

  const raisedSeventh = raisedTriad.replace("D3/2 | Bb2/2", "C3/2 | Bb2/2");

  const raisedInBass = `satb 1
key D minor
meter 2/4
bars 1..2 {
  S: | C5/2 | Bb4/2 |
  A: | A4/2 | G4/2 |
  T: | D4/2~ | D4/2 |
  B: | F3/4. F#3/8 | G3/2 |
}`;

  const rule = "melody.augmented-interval";

  function labelled(score: string, harmony: string) {
    return compileScoreText(score.replace(/\}$/, `  H: ${harmony}\n}`)).project;
  }

  function warningsAtRaise(score: string, harmony?: string) {
    const project = harmony ? labelled(score, harmony) : compileScoreText(score).project;
    const input = harmony ? project : applyHarmonyInference(project, { chordInference: inferChords(project) }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
    return warningsAt(input, 1.5);
  }

  function warningsAt(project: ReturnType<typeof labelled>, quarters: number) {
    const result = checkHarmony(project, undefined, {}, { [rule]: { "same-harmony": "strict" } });
    expect(result.skippedRuleIds).not.toContain(rule);
    return result.diagnostics.filter(diagnostic => diagnostic.ruleId === rule &&
      diagnostic.tick === project.ppq * quarters).flatMap(diagnostic => diagnostic.voiceIds);
  }

  describe("小三音升为局部属的导音", () => {
    it.each([
      ["N039 的三和弦", raisedTriad, "| i/4. V/IV/8 | iv6/2 |"],
      ["N039 的七和弦", raisedSeventh, "| i42/4. V42/IV/8 | iv6/2 |"],
      ["N071 的低音", raisedInBass, "| i65/4. V65/IV/8 | iv/2 |"],
    ])("%s 在两入口通过", (_name, score, harmony) => {
      expect(warningsAtRaise(score)).toEqual([]);
      expect(warningsAtRaise(score, harmony)).toEqual([]);
    });

    it("七音错八度时低音入音无 B.3，仍查标明的七音义务", () => {
      const wrong = raisedInBass.replace("Bb4/2", "Bb5/2");
      expect(warningsAtRaise(wrong)).toEqual([]);
      const harmony = "| i65/4. V65/IV/8 | iv/2 |";
      expect(warningsAtRaise(wrong, harmony)).toEqual([]);
      const project = labelled(wrong, harmony);
      expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
        ruleId: "resolution.chord-seventh", tick: 2 * project.ppq, voiceIds: ["soprano"],
      }));
    });

    it("导音错八度时仍查标明的导音义务", () => {
      const wrong = raisedSeventh.replace("G4/2", "G5/2");
      expect(warningsAtRaise(wrong)).toEqual([]);
      const harmony = "| i42/4. V42/IV/8 | iv6/2 |";
      expect(warningsAtRaise(wrong, harmony)).toEqual([]);
      const project = labelled(wrong, harmony);
      expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
        ruleId: "resolution.leading-tone", tick: 2 * project.ppq, voiceIds: ["soprano"],
      }));
    });

    it("从标签的局部调取目标拼写并拒绝改根后指向另一调的标签", () => {
      const score = `satb 1
key C major
meter 3/4
bars 1..2 {
  S: | Gb4/4 G4/2 | Ab4/2. |
  A: | Eb4/2.~ | Eb4/2. |
  T: | Bb3/2. | Ab3/2. |
  B: | Db3/2. | C3/2. |
}
annotations {
  chord middle range=[1:2,2:1) MIDDLE
  chord target range=[2:1,3:1) symbol=I6 localKey="Ab major"
}`;
      const project = (label: string) => compileScoreText(score.replace("MIDDLE", label)).project;
      expect(warningsAt(project('symbol=V42 localKey="Ab major"'), 1)).toEqual([]);
      expect(warningsAt(project('symbol=V42/VI localKey="C minor"'), 1)).toEqual([]);
      expect(warningsAt(project("symbol=bV42/VI"), 1)).toEqual([]);
    });
  });
});

describe("进入重属导七改记七音的减三度", () => {
  // Constructed in compound meter. The tenor approaches the cadential third.
  // In first inversion the bass stays on F while the soprano raises Db to D.
  const firstInversion = `satb 1
key Ab major
meter 6/8
bars 1..2 {
 S: | Db5/4. D5/8 Eb5/4 | Db5/2. |
 A: | Ab4/2. | G4/2. |
 T: | Db4/4. B3/8 C4/4 | Bb3/2. |
 B: | F3/2 Eb3/4 | Eb3/2. |
}
annotations {
 chord prep range=[1:1,1:4) symbol=S6
 chord leading range=[1:4,1:5) symbol=viio65/V
 chord cadence range=[1:5,2:1) symbol=K46
 chord dominant range=[2:1,3:1) symbol=D7
}`;

  // Here the soprano holds the common tonic throughout. The alto and tenor
  // resolve in contrary motion at the barline, after the new bass has sounded.
  const earlyBass = `satb 1
key Ab major
meter 6/8
bars 1..2 {
 S: | Ab4/2.~ | Ab4/4. G4/4. |
 A: | F4/4. F4/4. | Eb4/4. Db4/4. |
 T: | Db4/4. B3/4. | C4/4. Bb3/4. |
 B: | Db3/4. D3/4 Eb3/8~ | Eb3/4. Eb3/4. |
}
annotations {
 chord prep range=[1:1,1:4) symbol=S
 chord leading range=[1:4,1:6) symbol=viio7/V
 chord cadence range=[1:6,2:4) symbol=K46
 chord dominant range=[2:4,3:1) symbol=D7
}`;

  const rule = "melody.diminished-interval";
  function edit(score: string, from: string, to: string) {
    expect(score.split(from)).toHaveLength(2);
    return score.replace(from, to);
  }

  function tenorWarning(score: string, boundary?: number) {
    const project = compileScoreText(score).project;
    if (boundary !== undefined) project.structure.phraseBoundaries.push({
      id: "cut", tick: boundary, source: "manual", confidence: "certain",
    });
    const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    const matches = (d: { ruleId: string; tick: number; voiceIds: readonly string[] }) =>
      d.ruleId === rule && d.tick === 1440 && d.voiceIds.includes("tenor");
    const strict = { [rule]: { "same-harmony": "strict", arpeggiation: "strict" } } as const;
    return [
      diminishedIntervalRule(context).some(matches),
      checkHarmony(project, undefined, {}, strict).diagnostics.some(matches),
    ];
  }

  describe("男高以下行减三度进入重属导七的改记七音", () => {
    it.each([
      ["第一转位，由女高升四级和男高升二级同步解决", firstInversion],
      ["原位，低音先到，两个内声在小节线处实际解决", earlyBass],
      ["终止四六从上方实际解决时标起", edit(earlyBass, "cadence range=[1:6", "cadence range=[2:1")],
      ["中间标签空缺，四部仍完整", edit(firstInversion, " chord leading range=[1:4,1:5) symbol=viio65/V\n", "")],
      ["显式局部大调", edit(firstInversion, "key Ab major", "key F minor")
        .replaceAll(/symbol=(\S+)/g, 'symbol=$1 localKey="Ab major"')],
    ])("%s", (_, score) => expect(tenorWarning(score)).toEqual([false, false]));

    it.each([
      ["男高在低音到达时重奏升二级", edit(earlyBass, "B3/4.", "B3/4 B3/8")],
      ["女低在低音到达时重奏六级", edit(earlyBass, "F4/4. F4/4.", "F4/4. F4/4 F4/8")],
      ["提前的低音是另一音", edit(earlyBass, "Eb3/8~", "F3/8")],
      ["低音在上方解决时换八度", edit(earlyBass, "Eb3/8~ | Eb3/4.", "Eb3/8 | Eb2/4.")],
      ["第一转位的导音从异音区跳入", edit(firstInversion, "Db5/4.", "Db6/4.")],
      ["第一转位的导音没有到属音", edit(firstInversion, "D5/8 Eb5/4", "D5/8 C5/4")],
      ["延迟解决的女低转向三音", edit(earlyBass, "Eb4/4. Db4/4.", "C4/4. Db4/4.")],
      ["男高改到另一音区", edit(firstInversion, "C4/4 |", "C5/4 |")],
      ["同样落在主四六，标作普通转位", edit(firstInversion, "symbol=K46", "symbol=I64")],
      ["终止功能留空", edit(firstInversion, " chord cadence range=[1:5,2:1) symbol=K46\n", "")],
      ["降六低音与升四位于不同声部，构成异名增六", edit(
        edit(earlyBass, "Db3/4. D3/4", "Db3/4. Fb3/4"), "F4/4. F4/4.", "F4/4. D4/4.")],
      ["中段明确标记半减七", edit(firstInversion, "viio65/V", "viiø65/V")],
      ["低音先到期间另换属七", edit(earlyBass, "cadence range=[1:6",
        "intervening range=[1:6,2:1) symbol=D7\n chord cadence range=[2:1")],
      ["终点换调", edit(firstInversion, "symbol=K46", 'symbol=K46 localKey="Eb major"')],
      ["改记七音有显式外音角色", edit(earlyBass, " chord prep", " note T@1:4 role=passing\n chord prep")],
    ])("%s 时保留减三度警告", (_, score) => expect(tenorWarning(score)).toEqual([true, true]));

    it.each([1440, 2400, 2880])("句界 %i 隔开进入、低音先到或上方解决", tick => {
      expect(tenorWarning(earlyBass, tick)).toEqual([true, true]);
    });
  });
});

describe("小调升三音的低音半音经过", () => {
  interface Example {
    key?: string;
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    harmony?: string;
    onset?: number;
    boundary?: number;
    keyDetour?: boolean;
    changeMiddleLabelKey?: boolean;
  }

  function warnings({
    key = "G minor", soprano = "D5/4 Eb5/2", alto = "G4/2.", tenor = "D4/4 C4/2",
    bass = "Bb2/8 B2/8 C3/2", harmony, onset = 0.5, boundary, keyDetour, changeMiddleLabelKey,
  }: Example = {}) {
    const { project } = compileScoreText(`satb 1
key ${key}
meter 3/4
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
    if (keyDetour) project.keyEvents.push(
      { id: "detour", tick: project.ppq / 4, tonic: { step: "C", alter: 0 }, mode: "minor" },
      { id: "return", tick: project.ppq / 2, tonic: { step: "G", alter: 0 }, mode: "minor" },
    );
    if (changeMiddleLabelKey) {
      const middle = project.chordTrack.regions[1];
      const secondHalf = structuredClone(middle);
      secondHalf.id = "middle-label-detour";
      secondHalf.startTick += project.ppq / 4;
      secondHalf.durationTicks /= 2;
      secondHalf.semantics!.interpretations[0].localKey = { tonic: { step: "D", alter: 0 }, mode: "minor" };
      middle.durationTicks /= 2;
      project.chordTrack.regions.splice(2, 0, secondHalf);
    }
    return checkHarmony(project, undefined, {}, {
      "melody.augmented-interval": { "same-harmony": "strict" },
    }).diagnostics.filter(item =>
      item.ruleId === "melody.augmented-interval" && item.voiceIds.includes("bass") &&
      item.tick === onset * project.ppq);
  }

  describe("小调低音升三音半音经过到下属", () => {
    it.each([
      ["裸四声部", {}],
      ["单列大主和弦第一转位", { harmony: "i6/8 I6/8 iv/2" }],
      ["持续小主和弦覆盖弱分拍", { harmony: "i6/4 iv/2" }],
      ["明确副属标签", { harmony: "i6/8 V6/IV/8 iv/2" }],
      ["移至 D 小调", { key: "D minor", soprano: "A4/4 Bb4/2", alto: "D4/2.",
        tenor: "A3/4 G3/2", bass: "F2/8 F#2/8 G2/2", harmony: "i6/8 I6/8 iv/2" }],
    ] satisfies [string, Example][])("%s 时同声部半音经过无 B.3", (_label, example) => {
      expect(warnings(example)).toHaveLength(0);
    });

    it.each([
      ["上声部重奏原音", { soprano: "D5/8 D5/8 Eb5/2", harmony: "i6/8 I6/8 iv/2" }],
      ["上声部同时换音", { soprano: "D5/8 G5/8 Eb5/2" }],
      ["右端响成大下属", { soprano: "D5/4 E5/2" }],
      ["右端根音低音换八度", { bass: "Bb2/8 B2/8 C4/2" }],
      ["中间低音后缺后继", { bass: "Bb2/8 B2/8 r/2" }],
      ["经过后有休止", { bass: "Bb2/8 B2/8 r/8 C3/4." }],
      ["中间声部下穿名义低音", { tenor: "D2/4 C4/2" }],
      ["中间独立和弦标签冲突", { harmony: "i6/8 VI/8 iv/2" }],
      ["持续经过音内部出现另一局部调标签", { harmony: "i6/8 I6/8 iv/2", changeMiddleLabelKey: true }],
      ["右端标签与原位小下属冲突", { harmony: "i6/8 I6/8 i/2" }],
      ["经过音落在整拍", { bass: "Bb2/4 B2/8 C3/4.", soprano: "D5/4. Eb5/4.",
        tenor: "D4/4. C4/4.", onset: 1 }],
      ["第三音仍在同一分拍级别", { bass: "Bb2/16 B2/16 C3/8 C3/2", soprano: "D5/8 Eb5/8 Eb5/2",
        tenor: "D4/8 C4/8 C4/2", onset: 0.25 }],
      ["句界落在右端", { boundary: 1 }],
      ["两音之间暂时换调再返回", { keyDetour: true }],
    ] satisfies [string, Example][])("%s 时仍不从低音增一度推断错拼", (_label, example) => {
      expect(warnings(example)).toHaveLength(0);
    });
  });
});

describe("属三音至实写七音的减音程", () => {
  const score = `satb 1
key Bb major
meter 3/4
bars 1..1 {
 S: | A4/4 Eb5/4 D5/4 |
 A: | F4/2. |
 T: | C4/4 A3/4 Bb3/4 |
 B: | F2/4 C3/4 Bb2/4 |
 H: | V/4 V43/4 I/4 |
}`;

  const rule = "melody.diminished-interval";

  function warns(text: string, cut = false) {
    const { project } = compileScoreText(text);
    if (cut) project.structure.phraseBoundaries.push({
      id: "cut", tick: 2 * project.ppq, source: "manual", confidence: "certain",
    });
    return checkHarmony(project, { ...defaultHarmonyRuleSeverities(), "melody.tritone": "off" }, {}, {
      [rule]: { "same-harmony": "strict", arpeggiation: "strict" },
    }).diagnostics.some(item =>
      item.ruleId === rule && item.tick === project.ppq && item.voiceIds.includes("soprano"));
  }

  describe("从属三音跳进到实际引入的七音", () => {
    it("七音同声部下行解决时放行，裸谱也能核对四部", () => {
      expect(warns(score)).toBe(false);
      expect(warns(score.replace(/ H:.*\n/, ""))).toBe(false);
    });

    it.each([
      ["同向继续", score.replace("Eb5/4 D5/4", "Eb5/4 F5/4")],
      ["反向但跳三度", score.replace("Eb5/4 D5/4", "Eb5/4 C5/4")],
      ["有休止才解决", score.replace("Eb5/4", "Eb5/8 r/8")],
      ["虽折回但未构成主和弦", score.replace("Bb3/4", "C4/4")],
      ["进入的七和弦拼写不完整", score.replace("A3/4", "G3/4")],
      ["标签与实奏冲突", score.replace("V43/4", "V65/4")],
    ])("%s 时报告减五度", (_name, text) => expect(warns(text)).toBe(true));

    it("显式句界隔开落主时仍报告", () => expect(warns(score, true)).toBe(true));
  });
});

describe("进入属六的低音减五度", () => {
  const score = `satb 1
key D major
meter 3/4
bars 1..1 {
 S: | G4/4 A4/4 F#4/4 |
 A: | D4/4 E4/4 D4/4 |
 T: | B3/4 A3/4 A3/4 |
 B: | G3/4 C#3/4 D3/4 |
 H: | IV/4 V6/4 I/4 |
}`;
  function checks(text: string, boundary?: number) {
    const project = compileScoreText(text).project;
    if (boundary !== undefined) project.structure.phraseBoundaries.push({
      id: "manual", tick: boundary, source: "manual", confidence: "certain",
    });
    const c = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    return [...tritoneRule(c), ...diminishedIntervalRule(c)].filter(d =>
      d.tick === 960 && d.voiceIds.includes("bass")).map(d => d.ruleId);
  }
  const both = ["melody.tritone", "melody.diminished-interval"];

  describe("低音下跳减五度进入属六并在原声部解决", () => {
    it.each([
      ["manual", "IV/4 V6/4 I/4", "D3/4 Eb3/4", false],
      ["confirmed", "IV/4 V6/4 I/4", "D3/4 Eb3/4", false],
      ["inferred", "IV/4 V6/4 I/4", "D3/4 Eb3/4", true],
      ["manual", "IV/4 r/4 I/4", "D3/4 Eb3/4", true],
      ["manual", "IV/4 V6/4 I/4", "D4/4 Eb4/4", true],
    ] as const)("单线低音核验三处和声标注及解决方向 %s %s %s", (source, harmony, line, reported) => {
      const { project } = compileScoreText(`satb 1
key Eb major
meter 3/4
bars 1..1 {
 S: empty
 A: empty
 T: empty
 B: | Ab3/4 ${line} |
 H: | ${harmony} |
}`);
      for (const chord of project.chordTrack.regions) {
        for (const reading of chord.semantics!.interpretations) reading.source = source;
      }
      const result = checkHarmony(project).diagnostics.some(d =>
        d.ruleId === "melody.tritone" && d.tick === project.ppq && d.voiceIds.includes("bass"));
      expect(result).toBe(reported);
    });
    it("按实写 S–D6–T 放行，给定或缺标签均须有四部支持", () => {
      expect(checks(score)).toEqual([]);
      expect(checks(score.replace(/ H:.*\n/, ""))).toEqual([]);
    });
    it("接受第一转位的二级小三和弦作下属", () => {
      expect(checks(score.replace("G4/4", "E4/4").replace("D4/4 E4", "B3/4 E4")
        .replace("B3/4 A3", "G3/4 A3").replace("IV/4", "ii6/4"))).toEqual([]);
    });
    it.each([
      ["同音重奏", score.replace("C#3/4 D3/4", "C#3/4 C#3/4")],
      ["错误音区", score.replace("C#3/4 D3/4", "C#3/4 D4/4")],
      ["导音后休止", score.replace("C#3/4", "C#3/8 r/8")],
      ["属六含外音", score.replace("D4/4 E4/4", "D4/4 F4/4")],
      ["低音保持时中途变和声", score.replace("D4/4 E4/4", "D4/4 E4/8 F4/8")],
      ["标签与实音冲突", score.replace("V6/4", "V65/4")],
      ["落点并非主三", score.replace("A4/4 F#4/4", "A4/4 G4/4")],
    ])("%s 时保留两个底层音程报告", (_, text) => expect(checks(text)).toEqual(both));
    it("进入或解决时跨句均保留警告", () => {
      expect(checks(score, 960)).toEqual(both);
      expect(checks(score, 1920)).toEqual(both);
    });
    it("低音反向改成上跳增四并继续上行，仍有 B.5", () => {
      expect(checks(score.replace("C#3/4 D3/4", "C#4/4 D4/4"))).toContain("melody.tritone");
    });
  });
});

describe("下属七至重属的低音半音引入", () => {
  const exercise = `satb 1
key C minor
meter 6/8
bars 1..2 {
 S: | C5/4. A4/4. | G4/4. F4/4. |
 A: | Eb4/4. D4/4. | Eb4/4. D4/4. |
 T: | A3/2. | C4/4. B3/4. |
 B: | F3/8 F#3/8~ F#3/2 | G3/2. |
}
annotations {
 chord v range=[2:4,3:1) symbol=V7
}`;
  const nameChain = ` chord dd range=[1:2,1:4) symbol=viio7/V
 chord dd6 range=[1:4,2:1) symbol=V6/V
 chord k range=[2:1,2:4) symbol=K46
`;
  const named = exercise.replace(" chord v", nameChain + " chord v");
  const rule = "melody.augmented-interval";
  function result(input: string | ProjectDocument, boundary?: number, voice = "bass", tick = 480) {
    const project = typeof input === "string" ? compileScoreText(input).project : input;
    if (boundary !== undefined) project.structure.phraseBoundaries.push({
      id: "cut", tick: boundary, source: "manual", confidence: "certain",
    });
    const rules = createHarmonyRuleContext(buildHarmonyAnalysis(project));
    const atEntry = (d: {ruleId: string; tick: number; voiceIds: readonly string[]}) =>
      d.ruleId === rule && d.tick === tick && d.voiceIds.includes(voice);
    return [
      augmentedIntervalRule(rules).some(atEntry),
      checkHarmony(project, undefined, {}, { [rule]: { "same-harmony": "strict", arpeggiation: "strict" } }).diagnostics.some(atEntry),
    ];
  }

  describe("bass raises the subdominant seventh's root into a sustained leading tone of V", () => {
    it.each([exercise, named])("accepts complete written DD sonorities and their real dominant", text => {
      expect(result(text)).toEqual([false, false]);
    });
    it("accepts the direct dominant route", () => {
      const text = named.replace("Eb4/4. D4/4. |\n T:", "D4/4. D4/4. |\n T:")
        .replace("C4/4. B3/4.", "B3/4. B3/4.").replace("symbol=K46", "symbol=V");
      expect(result(text)).toEqual([false, false]);
    });
    it.each([
      ["upper voice reattacks at the bass alteration", exercise.replace("C5/4.", "C5/8 C5/4")],
      ["actual chord member missing under a DD label", named.replace("A4/4. |", "B4/4. |")],
      ["a new bass note interrupts the held chain", named.replace("F#3/8~ F#3/2", "F#3/8 F#3/2")],
      ["bass resolves in another register", exercise.replace("G3/2.", "G2/2.")],
      ["bass fails to reach V", exercise.replace("G3/2.", "A3/2.")],
      ["cadential sonority lacks its third", exercise.replace("| Eb4/4. D4/4. |\n T:", "| G4/4. D4/4. |\n T:")],
      ["dominant missing after an apparent six-four", exercise.replace("F4/4. |", "Eb4/4. |")],
      ["conflicting internal target", named.replace("V6/V", "V6/II")],
      ["ordinary tonic inversion", named.replace("symbol=K46", "symbol=i64")],
      ["named dominant in a conflicting key", exercise.replace("symbol=V7", 'symbol=V7 localKey="F minor"')],
      ["explicit nonchord role", named.replace(" chord dd range", " note B@1:2 role=passing\n chord dd range")],
    ])("%s leaves the bass semitone free of B.3", (_, text) => expect(result(text)).toEqual([false, false]));
    it("still reports a soprano augmented fourth inside a proven bass chain", () => {
      const withUpperLeap = named.replace("C5/4. A4/4.", "C5/4. F#5/4.");
      expect(result(withUpperLeap)).toEqual([false, false]);
      // The display groups the raw augmented fourth under the more specific tritone rule.
      expect(result(withUpperLeap, undefined, "soprano", 1440)).toEqual([true, false]);
      expect(checkHarmony(compileScoreText(withUpperLeap).project).diagnostics).toContainEqual(expect.objectContaining({
        ruleId: "melody.tritone", tick: 1440, voiceIds: ["soprano"], severity: "warning",
      }));
    });
    it("also checks the eventual arrival when the preparation is explicitly named", () => {
      const full = named.replace(" chord dd range", " chord prep range=[1:1,1:2) symbol=IV7\n chord dd range");
      // Roman IV7 compiles to major7. The project can also explicitly encode
      // the major triad with minor seventh that is written in these four parts.
      expect(result(full)).toEqual([false, false]);
      for (const score of [full, full.replace("G3/2.", "G2/2.")]) {
        const project = compileScoreText(score).project;
        const chord = project.chordTrack.regions[0].identity.structure;
        if (chord.kind !== "tertian") throw new Error("Expected a tertian chord");
        chord.quality = "dominant7";
        expect(result(project)).toEqual([false, false]);
      }
    });
    it.each([480, 1440, 2880, 4320])("does not report B.3 at a bass semitone around phrase boundary %i", cut => {
      expect(result(named, cut)).toEqual([false, false]);
    });
  });
});

describe("实奏属和弦解决与旋律半音拼写", () => {
  const ruleId = "melody.augmented-interval";
  const spelling = {
    severity: "warning", messageKey: ruleId + ".structural-spelling", message: expect.stringContaining("C♯"),
  };

  interface Annotation {
    source: HarmonyInterpretation["source"];
    locked: boolean;
    absoluteOnly?: boolean;
    trackLocked?: boolean;
    conflict?: "middle" | "enharmonic-goal";
  }

  function identity(root: string, bass: string, quality: ChordQuality): ChordIdentity {
    return {
      root: parsePitchClass(root)!, bass: parsePitchClass(bass)!,
      structure: { kind: "tertian", quality, extensions: [], alterations: [] },
    };
  }

  interface RoleMark {
    voice: VoiceId;
    tick: number;
    role: NonChordToneRole;
  }

  function entry(
    middle = "C#4", soprano = "A4", annotation?: Annotation, landingBass = "F3", mark?: RoleMark,
  ) {
    const score = [
      "satb 1", "key D minor", "meter 3/4", "bars 1..1 {",
      " S: | A4/2 " + soprano + "/4 |",
      " A: | F4/4 E4/4 F4/4 |",
      " T: | C4/4 " + middle + "/4 D4/4 |",
      " B: | A3/4 G3/4 " + landingBass + "/4 |",
      ...(annotation ? [" H: | i/4 iv/4 V/4 |"] : []),
      "}",
    ].join("\n");
    const { project } = compileScoreText(score);
    if (annotation) {
      project.chordTrack.locked = annotation.trackLocked ?? false;
      const identities = [identity("F:0", "A:0", "major"), identity("A:0", "G:0", "dominant7"), identity("D:0", "F:0", "minor")];
      if (annotation.conflict === "middle") identities[1] = identity("B:-1", "D:0", "major");
      if (annotation.conflict === "enharmonic-goal") identities[2] = identity("E:-2", "G:-2", "minor");
      for (const [index, chord] of project.chordTrack.regions.entries()) {
        chord.identity = identities[index];
        chord.locked = annotation.locked;
        // Keep the deliberately unrelated functional labels; the absolute identities above carry the declaration.
        if (annotation.absoluteOnly) delete chord.semantics;
        else for (const reading of chord.semantics!.interpretations) reading.source = annotation.source;
      }
    }
    if (mark) markRole(project, mark);
    return checkHarmony(project).diagnostics.filter(d =>
      d.messageKey === spelling.messageKey && d.tick === project.ppq && d.voiceIds.includes("tenor"));
  }

  function markRole(project: ReturnType<typeof compileScoreText>["project"], mark: RoleMark) {
    const track = project.satbTracks.find(track => track.voice === mark.voice)!;
    const note = track.notes.find(note => note.startTick === mark.tick)!;
    note.nonChordToneRole = mark.role;
  }

  describe("Structural spelling from written dominant resolution", () => {
    it("reads spelling from the played four parts without annotations", () => {
      expect(entry()).toEqual([]);
      expect(entry("Db4")).toMatchObject([spelling]);
    });

    it.each([
      { source: "inferred", locked: false },
      { source: "inferred", locked: false, trackLocked: true },
      { source: "inferred", locked: false, absoluteOnly: true },
      { source: "manual", locked: false },
      { source: "inferred", locked: true },
      { source: "manual", locked: true },
      { source: "confirmed", locked: false },
    ] satisfies Annotation[])("uses the same spelling with an identical absolute identity: %o", annotation => {
      expect(entry("C#4", "A4", annotation)).toEqual([]);
      expect(entry("Db4", "A4", annotation)).toMatchObject([spelling]);
    });

    it.each([
      { source: "manual", locked: false, conflict: "middle" },
      { source: "inferred", locked: false, trackLocked: true, conflict: "middle" },
      { source: "inferred", locked: false, absoluteOnly: true, conflict: "middle" },
      { source: "inferred", locked: true, conflict: "middle" },
      { source: "manual", locked: false, conflict: "enharmonic-goal" },
    ] satisfies Annotation[])("withholds a correction when an explicit written identity conflicts: %o", annotation => {
      expect(entry("Db4", "A4", annotation)).toEqual([]);
    });

    it("ignores an unlocked inferred identity that contradicts the performed one", () => {
      const inferred = { source: "inferred", locked: false, conflict: "middle" } as const;
      expect(entry("C#4", "A4", inferred)).toEqual([]);
      expect(entry("Db4", "A4", inferred)).toMatchObject([spelling]);
    });

    it("withholds the correction for a diminished landing even if a manual tonic is given", () => {
      expect(entry("Db4", "Ab4")).toEqual([]);
      expect(entry("Db4", "Ab4", { source: "manual", locked: false })).toEqual([]);
    });

    it("withholds the correction if the seventh reaches the tonic third in the wrong octave", () => {
      expect(entry("Db4", "A4", undefined, "F2")).toEqual([]);
    });

    it.each([
      { voice: "tenor", tick: 0, role: "passing" },
      { voice: "tenor", tick: 960, role: "neighbor" },
      { voice: "tenor", tick: 1920, role: "suspension" },
      { voice: "bass", tick: 960, role: "anticipation" },
    ] satisfies RoleMark[])("withholds the correction if a required note has an ornamental role: %o", mark => {
      expect(entry("Db4", "A4", undefined, "F3", mark)).toEqual([]);
    });

    it("still reads the spelling if a redundant goal note in another voice has an ornamental role", () => {
      const mark = { voice: "alto", tick: 1920, role: "other" } as const;
      expect(entry("C#4", "A4", undefined, "F3", mark)).toEqual([]);
      expect(entry("Db4", "A4", undefined, "F3", mark)).toMatchObject([spelling]);
    });

    it("can establish the goal without a redundant following note in the inspected voice", () => {
      const { project } = compileScoreText([
        "satb 1", "key E major", "meter 3/4", "bars 1..1 {",
        " S: | C#5/4 B4/4 E5/4 |", " A: | E#4/4 E4/4 E4/4 |",
        " T: | G#3/2 A3/4 |", " B: | C#3/4 D3/4 C#3/4 |", "}",
      ].join("\n"));
      markRole(project, { voice: "alto", tick: 1920, role: "other" });
      expect(checkHarmony(project).diagnostics.some(d =>
        d.ruleId === ruleId && d.tick === project.ppq && d.voiceIds.includes("alto"))).toBe(false);
    });

    it.each([1920, 2400])("uses the early seventh to prove an enharmonic correction before the tonic onset: %s", tick => {
      const { project } = compileScoreText([
        "satb 1", "key C minor", "meter 4/4", "bars 1..1 {",
        " S: | C5/4 Bb4/8 C5/8 Bb4/8 A4/8 A4/4 |", " A: | G4/2. F#4/4 |",
        " T: | D#4/4 E4/2 D4/4 |", " B: | C3/4 C#3/2 D3/4 |", "}",
      ].join("\n"));
      const warns = () => checkHarmony(project).diagnostics.some(d =>
        d.ruleId === ruleId && d.tick === project.ppq && d.voiceIds.includes("tenor"));
      expect(warns()).toBe(true);
      markRole(project, { voice: "soprano", tick, role: "neighbor" });
      expect(warns()).toBe(false);
    });

    it("does not respell an ornamental lower neighbor as the minor third of a stationary chord", () => {
      const score = [
        "satb 1", "key Bb minor", "meter 4/4", "bars 1..1 {",
        " S: | F5/1 |",
        " A: | A4/4 G#4/4 A4/4 Bb4/4 |",
        " T: | C4/2. Bb3/4 |",
        " B: | F3/2 Eb3/4 Db3/4 |",
        "}",
      ].join("\n");
      const { project } = compileScoreText(score);
      expect(checkHarmony(project).diagnostics.some(d =>
        d.ruleId === ruleId && d.tick === project.ppq * 2 && d.voiceIds.includes("alto"))).toBe(false);
    });
  });
});

describe("重属改写至终止四六的旋律增一度", () => {
  const approach = `satb 1
key F major
meter 2/4
bars 1..3 {
  S: | F5/8 G5/8 G#5/4 | A5/4 G5/4 | F5/2 |
  A: | F4/2 | F4/4 E4/4 | F4/2 |
  T: | Bb3/4 B3/4 | C4/2 | A3/2 |
  B: | D3/2 | C3/2 | F3/2 |
}
`;

  function warningVoices(project: ReturnType<typeof compileScoreText>["project"]) {
    return checkHarmony(project).diagnostics.filter(item =>
      item.tick === PPQ && item.ruleId === "melody.augmented-interval").flatMap(item => item.voiceIds).sort();
  }

  function compile(text: string) {
    const { project } = compileScoreText(text);
    const applied = applyHarmonyInference(project, inferHarmony(project), { mode: "fill-gaps" }).project;
    // A normal given-harmony check may have a gap at the incoming reduced seventh.
    applied.chordTrack.regions = applied.chordTrack.regions.filter(region => region.startTick !== PPQ);
    return applied;
  }

  describe("大调重属改写到完整终止四六的同声部增一度", () => {
    it("不开中间和弦标签也能凭实写升II、升IV和后接属识别合法解决", () => {
      const score = compile(approach);
      expect(score.chordTrack.regions.some(region => region.startTick === PPQ)).toBe(false);
      expect(warningVoices(score)).toEqual([]);
    });

    it.each([
      ["四部仍拼出 K46，但升IV进了和弦三音", approach.replace("C4/2", "A3/4 C4/4")],
      ["后继四部没有实写属导音", approach.replace("F4/4 E4/4", "F4/4 F4/4")],
    ])("%s 时两个半音入音均无 B.3", (_description, score) => {
      expect(warningVoices(compile(score))).toEqual([]);
    });

    it("普通四六标签也不导致半音入音报警", () => {
      const score = compile(approach);
      const landing = score.chordTrack.regions.find(region => region.startTick === 2 * PPQ)!;
      landing.semantics = undefined;
      expect(warningVoices(score)).toEqual([]);
    });

    it("局部调冲突或句界不构成半音入音的报错证据", () => {
      const conflict = compile(approach);
      const prep = conflict.chordTrack.regions.find(region => region.startTick === PPQ / 2)!;
      prep.semantics = { ...prep.semantics!, interpretations: prep.semantics!.interpretations.map(reading => ({
        ...reading, localKey: { tonic: { step: "B", alter: -1 }, mode: "major" },
      })) };
      expect(warningVoices(conflict)).toEqual([]);
      const cut = compile(approach);
      cut.structure.phraseBoundaries.push({ id: "cut", tick: 2*PPQ, source: "manual", confidence: "certain" });
      expect(warningVoices(cut)).toEqual([]);
    });
  });
});

describe("大调二级半减七降五音的旋律拼写", () => {
  const ruleId = "melody.augmented-interval";
  const spelling = { messageKey: ruleId + ".structural-spelling", message: expect.stringContaining("B♭") };

  function projectFor(entry = "Bb4", goalSeventh = "C#4") {
    return compileScoreText([
      "satb 1", "key D major", "meter 3/4", "bars 1..1 {",
      " S: | B4/4 " + entry + "/4 A4/4 |", " A: | G4/4 G4/4 E4/4 |",
      " T: | D4/2 " + goalSeventh + "/4 |", " B: | G3/4 E3/4 A3/4 |",
      " H: | IV/4 iiø7/4 V/4 |", "}",
    ].join("\n")).project;
  }

  function focus(project: ReturnType<typeof projectFor>) {
    return checkHarmony(project).diagnostics.filter(d =>
      d.ruleId === ruleId && d.tick === project.ppq && d.voiceIds.includes("soprano"));
  }

  describe("Written resolution of the major-mode lowered fifth of iiø7", () => {
    it("holds for bare score, matching manual labels, and a matching locked track", () => {
      for (const spellingAtEntry of ["Bb4", "A#4"]) {
        const expected = spellingAtEntry === "Bb4" ? [] : [spelling];
        const project = projectFor(spellingAtEntry);
        expect(focus(project)).toMatchObject(expected);
        project.chordTrack.locked = true;
        expect(focus(project)).toMatchObject(expected);
        project.chordTrack.regions = [];
        expect(focus(project)).toMatchObject(expected);
      }
    });

    it("still uses a fully supported preparation with a marked redundant root", () => {
      const project = projectFor();
      project.satbTracks.find(track => track.voice === "alto")!.notes[0].nonChordToneRole = "other";
      expect(focus(project)).toEqual([]);
    });

    it("recovers the same lowered degree after transposition", () => {
      const { project } = compileScoreText([
        "satb 1", "key Bb major", "meter 3/4", "bars 1..1 {",
        " S: | G4/4 F#4/4 F4/4 |", " A: | Eb4/2 C4/4 |",
        " T: | Bb3/2 A3/4 |", " B: | Eb3/4 C3/4 F3/4 |", "}",
      ].join("\n"));
      expect(focus(project)).toMatchObject([
        { messageKey: ruleId + ".structural-spelling", message: expect.stringContaining("G♭") },
      ]);
    });
    it.each([1, 2])("retains the proof when the same key is restated at beat %i", beat => {
      const project = projectFor("A#4");
      project.chordTrack.regions = [];
      project.keyEvents.push({ ...project.keyEvents[0], id: "restated", tick: beat * project.ppq });
      expect(focus(project)).toMatchObject([spelling]);
    });

    it("rejects a temporary change within the altered note, before the resolution", () => {
      const project = projectFor("A#4");
      project.chordTrack.regions = [];
      const startKey = project.keyEvents[0];
      project.keyEvents.push(
        { ...startKey, id: "detour", tick: project.ppq * 1.5, tonic: { step: "C", alter: 0 } },
        { ...startKey, id: "return", tick: project.ppq * 2 },
      );
      expect(focus(project)).not.toContainEqual(expect.objectContaining({ messageKey: spelling.messageKey }));
    });

    it("does not use an octave displacement as the seventh's resolution", () => {
      const project = projectFor("A#4", "C#5");
      project.chordTrack.regions = [];
      expect(focus(project)).not.toContainEqual(expect.objectContaining({ messageKey: spelling.messageKey }));
    });

    it("falls back when a manual or whole-track locked identity conflicts", () => {
      const project = projectFor("A#4");
      project.chordTrack.regions[1].identity = structuredClone(project.chordTrack.regions[0].identity);
      expect(focus(project)).not.toContainEqual(expect.objectContaining({ messageKey: spelling.messageKey }));
      for (const region of project.chordTrack.regions) {
        for (const reading of region.semantics!.interpretations) reading.source = "inferred";
      }
      expect(focus(project)).toMatchObject([spelling]);
      project.chordTrack.locked = true;
      expect(focus(project)).not.toContainEqual(expect.objectContaining({ messageKey: spelling.messageKey }));
    });

    it("does not infer through a marked entering note or an ornamental seventh resolution", () => {
      const entry = projectFor("A#4");
      entry.satbTracks.find(track => track.voice === "soprano")!.notes[1].nonChordToneRole = "passing";
      expect(focus(entry)).not.toContainEqual(expect.objectContaining({ messageKey: spelling.messageKey }));
      const seventh = projectFor("A#4");
      seventh.satbTracks.find(track => track.voice === "tenor")!.notes[1].nonChordToneRole = "suspension";
      expect(focus(seventh)).not.toContainEqual(expect.objectContaining({ messageKey: spelling.messageKey }));
    });
  });
});
