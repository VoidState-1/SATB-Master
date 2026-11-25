import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../../../../project";
import { compileScoreText } from "../../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../../inference";
import { checkHarmony } from "../../../registry";

describe("外音解决必须连续", () => {
  const cases = [
    ["neighbor", "neighbor-tone", "E5", "F5", "E5", "I/1"],
    ["appoggiatura", "appoggiatura", "C5", "F5", "E5", "I/1"],
    ["suspension", "suspension-resolution", "F5", "F5", "E5", "V7/2 I/2"],
    ["retardation", "retardation", "B4", "B4", "C5", "V/2 I/2"],
  ] as const;
  describe.each(cases)("%s", (role, rule, before, ornament, after, harmony) => {
    function findings(tail: string, accompaniment = "empty") {
      const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${before}/2 ${ornament}${tail} |
 A: ${accompaniment}
 T: empty
 B: empty
 H: | ${harmony} |
}
annotations {
 note x role=${role}
}`);
      return checkHarmony(project).diagnostics.filter(d => d.ruleId === `nonchord.${rule}`);
    }
    it("接受同一声部的连续落点", () => expect(findings(`/8@x ${after}/4.`)).toEqual([]));
    it("拒绝休止后的同一落点", () => expect(findings(`/8@x r/8 ${after}/4`)).toHaveLength(1));
    it("无后继起音，但休止期间另一声部仍在发声", () => {
      expect(findings("/8@x r/4.", "| G4/1 |")).toHaveLength(1);
    });
    it("不将尚未写完的末尾视为休止", () => expect(findings("/2@x")).toEqual([]));
  });
});

describe("先现的提前时值和目标上的保持时值", () => {
  function findings(soprano: string, harmony = "V/2. I/4") {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${soprano} |
 A: empty
 T: empty
 B: empty
 H: | ${harmony} |
}
annotations {
 note ant role=anticipation
}`);
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === "nonchord.anticipation");
  }

  it("接受弱位短先现及目标和弦上的重奏", () => {
    expect(findings("B4/2 B4/8 C5/8@ant C5/4")).toEqual([]);
  });
  it("接受总音值超过一拍、但提前部分仅为半拍的跨界保持", () => {
    expect(findings("B4/2 B4/8 C5/4.@ant")).toEqual([]);
  });
  it("拒绝强拍上的短先现", () => {
    expect(findings("B4/2 C5/8@ant C5/4.", "V/2 V/8 I/4.")).toHaveLength(1);
  });
  it("拒绝弱拍上超过一拍的提前", () => {
    expect(findings("B4/4 C5/4.@ant C5/4.", "V/2 V/8 I/4.")).toHaveLength(1);
  });
  it("不足提前时值的目标重奏不能冒充结构落点", () => {
    expect(findings("B4/2 B4/8 C5/8@ant C5/16 E5/8.")).toHaveLength(1);
  });
  it("不把继续延入第三个和弦的时值计入目标上的保持", () => {
    expect(findings("B4/2 B4/8 C5/4.@ant", "V/2. I/16 vi/8.")).toHaveLength(1);
  });
});

