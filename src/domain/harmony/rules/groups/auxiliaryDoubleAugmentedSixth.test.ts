import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { applyHarmonyInference, inferHarmony } from "../../inference/harmonyInference";
import { checkHarmony } from "../../registry";

const closingReturn = `satb 1
key F# major
meter 4/4
bars 1..1 {
 S: | G#4/4 F#4/2. |
 A: | E#4/4 C#4/4 B#3/4 C#4/4 |
 T: | B3/4 A#3/4 G##3/4 A#3/4 |
 B: | C#3/4 F#3/4 D3/4 F#3/4 |
 H: | D7/4 T/4 DD++43/4 T/4 |
}`;

const transposedReturn = `satb 1
key C major
meter 3/4
bars 1..1 {
 S: | C5/2. |
 A: | G4/4 F#4/4 G4/4 |
 T: | E4/4 D#4/4 E4/4 |
 B: | C3/4 Ab2/4 C3/4 |
 H: | T/4 DD++43/4 T/4 |
}`;

const descendingGermanEnd = `satb 1
key D minor
meter 4/4
bars 1..1 {
 S: | D5/4 D5/4 C#5/4 D5/4 |
 A: | G4/4 G#4/4 G4/4 F4/4 |
 T: | D4/4 F4/4 E4/4 D4/4 |
 B: | Bb2/4 Bb2/4 A2/4 D3/4 |
 H: | iv6/4 Ger+6/4 V7/4 i/4 |
}`;

function inferFromNotes(notation: string) {
  const { project } = compileScoreText(notation.replace(/\n H:.*/, ""));
  return applyHarmonyInference(project, inferHarmony(project), {
    mode: "replace-unlocked",
    writeNonChordToneRoles: true,
  }).project;
}

type Project = ReturnType<typeof compileScoreText>["project"];

function errors(project: Project) {
  return checkHarmony(project).diagnostics.filter(item =>
    item.ruleId === "resolution.augmented-sixth" && item.severity === "error",
  );
}

describe("实写增六的句末辅助性回归", () => {
  it("黄虎威第30章书面5末尾的倍增三四，盲推和给定均读为辅助回主", () => {
    for (const project of [inferFromNotes(closingReturn), compileScoreText(closingReturn).project]) {
      expect(buildHarmonyAnalysis(project).slices.map(slice => slice.chord?.identity.structure)).toEqual([
        expect.objectContaining({ quality: "dominant7" }),
        expect.objectContaining({ quality: "major" }),
        { kind: "augmented-sixth", variant: "doubleAugmented43" },
        expect.objectContaining({ quality: "major" }),
      ]);
      expect(errors(project)).toEqual([]);
    }
  });

  it("相同声部连接移调到 C 大调仍是辅助回归", () => {
    expect(errors(compileScoreText(transposedReturn).project)).toEqual([]);
  });

  it("内声交接后虽形成完整主和弦，仍报告错解", () => {
    const bad = transposedReturn.replace("F#4/4 G4/4", "F#4/4 E4/4")
      .replace("D#4/4 E4/4", "D#4/4 G3/4");
    for (const project of [inferFromNotes(bad), compileScoreText(bad).project]) {
      expect(buildHarmonyAnalysis(project).slices[2].chord?.identity.structure)
        .toMatchObject({ kind: "tertian", quality: "major" });
      expect(errors(project)).toMatchObject([{ tick: 2 * project.ppq }]);
    }
  });

  it.each([
    ["前置实音并不是同配置原位主和弦", transposedReturn.replace("G4/4 F#4/4", "A4/4 F#4/4")],
    ["把升二级错写为等音降三", transposedReturn.replace("D#4/4", "Eb4/4")],
    ["低音越八度返回", transposedReturn.replace("Ab2/4 C3/4", "Ab2/4 C2/4")],
  ])("%s 时仍报告", (_name, notation) => {
    const { project } = compileScoreText(notation);
    expect(errors(project)).toMatchObject([{ tick: 2 * project.ppq }]);
  });

  it("跨手工句末的相同音型不建立辅助回归", () => {
    const { project } = compileScoreText(transposedReturn);
    project.structure.phraseBoundaries.push({
      id: "phrase", tick: 2 * project.ppq, source: "manual", confidence: "certain",
    });
    expect(errors(project)).toMatchObject([{ tick: 2 * project.ppq }]);
  });
});

describe("保留常规增六要求及给定标签", () => {
  it("第32章书面8的实写德增六高端下行，属七身份不能豁免", () => {
    for (const project of [inferFromNotes(descendingGermanEnd), compileScoreText(descendingGermanEnd).project]) {
      expect(errors(project)).toMatchObject([{
        tick: 2 * project.ppq, params: { target: "D", lowDelta: -1, highDelta: -1 },
      }]);
    }
    const corrected = descendingGermanEnd.replace("G#4/4 G4/4", "G#4/4 A4/4").replace("V7/4", "V/4");
    expect(errors(compileScoreText(corrected).project)).toEqual([]);
  });

  it("第37章键盘二2的实写双延留属于倍增三四，显式德增六标签仍按输入检查", () => {
    const notation = `satb 1
key Eb major
meter 2/4
bars 1..2 {
 S: | Ab5/4 F#5/4~ | F#5/4 G5/4 |
 A: | Ab4/4 A4/4~ | A4/4 Bb4/4 |
 T: | Eb4/2~ | Eb4/2 |
 B: | C3/4 Cb3/4 | Bb2/2 |
 H: | IV6/4 DD++43/4 | K46/2 |
}`;
    expect(errors(compileScoreText(notation).project)).toEqual([]);
    const { project } = compileScoreText(notation.replace("DD++43", "Ger+6"));
    expect(errors(project)).toMatchObject([{
      tick: 2 * project.ppq, params: { target: "K46", lowDelta: -1, highDelta: 0 },
    }]);
  });
});
