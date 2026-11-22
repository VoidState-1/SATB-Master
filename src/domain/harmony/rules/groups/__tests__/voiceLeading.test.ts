import { describe, expect, it } from "vitest";
import { spellMidi } from "../../../../pitch";
import { createEmptyProject, PPQ, type NoteEvent, type VoiceId } from "../../../../project";
import type { ProjectDocument } from "../../../../project/types";
import { compileScoreText } from "../../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../../index";
import { checkHarmony, createHarmonyRuleScheduler } from "../../../registry";
import { diagnosticFor, pitch, setLine } from "../../../testing/fixtures/ruleProjects";
import { defaultHarmonyRuleSeverities } from "../../catalog";

describe("结束终止中的女高与女低声部超越", () => {
  const rule = "voice-leading.overlap";
  const parts = {
    soprano: "D5/4 F#4/4 G4/2",
    alto: "G4/4 D4/4 D4/2",
    tenor: "B3/4 C4/4 B3/2",
    bass: "D3/4 D2/4 G2/2",
    harmony: "K46/4 V7/4 I/2",
  };

  function example(mode: "blind" | "given", changes: Partial<typeof parts> = {}) {
    const { soprano, alto, tenor, bass, harmony } = { ...parts, ...changes };
    const { project } = compileScoreText(`satb 1
key G major
meter 4/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 ${mode === "given" ? `H: | ${harmony} |` : ""}
}`);
    return mode === "given" ? project : applyHarmonyInference(project, { chordInference: inferChords(project) }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
  }

  function overlap(project: ProjectDocument, strict = false) {
    const exceptions = strict ? { [rule]: { cadence: "strict" } } as const : {};
    return checkHarmony(project, undefined, {}, exceptions).diagnostics.find(diagnostic =>
      diagnostic.ruleId === rule && diagnostic.tick === PPQ &&
      diagnostic.voiceIds.includes("alto") && diagnostic.voiceIds.includes("soprano"),
    );
  }

  describe.each(["blind", "given"] as const)("%s", mode => {
    it("属七省五且女高落导音，默认例外与严格警告均可用", () => {
      const project = example(mode);
      expect(overlap(project)).toBeUndefined();
      expect(overlap(project, true)).toMatchObject({ severity: "warning", voiceIds: ["alto", "soprano"] });
    });

    it("属三和弦上女高可下跳到五音", () => {
      const project = example(mode, {
        soprano: "G5/4 A4/4 G4/2",
        alto: "B4/4 F#4/4 D4/2",
        tenor: "D4/4 D4/4 B3/2",
        harmony: "K46/4 V/4 I/2",
      });
      expect(overlap(project)).toBeUndefined();
      expect(overlap(project, true)?.severity).toBe("warning");
    });

    it.each([
      ["后续改为下属和弦", { soprano: "D5/4 F#4/4 G4/2", alto: "G4/4 D4/4 E4/2", tenor: "B3/4 C4/4 C4/2", bass: "D3/4 D2/4 C3/2", harmony: "K46/4 V7/4 IV/2" }],
      ["属七后休止且全曲无落主", {
        soprano: "D5/4 F#4/4 r/2", alto: "G4/4 D4/4 r/2",
        tenor: "B3/4 C4/4 r/2", bass: "D3/4 D2/4 r/2", harmony: "K46/4 V7/4 r/2",
      }],
      ["有真正的垂直交叉", { alto: "G4/4 D5/4 D4/2" }],
      ["属低音不换八度", { bass: "D3/4 D3/4 G2/2" }],
      ["普通 G/B → D7/A 换位且低音继续下行", { bass: "B2/4 A2/4 Ab2/2", harmony: "I6/4 V43/4 r/2" }],
    ] as const)("%s 仍保留 C.1 警告", (_, changes) => {
      expect(overlap(example(mode, changes))?.severity).toBe("warning");
    });

    it.each([PPQ, 2 * PPQ])("在 %i tick 设人工句界后仍报警告", tick => {
      const project = example(mode);
      project.structure.phraseBoundaries.push({ tick, id: "cut", source: "manual", confidence: "certain" });
      expect(overlap(project)?.severity).toBe("warning");
    });
  });

  it.each(["I64/4", "r/4"])("源拍标签为 %s 时使用实写主四六和随后的正格落主", source => {
    const project = example("given", { harmony: `${source} V7/4 I/2` });
    expect(overlap(project)).toBeUndefined();
    expect(overlap(project, true)?.severity).toBe("warning");
  });
});

describe("隐伏五度的和声上下文", () => {
  const rule = "voice-leading.hidden-fifth";
  function fifths(project: ProjectDocument, strict = false) {
    return checkHarmony(project, undefined, {}, strict ? { [rule]: { "same-harmony": "strict" } } : {})
      .diagnostics.filter(d => d.ruleId === rule);
  }

  it("同向进入纯十二度时按起跳和落点核实和声", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 6/8
bars 1..1 {
 S: | D5/4. G5/4. |
 A: | A4/4. E5/8 C5/4 |
 T: | D4/4. G4/4. |
 B: | D3/4 F3/8 C4/4. |
 H: | ii/4 ii6/8 I/4. |
}`);
    expect(fifths(project)).toContainEqual(expect.objectContaining({
      tick: 1.5 * PPQ, endTick: 2 * PPQ, severity: "warning", voiceIds: ["bass", "soprano"],
    }));
  });

  function revoicing() {
    return compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | E4/4 G5/2 |
 A: | C4/4 E5/4 E5/4 |
 T: | G3/4 G4/2 |
 B: | E3/4 C4/2 |
 H: | I6/4 I/2 |
}`).project;
  }

  it.each([true, false])("在实奏的同和弦转位上保留例外，有标注 %s", labeled => {
    const project = revoicing();
    if (!labeled) project.chordTrack.regions = [];
    expect(fifths(project, true)).toContainEqual(expect.objectContaining({ tick: PPQ }));
    expect(fifths(project)).toEqual([]);
  });

  it("相同的实奏音集合在明确换调后仍报隐伏五度", () => {
    const project = revoicing();
    const interpretation = project.chordTrack.regions[1].semantics!.interpretations[0];
    interpretation.localKey = { tonic: { step: "F", alter: 0 }, mode: "major" };
    interpretation.degree = 5;
    expect(fifths(project)).toContainEqual(expect.objectContaining({ tick: PPQ, severity: "warning" }));
  });
});