describe("自然与半音经过链", () => {
  function findings(melody: string, harmony: string, roles: readonly string[], key = "C major", cut?: number) {
    const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
 S: | ${melody} |
 A: empty
 T: empty
 B: empty
 H: | ${harmony} |
}
annotations {
 ${roles.map(id => "note " + id + " role=passing").join("\n ")}
}`);
    if (cut !== undefined) project.structure.phraseBoundaries.push({
      id: "cut", tick: cut * project.ppq, source: "manual", confidence: "certain",
    });
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === "nonchord.passing-tone");
  }

  it.each([
    ["上行半音", "C5/2 C#5/4@p D5/4", "I/2. V/4", ["p"], "C major"],
    ["下行半音", "A4/2 G#4/4@p G4/4", "IV/2. I/4", ["p"], "C major"],
    ["重升经过", "F#4/2 F##4/4@p G#4/4", "V/2. vi/4", ["p"], "B major"],
    ["两个自然经过音", "D#5/2 E#5/8@p F##5/8@q G#5/4", "V/2. I/4", ["p", "q"], "E major"],
    ["两个半音阶经过音", "Eb5/2 D5/8@p Db5/8@q C5/4", "i/1", ["p", "q"], "C minor"],
    ["三个半音阶经过音", "C5/2 C#5/8@p D5/8@q D#5/8@r E5/8", "I/1", ["p", "q", "r"], "C major"],
    ["填满纯四度的四个经过音", "C5/4. C#5/8@p D5/8@q D#5/8@r E5/8@s F5/8", "IV/1",
      ["p", "q", "r", "s"], "C major"],
    ["长音到新和弦后才成为结构音", "C5/2 C#5/4@p D5/4", "V/4 I/2 V/4", ["p"], "C major"],
  ] as const)("%s成立", (_label, notes, chords, roles, key) => {
    expect(findings(notes, chords, roles, key)).toEqual([]);
  });

  it.each([
    ["辅助音折返", "C5/2 C#5/4@p C5/4", "I/1", ["p"]],
    ["倚音跳进", "G4/2 C#5/4@p D5/4", "I/2. V/4", ["p"]],
    ["同音重复", "C5/2 C5/4@p D5/4", "I/2 V/2", ["p"]],
    ["跨休止", "C5/4 r/4 C#5/4@p D5/4", "I/2. V/4", ["p"]],
    ["跨手动句界", "C5/2 C#5/4@p D5/4", "I/2. V/4", ["p"], 3],
    ["落点非和弦音", "C5/2 C#5/4@p D5/4", "I/1", ["p"]],
    ["自身是当前构成音", "C5/2 D5/4@p E5/4", "I/2 V/4 I/4", ["p"]],
    ["链中混入错标的构成音", "C5/2 C#5/8@p D5/8@q D#5/8@r E5/8", "I/2 V/4 I/4", ["p", "q", "r"]],
    ["增二度", "C5/2 D#5/4@p E5/4", "I/1", ["p"]],
    ["五个连续标注超过范围", "C5/4 C#5/8@p D5/8@q D#5/8@r E5/8@s E#5/8@t F#5/8",
      "i/2. i/8 V/V/8", ["p", "q", "r", "s", "t"]],
  ] as const)("%s仍报告", (...[_label, notes, chords, roles, cut]) => {
    expect(findings(notes, chords, roles, "C major", cut)).toHaveLength(roles.length);
  });
});

describe("分解和弦后的半音经过音", () => {
  const minor = `satb 1
key E minor
meter 4/4
bars 1..2 {
 S: | G4/2 E5/4. F5/8 | F#5/2 G5/2 |
 A: | E4/1 | D#4/2 E4/2 |
 T: | B3/1 | A3/2 B3/2 |
 B: | E3/1 | B2/2 E3/2 |
}
`;

  const major = minor.replace("E minor", "C major")
    .replace("E5/4. F5/8 | F#5/2 G5/2", "C5/4. C#5/8 | D5/2 E5/2")
    .replace("D#4/2 E4/2", "B3/2 C4/2")
    .replace("B3/1 | A3/2 B3/2", "C4/1 | F3/2 G3/2")
    .replace("E3/1 | B2/2 E3/2", "C3/1 | G2/2 C3/2");

  const ruleId = "melody.augmented-interval";
  function project(text: string) {
    return compileScoreText(text).project;
  }

  function diagnostics(input: ProjectDocument) {
    return checkHarmony(input, undefined, {}, { [ruleId]: { "same-harmony": "strict" } }).diagnostics;
  }

  function b3(input: ProjectDocument) {
    return diagnostics(input).filter(d => d.ruleId === ruleId && d.voiceIds.includes("soprano"));
  }

  describe("a written chromatic passing tone after arpeggiation", () => {
    it.each([["missing third", minor], ["missing fifth", major]])(
      "recovers a %s in bare input and after blind inference", (_label, score) => {
        const raw = project(score);
        const blind = applyHarmonyInference(raw, { chordInference: inferChords(raw) },
          { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
        expect(b3(raw)).toEqual([]);
        expect(b3(blind)).toEqual([]);
      },
    );

    it("keeps the passing role separate from an enharmonic spelling correction", () => {
      for (const [pitch, wrong] of [["F5", false], ["E#5", true]] as const) {
        const text = minor.replace("F5/8", pitch + "/8").replace(" B:", " H: | i/2 r/4. i/8 | V7/2 i/2 |\n B:");
        const input = project(text);
        input.satbTracks.find(t => t.voice === "soprano")!.notes[2].nonChordToneRole = "passing";
        const found = diagnostics(input);
        expect(found.filter(d => d.ruleId === "nonchord.passing-tone")).toEqual([]);
        const chromatic = found.filter(d => d.ruleId === ruleId);
        if (wrong) expect(chromatic).toEqual([expect.objectContaining({
          tick: 3360, messageKey: ruleId + ".passing-spelling", message: expect.stringContaining("F5"),
        })]);
        else expect(chromatic).toEqual([]);
      }
    });

    it("gives the same specific spelling correction in bare input", () => {
      expect(b3(project(minor.replace("F5/8", "E#5/8")))).toEqual([expect.objectContaining({
        tick: 3360, messageKey: ruleId + ".passing-spelling", message: expect.stringContaining("F5"),
      })]);
    });

    it.each([
      ["no complete preparation", minor.replace("G4/2", "E4/2")],
      ["a rest between the arpeggiation and the proved harmony", minor.replace("G4/2", "G4/4 r/4")],
      ["a reattack in the accompaniment", minor.replace("E4/1", "E4/2 E4/2")],
      ["an independent label during the passing note", minor.replace(" B:", " H: | r/2 r/4. iv/8 | V7/2 i/2 |\n B:")],
      ["an incomplete destination", minor.replace("D#4/2 E4/2", "F#4/2 E4/2")],
    ])("does not infer a spelling error with %s", (_label, score) => {
      expect(b3(project(score))).not.toContainEqual(expect.objectContaining({ tick: 3840 }));
    });

    it("withholds a spelling correction when the local-key label conflicts", () => {
      const conflicting = minor.replace("F5/8", "E#5/8") + `
annotations {
 chord handoff range=[1:4+1/2,2:1) symbol=vi localKey="G major"
}
`;
      expect(b3(project(conflicting))).not.toContainEqual(expect.objectContaining({ messageKey: ruleId + ".passing-spelling" }));
    });

    it("does not import the accompaniment's harmony across a key event or phrase boundary", () => {
      const misspelled = minor.replace("F5/8", "E#5/8");
      const key = project(misspelled);
      key.keyEvents.push({ ...key.keyEvents[0], id: "new-key", tick: 1920 });
      const phrase = project(misspelled);
      phrase.structure.phraseBoundaries.push({ id: "cut", confidence: "certain", source: "manual", tick: 1920 });
      for (const input of [key, phrase]) expect(b3(input)).not.toContainEqual(expect.objectContaining({ messageKey: ruleId + ".passing-spelling" }));
    });
  });
});

describe("持续延留音的准备与解决", () => {
  interface Example {
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    harmony?: string;
    annotations?: string;
  }

  function fixture({
    soprano = "D5/1 | C5/1",
    alto = "B4/1 | G4/1",
    tenor = "F4/1@sus~ | F4/4 E4/2.",
    bass = "G3/1 | C3/1",
    harmony = "V7/1 | I/1",
    annotations = "",
  }: Example = {}) {
    return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}
${annotations ? "annotations {\n" + annotations + "\n}" : ""}`).project;
  }

  function unclassified(project: ReturnType<typeof fixture>) {
    return checkHarmony(project).diagnostics.filter(item => item.ruleId === "chord.unclassified-nonchord-tone")
      .map(({ tick, endTick, voiceIds }) => ({ tick: tick / project.ppq, endTick: endTick / project.ppq, voiceIds }));
  }

  describe("有准备的延留只在已证实的当前和弦区间生效", () => {
    it("同一延音事件上的 4–3 和有证据的双重延留通过默认入口", () => {
      const single = fixture();
      expect(unclassified(single)).toEqual([]);
      expect(unclassified(fixture({ soprano: "D5/1~ | D5/4 C5/2." }))).toEqual([]);
      expect(single.satbTracks.find(track => track.voice === "tenor")!.notes[0].nonChordToneRole).toBeUndefined();
    });

    const appliedNinth: Example = {
      soprano: "E5/1~ | E5/4 D5/2.", alto: "G4/1 | F#4/1",
      tenor: "C4/1 | A3/1", bass: "C3/1 | D3/1", harmony: "I/1 | V/V/1",
    };

    it.each([
      ["副属大三和弦", appliedNinth],
      ["第二级小三和弦", { ...appliedNinth, alto: "G4/1 | F4/1", harmony: "I/1 | ii/1" }],
    ] as const)("单 9–8 可解决到%s", (_name, example) => {
      const project = fixture(example);
      expect(project.chordTrack.regions).toHaveLength(2);
      expect(unclassified(project)).toEqual([]);
      expect(project.satbTracks.flatMap(t => t.notes).every(n => !n.nonChordToneRole)).toBe(true);
    });

    it.each<[string, Example]>([
      ["准备标签与当时实音不合", { ...appliedNinth, harmony: "vi/1 | V/V/1" }],
      ["解决前被重新起奏", { ...appliedNinth, soprano: "E5/1 | E5/4 D5/2." }],
      ["解决落在七和弦上", { ...appliedNinth, harmony: "I/1 | V7/V/1" }],
      ["解决后只有根、三音", { ...appliedNinth, tenor: "C4/1 | D4/1" }],
      ["低音不在解决和弦的根音上", { ...appliedNinth, bass: "C3/1 | F#3/1" }],
    ])("%s 时单九音不获豁免", (_name, example) => {
      expect(unclassified(fixture(example))).toContainEqual(expect.objectContaining({
        tick: 4, voiceIds: expect.arrayContaining(["soprano"]),
      }));
    });

    it("单九音仅豁免延留区间，保留准备以前和解决以后的外音", () => {
      const project = fixture({
        soprano: "E5/1~ | E5/4 D5/4 G5/2", alto: "G4/1 | F#4/1",
        tenor: "B3/2 C4/2 | A3/1", bass: "G3/2 C3/2 | D3/1",
        harmony: "V/2 I/2 | V/V/1",
      });
      expect(unclassified(project)).toEqual([
        { tick: 0, endTick: 2, voiceIds: ["soprano"] },
        { tick: 6, endTick: 8, voiceIds: ["soprano"] },
      ]);
    });

    it("保留解决之后同一主和弦上的其他未解释外音", () => {
      expect(unclassified(fixture({ soprano: "D5/1 | C5/2 F5/2" }))).toEqual([
        { tick: 6, endTick: 8, voiceIds: ["soprano"] },
      ]);
    });

    it("同一切片另有未解决外音时保留警告及两个声部", () => {
      expect(unclassified(fixture({ alto: "B4/1 | A#4/1" }))).toContainEqual({
        tick: 4, endTick: 5, voiceIds: ["alto", "tenor"],
      });
    });

    it("解决落在另一个同身份、同功能的主和弦区域时仍可核实", () => {
      expect(unclassified(fixture({ harmony: "V7/1 | I/4 I/2." }))).toEqual([]);
    });

    it("同一主和弦标签在延留区间内拆开时仍核对完整的延留", () => {
      expect(unclassified(fixture({ harmony: "V7/1 | I/8 I/8 I/2." }))).toEqual([]);
    });

    it("延留区间内有冲突转位时，两处外音都应报告", () => {
      expect(unclassified(fixture({ harmony: "V7/1 | I/8 I6/8 I/2." }))).toEqual([
        { tick: 4, endTick: 4.5, voiceIds: ["tenor"] },
        { tick: 4.5, endTick: 5, voiceIds: ["tenor"] },
      ]);
    });

    it("同身份落点的解释换了局部调时仍报", () => {
      expect(unclassified(fixture({
        harmony: "V7/1 | I/4 r/2.",
        annotations: 'chord exit range=[2:2,3:1) symbol=IV localKey="G major"',
      }))).toContainEqual({ tick: 4, endTick: 5, voiceIds: ["tenor"] });
    });

    it("即使局部解释相同，跨书写调号边界也仍报", () => {
      const project = fixture({ harmony: "V7/1 | I/4 I/2." });
      const tonic = { step: "C", alter: 0 } as const;
      const localKey = { tonic, mode: "major" } as const;
      for (const chord of project.chordTrack.regions) chord.semantics!.interpretations[0].localKey = localKey;
      project.keyEvents.push({
        id: "changed-key", tick: 5 * project.ppq, tonic: { step: "G", alter: 0 }, mode: "major",
      });
      expect(unclassified(project)).toContainEqual({ tick: 4, endTick: 5, voiceIds: ["tenor"] });
    });

    it("弱位上声部短暂变音时，按实音核对准备并保留该弱位警告", () => {
      const soprano = "D5/2.. E5/8 | C5/1";
      expect(unclassified(fixture({ soprano }))).toEqual([
        { tick: 3.5, endTick: 4, voiceIds: ["soprano"] },
      ]);
      expect(unclassified(fixture({ soprano, harmony: "V7/2.. r/8 | I/1" }))).toEqual([]);
      expect(unclassified(fixture({ soprano, harmony: "V7/2.. I64/8 | I/1" })))
        .toContainEqual({ tick: 4, endTick: 5, voiceIds: ["tenor"] });
    });

    it("同一事件在较早和弦有真实外音时，整音角色会遮掉该警告", () => {
      const example = {
        soprano: "C5/2 D5/2 | C5/1",
        alto: "G4/2 B4/2 | G4/1",
        bass: "C3/2 G3/2 | C3/1",
        harmony: "I/2 V7/2 | I/1",
      };
      expect(unclassified(fixture(example))).toEqual([{ tick: 0, endTick: 2, voiceIds: ["tenor"] }]);
      const tagged = fixture({ ...example, annotations: "note sus role=suspension" });
      expect(unclassified(tagged)).toEqual([]);
      expect(checkHarmony(tagged).diagnostics).toContainEqual(expect.objectContaining({
        tick: 0, ruleId: "nonchord.suspension-preparation",
      }));
    });

    it("保留原有显式挂留角色校验", () => {
      const project = fixture({
        tenor: "F4/1@sus~ | F4/4 G4/2.",
        annotations: "note sus role=suspension",
      });
      expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
        ruleId: "nonchord.suspension-resolution",
      }));
    });

    it.each(["suspension", "other"])("保留显式 %s 的优先级，未标的 9–8 不随它获豁免", role => {
      expect(unclassified(fixture({
        soprano: "D5/1~ | D5/4 C5/2.",
        annotations: `note sus role=${role}`,
      }))).toEqual([{ tick: 4, endTick: 5, voiceIds: ["soprano"] }]);
    });

    it("解决音已有显式外音角色时不把它当结构解决", () => {
      expect(unclassified(fixture({
        tenor: "F4/1~ | F4/4 E4/2.@arrival",
        annotations: "note arrival role=other",
      }))).toEqual([{ tick: 4, endTick: 5, voiceIds: ["tenor"] }]);
    });

    it("分句横跨准备与延留时保留警告", () => {
      const project = fixture();
      project.structure.phraseBoundaries.push({
        id: "separation", tick: 4 * project.ppq, source: "manual", confidence: "certain",
      });
      expect(unclassified(project)).toContainEqual({ tick: 4, endTick: 5, voiceIds: ["tenor"] });
    });

    it.each<[string, Example]>([
      ["未标角色的同拍重奏", { tenor: "F4/1 | F4/4 E4/2." }],
      ["未标角色的同拍起奏且无同音准备", {
        tenor: "G4/1 | F4/4 E4/2.",
        bass: "F3/1 | C3/1",
        harmony: "V42/1 | I/1",
      }],
      ["解决晚于休止", { tenor: "F4/1~ | F4/4 r/8 E4/8 E4/2" }],
      ["原声部反向解决", { tenor: "F4/1~ | F4/4 G4/2." }],
      ["解决音只有等音拼写", { tenor: "F4/1~ | F4/4 Fb4/2." }],
      ["同音低音在解决点重奏", { bass: "G3/1 | C3/4 C3/2." }],
      ["主和弦覆盖在解决前截断", { harmony: "V7/1 | I/4 r/2." }],
      ["主和弦换到另一和声再解决", { harmony: "V7/1 | I/4 vi/2." }],
      ["准备和弦空缺", { harmony: "r/1 | I/1" }],
      ["只有二度而非九度", { tenor: "F4/1 | E4/1", soprano: "D4/1~ | D4/4 C4/2.", bass: "G3/1 | C4/1" }],
      ["九音解决时另一声部也改变", { tenor: "F4/1 | C4/4 E4/2.", soprano: "D5/1~ | D5/4 C5/2." }],
      ["强位完整实奏了替代和弦 F/C", { alto: "B4/1 | A4/4 G4/2." }],
      ["准备后的空白跨过整个弱拍", { soprano: "D5/2. E5/4 | C5/1", harmony: "V7/2. r/4 | I/1" }],
    ])("%s 仍由 D.1 报警", (_label, example) => {
      expect(unclassified(fixture(example))).toContainEqual(expect.objectContaining({ tick: 4 }));
    });
  });
});

