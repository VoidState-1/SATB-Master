import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords, applyChordInference } from "./index";

const modulation = `satb 1
key C major
meter 2/4
bars 1..4 {
  S: | E5/4 D5/4 | C5/4 B4/4 | D5/4 C#5/4 | D5/2 |
  A: | C5/4 B4/4 | G4/4 G4/4 | F#4/4 G4/4 | F#4/2 |
  T: | G3/4 F4/4 | E4/4 E4/4 | A3/4 E4/4 | A3/2 |
  B: | C3/4 G2/4 | C3/4 E3/4 | A2/4 A2/4 | D3/2 |
}`;

describe("从谱面的终止识别局部调", () => {
  it("在原调主和弦之后用新调的 K46–D7–T 识别转调，保留题面调号", () => {
    const { project } = compileScoreText(modulation);
    const originalKeys = structuredClone(project.keyEvents);
    const result = inferChords(project);
    const expected = { tonic: { step: "D", alter: 0 }, mode: "major" };
    const destination = result.regions.filter(r => r.fromTick >= 4 * project.ppq);
    expect(destination).toHaveLength(3);
    expect(destination.map(r => r.selected?.semantics?.interpretations[0].localKey))
      .toEqual([expected, expected, expected]);
    expect(destination.at(-1)?.selected?.functionalBaseId).toBe("T");
    expect(result.regions[0].selected?.semantics?.interpretations[0].localKey).toBeUndefined();
    const applied = applyChordInference(project, result, { mode: "replace-unlocked" });
    expect(applied.project.keyEvents).toEqual(originalKeys);
    expect(applied.project.chordTrack.regions.at(-1)?.semantics?.interpretations[0].localKey)
      .toEqual(expected);
  });

  it("仅选终止主和弦的一部分仍使用全谱提供的局部调", () => {
    const { project } = compileScoreText(modulation);
    const result = inferChords(project, { fromTick: project.lengthTicks - project.ppq / 2 });
    expect(result.regions).toMatchObject([{ selected: { functionalBaseId: "T",
      semantics: { interpretations: [{ localKey: { tonic: { step: "D", alter: 0 }, mode: "major" } }] } } }]);
  });

  it("显式新调调号使后续和弦直接归属该调", () => {
    const { project } = compileScoreText(modulation);
    project.keyEvents.push({ id: "d", tick: 4 * project.ppq, tonic: { step: "D", alter: 0 }, mode: "major" });
    const last = inferChords(project).regions.at(-1)!;
    expect(last.selected?.functionalBaseId).toBe("T");
    expect(last.selected?.semantics?.interpretations[0].localKey).toBeUndefined();
  });

  it("目的调主和弦重新起音并持续一小节，回原调后使用原调的属主", () => {
    const returning = modulation.replace("1..4", "1..6")
      .replace("D5/2 |", "D5/4 D5/4 | B4/4 C5/4 | C5/2 |")
      .replace("F#4/2 |", "F#4/4 F#4/4 | F4/4 G4/4 | G4/2 |")
      .replace("A3/2 |", "A3/4 A3/4 | D4/4 E4/4 | E4/2 |")
      .replace("D3/2 |", "D3/4 D3/4 | G2/4 C3/4 | C3/2 |");
    const { project } = compileScoreText(returning);
    project.meterEvents.push({ id: "six-eight", tick: 8 * project.ppq, numerator: 6, denominator: 8 });
    const result = inferChords(project);
    const at = (beat: number) => result.regions.find(r => r.fromTick <= beat * project.ppq && beat * project.ppq < r.toTick)?.selected;
    expect([6, 7].map(i => at(i)?.semantics?.interpretations[0].localKey?.tonic.step)).toEqual(["D", "D"]);
    expect(at(8)?.functionalBaseId).toBe("D");
    expect(at(10)?.functionalBaseId).toBe("T");
    expect(at(8)?.semantics?.interpretations[0].localKey).toBeUndefined();
    expect(at(10)?.semantics?.interpretations[0].localKey).toBeUndefined();
  });

  it("原调主音持续与同主音大小调色彩均不能单独触发转调", () => {
    const { project } = compileScoreText(`satb 1
key C minor
meter 2/4
bars 1..3 {
  S: | G4/2 | F4/4 B4/4 | E5/2 |
  A: | Eb4/2 | D4/4 G4/4 | G4/2 |
  T: | C4/2 | A3/4 F4/4 | C4/2 |
  B: | C3/2 | C3/4 G2/4 | C3/2 |
}`);
    expect(inferChords(project).regions.every(r => !r.selected?.semantics?.interpretations[0].localKey)).toBe(true);
  });

  it("转位属七的实写七音下行到主和弦三音也能确立新调", () => {
    const { project } = compileScoreText(modulation.replace("A3/4 E4/4 | A3/2", "A3/4 A3/4 | A3/2")
      .replace("F#4/4 G4/4 | F#4/2", "F#4/4 E4/4 | F#4/2")
      .replace("A2/4 A2/4 | D3/2", "A2/4 G2/4 | F#2/2"));
    const regions = inferChords(project).regions.filter(r => r.fromTick >= 5 * project.ppq);
    expect(regions.map(r => r.selected?.semantics?.interpretations[0].localKey?.tonic.step)).toEqual(["D", "D"]);
    expect(regions.map(r => r.selected?.identity.bass.step)).toEqual(["G", "F"]);
  });

  it("缺少目的调预备时保持句末重属到属以及调内主和弦的原调归属", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
  S: | E5/2 | F5/4 F#5/4 | G5/2 |
  A: | C5/2 | C5/4 C5/4 | B4/2 |
  T: | G3/2 | A3/4 A3/4 | D4/2 |
  B: | C3/2 | F2/4 D3/4 | G2/2 |
}`);
    const result = inferChords(project);
    expect(result.regions.map(r => r.selected?.functionalBaseId)).toEqual(["T","S","DD","D"]);
    expect(result.regions.every(r => !r.selected?.semantics?.interpretations[0].localKey)).toBe(true);
  });
});

describe("降二级的三和弦和大七和弦", () => {
  const preparation = `satb 1
key C minor
meter 2/4
bars 1..2 {
  S: | Db5/4 C5/4 | B4/4 C5/4 |
  A: | Ab4/4 Ab4/4 | F4/4 G4/4 |
  T: | F4/4 F4/4 | D4/4 Eb4/4 |
  B: | Db3/4 Db3/4 | G2/4 C3/4 |
}`;
  it("下降二级根音上的三和弦增加大七度后解决到属，保留转位与功能", () => {
    const { project } = compileScoreText(preparation);
    const regions = inferChords(project).regions;
    for (const [i, quality] of ["major", "major7"].entries()) {
      expect(regions[i]).toMatchObject({ status: "resolved", selected: {
        identity: { root: { step: "D", alter: -1 }, structure: { quality }, bass: { step: "D", alter: -1 } },
        semantics: { interpretations: [{ degree: 2, degreeAlteration: -1,
          designation: { kind: "side-degree", primaryFunction: "subdominant" } }] },
      } });
    }
    const inverted = compileScoreText(preparation.replace("F4/4 F4/4", "Db4/4 Db4/4")
      .replace("Db3/4 Db3/4", "F3/4 F3/4"));
    const selected = inferChords(inverted.project).regions.map(r => r.selected);
    expect(selected[0]?.functionalBaseId).toBe("N6");
    expect(selected[1]).toMatchObject({ functionalBaseId: "SII", identity: {
      bass: { step: "F", alter: 0 }, structure: { quality: "major7" },
    } });
  });

  it("孤立的降二级与等音拼写不触发带有解决依据的下属解释", () => {
    const isolated = compileScoreText(preparation.replace("B4/4 C5/4","C5/4 C5/4")
      .replace("F4/4 G4/4","G4/4 G4/4").replace("D4/4 Eb4/4","Eb4/4 Eb4/4")
      .replace("G2/4 C3/4","C3/4 C3/4"));
    const respelled = compileScoreText(preparation.replaceAll("Db","C#"));
    for (const { project } of [isolated, respelled]) {
      expect(inferChords(project).regions.every(r =>
        !r.selected?.evidence.some(e => e.code === "lowered-supertonic-resolution"))).toBe(true);
    }
  });

  it("截取降二级和弦中段时保留全谱的解决证据，输出只覆盖选区内的音符", () => {
    const { project } = compileScoreText(preparation);
    const range = { fromTick: project.ppq / 2, toTick: project.ppq };
    const result = inferChords(project, range);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toMatchObject({ ...range, observationIndices: [0], selected: {
      observationIndex: 0, functionalBaseId: "SII", identity: { structure: { quality: "major" } },
    } });
    expect(result.regions[0].selected?.fit.chordToneNoteIds).toHaveLength(4);
    expect(applyChordInference(project, result, { mode: "replace-unlocked" }).project.chordTrack.regions)
      .toMatchObject([{ startTick: range.fromTick, durationTicks: range.toTick - range.fromTick }]);
  });
});
