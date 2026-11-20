import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { applyHarmonyInference, inferHarmony } from "../inference/harmonyInference";
import { detectProjectCadences } from "./projectEvidence";

const score = `satb 1
key Bb major
meter 3/2
bars 1..2 {
  S: | F5/1 C5/4 Bb4/4 | C5/1. |
  A: | F4/1 F4/4 G4/4 | G4/2 A4/2 G4/2 |
  T: | D4/1 C4/4 D4/4 | Eb4/2 F4/2 Eb4/2 |
  B: | Bb2/1 A2/4 G2/4 | C3/2 F2/2 C3/2 |
}`;

function blind(text: string) {
  const { project } = compileScoreText(text);
  return applyHarmonyInference(project, inferHarmony(project), { mode: "replace-unlocked" }).project;
}

function modalEndings(project: ReturnType<typeof blind>) {
  return detectProjectCadences(project).filter(candidate =>
    candidate.evidence.some(item => item.code === "dorian-plagal-ending"));
}

describe("多利亚大下属的句末变格", () => {
  it("盲推从自然小属、下拍小主和末端 IV–i 识别独立不完满变格", () => {
    const project = blind(score);
    const result = modalEndings(project);
    expect(result).toMatchObject([{
      kind: "full", form: "plagal", completion: "imperfect",
      fromTick: 8 * project.ppq, toTick: 12 * project.ppq,
    }]);
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toContainEqual(result[0]);
    expect(project.structure.phraseBoundaries).toEqual([]);
  });

  it("允许共同音重奏及内声使用同一和弦的其他合法配音", () => {
    const revoiced = score.replace("C5/1. |", "C5/2 C5/2 C5/2 |")
      .replace("Eb4/2 F4/2 Eb4/2", "Eb4/2 C4/2 Eb4/2");
    expect(modalEndings(blind(revoiced))).toMatchObject([{ completion: "imperfect" }]);
  });

  it("可在中间和弦之前找到独立确立的小调中心", () => {
    const intervening = score.replace("C5/1. |", "C5/2 Bb4/4 C5/4 C5/2 |")
      .replace("G4/2 A4/2 G4/2", "G4/2 Eb4/4 A4/4 G4/2")
      .replace("Eb4/2 F4/2 Eb4/2", "Eb4/2 Bb3/4 F4/4 Eb4/2")
      .replace("C3/2 F2/2 C3/2", "C3/2 G2/4 F2/4 C3/2");
    const project = blind(intervening);
    expect(modalEndings(project)).toMatchObject([{ fromTick: 9 * project.ppq, completion: "imperfect" }]);
  });

  it("移调到 D 多利亚，低音与共同音判据按书写相对音级工作", () => {
    const transposed = `satb 1
key C major
meter 3/2
bars 1..2 {
  S: | G5/1 D5/4 C5/4 | D5/1. |
  A: | G4/1 G4/4 A4/4 | A4/2 B4/2 A4/2 |
  T: | E4/1 D4/4 E4/4 | F4/2 G4/2 F4/2 |
  B: | C3/1 B2/4 A2/4 | D3/2 G2/2 D3/2 |
}`;
    expect(modalEndings(blind(transposed))).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect" }]);
  });

  const supplied = `satb 1
key Bb major
meter 3/2
bars 1..2 {
  S: | C5/1. | F5/1. |
  A: | A4/2 G4/1 | D5/1. |
  T: | F4/2 Eb4/1 | Bb3/1. |
  B: | F2/2 C3/1 | Bb2/1. |
  H: | r/1. | T/1. |
}
annotations {
  chord source range=[1:1,1:2) symbol=S localKey="C minor"
  chord landing range=[1:2,2:1) symbol=t localKey="C minor"
  phrase first range=[1:1,2:1)
  phrase second range=[2:1,3:1)
}`;

  it("已有一致局部调时，前句 IV–i 可独立收束，无须额外小属", () => {
    const { project } = compileScoreText(supplied);
    const result = modalEndings(project);
    expect(result).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect", toTick: 6 * project.ppq }]);
    expect(buildHarmonyAnalysis(project).phraseSegments.map(({ toTick }) => toTick))
      .toEqual([6 * project.ppq, 12 * project.ppq]);
  });

  it("明确借同主音大调的 IV 与小 i 共享同一收束中心", () => {
    const { project } = compileScoreText(supplied.replace('symbol=S localKey="C minor"', 'symbol=S localKey="C major"'));
    expect(modalEndings(project)).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect" }]);
  });

  it("共同主音可在内声保持，女高落五音时即使强次拍也不完满", () => {
    const { project } = compileScoreText(supplied.replace("C5/1. | F5/1.", "A4/2 G4/1 | F5/1.")
      .replace("A4/2 G4/1 | D5/1.", "C4/1. | D5/1.")
      .replace("F4/2 Eb4/1 | Bb3/1.", "F3/2 Eb3/1 | Bb3/1."));
    project.meterEvents[0].beatGrouping = [1, 2];
    expect(modalEndings(project)).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect" }]);
  });

  it("同一实奏在母调只标 V–ii 且无独立证据时拒绝重释", () => {
    const { project } = compileScoreText(supplied.replace('symbol=S localKey="C minor"', "symbol=V")
      .replace('symbol=t localKey="C minor"', "symbol=ii"));
    expect(modalEndings(project)).toEqual([]);
  });

  it.each([false, true])("已完成正格后的 IV–i 保持补充性质（借大调 %s）", borrowed => {
    const { project } = compileScoreText(`satb 1
key C minor
meter 3/2
bars 1..3 {
  S: | D5/1. | C5/1. | C5/1. |
  A: | B4/1. | G4/1. | A4/2 G4/1 |
  T: | G4/1. | Eb4/1. | F4/2 Eb4/1 |
  B: | G2/1. | C3/1. | F2/2 C3/1 |
  H: | D/1. | t/1. | ${borrowed ? "r/2" : "S/2"} t/1 |
}
annotations {
  ${borrowed ? 'chord borrowedIV range=[3:1,3:2) symbol=S localKey="C major"' : ""}
  phrase whole range=[1:1,4:1)
}`);
    expect(detectProjectCadences(project)).toMatchObject([
      { kind: "full", form: "authentic", toTick: 12 * project.ppq },
      { kind: "supplementary", form: "plagal", toTick: 18 * project.ppq },
    ]);
  });

  it("自然小属可确立中心，已有大 IV 收束照常走独立变格", () => {
    const { project } = compileScoreText(`satb 1
key C minor
meter 3/2
bars 1..3 {
  S: | Bb4/1. | C5/1. | C5/1. |
  A: | G4/1. | G4/1. | A4/2 G4/1 |
  T: | D4/1. | Eb4/1. | F4/2 Eb4/1 |
  B: | G2/1. | C3/1. | F2/2 C3/1 |
  H: | d/1. | t/1. | S/2 t/1 |
}
annotations {
  phrase whole range=[1:1,4:1)
}`);
    expect(detectProjectCadences(project)).toMatchObject([
      { kind: "full", form: "plagal", completion: "imperfect", toTick: 18 * project.ppq },
    ]);
  });

  it("中途重新确立母调主和弦后，先前的小调收束不能借给新的 V–ii", () => {
    const { project } = compileScoreText(`satb 1
key Bb major
meter 3/2
bars 1..3 {
  S: | F5/1 C5/4 Bb4/4 | C5/1. | F5/2 C5/2 C5/2 |
  A: | F4/1 F4/4 G4/4 | G4/1. | D5/2 A4/2 G4/2 |
  T: | D4/1 C4/4 D4/4 | Eb4/1. | Bb3/2 F4/2 Eb4/2 |
  B: | Bb2/1 A2/4 G2/4 | C3/1. | Bb2/2 F2/2 C3/2 |
  H: | T/1 V6/4 vi/4 | ii/1. | T/2 V/2 ii/2 |
}
annotations {
  phrase whole range=[1:1,4:1)
}`);
    expect(modalEndings(project)).toEqual([]);
  });

  it("强次拍的同一原位落主可以是完满变格", () => {
    const project = blind(score);
    project.meterEvents[0].beatGrouping = [2, 1];
    expect(modalEndings(project)).toMatchObject([{ kind: "full", form: "plagal", completion: "perfect" }]);
  });

  it.each([
    ["大属", score.replace("Bb4/4", "B4/4")],
    ["自然七级未在原声部上行到主音", score.replace("Bb4/4", "G5/4").replace("G4/4 | G4", "Bb4/4 | G4")],
    ["末尾低音越过八度", score.replace("F2/2 C3/2", "F2/2 C4/2")],
    ["主音持续低音的下属四六", score.replace("C3/2 F2/2 C3/2", "C3/1.")],
  ])("%s 保留普通终止搜索", (_name, text) => {
    expect(modalEndings(blind(text))).toEqual([]);
  });

  it.each(["key", "phrase"] as const)("不能借 %s 边界另一侧的实奏判定", boundary => {
    const project = blind(score);
    if (boundary === "key") {
      project.keyEvents.push({
        tick: 10 * project.ppq, id: "arrival-key",
        tonic: { step: "C", alter: 0 }, mode: "minor",
      });
    } else {
      project.structure.phraseBoundaries.push({
        tick: 8 * project.ppq, id: "manual-cut", source: "manual", confidence: "certain",
      });
    }
    expect(modalEndings(project)).toEqual([]);
  });
});