describe("声部超越与和弦换位", () => {
  const rule = "voice-leading.overlap";

  function atSecondBeat(
    project: ProjectDocument, strict = false, voices = ["alto", "soprano"],
  ) {
    const policy = strict ? { [rule]: { "same-harmony": "strict" } } as const : {};
    return checkHarmony(project, undefined, {}, policy).diagnostics
      .filter(diagnostic => diagnostic.ruleId === rule && diagnostic.tick === PPQ &&
        voices.every(voice => diagnostic.voiceIds.some(id => id === voice)))
      .map(({ tick, endTick, severity }) => ({ tick, endTick, severity }));
  }

  function expandsUnison({
    tenor = "B3/4 C4/4 G3/4 B3/4", bass = "G2/4 E3/4 E3/2", harmony = "r/4 I6/4 iii/2",
  }: { tenor?: string; bass?: string; harmony?: string } = {}) {
    return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | G4/4 E6/2. |
 A: | G4/4 G5/4 B5/4 G5/4 |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}`).project;
  }

  const warning = { tick: PPQ, endTick: 2 * PPQ, severity: "warning" };

  describe("同度分开时的声部超越证据", () => {
    it.each(["r/4 I6/4 iii/2", "r/2 iii/2"])("还原实奏属到主六的超越 %s", harmony => {
      // G4/G4/B3/G2 -> E6/G5/C4/E3 before the unrelated E-minor revoicing.
      expect(atSecondBeat(expandsUnison({ harmony }))).toEqual([warning]);
    });

    it("出发和声不完整时仍报告越界", () => {
      const project = expandsUnison({ tenor: "G3/4 C4/4 G3/4 B3/4" });
      expect(atSecondBeat(project, true)).toEqual([warning]);
      expect(atSecondBeat(project)).toEqual([warning]);
    });

    it("到达低音与主六标签不符时仍报告越界", () => {
      const project = expandsUnison({ bass: "G2/4 Eb3/4 E3/2" });
      expect(atSecondBeat(project, true)).toEqual([warning]);
      expect(atSecondBeat(project)).toEqual([warning]);
    });

    it("局部属功能解释不使相邻连接的豁免生效", () => {
      const project = expandsUnison();
      const interpretation = project.chordTrack.regions[0].semantics!.interpretations[0];
      interpretation.localKey = { tonic: { step: "F", alter: 0 }, mode: "major" };
      interpretation.degree = 5;
      interpretation.designation = { notationSystem: "spasobin", kind: "primary", primaryFunction: "dominant" };
      expect(atSecondBeat(project, true)).toEqual([warning]);
      expect(atSecondBeat(project)).toEqual([warning]);
    });

    it("手动句界处仍检查实际越界", () => {
      const project = expandsUnison();
      project.structure.phraseBoundaries.push({ id: "boundary", tick: PPQ, source: "manual", confidence: "certain" });
      expect(atSecondBeat(project)).toEqual([warning]);
    });
  });

  it.each(["K46", "r"])("终止四六接属七只越二度时仍报告越界 %s", label => {
    const project = compileScoreText(`satb 1
key G major
meter 4/4
bars 1..1 {
 S: | B4/4 A4/4 D5/4 B4/4 |
 A: | G4/4 F#4/2 G4/4 |
 T: | D4/4 C4/2 B3/4 |
 B: | D4/4 D3/2 G2/4 |
 H: | ${label}/4 V7/2 I/4 |
}`).project;
    const pair = ["tenor", "bass"];
    expect(atSecondBeat(project, true, pair)).toEqual([warning]);
    expect(atSecondBeat(project, false, pair)).toEqual([warning]);
  });

  it("汇入同度的换和弦不借用下一连接的豁免", () => {
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | F4/4 G4/2. |
 A: | D4/4 G4/4 E4/4 G4/4 |
 T: | B3/4 E3/4 C4/4 E4/4 |
 B: | G2/4 C3/2. |
 H: | V7/4 I/2. |
}`).project;
    expect(atSecondBeat(project, true)).toEqual([warning]);
    expect(atSecondBeat(project)).toEqual([warning]);
    project.chordTrack.regions = [];
    expect(atSecondBeat(project)).toEqual([warning]);
  });

  it.each(["I/4 I6/2", "r/2."])("完整同和弦跨八度换位遵守默认和严格配置 %s", harmony => {
    const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | G4/4 C6/2 |
 A: | E4/4 G5/2 |
 T: | C4/4 C5/2 |
 B: | C3/4 E3/2 |
 H: | ${harmony} |
}`).project;
    expect(atSecondBeat(project, true)).toEqual([{ ...warning, endTick: 3 * PPQ }]);
    expect(atSecondBeat(project)).toEqual([]);
  });

  it("手动同和声的部分配声仍遵守用户配置的豁免和严格选项", () => {
    const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | G4/4 E5/2 |
 A: | E4/4 C5/2 |
 T: | r/2. |
 B: | r/2. |
 H: | I/2. |
}`).project;
    expect(atSecondBeat(project, true)).toEqual([{ ...warning, endTick: 3 * PPQ }]);
    expect(atSecondBeat(project)).toEqual([]);
  });

  function subdominantToMediant(harmony: string) {
    return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | A4/4 E6/2. |
 A: | A4/4 B5/4 C6/4 G5/4 |
 T: | C4/4 G3/4 G3/4 C4/4 |
 B: | F3/4 E3/4 E3/2 |
 H: | ${harmony} |
}`).project;
  }

  it("越过大九度的 IV→iii 由完整实奏取证", () => {
    expect(atSecondBeat(subdominantToMediant("IV/4 iii/4 I6/2"))).toEqual([warning]);
  });

  it("标签相冲突的两个不同实奏实体仍报告越界", () => {
    const project = subdominantToMediant("IV/4 I6/4 I6/2");
    expect(atSecondBeat(project, true)).toEqual([warning]);
    expect(atSecondBeat(project)).toEqual([warning]);
  });

  it("替代解释未决时仍报告实奏越界", () => {
    const project = subdominantToMediant("IV/4 iii/4 I6/2");
    project.chordTrack.regions[1].semantics!.interpretations[0].confidence = "ambiguous";
    expect(atSecondBeat(project, true)).toEqual([warning]);
    expect(atSecondBeat(project)).toEqual([warning]);
  });

  it("真实换和弦只越三度时仍报告越界", () => {
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | G4/4 E5/2. |
 A: | G4/4 B4/4 C5/4 G4/4 |
 T: | E4/4 G3/4 G3/4 C4/4 |
 B: | C3/4 E3/4 E3/2 |
 H: | I/4 iii/4 I6/2 |
}`).project;
    expect(atSecondBeat(project, true)).toEqual([warning]);
    expect(atSecondBeat(project)).toEqual([warning]);
  });


  it("下行离开同度时，iii→I 的跨八度超越也取实奏证据", () => {
    const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | B4/4 C4/4 E4/4 |
 A: | G4/4 G3/4 C4/4 |
 T: | E3/4 E2/2 |
 B: | E3/4 C2/2 |
 H: | iii/4 I/2 |
}`).project;
    expect(atSecondBeat(project, false, ["tenor", "bass"])).toEqual([warning]);
  });

  it("同和弦内从同度分开并越过整八度时，仍遵守同和声豁免", () => {
    const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | G4/4 C6/2 |
 A: | G4/4 G5/2 |
 T: | E4/2. |
 B: | C3/2. |
 H: | I/2. |
}`).project;
    expect(atSecondBeat(project, true)).toEqual([{ ...warning, endTick: 3 * PPQ }]);
    expect(atSecondBeat(project)).toEqual([]);
  });

  it.each([
    ["增七度实响十二个半音", "G#5", "B#4", "D#4 G#3 E4", "G#2/4 E3/2", "E5 B4", "III"],
    ["减八度实响只有十一个半音", "Ab5", "Cb5", "Eb4 C4 F4", "Ab2/4 F3/2", "F5 C5", "iv"],
  ])("%s 时仍检查实际越界", (_, soprano, alto, tenor, bass, nextAlto, label) => {
    const quarterNotes = (pitches: string) => pitches.split(" ").map(pitch => `${pitch}/4`).join(" ");
    const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | C4/4 ${soprano}/2. |
 A: | C4/4 ${alto}/4 ${quarterNotes(nextAlto)} |
 T: | E3/4 ${quarterNotes(tenor)} |
 B: | C3/4 ${bass} |
 H: | I/4 r/4 ${label}/2 |
}`).project;
    expect(atSecondBeat(project, true)).toEqual([warning]);
    expect(atSecondBeat(project)).toEqual([warning]);
  });

  it("汇入同度的换和弦不借用上一连接的豁免", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | F5/4 F4/4 G4/2 |
 A: | D4/2 G4/2 |
 T: | B3/2 E3/2 |
 B: | G2/2 C3/2 |
 H: | V7/2 I/2 |
}`);
    const match = expect.objectContaining({
      ruleId: rule, tick: 2 * PPQ, endTick: 4 * PPQ, severity: "warning",
      voiceIds: ["alto", "soprano"],
    });
    expect(checkHarmony(project).diagnostics).toContainEqual(match);
    project.chordTrack.regions = [];
    expect(checkHarmony(project).diagnostics).toContainEqual(match);
  });

  it.each(["E5/4 D5/4", "D5/2"])("两个实写和弦之间的超越不借用前一和弦的换位 %s", alto => {
    const { project } = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..2 {
  S: | F5/2 A5/4 | G5/2. |
  A: | ${alto} F#5/4 | F#5/4 E5/2 |
  T: | A4/2 B4/4 | B4/2. |
  B: | D4/2 D#4/4 | E4/2. |
  H: | ii/2 V65/III/4 | iii/2. |
}`);
    const match = expect.objectContaining({
      ruleId: rule, tick: 2 * project.ppq, voiceIds: expect.arrayContaining(["soprano", "alto"]),
    });
    expect(checkHarmony(project).diagnostics).toContainEqual(match);
  });
});

describe("有准备延留遮蔽的平行五八度", () => {
  const fifth = "voice-leading.parallel-fifths";
  const octave = "voice-leading.parallel-octaves";

  function fifthProject({
    soprano = "F5/2 C5/4 | D5/2.",
    alto = "C4/2 G4/4~ | G4/4 F4/2",
    tenor = "A3/2 E3/4 | D3/2.",
    bass = "F3/2 C3/4 | Bb2/2.",
    harmony = "I/2 V/4 | IV/2.",
  }: {
    soprano?: string;
    alto?: string;
    tenor?: string;
    bass?: string;
    harmony?: string;
  } = {}) {
    return compileScoreText(`satb 1
key F major
meter 3/4
bars 1..2 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 ${harmony ? "H: | " + harmony + " |" : ""}
}`).project;
  }

  function overBass(project: ReturnType<typeof fifthProject>, kind: typeof fifth | typeof octave,
    upper = "alto", fromBeat = 3) {
    return checkHarmony(project).diagnostics.filter(d =>
      d.ruleId === kind && d.tick >= fromBeat * project.ppq &&
      d.voiceIds.includes("bass") && d.voiceIds.some(voice => voice === upper));
  }

  describe("同一声部对有准备延留遮蔽的平行五八度", () => {
    it.each(["", "I/2 V/4 | IV/2."])("补报女低与低音的复五度 %s", harmony => {
      const project = fifthProject({ harmony });
      expect(overBass(project, fifth)).toEqual([expect.objectContaining({
        tick: 4 * project.ppq,
        params: { suspensionEntryTick: 3 * project.ppq },
        noteIds: expect.arrayContaining(["note-A-1920","note-B-1920","note-A-3840","note-B-2880"]),
      })]);
    });

    it("在独立的下行小二度写法中补报女高与低音的复八度", () => {
      const { project } = compileScoreText(`satb 1
key D major
meter 3/4
bars 1..2 {
 S: | A4/2 G5/4~ | G5/4 F#5/2 |
 A: | F#4/2 B4/4 | A4/2. |
 T: | D4/2 D4/4 | C#4/2. |
 B: | D3/2 G2/4 | F#2/2. |
 H: | I/2 IV/4 | iii/2. |
}`);
      expect(overBass(project, octave, "soprano")).toEqual([expect.objectContaining({
        tick: 4 * project.ppq,
        params: { suspensionEntryTick: 3 * project.ppq },
      })]);
    });

    it("即时平行仍仅在共同起奏时报告一次", () => {
      const project = fifthProject({ alto: "C4/2 G4/4 | F4/2." });
      const result = overBass(project, fifth);
      expect(result).toHaveLength(1);
      expect(result[0].tick).toBe(3 * project.ppq);
      expect(result[0].params?.suspensionEntryTick).toBeUndefined();
    });

    it("即时反向复五度沿用现行规则，延迟补报不扩到该口径", () => {
      const project = fifthProject({
        alto: "C4/2 G4/4 | F4/2.",
        bass: "F3/2 C2/4 | Bb2/2.",
      });
      const result = overBass(project, fifth);
      expect(result).toHaveLength(1);
      expect(result[0].tick).toBe(3 * project.ppq);
      expect(result[0].params?.suspensionEntryTick).toBeUndefined();
    });

    it("两个声部同向上行小二度的延期暂不纳入，直接平行仍报告", () => {
      function ascending(alto: string) {
        return compileScoreText(`satb 1
key E major
meter 3/4
bars 1..2 {
 S: | E5/2 F##5/4 | E5/2. |
 A: | ${alto} |
 T: | G#3/2 F##3/4 | G#3/2. |
 B: | E2/2 D#2/4 | E2/2. |
}`).project;
      }
      const held = ascending("B4/2 A#4/4~ | A#4/4 B4/2");
      expect(overBass(held, fifth)).toEqual([]);
      const immediate = ascending("B4/2 A#4/4 | B4/2.");
      expect(overBass(immediate, fifth)).toEqual([expect.objectContaining({
        tick: 3 * immediate.ppq,
      })]);
    });

    it("只有搭档晚到时不把它接成上声部的延留", () => {
      const project = fifthProject({
        alto: "C4/2 G4/4 | F4/2.",
        bass: "F3/2 C3/4~ | C3/4 Bb2/2",
      });
      expect(overBass(project, fifth)).toEqual([]);
    });

    it.each([
      ["延留音重新起奏", { alto: "C4/2 G4/4 | G4/4 F4/2" }],
      ["搭档在解决拍重奏", { bass: "F3/2 C3/4 | Bb2/4 Bb2/2" }],
      ["落点音区改变", { alto: "C4/2 G4/4~ | G4/4 F3/2" }],
      ["两端同类而实际反向", { bass: "F3/2 C2/4 | Bb2/2.", tenor: "A3/2 E3/4 | D3/2." }],
      ["准备的纯五度来自另一个声部", { bass: "F3/2 E3/4 | Bb2/2.", tenor: "A3/2 C4/4 | D3/2.",
        harmony: "I/2 V6/4 | IV/2." }],
      ["落点已没有延留音的连续发音", { alto: "C4/2 G4/4~ | G4/8 r/8 F4/2" }],
      ["延留处插入冲突的明确和弦", { harmony: "I/2 V/4 | I64/4 IV/2" }],
      ["落点同音异名", { alto: "C4/2 G4/4~ | G4/4 E#4/2" }],
    ] satisfies Array<[string, Parameters<typeof fifthProject>[0]]>)(
      "%s 时不拼接成新的同向平行", (_label, edits) => {
        expect(overBass(fifthProject(edits), fifth)).toEqual([]);
      },
    );

    it.each(["句界", "调号"])("预备到解决之间有%s时不合并", boundary => {
      const project = fifthProject();
      const tick = 3.5 * project.ppq;
      if (boundary === "句界") {
        project.structure.phraseBoundaries.push({
          id: "split", tick, source: "manual", confidence: "certain",
        });
      } else {
        project.keyEvents.push({ id: "change", tick, tonic: { step: "C", alter: 0 }, mode: "major" });
      }
      expect(overBass(project, fifth)).toEqual([]);
    });

    it("只编辑准备和弦后，桌面增量检查移除并可重新得到落点诊断", async () => {
      const project = fifthProject();
      const edited = structuredClone(project);
      edited.satbTracks.find(t => t.voice === "tenor")!.notes.find(n => n.startTick === 2 * project.ppq)!.pitch =
        { step: "E", alter: -1, octave: 3 };
      const scheduler = createHarmonyRuleScheduler();
      const severities = defaultHarmonyRuleSeverities();
      for (const [index, current] of [project, edited, project].entries()) {
        const result = await scheduler.run({ project: current, severities, revision: index + 1 });
        expect(result.diagnostics.filter(d => d.ruleId === fifth && d.params?.suspensionEntryTick !== undefined))
          .toHaveLength(current === project ? 1 : 0);
      }
    });
  });
});

describe("七音延留后的外声部平行五度", () => {
  const rule = "voice-leading.parallel-fifths";
  const parts = {
    S: "r/4 D5/4~ | D5/4 C5/4", A: "r/4 E4/4 | F4/2",
    T: "r/4 Bb3/4 | A3/2", B: "r/4 G3/4 | F3/2",
    H: "r/4 viiø6/5/4 | vi6/4 I/4",
  };

  function score(edits: Partial<typeof parts> = {}) {
    const lines = Object.entries({ ...parts, ...edits }).filter(([, v]) => v)
      .map(([part, notes]) => part + ": | " + notes + " |");
    return compileScoreText(["satb 1", "key F major", "meter 2/4", "bars 1..2 {", ...lines, "}"].join("\n")).project;
  }

  function routes(edits: Partial<typeof parts> = {}) {
    const raw = score({ ...edits, H: "" });
    const blind = applyHarmonyInference(raw, {chordInference: inferChords(raw)},
      {mode: "replace-unlocked", writeNonChordToneRoles: true}).project;
    return [raw, blind, score(edits)];
  }

  function fifths(p: ProjectDocument, upper = "soprano") {
    return checkHarmony(p).diagnostics.filter(d => d.ruleId === rule && d.tick === 3 * p.ppq &&
      d.voiceIds.includes("bass") && d.voiceIds.some(v => v === upper));
  }

  describe("a delayed outer fifth over a sounding submediant sixth chord", () => {
    it("reports the same four notes after the inner tritone resolves in place, in all three routes", () => {
      const [raw, blind, declared] = routes();
      for (const p of [raw, blind, declared]) {
        const snapshot = structuredClone(p);
        expect(fifths(p)).toEqual([expect.objectContaining({severity: "error",
          noteIds: expect.arrayContaining(["note-S-960","note-B-960","note-S-2880","note-B-1920"]),
          params: {suspensionEntryTick: 1920}})]);
        expect(p).toEqual(snapshot);
      }
      for (const p of [blind, declared]) {
        const middle = p.chordTrack.regions.find(c => c.startTick === 1920);
        expect(middle?.identity).toMatchObject({root: {step:"D", alter:0}, bass:{step:"F",alter:0},
          structure:{kind:"tertian",quality:"minor"}});
      }
    });

    it("works from three literal identities or an explicitly written, locked vi6", () => {
      const p = score();
      p.chordTrack.regions.forEach(c => { c.locked = true; });
      expect(fifths(p)).toHaveLength(1);
      p.chordTrack.regions.forEach(c => { delete c.semantics; });
      expect(fifths(p)).toHaveLength(1);
    });

    it.each<[string, Partial<typeof parts>]>([
      ["independently attacked D minor", {S:"r/4 D5/4 | D5/4 C5/4"}],
      ["independent interior motion in D minor", {A:"r/4 E4/4 | F4/8 A4/4."}],
      ["a fresh bass attack at the arrival", {B:"r/4 G3/4 | F3/4 F3/4"}],
      ["a return to the preparation", {S:"r/4 D5/4~ | D5/4 D5/4"}],
      ["the soprano moves in the opposite direction", {S:"r/4 D5/4~ | D5/4 E5/4"}],
      ["the lower partner goes up while the fifth descends", {B:"r/4 G2/4 | F3/2"}],
      ["the soprano reaches a different octave", {S:"r/4 D5/4~ | D5/4 C4/4"}],
      ["an audible break before resolution", {S:"r/4 D5/4~ | D5/8 r/8 C5/4"}],
    ])("%s supplies no delayed fifth in any route", (_label, edits) => {
      for (const p of routes(edits)) expect(fifths(p)).toHaveLength(0);
    });

    it("keeps a written independent sixth chord when the inner voices exchange the tonic and third", () => {
      const p = score({A:"r/4 E4/4 | A4/2", T:"r/4 Bb3/4 | F4/2"});
      expect(fifths(p)).toHaveLength(0);
    });

    it("a different preparation or a different harmony at entry cannot borrow the printed resolution", () => {
      expect(fifths(score({A:"r/4 F4/4 | F4/2",H:"r/4 ii7/4 | vi6/4 I/4"}))).toHaveLength(0);
      expect(fifths(score({H:"r/4 viiø6/5/4 | IV64/4 I/4"}))).toHaveLength(0);
      expect(fifths(score({A:"r/4 E4/4 | F3/2"}))).toHaveLength(0);
    });

    it("does not extend the alternate-identity reading to a delayed inner fifth", () => {
      const p = score({S:"r/4 Bb4/4 | A4/2", T:"r/4 D4/4~ | D4/4 C4/4"});
      expect(fifths(p, "tenor")).toHaveLength(0);
    });

    it("respects a phrase cut, key event and explicit competing reading", () => {
      for (const tick of [1440,1920,2400,2880]) {
        const p = score();
        p.structure.phraseBoundaries.push({id:"cut",tick,source:"manual",confidence:"certain"});
        expect(fifths(p)).toHaveLength(0);
      }
      const keyed = score();
      keyed.keyEvents.push({...keyed.keyEvents[0],tick:2400,id:"next"});
      expect(fifths(keyed)).toHaveLength(0);
      const marked = score();
      marked.chordTrack.regions[1].semantics!.cadenceRole = "deceptive";
      expect(fifths(marked)).toHaveLength(0);
      const applied = score();
      applied.chordTrack.regions[1].semantics!.interpretations[0].appliedTarget = {degree:2,primaryFunction:"subdominant"};
      expect(fifths(applied)).toHaveLength(0);
    });

    it("cannot use a sliced-off preparation in another phrase", () => {
      const p = score();
      const first = p.chordTrack.regions[0];
      first.durationTicks = p.ppq / 2;
      p.chordTrack.regions.splice(1, 0, { ...first, id: "later-half", startTick: 1.5*p.ppq });
      expect(fifths(p)).toHaveLength(1);
      p.structure.phraseBoundaries.push({id:"break",tick:1.5*p.ppq,source:"manual",confidence:"certain"});
      expect(fifths(p)).toHaveLength(0);
    });

    it("a fresh inner harmony only just before the strong beat cannot certify the held note's attack", () => {
      const p = score({A:"r/4 F4/8 E4/8 | F4/2", H:"r/4 ii7/8 viiø6/5/8 | vi6/4 I/4"});
      expect(fifths(p)).toHaveLength(0);
    });

    it("ignores unrelated earlier harmony and blocks a contradictory note role at the preparation", () => {
      const p = score({H:"V7/4 viiø6/5/4 | vi6/4 I/4"});
      expect(fifths(p)).toHaveLength(1);
      p.satbTracks[0].notes[0].nonChordToneRole = "passing";
      expect(fifths(p)).toHaveLength(0);
    });
  });
});

describe("平行、反向和不等五度的声部进行", () => {
  function pairProject(
    upper: readonly [number, number],
    lower: readonly [number, number],
    voiceIds: readonly [VoiceId, VoiceId] = ["soprano", "bass"],
    startTick = 0,
  ) {
    const project = createEmptyProject();
    project.lengthTicks = startTick + PPQ * 2;
    [upper, lower].forEach((pitches, voiceIndex) => {
      const voiceId = voiceIds[voiceIndex];
      project.satbTracks.find((track) => track.id === voiceId)!.notes =
        pitches.map((midi, index): NoteEvent => ({
          id: `${voiceId}-${index}`,
          startTick: startTick + index * PPQ,
          durationTicks: PPQ,
          pitch: spellMidi(midi),
          velocity: 88,
          locked: false,
          spellingSource: "manual",
        }));
    });
    return project;
  }

  const rules = [
    {
      label: "五度",
      ruleId: "voice-leading.parallel-fifths",
      contraryUpper: [67, 72],
      contraryLower: [60, 53],
      parallelUpper: [67, 69],
      parallelLower: [60, 62],
      heldUpper: [67, 67],
      heldLower: [60, 48],
    },
    {
      label: "八度",
      ruleId: "voice-leading.parallel-octaves",
      contraryUpper: [65, 70],
      contraryLower: [53, 46],
      parallelUpper: [72, 74],
      parallelLower: [60, 62],
      heldUpper: [72, 72],
      heldLower: [60, 48],
    },
  ] as const;

  describe.each(rules)("连续纯$label", (rule) => {
    it.each([
      ["soprano", "bass"],
      ["alto", "tenor"],
    ] as const)("识别 %s 与 %s 反向扩张到复音程", (upperId, lowerId) => {
      const project = pairProject(
        rule.contraryUpper,
        rule.contraryLower,
        [upperId, lowerId],
      );
      const diagnostics = checkHarmony(project).diagnostics.filter(
        (item) => item.ruleId === rule.ruleId,
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ tick: PPQ, severity: "error" });
      expect(diagnostics[0].voiceIds).toEqual(
        expect.arrayContaining([upperId, lowerId]),
      );
      expect(diagnostics[0].noteIds).toHaveLength(4);
    });

    it("识别反向收缩的连续音程", () => {
      const project = pairProject(
        [rule.contraryUpper[1], rule.contraryUpper[0]],
        [rule.contraryLower[1], rule.contraryLower[0]],
      );
      expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
        .toContain(rule.ruleId);
    });

    it("保留同向进行的检测", () => {
      const project = pairProject(rule.parallelUpper, rule.parallelLower);
      expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
        .toContain(rule.ruleId);
    });

    it.each(["upper", "lower"] as const)(
      "%s 声部重复同音时不误报斜向进行",
      (stationaryVoice) => {
        const upper: readonly [number, number] = stationaryVoice === "upper"
          ? rule.heldUpper : [rule.heldUpper[0], rule.heldUpper[0] + 12];
        const lower: readonly [number, number] = stationaryVoice === "upper"
          ? rule.heldLower : [rule.heldLower[0], rule.heldLower[0]];
        const project = pairProject(upper, lower);
        expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
          .not.toContain(rule.ruleId);
      },
    );

    it("持续音遇到另一声部换音时不误报", () => {
      const project = pairProject(rule.heldUpper, rule.heldLower);
      const track = project.satbTracks.find((item) => item.id === "soprano")!;
      track.notes = [{ ...track.notes[0], durationTicks: PPQ * 2 }];
      expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
        .not.toContain(rule.ruleId);
    });

    it("两个声部都重复同音时不误报", () => {
      const project = pairProject(
        [rule.parallelUpper[0], rule.parallelUpper[0]],
        [rule.parallelLower[0], rule.parallelLower[0]],
      );
      expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
        .not.toContain(rule.ruleId);
    });

    it("休止隔开的两个音程不视为连续进行", () => {
      const project = pairProject(rule.contraryUpper, rule.contraryLower);
      project.satbTracks.forEach((track) => {
        if (track.notes[0]) track.notes[0].durationTicks = PPQ / 2;
      });
      expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
        .not.toContain(rule.ruleId);
    });

    it("反向进入非纯音程时不误报", () => {
      const project = pairProject(
        [rule.contraryUpper[0], rule.contraryUpper[1] + 1],
        rule.contraryLower,
      );
      expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
        .not.toContain(rule.ruleId);
    });
  });

  it("复现第 4 小节末 F4/F3 反向进入第 5 小节 B♭4/B♭2", () => {
    const project = pairProject([65, 70], [53, 46], ["soprano", "bass"], PPQ * 15);
    for (const track of project.satbTracks) {
      if (track.notes[1]) {
        track.notes[1].pitch = {
          step: "B",
          alter: -1,
          octave: track.id === "soprano" ? 4 : 2,
        };
      }
    }
    const diagnostics = checkHarmony(project).diagnostics.filter(
      (item) => item.ruleId === "voice-leading.parallel-octaves",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ tick: PPQ * 16 });
  });

  it("识别同度反向展开到八度", () => {
    const project = pairProject([60, 67], [60, 55]);
    expect(checkHarmony(project).diagnostics.map((item) => item.ruleId))
      .toContain("voice-leading.parallel-octaves");
  });

  it("五度反向进入八度时不作为连续五度或连续八度", () => {
    const project = pairProject([67, 69], [60, 57]);
    const ids = checkHarmony(project).diagnostics.map((item) => item.ruleId);
    expect(ids).not.toContain("voice-leading.parallel-fifths");
    expect(ids).not.toContain("voice-leading.parallel-octaves");
  });

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

  describe("不等五度的声部进行", () => {
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
  });
});
