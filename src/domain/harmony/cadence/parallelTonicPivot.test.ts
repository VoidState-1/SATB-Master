import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { phraseInferenceFingerprint } from "../phrase";

const majorToMinor = `satb 1
key D major
meter 2/4
bars 1..4 {
  S: | F#5/2 | C#5/4 C#5/4 | D5/4 C5/4 | Bb4/2 |
  A: | A4/2 | A4/2~ | A4/4 Eb4/4 | D4/2 |
  T: | D4/2 | E4/4 E4/4 | A3/4 A3/4 | F3/2 |
  B: | D3/2 | A2/4 G2/4 | F2/4 F2/4 | Bb2/2 |
}
annotations {
  chord tonic at=1:1 duration=1/2 symbol=T
  chord dominant at=2:1 duration=1/4 symbol=D
  chord last at=2:2 duration=1/4 symbol=D2
  chord pivot at=3:1 duration=1/4 symbol=t6 localKey="D minor"
  chord next at=3:2 duration=1/4 symbol=D7 localKey="Bb major"
  chord end at=4:1 duration=1/2 symbol=T localKey="Bb major"
}`;

const minorToMajor = `satb 1
key G minor
meter 2/4
bars 1..4 {
  S: | Bb4/2 | F#4/4 F#4/4 | G4/4 F#4/4 | E4/2 |
  A: | G4/2 | D4/2~ | D4/4 D#4/4 | B3/2 |
  T: | D4/2 | A3/4 A3/4 | D3/4 A3/4 | G3/2 |
  B: | G2/2 | D3/4 C3/4 | B2/4 B2/4 | E3/2 |
}
annotations {
  chord tonic at=1:1 duration=1/2 symbol=t
  chord dominant at=2:1 duration=1/4 symbol=D
  chord last at=2:2 duration=1/4 symbol=D2
  chord pivot at=3:1 duration=1/4 symbol=T6 localKey="G major"
  chord next at=3:2 duration=1/4 symbol=D7 localKey="E minor"
  chord end at=4:1 duration=1/2 symbol=t localKey="E minor"
}`;

const cut = 4 * PPQ;
const halfEnding = expect.objectContaining({ kind: "half", form: "authentic", toTick: cut });
const finalEnding = expect.objectContaining({
  fromTick: 5 * PPQ, toTick: 8 * PPQ, kind: "full", form: "authentic", completion: "perfect",
});

function withBreak(score: string, source: "manual" | "inferred" = "inferred", nextManual?: number) {
  const { project } = compileScoreText(score);
  project.structure.phraseBoundaries.push({
    id: "midpoint", tick: cut, source, confidence: "certain",
    ...(source === "inferred" ? { inferenceFingerprint: phraseInferenceFingerprint(project) } : {}),
  });
  if (nextManual !== undefined) project.structure.phraseBoundaries.push({
    id: "next-explicit", tick: nextManual, source: "manual", confidence: "certain",
  });
  return buildHarmonyAnalysis(project);
}

describe("同主音主六接续转调处的自动半终止", () => {
  it.each([["大转小", majorToMinor], ["小转大", minorToMajor]])("%s 时排除延续中的半终止并保留尾部正格", (_title, score) => {
    const analysis = withBreak(score);
    expect(analysis.phraseSegments.some(phrase => phrase.toTick === cut)).toBe(true);
    expect(analysis.cadenceCandidates).toEqual([finalEnding]);
  });

  it("人工划在同一处的半终止仍可保留", () => {
    expect(withBreak(majorToMinor, "manual").cadenceCandidates).toEqual([halfEnding, finalEnding]);
  });

  it("不越过主六之后标注的人工句界借用新调属和弦", () => {
    expect(withBreak(majorToMinor, "inferred", 5 * PPQ).cadenceCandidates).toContainEqual(halfEnding);
  });

  it.each([
    ["共同音在跨界处同音重奏", majorToMinor.replace("A4/2~ | A4/4", "A4/2 | A4/4")],
    ["共同音跨八度", majorToMinor.replace("A4/2~ | A4/4", "A4/2 | A5/4")],
    ["共同音只在属二才开始", majorToMinor.replace("A4/2~ | A4/4", "A4/4 A4/4~ | A4/4")],
    ["导音跳八度进入主音", majorToMinor.replace("D5/4 C5/4", "D6/4 C5/4")],
    ["低音七音跳八度解决", majorToMinor.replace("F2/4 F2/4", "F3/4 F2/4")],
    ["落点缺乏连贯实奏", majorToMinor.replace("A3/4 A3/4", "r/8 A3/8 A3/4")],
    ["没有大小调转换", majorToMinor.replace('symbol=t6 localKey="D minor"', 'symbol=T6 localKey="D major"')
      .replace("F2/4 F2/4", "F#2/4 F2/4")],
    ["没有实际的新调属七", majorToMinor.replace("D5/4 C5/4", "D5/4 B4/4")],
    ["主六保持超过一拍", majorToMinor.replace("duration=1/4 symbol=t6", "duration=1/2 symbol=t6")
      .replace('  chord next at=3:2 duration=1/4 symbol=D7 localKey="Bb major"', "")],
  ])("%s 时保留原半终止判断", (_title, score) => {
    expect(withBreak(score).cadenceCandidates).toContainEqual(halfEnding);
  });
});
