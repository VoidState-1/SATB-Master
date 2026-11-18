import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords } from "./inferChords";

function ascendingFourthChain(firstSeventh = "D5", secondSoprano = "C5", secondTenor = "E4") {
  return compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
 S: | ${firstSeventh}/2 | ${secondSoprano}/2 | C5/2 |
 A: | G4/2 | G4/2 | F4/2 |
 T: | B3/2 | ${secondTenor}/2 | A3/2 |
 B: | E3/2 | A2/2 | D3/2 |
}`).project;
}

describe("自然音副七和弦的模进推导", () => {
  it("用同声部七音下行辨认 iii7 与 vi7", () => {
    const project = ascendingFourthChain();
    const regions = inferChords(project).regions;
    expect(regions[0].selected).toMatchObject({
      functionalBaseId: "DTIII", identity: { root: { step: "E", alter: 0 }, structure: { quality: "minor7" } },
      evidence: expect.arrayContaining([expect.objectContaining({ code: "diatonic-seventh-sequence" })]),
    });
    expect(regions.find(region => region.fromTick === 2 * project.ppq)?.selected).toMatchObject({
      functionalBaseId: "TSVI", identity: { root: { step: "A", alter: 0 }, structure: { quality: "minor7" } },
    });
  });

  it.each([
    ["D5", "E5", "C4"],
    ["C##5", "C5", "E4"],
  ])("%s→%s 缺少规范拼写或同声部下行解决", (firstSeventh, secondSoprano, secondTenor) => {
    const regions = inferChords(ascendingFourthChain(firstSeventh, secondSoprano, secondTenor)).regions;
    expect([regions[0].selected, ...regions[0].alternatives].some(candidate =>
      candidate?.evidence.some(evidence => evidence.code === "diatonic-seventh-sequence"),
    )).toBe(false);
  });

  it("两个相邻转位之间的单声部和弦内换音仍可确认七和弦", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..2 {
 S: | E4/4 A4/4 | G4/2 |
 A: | C4/2 | E4/2 |
 T: | A3/2 | C4/2 |
 B: | G3/2 | A3/2 |
}`).project;
    const regions = inferChords(project).regions;
    expect(regions[0].selected?.identity).toMatchObject({ root: { step: "A" }, bass: { step: "G" }, structure: { quality: "minor7" } });
    expect(regions.find(region => region.fromTick === 2 * project.ppq)?.selected?.identity)
      .toMatchObject({ root: { step: "A" }, bass: { step: "A" }, structure: { quality: "minor7" } });
  });

  it("自然小调主七和弦使用自然 VII 而非升导音", () => {
    const project = compileScoreText(`satb 1
key G minor
meter 2/4
bars 1..2 {
 S: | F4/2 | Eb4/2 |
 A: | D4/2 | G4/2 |
 T: | Bb3/2 | C4/2 |
 B: | G2/2 | C3/2 |
}`).project;
    expect(inferChords(project).regions[0].selected).toMatchObject({
      functionalBaseId: "t", identity: { structure: { quality: "minor7" } },
    });
  });

  it("属七共用音重奏后识别主大七，随后回到主三和弦", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
 S: | B4/2 | B4/2 | C5/2 |
 A: | F4/2 | E4/2 | E4/2 |
 T: | D4/2 | C4/2 | G3/2 |
 B: | G2/2 | G3/2 | C3/2 |
}`).project;
    expect(inferChords(project).regions.find(region => region.fromTick === 2 * project.ppq)?.selected)
      .toMatchObject({ functionalBaseId: "T", identity: { structure: { quality: "major7" } } });
  });
});
