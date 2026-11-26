import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";

const targets = [
  { rule: "chord.doubled-leading-tone", harmony: "V", goal: "I", top: "B4", double: "B3", single: "D4",
    tenor: "D3", bass: "G2", landing: ["C5", "E4", "G3", "C3"] },
  { rule: "chord.doubled-seventh", harmony: "V7", goal: "I", top: "F5", double: "F4", single: "D4",
    tenor: "B3", bass: "G2", landing: ["E5", "G4", "C4", "C3"] },
  { rule: "chord.doubled-altered-tendency-tone", harmony: "V/V", goal: "V", top: "F#5", double: "F#4", single: "A4",
    tenor: "A3", bass: "D3", landing: ["G5", "B4", "D4", "G2"] },
];

describe.each(targets)("$rule 的实听重复", target => {
  it.each(["整段", "前半拍", "后半拍", "旁声部休止", "仅两声部", "单写"])("%s 在条件与盲推入口精确定位", variant => {
    const { top, single, double, tenor, bass, harmony, goal, landing, rule } = target;
    const rest = variant === "旁声部休止" || variant === "仅两声部";
    const early = variant === "前半拍" || rest;
    const halves = variant === "整段" ? double + "/4" :
      [early ? double : single,
        variant === "后半拍" ? double : single].map(note => note + "/8").join(" ");
    const lines = [top + "/4", halves, rest ? "r/8 " + tenor + "/8" : tenor + "/4",
      variant === "仅两声部" ? "r/8 " + bass + "/8" : bass + "/4"];
    // An intact attack of the same harmony supplies context for the partial voicing.
    const opening = [top, single, tenor, bass];
    const score = ["satb 1", "key C major", "meter 3/4", "bars 1..1 {",
      ...lines.map((line, i) => "SATB"[i] + ": | " + opening[i] + "/4 " + line + " " + landing[i] + "/4 |")];
    const raw = compileScoreText([...score, "}"].join("\n")).project;
    const conditioned = compileScoreText([...score, "H: | " + harmony + "/2 " + goal + "/4 |", "}"].join("\n")).project;
    const blind = applyHarmonyInference(raw, { chordInference: inferChords(raw) },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    for (const project of [conditioned, blind]) {
      const check = checkHarmony(project);
      expect(check.skippedRules.filter(s => s.reason === "rule-error")).toEqual([]);
      const collisions = check.diagnostics.filter(d => d.ruleId === rule);
      const from = project.ppq * (variant === "后半拍" ? 1.5 : 1);
      const end = project.ppq * (early ? 1.5 : 2);
      expect(collisions.map(d => [d.tick, d.endTick]), project === blind ? "盲推" : "条件").toEqual(
        variant === "单写" ? [] : [[from, end]]);
    }
  });
});

describe("外音与结构倾向音的同响", () => {
  it("休止中旁声部重奏时沿用两侧相同和弦，身份冲突或跨句则停查", () => {
    const { project } = compileScoreText(["satb 1", "key C major", "meter 3/4", "bars 1..1 {",
      "S: | F5/2. |", "A: | D4/4 F4/4 D4/4 |", "T: | B3/4 r/4 B3/4 |",
      "B: | G2/4 G2/8 G2/8 G2/4 |", "H: | V7/4 r/4 V7/4 |", "}"].join("\n"));
    const collisions = () => checkHarmony(project).diagnostics.filter(d => d.ruleId === "chord.doubled-seventh");
    expect(collisions()).toMatchObject([{ tick: project.ppq, endTick: 2 * project.ppq,
      chordIds: project.chordTrack.regions.map(c => c.id), voiceIds: ["alto", "soprano"] }]);
    project.structure.phraseBoundaries = [{ id: "cut", tick: 2 * project.ppq, source: "manual", confidence: "certain" }];
    expect(collisions()).toEqual([]);
    project.structure.phraseBoundaries = [];
    project.chordTrack.regions[1].identity.bass = { step: "B", alter: 0 };
    expect(collisions()).toEqual([]);
  });

  it.each([["C5", 0], ["G5", 1]] as const)("同声部经过导音后到 %s", (landing, count) => {
    const { project } = compileScoreText(["satb 1", "key C major", "meter 3/4", "bars 1..1 {",
      "S: | A4/4 B4/4@via " + landing + "/4 |", "A: | F4/4 D4/4 E4/4 |",
      "T: | D4/4 B3/4 G3/4 |", "B: | D3/4 G2/4 C3/4 |", "H: | ii/4 V/4 I/4 |",
      "}", "annotations {", "note via role=passing", "}"].join("\n"));
    expect(checkHarmony(project).diagnostics.filter(d => d.ruleId === "chord.doubled-leading-tone")
      .map(d => d.tick)).toEqual(count ? [project.ppq] : []);
  });

  it("副导半减七在低音先到后释放三个延留声部", () => {
    const { project } = compileScoreText(["satb 1", "key D major", "meter 3/4", "bars 1..1 {",
      "S: | F#4/2@s E4/4 |", "A: | D4/2@a C#4/4 |", "T: | B3/2@t C#4/4 |",
      "B: | G#3/4 A3/2 |", "H: | viiø7/V/4 V/2 |", "}", "annotations {",
      "note s role=suspension", "note a role=suspension", "note t role=retardation", "}"].join("\n"));
    const collisions = () => checkHarmony(project).diagnostics.filter(d => d.ruleId === "chord.doubled-leading-tone");
    expect(collisions()).toEqual([]);
    project.satbTracks[2].notes[1].pitch.octave++;
    expect(collisions().map(d => d.tick)).toEqual([2 * project.ppq]);
  });

  it.each([
    ["passing", "A4/4 B4/4@orn C5/4", "C4/4 B3/4@other A3/4", "vi/2."],
    ["neighbor", "C5/4 B4/4@orn C5/4", "C4/4 B3/4@other C4/4", "vi/2."],
    ["suspension", "B4/4@orn~ B4/4 A4/4", "B3/4@other~ B3/4 A3/4", "iii/4 vi/2"],
    ["anticipation", "C5/4 B4/4@orn B4/4", "C4/4 B3/4@other B3/4", "vi/2 iii/4"],
  ])("%s 有实际准备或落点时豁免碰撞", (role, top, inner, harmony) => {
    const text = ["satb 1", "key C major", "meter 3/4", "bars 1..1 {", "S: | " + top + " |",
      "A: | E4/2. |", "T: | " + inner + " |", "B: | " +
      (role === "suspension" ? "E3/4 A2/2" : role === "anticipation" ? "A2/2 E3/4" : "A2/2.") + " |",
      "H: | " + harmony + " |", "}", "annotations {", "note orn role=" + role, "note other role=" + role, "}"].join("\n");
    const project = compileScoreText(text).project;
    const result = checkHarmony(project);
    expect(result.skippedRules.filter(skip => skip.reason === "rule-error")).toEqual([]);
    expect(result.diagnostics.filter(d => d.ruleId === "chord.doubled-leading-tone" &&
      d.tick < 2 * project.ppq && d.endTick > project.ppq)).toEqual([]);
  });
});
