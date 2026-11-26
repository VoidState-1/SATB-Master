import { describe, expect, it } from "vitest";
import { checkHarmony } from "../registry";
import { compileScoreText } from "../../scoreText";
import { defaultHarmonyRuleSeverities } from "./catalog";
import { createEmptyProject, PPQ } from "../../project";
import { note, setNotes, fSharpMajorRegion } from "../testing/fixtures/writtenPitchProject";

describe("Phase B v1 书写与和弦金样本", () => {
  it("相同输入生成稳定诊断 ID，并归并连续同根因区间", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      {
        ...fSharpMajorRegion(),
        durationTicks: PPQ * 2,
      },
    ];
    setNotes(project, "soprano", [
      note("held-g-flat", 0, PPQ * 2, { step: "G", alter: -1, octave: 4 }),
    ]);
    setNotes(project, "alto", [
      note("boundary-1", 0, PPQ, { step: "C", alter: 1, octave: 4 }),
      note("boundary-2", PPQ, PPQ, { step: "C", alter: 1, octave: 4 }),
    ]);
    const first = checkHarmony(project).diagnostics.filter(
      (item) =>
        item.ruleId === "chord.unclassified-nonchord-tone" &&
        item.noteIds.includes("held-g-flat"),
    );
    const second = checkHarmony(project).diagnostics.filter(
      (item) =>
        item.ruleId === "chord.unclassified-nonchord-tone" &&
        item.noteIds.includes("held-g-flat"),
    );
    expect(first).toHaveLength(1);
    expect(first[0].endTick).toBe(PPQ * 2);
    expect(second[0].id).toBe(first[0].id);
  });
});

describe("指定转位的低音错写", () => {
  const inversion = "chord.inversion-bass";
  const missing = "chord.incomplete-members";
  const outside = "chord.unclassified-nonchord-tone";
  const chord = (alto: string, tenor: string, bass = "F#2") => compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | E5/1 |
 A: | ${alto}/1 |
 T: | ${tenor}/1 |
 B: | ${bass}/1 |
 H: | I/1 |
}`).project;

  it.each([false, true])("修正低音只消除同因的三报，独立交叉=%s", crossing => {
    const alto = crossing ? "E4" : "G4", tenor = crossing ? "G4" : "E4";
    const project = chord(alto, tenor);
    const primary = checkHarmony(project).diagnostics.filter(d => d.severity !== "suggestion");
    expect(primary.map(d => d.ruleId)).toEqual(crossing ? [inversion, "voice.crossing"] : [inversion]);
    const children = primary[0].consequences!;
    expect(children.map(d => d.ruleId).sort()).toEqual([missing, outside]);
    const raw = checkHarmony(project, { ...defaultHarmonyRuleSeverities(), [inversion]: "off" });
    for (const child of children) expect(raw.diagnostics).toContainEqual(child);
    expect(checkHarmony(chord(alto, tenor, "C3")).diagnostics.filter(d => d.severity !== "suggestion")
      .map(d => d.ruleId)).toEqual(crossing ? ["voice.crossing"] : []);
  });

  it("缺少其他构成音或其他声部也有外音时保留独立诊断", () => {
    const result = checkHarmony(chord("A4", "E4")).diagnostics;
    expect(result.find(d => d.ruleId === inversion)?.consequences).toBeUndefined();
    expect(result.find(d => d.ruleId === missing)?.params.missing).toBe("C,G");
    expect(result.find(d => d.ruleId === outside)?.voiceIds).toEqual(["alto", "bass"]);
  });

  it("工程单独提高连带规则等级时保留高等级提示", () => {
    const result = checkHarmony(chord("G4", "E4"), {
      ...defaultHarmonyRuleSeverities(), [inversion]: "warning", [missing]: "error",
    }).diagnostics;
    expect(result.find(d => d.ruleId === missing)?.severity).toBe("error");
    expect(result.find(d => d.ruleId === inversion)?.consequences?.map(d => d.ruleId)).toEqual([outside]);
  });
});