describe("辅助音的准备", () => {
  function check(soprano: string, tonicStart: string) {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${soprano} |
 A: | G4/1 |
 T: | E4/1 |
 B: | C3/1 |
}
annotations {
 chord tonic range=[${tonicStart},2:1) symbol=I
 note neighbor role=neighbor
}`);
    return checkHarmony(project).diagnostics.filter(d => d.ruleId === "nonchord.neighbor-tone");
  }

  describe("持续到和弦内的辅助音准备", () => {
    const returns = "C5/2 B4/8@neighbor C5/4.";

    it("以前音离开时实际发声的和弦确认其结构音身份", () => {
      expect(check(returns, "1:2")).toEqual([]);
    });

    it.each([
      [returns, "1:3"],
      ["C5/4 r/4 B4/8@neighbor C5/4.", "1:2"],
      ["C5/2 B4/8@neighbor G4/4.", "1:2"],
    ])("前音无和声支撑、被休止隔开或没有返回时仍报警", (notes, tonicStart) => {
      expect(check(notes, tonicStart)).toContainEqual(expect.objectContaining({
        tick: 1920, severity: "warning", voiceIds: ["soprano"],
      }));
    });
  });
});

describe("上声部未标记的自然经过音", () => {
  const example = `satb 1
key Eb major
meter 3/4
bars 1..1 {
 S: | G4/8 Ab4/8 Bb4/2 |
 A: | Eb4/2. |
 T: | Bb3/2. |
 B: | G3/2. |
 H: | I6/2. |
}`;

  function atPassing(score: string, split = false) {
    const { project } = compileScoreText(score);
    if (split) project.structure.phraseBoundaries = [{
      id: "break", tick: project.ppq, source: "manual", confidence: "certain",
    }];
    return checkHarmony(project).diagnostics.filter(d =>
      d.ruleId === "chord.unclassified-nonchord-tone" && d.tick === project.ppq / 2,
    ).map(d => d.voiceIds);
  }

  describe("同一三和弦内实写的自然经过音", () => {
    it("三个伴随声部持续时，未标角色的单声部级进成立", () => {
      expect(atPassing(example)).toEqual([]);
    });

    it.each([
      ["调外拼写", example.replace("Ab4", "A4")],
      ["离开时跳进", example.replace("Bb4/2", "Eb5/2")],
      ["另一声部在落点重新起奏", example.replace("Eb4/2.", "Eb4/4 Eb4/2")],
      ["到达端实奏缺少三音", example.replace("G3/2.", "G3/4 Eb3/2")],
    ])("%s 保留外音警告", (_reason, score) => {
      expect(atPassing(score)).toContainEqual(["soprano"]);
    });

    it("句界截断两端证据", () => {
      expect(atPassing(example, true)).toContainEqual(["soprano"]);
    });
  });
});
