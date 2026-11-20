import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../index";
import type { ChordInferenceOptions } from "./types";

const parts = [
  "G4/4 Ab4/4 G4/4 | C5/2. | Bb4/2 A4/4 | G4/2.",
  "Eb4/4 D4/4 Eb4/4 | Ab4/2. | G4/2 F#4/4 | G4/2.",
  "Bb3/4 F3/4 Bb3/4 | Eb4/2. | D4/2 C4/4 | Bb3/2.",
  "Eb3/4 Bb2/4 Eb3/4 | Ab2/2 C3/4 | D3/2 D3/4 | G2/2.",
];
const code = "neapolitan-pivot-to-cadential-six-four";
function score(changes: Partial<Record<number, string>> = {}) {
  return compileScoreText(`satb 1
key Eb major
meter 3/4
bars 1..4 {
${parts.map((part, v) => "SATB"[v] + ": | " + (changes[v] ?? part) + " |").join("\n")}
}`).project;
}
type Project = ReturnType<typeof score>;
function run(project: Project, options?: ChordInferenceOptions) {
  const inference = inferChords(project, options);
  const at = (beat: number) => inference.regions.find(r => r.fromTick <= project.ppq * beat && project.ppq * beat < r.toTick);
  return { inference, at, hasPivot: inference.regions.some(r => r.selected?.evidence.some(e => e.code === code)) };
}
const key = { tonic: { step: "G", alter: 0 }, mode: "minor" };

describe("降二级共同和弦进入经证实的终止", () => {
  it("保留降 A 原位进入时的降 E 大调 IV，六和弦离开时在 g 小调承接", () => {
    const project = score();
    const { inference, at, hasPivot } = run(project);
    expect(hasPivot).toBe(true);
    expect(at(3)?.selected?.semantics).toMatchObject({
      interpretations: [{ localKey: key, degree: 2, degreeAlteration: -1 }, { degree: 4 }],
    });
    expect(at(3)?.selected?.semantics?.interpretations[1].localKey).toBeUndefined();
    expect(at(5)?.selected?.semantics?.interpretations).toMatchObject([
      { localKey: key, degree: 2, designation: { kind: "neapolitan" } },
    ]);
    expect(at(6)?.selected?.functionalBaseId).toBe("K46");
    expect(at(8)?.selected?.functionalBaseId).toBe("D");
    expect(at(9)?.selected?.functionalBaseId).toBe("t");
    const applied = applyHarmonyInference(project, { chordInference: inference }, { mode: "replace-unlocked", writeNonChordToneRoles: true });
    expect(applied.project.keyEvents).toEqual(project.keyEvents);
    expect(applied.project.satbTracks).toEqual(project.satbTracks);
    expect(checkHarmony(applied.project).diagnostics.some(d => d.ruleId === "tonality.pivot-reinterpretation")).toBe(false);
    const range = { fromTick: project.ppq * 5, toTick: project.ppq * 6 };
    expect(run(project, range).at(5)?.selected?.semantics).toEqual(at(5)?.selected?.semantics);
  });

  it("同一六和弦仅换一个上声部时，写成连续的双读区域", () => {
    const project = score({ 0: parts[0].replace("C5/2.", "Eb5/2 C5/4"), 3: parts[3].replace("Ab2/2 C3/4", "C3/2.") });
    const { at } = run(project);
    expect(at(3)).toBe(at(5));
    expect(at(3)?.selected?.semantics?.interpretations).toMatchObject([{ localKey: key, degree: 2 }, { degree: 4 }]);
  });

  it.each([
    ["旧调属七的七音未按原声部解决", { 0: parts[0].replace("Ab4/4 G4/4", "Ab4/4 Bb4/4") }],
    ["只有新调属三和弦", { 2: parts[2].replace("D4/2 C4/4", "D4/2 D4/4") }],
    ["目的调七音错声部", { 0: parts[0].replace("G4/2.", "Bb4/2."), 2: parts[2].replace("Bb3/2.", "G3/2.") }],
    ["降二级根音在共同和弦中改为同音异名", { 1: parts[1].replace("Ab4/2.", "G#4/2.") }],
    ["属低音换八度", { 3: parts[3].replace("D3/2 D3/4", "D3/2 D2/4") }],
    ["共同和弦的另一声部也重新发音", { 1: parts[1].replace("Ab4/2.", "Ab4/2 Ab4/4") }],
    ["降二级第三音未在原声部下行", { 0: parts[0].replace("Bb4/2", "G4/2"), 1: parts[1].replace("G4/2 F#4", "Bb4/2 F#4") }],
    ["后续回到原调主和弦", { 0: parts[0].replace("G4/2.", "Bb4/2."),
      2: parts[2].replace("Bb3/2.", "Eb4/2."), 3: parts[3].replace("G2/2.", "Eb3/2.") }],
  ] as const)("%s 不引入双重功能", (_reason, edit) => {
    expect(run(score(edit)).hasPivot).toBe(false);
  });

  it("短暂到 g 后立即经原属七落回降 E，保留实际短离调", () => {
    const project = score({
      0: parts[0].replace("G4/2.", "G4/4 Ab4/4 G4/4"),
      1: parts[1].replace("G4/2.", "G4/4 D4/4 Eb4/4"),
      2: parts[2].replace("Bb3/2.", "Bb3/4 F3/4 Bb3/4"),
      3: parts[3].replace("G2/2.", "G2/4 Bb2/4 Eb3/4"),
    });
    const { hasPivot, at } = run(project);
    expect(hasPivot).toBe(false);
    expect(at(11)?.selected?.functionalBaseId).toBe("T");
    expect(at(11)?.selected?.semantics?.interpretations[0].localKey).toBeUndefined();
  });

  it.each([2, 4, 6, 8, 9])("人工句界切断书写证据链，第 %i 拍", beat => {
    const project = score();
    project.structure.phraseBoundaries.push({ id: "cut", tick: beat * project.ppq, source: "manual", confidence: "certain" });
    expect(run(project).hasPivot).toBe(false);
  });

  it("后半另写调号时保留显式调性", () => {
    const project = score();
    project.keyEvents.push({ ...project.keyEvents[0], id: "printed", tick: 6 * project.ppq, tonic: { step: "G", alter: 0 }, mode: "minor" });
    expect(run(project).hasPivot).toBe(false);
  });
});
