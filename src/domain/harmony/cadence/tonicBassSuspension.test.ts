import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";

const imperfect = `satb 1
key D major
meter 3/4
bars 1..2 {
 S: | A4/2 G4/4~ | G4/4 F#4/2 |
 A: | F#4/2 E4/4~ | E4/4 D4/2 |
 T: | D4/2 C#4/4~ | C#4/4 D4/2 |
 B: | A2/2 A2/4 | D3/2. |
 H: | K46/2 V7/4 | r/4 I/2 |
}`;

const perfect = `satb 1
key Eb major
meter 3/4
bars 1..2 {
 S: | Ab5/2 F5/4~ | F5/4 Eb5/2 |
 A: | C5/2 Ab4/4~ | Ab4/4 G4/2 |
 T: | Eb4/2 D4/4~ | D4/4 Eb4/2 |
 B: | Ab2/2 Bb2/4 | Eb3/2. |
 H: | IV/2 V7/4 | r/4 I/2 |
}`;

function authentic(project: ReturnType<typeof compileScoreText>["project"]) {
  return buildHarmonyAnalysis(project).cadenceCandidates.find(
    cadence => cadence.kind === "full" && cadence.form === "authentic",
  );
}

describe("主低音先到、上三声部延留的正格终止", () => {
  it.each([
    ["属七音在高音，保持 K46 左界", imperfect, 0, "imperfect"],
    ["属五音在高音，落在主音", perfect, 1920, "perfect"],
  ])("%s", (_label, text, fromTick, completion) => {
    const { project } = compileScoreText(text);
    const chords = structuredClone(project.chordTrack);
    expect(authentic(project)).toMatchObject({
      fromTick, toTick: 5760, completion, confidence: "probable",
      evidence: expect.arrayContaining([expect.objectContaining({
        code: "tonic-bass-suspension",
        refs: expect.arrayContaining(["note-B-2880", "note-T-1920", "note-T-3840"]),
      })]),
    });
    expect(project.chordTrack).toEqual(chords);
    expect(buildHarmonyAnalysis(project).slices.find(slice => slice.tick === 2880)?.chord).toBeUndefined();
  });

  it.each([
    ["女高同音重奏", imperfect.replace("G4/4~ | G4/4", "G4/4 | G4/4")],
    ["女高未持续", imperfect.replace("G4/4~ | G4/4", "G4/4 | r/4")],
    ["低音未持续过解决", imperfect.replace("D3/2.", "D3/4 D3/2")],
    ["跨八度延留解决", imperfect.replace("F#4/2 |", "F#5/2 |")],
    ["属导音未升至主音", imperfect.replace("C#4/4 D4/2", "C#4/4 A3/2")],
    ["七音被另一声部接替", imperfect.replace("G4/4 F#4/2", "G4/4 D5/2").replace("E4/4 D4/2", "E4/4 F#4/2")],
    ["起始属七拼写错误", imperfect.replaceAll("C#4", "Db4")],
    ["中间已有独立和弦标注", imperfect.replace("r/4 I/2", "ii/4 I/2")],
  ])("%s 不用该证据补终止", (_label, text) => {
    expect(authentic(compileScoreText(text).project)).toBeUndefined();
  });

  it.each([2880, 3360, 3840])("句界 %i 阻断延留连接", tick => {
    const { project } = compileScoreText(imperfect);
    project.structure.phraseBoundaries.push({ id: "boundary", tick, source: "manual", confidence: "certain" });
    expect(authentic(project)).toBeUndefined();
  });

  it("延留中新增同名调事件也阻断连接", () => {
    const { project } = compileScoreText(imperfect);
    project.keyEvents.push({ ...project.keyEvents[0], id: "repeat-key", tick: 3360 });
    expect(authentic(project)).toBeUndefined();
  });
});
