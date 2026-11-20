import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const contrary = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | E5/8 D5/8 C5/2. |
 A: | G4/1 |
 T: | C4/8 D4/8 E4/2. |
 B: | C3/1 |
 H: | I/1 |
}`;

const neighbor = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | C4/1 |
 A: | G3/1 |
 T: | E3/8 D3/8 E3/2. |
 B: | G2/1 |
 H: | I64/1 |
}`;

function warnings(score: string, boundary = false) {
  const { project } = compileScoreText(score);
  project.chordTrack.regions[0].durationTicks = project.ppq;
  if (boundary) project.structure.phraseBoundaries = [{
    id: "break", tick: project.ppq, source: "manual", confidence: "certain",
  }];
  return checkHarmony(project).diagnostics.filter(d =>
    d.tick === project.ppq / 2 && ["chord.unclassified-nonchord-tone", "chord.incomplete-members"].includes(d.ruleId),
  ).map(d => d.ruleId).sort();
}

const bothWarnings = ["chord.incomplete-members", "chord.unclassified-nonchord-tone"];

describe("从标签后的实际配置核对弱位外音和缺音", () => {
  it("反向经过音与单下辅助音均可通过同一和声的实奏核对", () => {
    expect(warnings(contrary)).toEqual([]);
    expect(warnings(neighbor)).toEqual([]);
  });

  it.each([
    ["右端缺少应回的三音", neighbor.replace("D3/8 E3", "D3/8 D3")],
    ["另一声部重新起奏", contrary.replace("G4/1", "G4/4 G4/2.")],
    ["不同书写的实际音级", contrary.replace("D4/8", "D#4/8")],
    ["右端另有明确标签", contrary.replace("I/1", "I/4 vi/2.")],
  ])("%s 保留原拍两条警告", (_reason, score) => {
    expect(warnings(score)).toEqual(bothWarnings);
  });

  it("手动句界在恢复音处切断证据", () => {
    expect(warnings(neighbor, true)).toEqual(bothWarnings);
  });
});
