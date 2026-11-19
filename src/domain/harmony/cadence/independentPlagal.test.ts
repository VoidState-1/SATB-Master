import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";

const briefDominantMotion = `satb 1
key C major
meter 2/4
bars 1..4 {
  S: | E5/4 D5/4 | C5/4 A4/4 | G4/4 A4/4 | E5/2 |
  A: | C5/4 G4/4 | G4/4 F4/4 | E4/4 F4/4 | C5/2 |
  T: | G4/4 B3/4 | E4/4 C4/4 | C4/4 C4/4 | G4/2 |
  B: | C3/4 G2/4 | C3/4 F2/4 | C3/4 F2/4 | C3/2 |
  H: | T/4 D/4 | T/4 S/4 | T/4 S/4 | T/2 |
}`;

const tonicAfterDominant = `satb 1
key C major
meter 4/4
bars 1..6 {
  S: | D5/1 | C5/1 | A4/1 | G4/1 | A4/1 | E5/1 |
  A: | G4/1 | G4/1 | F4/1 | E4/1 | F4/1 | C5/1 |
  T: | B3/1 | E4/1 | C4/1 | C4/1 | C4/1 | G4/1 |
  B: | G2/1 | C3/1 | F2/1 | C3/1 | F2/1 | C3/1 |
  H: | D/1 | T/1 | S/1 | T/1 | S/1 | T/1 |
}`;

const twoPhrases = `annotations {
  phrase first range=[1:1,3:1)
  phrase second range=[3:1,7:1)
}`;

describe("独立不完满变格终止", () => {
  it("识别带三音旋律位置的句末原位变格，句中的短属主连接保留为进行", () => {
    const project = compileScoreText(briefDominantMotion).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "plagal", completion: "imperfect", fromTick: 5 * PPQ, toTick: 8 * PPQ, confidence: "probable" },
    ]);
  });

  it("识别女高音落主音的第一转位下属到原位小主", () => {
    const project = compileScoreText(`satb 1
key G minor
meter 4/4
bars 1..2 {
  S: | C5/1 | G4/1 |
  A: | G4/1 | D4/1 |
  T: | C4/1 | Bb3/1 |
  B: | Eb3/1 | G2/1 |
  H: | s6/1 | t/1 |
}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "plagal", completion: "imperfect", fromTick: 0, toTick: 8 * PPQ },
    ]);
  });

  it("同一句的长补充尾部保留补充变格", () => {
    const project = compileScoreText(tonicAfterDominant).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "supplementary", form: "plagal", fromTick: 16 * PPQ, toTick: 24 * PPQ },
    ]);
  });

  it("前句已检测到正格收束时，跨句长尾的最后一次变格仍属补充", () => {
    const project = compileScoreText(`${briefDominantMotion}
annotations {
  phrase first range=[1:1,2:2)
  phrase tail range=[2:2,5:1)
}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "authentic", toTick: 3 * PPQ },
      { kind: "supplementary", form: "plagal", fromTick: 5 * PPQ, toTick: 8 * PPQ },
    ]);
  });

  it("前句正格后出现新和声材料，后句可以独立变格收束", () => {
    const score = tonicAfterDominant
      .replace("G4/1 | G4/1 | F4/1", "G4/1 | G4/1 | E4/1")
      .replace("G2/1 | C3/1 | F2/1", "G2/1 | C3/1 | A2/1")
      .replace("D/1 | T/1 | S/1", "D/1 | T/1 | vi/1");
    const project = compileScoreText(`${score}\n${twoPhrases}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "authentic", toTick: 8 * PPQ },
      { kind: "full", form: "plagal", completion: "imperfect", fromTick: 16 * PPQ, toTick: 24 * PPQ },
    ]);
  });

  it.each([
    ["四声部休止", tonicAfterDominant
      .replace("D5/1 | C5/1", "D5/1 | C5/2 r/2")
      .replace("G4/1 | G4/1", "G4/1 | G4/2 r/2")
      .replace("B3/1 | E4/1", "B3/1 | E4/2 r/2")
      .replace("G2/1 | C3/1", "G2/1 | C3/2 r/2")],
    ["和声覆盖断裂", tonicAfterDominant.replace("D/1 | T/1 | S/1", "D/1 | T/1 | r/2 S/2")],
  ])("到达%s时停止追溯补充段", (_reason, score) => {
    const project = compileScoreText(`${score}\n${twoPhrases}`).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "full", form: "authentic", toTick: 8 * PPQ },
      { kind: "full", form: "plagal", completion: "imperfect", fromTick: 16 * PPQ, toTick: 24 * PPQ },
    ]);
  });

  it("前段参考和已写回终止都不影响检测，含同一范围的已写回标注", () => {
    const expected = buildHarmonyAnalysis(compileScoreText(briefDominantMotion).project).cadenceCandidates;
    const annotated = compileScoreText(`${briefDominantMotion}
annotations {
  phrase whole range=[1:1,5:1)
  cadence early phrase=whole range=[1:2,2:2) kind=full form=authentic completion=perfect
  cadence savedTail phrase=whole range=[3:2,5:1) kind=supplementary form=plagal
}`).project;
    const referenced = compileScoreText(`${briefDominantMotion}
reference complete=cadence {
  phrase whole range=[1:1,5:1)
  cadence early phrase=whole range=[1:2,2:2) kind=full form=authentic completion=perfect
}`);
    expect(annotated.chordTrack.cadenceAnnotations).toHaveLength(2);
    expect(referenced.reference.cadences).toHaveLength(1);
    expect(buildHarmonyAnalysis(annotated).cadenceCandidates).toEqual(expected);
    expect(buildHarmonyAnalysis(referenced.project).cadenceCandidates).toEqual(expected);
  });

  it("保持上声共同音时拒绝独立收束标签", () => {
    const project = compileScoreText(briefDominantMotion.replace("G4/4 A4/4 | E5/2", "G4/4 C5/4 | C5/2")).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "supplementary", form: "plagal", fromTick: 5 * PPQ, toTick: 8 * PPQ },
    ]);
  });

  it("下属跨度末拍低音提前落主时拒绝独立收束标签", () => {
    const project = compileScoreText(briefDominantMotion.replace("C3/4 F2/4 | C3/2", "C3/4 F2/8 C3/8 | C3/2")).project;
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "supplementary", form: "plagal", fromTick: 5 * PPQ, toTick: 8 * PPQ },
    ]);
  });
});
