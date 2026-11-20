import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { inferChords } from "../../inference";
import { applyHarmonyInference } from "../../inference/harmonyInference";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { augmentedIntervalRule, diminishedIntervalRule, tritoneRule } from "./melody";

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
