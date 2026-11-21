import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferHarmony } from "../../inference/harmonyInference";
import { checkHarmony } from "../../registry";

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
