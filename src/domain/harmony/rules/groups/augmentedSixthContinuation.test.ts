import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";
import { buildHarmonyAnalysis } from "../../analysis";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { isGermanToFrenchVoicing, isItalianToFrenchVoicing } from "./augmentedSixthContinuation";

const progression = `satb 1
key C minor
meter 3/4
bars 1..1 {
 S: | Eb5/4 D5/4 D5/4 |
 A: | C5/2 B4/4 |
 T: | F#4/2 G4/4 |
 B: | Ab2/2 G2/4 |
 H: | Ger+6/4 Fr+6/4 V/4 |
}`;

function errors(score: string) {
  const { project } = compileScoreText(score);
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.augmented-sixth")
    .map(item => [item.tick, item.severity]);
}

describe("德增六先转为法增六再解决", () => {
  it("只有五音下行半音时，两端的解决由后续连接检验", () => {
    expect(errors(progression)).toEqual([]);
    expect(errors(progression.replace("F#4/2 G4/4", "F#4/2 F4/4"))).toEqual([[1920, "error"]]);
  });

  it.each([
    ["高端保持在错误八度", progression.replace("F#4/2 G4/4", "F#4/4 F#3/4 G3/4")],
    ["只有法增六标签，五音没有下行", progression.replace("Eb5/4 D5/4", "Eb5/4 Eb5/4")],
    ["半音下行但改到错误的八度", progression.replace("Eb5/4 D5/4", "Eb5/4 D4/4")],
    ["将源五音同响异名改写", progression.replace("Eb5", "D#5")],
    ["没有后继和声", progression.replace(" V/4", " r/4")],
  ])("%s 仍保留错误", (_title, score) => {
    expect(errors(score)).toContainEqual([960, "error"]);
  });
});

const italian = progression.replace("Eb5/4 D5/4", "C5/4 D5/4").replace("Ger+6/4", "It+6/4");

describe("意式增六补入二级后连续成为法式", () => {
  it("两端和另一主音持续，只有重复主音上行二度", () => {
    expect(errors(italian)).toEqual([]);
    expect(errors(italian.replace("F#4/2 G4/4", "F#4/2 F4/4"))).toEqual([[1920, "error"]]);
  });

  it.each([
    ["一个端点同音重奏", italian.replace("F#4/2 G4/4", "F#4/4 F#4/4 G4/4")],
    ["移动的主音跳八度再到二级", italian.replace("C5/4 D5/4", "C5/4 D4/4")],
    ["法式缺少新加入的二级", italian.replace("C5/4 D5/4", "C5/4 Eb5/4")],
    ["后续和弦缺失", italian.replace(" V/4", " r/4")],
  ])("%s 保留变体交界报警", (_title, score) => {
    expect(errors(score)).toContainEqual([960, "error"]);
  });
});

describe("法式延续的共享证据和各自的持续要求", () => {
  it("德式允许同写重奏，意式要求另三个声部持续为原音符", () => {
    const reattack = (score: string) => score
      .replace("Ab2/2 G2/4", "Ab2/4 Ab2/4 G2/4")
      .replace("F#4/2 G4/4", "F#4/4 F#4/4 G4/4")
      .replace("C5/2 B4/4", "C5/4 C5/4 B4/4");
    expect(errors(reattack(progression))).toEqual([]);
    expect(errors(reattack(italian))).toEqual([[960, "error"]]);
  });

  it.each([
    ["同调号的另一个调性事件", (project: ReturnType<typeof compileScoreText>["project"]) => {
      project.keyEvents.push({ ...project.keyEvents[0], id: "next-key", tick: project.ppq });
    }],
    ["交界有明确句界", (project: ReturnType<typeof compileScoreText>["project"]) => {
      project.structure.phraseBoundaries.push({
        id: "split", tick: project.ppq, source: "manual", confidence: "certain",
      });
    }],
    ["实际低音使用降六级的等音写法", (project: ReturnType<typeof compileScoreText>["project"]) => {
      project.satbTracks.find(track => track.voice === "bass")!.notes[0].pitch = { step: "G", alter: 1, octave: 2 };
    }],
  ] as const)("%s 时两条路径均不成立", (_name, separate) => {
    for (const [score, admits] of [[progression, isGermanToFrenchVoicing], [italian, isItalianToFrenchVoicing]] as const) {
      const { project } = compileScoreText(score);
      separate(project);
      const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
      const before = context.sliceAt(0)!;
      const after = context.sliceAt(project.ppq)!;
      expect(admits(context, before, after, before.key)).toBe(false);
    }
  });
});
