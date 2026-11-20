import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";

const score = `satb 1
key D minor
meter 4/4
bars 1..2 {
  S: | D5/4 r/4 E5/4 r/4 | D5/4 r/2. |
  A: | Bb4/4 r/4 G4/4 r/4 | F4/4 r/2. |
  T: | G4/4 r/4 C#4/4 r/4 | A3/4 r/2. |
  B: | G3/4 r/4 A2/4 r/4 | D3/4 r/2. |
  H: | iv/4 r/4 V7/4 r/4 | i/4 r/2. |
}`;

function analyze(text: string, cut?: number) {
  const { project } = compileScoreText(text);
  if (cut !== undefined) {
    project.structure.phraseBoundaries = [{ id: "cut", tick: cut, source: "manual", confidence: "certain" }];
  }
  return buildHarmonyAnalysis(project).cadenceCandidates.find(c =>
    c.kind === "full" && c.fromTick === 2 * project.ppq && c.toTick === 5 * project.ppq);
}

describe("顿奏节奏中的句末正格终止", () => {
  it.each([
    ["完整主和弦", score],
    ["三声写出主音、三音与旋律收束", score.replace("A3/4 r/2.", "r/1")],
  ])("%s 保留属七到主的实际起止", (_label, text) => {
    expect(analyze(text)).toMatchObject({
      form: "authentic", completion: "perfect", confidence: "probable",
      evidence: expect.arrayContaining([expect.objectContaining({ code: "detached-dominant-to-tonic" })]),
    });
  });

  it.each([
    ["低音在属七后的空隙仍响", score.replace("A2/4 r/4", "A2/2")],
    ["休止中掺入新旋律", score.replace("E5/4 r/4", "E5/4 D5/4")],
    ["属七标签与实奏七音不合", score.replace("G4/4 r/4 | F4", "E4/4 r/4 | F4")],
    ["低音先到另一个落点", score.replace("D3/4 r/2.", "A2/4 r/2.")],
    ["落点只有主音与五音", score.replace("F4/4 r/2.", "A4/4 r/2.")],
    ["准备和弦在初次休止期间持续", score.replace("Bb4/4 r/4", "Bb4/2")],
    ["强拍落点后仍有新乐音", score.replace("D5/4 r/2.", "D5/4 r/4 A4/2")],
    ["两次齐休的长度不同", score.replaceAll("/4 r/4 |", "/8 r/4. |").replace("V7/4 r/4", "V7/8 r/4.")],
    ["没有实写下属准备", score.replace("iv/4 r/4", "r/2")],
    ["谱中途明确另标一段和声", score.replace("V7/4 r/4", "V7/4 vi/4")],
    ["准备或落点的调号不符", score.replace("key D minor", "key G minor")],
  ])("%s 保留两侧的分隔", (_label, text) => {
    expect(analyze(text)).toBeUndefined();
  });

  it("同名调号在全休中重新起算时，保留调性边界", () => {
    const { project } = compileScoreText(score);
    project.keyEvents.push({ ...project.keyEvents[0], id: "retake", tick: 3000 });
    expect(buildHarmonyAnalysis(project).cadenceCandidates.some(c => c.kind === "full")).toBe(false);
  });

  it.each([2880, 3840])("尊重属和弦释放或主和弦起奏处的明确句界 %i", tick => {
    expect(analyze(score, tick)).toBeUndefined();
  });
});
