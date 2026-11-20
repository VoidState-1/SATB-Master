import { describe, expect, it } from "vitest";
import { addCadenceAnnotation } from "../../editing";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { annotationFromCadenceCandidate } from "./confirmation";

const anticipation = `satb 1
key C major
meter 2/4
bars 1..3 {
 S: | E4/2 | F4/4 F4/8 E4/8 | E4/2 |
 A: | C4/2 | C4/4 B3/4 | C4/2 |
 T: | G3/2 | A3/4 G3/4 | G3/2 |
 B: | C3/2 | F3/4 D3/8 C3/8 | C3/2 |
 H: | I/2 | IV/4 V43/8 r/8 | I/2 |
}`;

const delay = `satb 1
key D major
meter 3/4
bars 1..2 {
 S: | F#4/2 C#5/4 | E5/8. D5/16 D5/2 |
 A: | D4/2 G4/4~ | G4/8. F#4/16 F#4/2 |
 T: | A3/2 A3/4~ | A3/2. |
 B: | D3/2 A2/4 | D3/2. |
 H: | I/2 V7/4 | r/2. |
}
annotations {
 chord goal range=[2:1+3/4,3:1) symbol=I
}`;

type Project = ReturnType<typeof compileScoreText>["project"];

function closingCadence(p: Project) {
  return buildHarmonyAnalysis(p).cadenceCandidates.find(
    candidate => candidate.kind === "full" && candidate.form === "authentic",
  );
}

function stagedCadence(p: Project) {
  const candidate = closingCadence(p);
  return candidate?.evidence.some(evidence => evidence.code === "staged-tonic-arrival")
    ? candidate : undefined;
}

describe("主低音先于完整主和弦到达的正格终止", () => {
  it.each([
    ["弱位先现重奏", anticipation, 2880, 3840, 5760, "imperfect"],
    ["强拍提前落主并持续", delay, 1920, 3600, 5760, "perfect"],
  ])("%s，落点取上方声部完成解决的位置", (_label, text, fromTick, landing, toTick, completion) => {
    const project = compileScoreText(text).project;
    const expected = { fromTick, toTick, observedLandingTick: landing, completion, confidence: "probable" };
    const chords = structuredClone(project.chordTrack);
    const saved = stagedCadence(project);
    expect(saved).toMatchObject(expected);
    expect(project.chordTrack).toEqual(chords);
    const updated = addCadenceAnnotation(project, annotationFromCadenceCandidate(saved!, "arrival"));
    expect(updated.error).toBeUndefined()
    expect(buildHarmonyAnalysis(updated.project).cadenceAnnotations).toContainEqual(expect.objectContaining({
      id: "arrival", observedLandingTick: landing, stale: false,
    }));
  });

  it.each([
    ["主低音晚到", anticipation.replace("D3/8 C3/8", "D3/4")],
    ["持续导音等音改写", anticipation.replace("B3/4", "Cb4/4")],
    ["在先到低音上重奏未解决音", anticipation.replace("C4/4 B3/4", "C4/4 B3/8 B3/8")],
    ["空档包含已标独立和弦", anticipation.replace("V43/8 r/8", "V43/8 IV/8")],
    ["七音跨八度后才到三音", delay.replaceAll("F#4/16 F#4/2", "F#3/16 F#3/2")],
  ])("%s，缺少先到连接的充分证据", (_label, text) => {
    expect(stagedCadence(compileScoreText(text).project)).toBeUndefined();
  });

  it("未完成解决时经过换调或手动句界，候选不跨界", () => {
    const project = compileScoreText(delay).project;
    const { ppq } = project;
    const keySplit = structuredClone(project);
    keySplit.keyEvents.push({ ...keySplit.keyEvents[0], id: "written-key", tick: ppq * 3.5 });
    expect(stagedCadence(keySplit)).toBeUndefined();
    project.structure.phraseBoundaries.push({
      id: "split", tick: ppq * 3.5, source: "manual", confidence: "certain",
    });
    expect(stagedCadence(project)).toBeUndefined();
  });

  it("持续超过一记谱拍，后来的主和弦不能补认这次落点", () => {
    const text = delay.replace("E5/8. D5/16 D5/2", "E5/4. D5/4.")
      .replace("G4/8. F#4/16 F#4/2", "G4/4. F#4/4.")
      .replace("2:1+3/4", "2:2+1/2");
    expect(stagedCadence(compileScoreText(text).project)).toBeUndefined();
  });
});
