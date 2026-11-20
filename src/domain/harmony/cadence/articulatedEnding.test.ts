import { describe, expect, it } from "vitest";
import { addCadenceAnnotation } from "../../editing";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";

const invertedAuthentic = `satb 1
key G major
meter 3/4
bars 1..4 {
 S: | B4/2. | C5/2 D5/4 | B4/2. | G4/4 B4/4 A4/4 |
 A: | G4/2. | G4/2 A4/4 | G4/2. | E4/4 G4/4 F#4/4 |
 T: | D4/2. | E4/2 D4/4 | D4/2. | C4/4 D4/4 D4/4 |
 B: | G3/2. | C3/2 F#3/4 | G3/2. | C3/4 B2/4 D3/4 |
 H: | I/2. | IV/2 V6/4 | I/2. | IV/4 I6/4 V/4 |
}`;

const deceptive = `satb 1
key C major
meter 3/4
bars 1..4 {
 S: | E5/2. | C5/2 B4/4 | C5/2. | A4/4 E5/4 D5/4 |
 A: | C5/2. | A4/2 F4/4 | E4/2. | F4/4 C5/4 B4/4 |
 T: | G4/2. | F4/2 D4/4 | C4/2. | C4/4 G4/4 G4/4 |
 B: | C3/2. | F3/2 G3/4 | A3/2. | F3/4 C3/4 G3/4 |
 H: | I/2. | IV/2 V7/4 | vi/2. | IV/4 I/4 V/4 |
}`;

const projectOf = (text: string) => compileScoreText(text).project;
const interior = (project: ReturnType<typeof projectOf>) =>
  buildHarmonyAnalysis(project).cadenceCandidates.find(c =>
    c.evidence.some(item => item.code === "articulated-interior-ending"));

describe("整小节齐收后的句内终止", () => {
  it.each([
    [invertedAuthentic, { kind: "full", form: "authentic", completion: "imperfect" }],
    [deceptive, { kind: "deceptive" }],
  ])("在整小节齐收时复用终止类型并可接受为标注", (text, expected) => {
    const project = projectOf(text);
    const before = structuredClone(project.structure);
    const cadence = interior(project);
    expect(cadence).toMatchObject({
      ...expected, fromTick: 4800, toTick: 8640, confidence: "probable",
      phraseId: "phrase-0-11520",
      evidence: expect.arrayContaining([expect.objectContaining({
        code: "articulated-interior-ending",
        refs: expect.arrayContaining(["note-B-5760", "note-B-8640"]),
      })]),
    });
    expect(project.structure).toEqual(before);
    if (!cadence) throw Error("Missing interior cadence");
    const added = addCadenceAnnotation(project, {
      id: "accepted", phraseId: cadence.phraseId, fromTick: cadence.fromTick, toTick: cadence.toTick,
      kind: cadence.kind, form: cadence.form, completion: cadence.completion,
      locked: false, source: "accepted-candidate", confidence: "probable",
    });
    expect(added.error).toBeUndefined();
    expect(buildHarmonyAnalysis(added.project).cadenceAnnotations).toEqual([
      expect.objectContaining({ id: "accepted", toTick: 8640 }),
    ]);
  });

  it.each([
    ["整小节内有同音重奏", invertedAuthentic.replace("D5/4 | B4/2.", "D5/4 | B4/4 B4/2")],
    ["落点后没有短节奏重启", invertedAuthentic
      .replace("G4/4 B4/4 A4/4", "G4/2.")
      .replace("E4/4 G4/4 F#4/4", "E4/2.")
      .replace("C4/4 D4/4 D4/4", "C4/2.")
      .replace("C3/4 B2/4 D3/4", "C3/2.")
      .replace("IV/4 I6/4 V/4", "IV/2.")],
    ["低音中的导音越八度", invertedAuthentic.replace("F#3/4 | G3", "F#2/4 | G3")],
    ["阻碍落点的导音未升", deceptive.replace("B4/4 | C5/2.", "B4/4 | A4/2.")],
    ["属七音跳向 VI 三音", deceptive.replace("F4/4 | E4/2.", "F5/4 | E4/2.")],
    ["源和弦未确定为属功能", invertedAuthentic.replace("IV/2 V6/4", "IV/2 ii6/4")],
  ])("%s 保留为普通句内进行", (_label, text) => {
    expect(interior(projectOf(text))).toBeUndefined();
  });

  it("人工句界仍由既有终止路径处理", () => {
    const project = projectOf(invertedAuthentic);
    project.structure.phraseBoundaries.push({ id: "manual", tick: 8640, confidence: "certain", source: "manual" });
    const candidates = buildHarmonyAnalysis(project).cadenceCandidates.filter(c => c.toTick === 8640);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "full", fromTick: 2880 });
    expect(candidates[0].evidence.some(item => item.code === "articulated-interior-ending")).toBe(false);
  });
});
