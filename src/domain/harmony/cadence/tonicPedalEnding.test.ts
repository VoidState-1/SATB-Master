import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { applyHarmonyInference, inferHarmony } from "../inference";

const parts = `bars 1..2 {
 S: | G4/2. D5/4 | C5/1 |
 A: | C4/2. B3/4 | C4/8 Bb3/8 Ab3/4 G3/2 |
 T: | Eb3/2. F3/4 | Eb3/8 E3/8 F3/4 Eb3/2 |
 B: | C3/2. G2/4 | C3/1 |
}`;

const labeled = `annotations {
chord d range=[1:4,2:1) symbol=D7 localKey="C minor"
chord t1 range=[2:1,2:1+1/2) symbol=t localKey="C minor"
chord a range=[2:1+1/2,2:2) symbol=V7/IV localKey="C minor"
chord s range=[2:2,2:3) symbol=iv64 localKey="C minor"
chord t2 range=[2:3,3:1) symbol=t localKey="C minor"
}`;

function analyze(notes = parts, chords = labeled, key = "Eb major", manualBoundary?: number) {
  const { project } = compileScoreText(`satb 1\nkey ${key}\nmeter 4/4\n${notes}\n${chords}`);
  if (manualBoundary !== undefined) {
    project.structure.phraseBoundaries.push({ id: "manual", tick: manualBoundary, source: "manual", confidence: "certain" });
  }
  const analysis = buildHarmonyAnalysis(project);
  return { project, analysis, recovered: analysis.cadenceCandidates.find(c =>
    c.evidence.some(e => e.code === "closing-tonic-pedal")) };
}

describe("正格落主后的持续主音", () => {
  it("以第一处实际落主判定完满，持续主音共同释放才是尾界", () => {
    const { project, analysis, recovered } = analyze();
    expect(recovered).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", confidence: "probable",
      fromTick: 3 * PPQ, toTick: 8 * PPQ, observedLandingTick: 4 * PPQ,
      evidence: expect.arrayContaining([expect.objectContaining({
        code: "closing-tonic-pedal", refs: expect.arrayContaining(["note-B-3840", "note-S-3840"]),
      })]),
    });
    expect(analysis.harmonySpans.slice(-5).map(span => span.regionIds[0]))
      .toEqual(project.chordTrack.regions.map(chord => chord.id));
    expect(analysis.cadenceCandidates.filter(c => c.toTick === 8 * PPQ)).toHaveLength(1);
  });

  it("持续音收在一同休止之前，保留实际释放点", () => {
    const stopped = parts.replace("C5/1", "C5/2. r/4").replace("| C3/1", "| C3/2. r/4")
      .replace("G3/2", "G3/4 r/4").replace("Eb3/2 |", "Eb3/4 r/4 |");
    expect(analyze(stopped, labeled.replace("2:3,3:1", "2:3,2:4")).recovered)
      .toMatchObject({ fromTick: 3 * PPQ, toTick: 7 * PPQ, completion: "perfect" });
  });

  it.each([
    ["低音同高重奏", parts.replace("| C3/1", "| C3/2 C3/2")],
    ["低音下换八度", parts.replace("| C3/1", "| C3/2 C2/2")],
    ["女高同高重奏", parts.replace("C5/1", "C5/2 C5/2")],
    ["实际最高声部变成内声部", parts.replace("C5/1", "C4/1").replace("Ab3/4", "Ab4/4")],
    ["局部属七的三音等音误拼", parts.replace("E3/8", "Fb3/8")],
    ["主调属七七音只换声部解决", parts.replace("B3/4 | C4/8", "B3/4 | Eb4/8").replace("F3/4 | Eb3/8", "F3/4 | C4/8")],
    ["副属七音向上而另一部代替预期落点", parts.replace("Ab3/4", "F4/4").replace("F3/4 Eb3/2", "Ab3/4 Eb3/2")],
    ["末主和弦不完整", parts.replace("G3/2", "C4/2")],
    ["延展中内声实际休止", parts.replace("F3/4 Eb3/2", "r/8 F3/8 Eb3/2")],
  ])("%s 时不能接长终止", (_name, score) => {
    expect(analyze(score).recovered).toBeUndefined();
  });

  it("下属占两拍时不按短内声扩展接长终止", () => {
    const prolonged = parts.replace("Ab3/4 G3/2", "Ab3/2 G3/4").replace("F3/4 Eb3/2", "F3/2 Eb3/4");
    const longerChords = labeled.replace("2:2,2:3", "2:2,2:4").replace("2:3,3:1", "2:4,3:1");
    expect(analyze(prolonged, longerChords).recovered).toBeUndefined();
  });

  it.each([4.5, 5, 6])("显式句界从第 %s 拍切断持续音取证", beat => {
    expect(analyze(parts, labeled, "Eb major", beat * PPQ).recovered).toBeUndefined();
  });

  it("冲突的应用目标不能借两个外声部持续取证", () => {
    expect(analyze(parts, labeled.replace("symbol=V7/IV", "symbol=V7/V")).recovered).toBeUndefined();
  });

  it("同一落点原已独立检出的补充终止仍沿用现有分类", () => {
    const { analysis, recovered } = analyze(parts, labeled.replaceAll(' localKey="C minor"', ""), "C minor");
    expect(recovered).toBeUndefined();
    expect(analysis.cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "supplementary", toTick: 8 * PPQ,
    }));
  });

  it("从正常盲推写回的不同局部小调获得同一结果", () => {
    const text = `satb 1
key G major
meter 4/4
bars 1..3 {
 S: | B4/1 | C5/4 D5/4 C5/4 B4/4 | A4/1 |
 A: | G4/1 | G#4/4 A4/4 A4/4 G#4/4 | A4/8 G4/8 F4/4 E4/2 |
 T: | D4/1 | F4/4 E4/4 F4/4 D4/4 | C4/8 C#4/8 D4/4 C4/2 |
 B: | G3/1 | B2/4 C3/4 D3/4 E3/4 | A2/1 |
}`;
    const { project } = compileScoreText(text);
    const applied = applyHarmonyInference(project, inferHarmony(project), { mode: "replace-unlocked" });
    const recovered = buildHarmonyAnalysis(applied.project).cadenceCandidates.find(c =>
      c.evidence.some(e => e.code === "closing-tonic-pedal"));
    expect(recovered).toMatchObject({ kind: "full", completion: "perfect", toTick: 12 * PPQ });
  });
});
