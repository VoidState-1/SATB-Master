import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony, createHarmonyRuleScheduler } from "../../registry";
import { defaultHarmonyRuleSeverities } from "../catalog";

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
