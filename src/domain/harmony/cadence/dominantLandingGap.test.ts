import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";

const auxiliary = `satb 1
key B minor
meter 3/4
bars 1..2 {
 S: | F#5/2 C#5/8 D5/8 | B4/2. |
 A: | B4/2 A#4/4 | F#4/2. |
 T: | D4/2 E4/4~ | E4/4 D4/2 |
 B: | F#2/2. | B2/2. |
 H: | K46/2 V7/8 r/8 | i/2. |
}`;

const revoiced = `satb 1
key C major
meter 3/4
bars 1..2 {
 S: | A4/2 D5/8 G5/8 | C5/2. |
 A: | F4/2 B4/4 | C5/2. |
 T: | D4/2 G4/4 | G4/2. |
 B: | F3/2. | E3/2. |
 H: | ii6/2 V2/8 r/8 | I6/2. |
}`;

function authenticCadence(project: ReturnType<typeof compileScoreText>["project"]) {
  return buildHarmonyAnalysis(project).cadenceCandidates.find(
    candidate => candidate.kind === "full" && candidate.form === "authentic",
  );
}

describe("终止前属七的弱位女高换音", () => {
  it.each([
    ["原位属七、女高辅助音与落主七音延留", auxiliary, 0, "perfect"],
    ["属二、女高转到根音后落主六", revoiced, 1920, "imperfect"],
  ])("%s 的半拍留白可证明连续的属到主", (_label, text, fromTick, completion) => {
    const { project } = compileScoreText(text);
    const originalChordTrack = structuredClone(project.chordTrack);
    expect(authenticCadence(project)).toMatchObject({
      fromTick, toTick: 5760, completion, confidence: "probable",
      evidence: expect.arrayContaining([expect.objectContaining({ code: "dominant-before-tonic-gap" })]),
    });
    expect(project.chordTrack).toEqual(originalChordTrack);
  });

  it.each([
    ["内声部同音重奏", auxiliary.replace("E4/4~ | E4/4", "E4/8 E4/8~ | E4/4")],
    ["低音同音重奏", auxiliary.replace("F#2/2.", "F#2/2 F#2/8 F#2/8")],
    ["女高等音异名", auxiliary.replace("D5/8", "C##5/8")],
    ["七音延留后跳进", auxiliary.replace("E4/4 D4/2", "E4/4 F#4/2")],
    ["标为属二但男高低于标注的低音", revoiced.replace("G4/4 | G4/2.", "G2/4 | G2/2.")],
    ["七音解决前已实奏另一组三和弦", auxiliary
      .replace("B4/2. |", "B4/8 G4/8 B4/2 |")
      .replace("F#4/2. |", "F#4/8 E4/8 F#4/2 |")],
    ["实际最高声部未落到主音", auxiliary.replace("A#4/4 | F#4/2.", "A#5/4 | F#5/2.")],
    ["属二的七音未下行", revoiced.replace("E3/2.", "C3/2.")],
    ["缺乏已确认的完整属七准备", auxiliary.replace("V7/8 r/8", "r/4")],
    ["完整书写和弦的留白", auxiliary.replace("D5/8", "C#6/8")],
    ["弱位已有独立和声标注", auxiliary.replace("V7/8 r/8", "V7/8 iv/8")],
  ])("%s 不凭留白产生新终止", (_label, text) => {
    expect(authenticCadence(compileScoreText(text).project)).toBeUndefined();
  });

  it.each([2400, 2640, 2880])("明确句界位于 %i 时阻断留白连接", tick => {
    const { project } = compileScoreText(auxiliary);
    project.structure.phraseBoundaries.push({ id: "boundary", tick, source: "manual", confidence: "certain" });
    expect(authenticCadence(project)).toBeUndefined();
  });

  it("留白内同主音调号事件也阻断连接", () => {
    const { project } = compileScoreText(auxiliary);
    project.keyEvents.push({ ...project.keyEvents[0], id: "new-key", tick: 2640 });
    expect(authenticCadence(project)).toBeUndefined();
  });
});
