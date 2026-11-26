import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { analyzePhrases, inferPhrases } from "./analyze";

const dominantPickup = `satb 1
key C major
meter 4/4
bars 1..8 {
 S: | E5/1 | F5/1 | E5/1 | C5/2 D5/2 | F5/4 E5/2. | A4/1 | D5/1 | C5/1 |
 A: | G4/1 | A4/1 | G4/1 | G4/2 G4/2 | G4/4 G4/2. | F4/1 | G4/1 | G4/1 |
 T: | C4/1 | C4/1 | C4/1 | E4/2 B3/2 | D4/4 C4/2. | C4/1 | B3/1 | E4/1 |
 B: | C3/1 | F3/1 | C3/1 | C3/2 G2/2 | B2/4 C3/2. | F3/1 | G2/1 | C3/1 |
 H: | I/1 | IV/1 | I/1 | I/2 V/2 | V65/4 I/2. | IV/1 | V/1 | I/1 |
}`;

const interrupted = `satb 1
key C major
meter 3/4
bars 1..8 {
 S: | E5/2. | F5/2. | G5/2. | E5/4 D5/2 | C5/4. E5/8 F5/4 | G5/2. | D5/2. | C5/2. |
 A: | G4/2. | A4/2. | G4/2. | G4/4 G4/4 F4/4 | E4/4. A4/8 A4/4 | G4/2. | G4/2. | G4/2. |
 T: | C4/2. | C4/2. | E4/2. | C4/4 B3/2 | C4/2 C4/4 | E4/2. | B3/2. | E4/2. |
 B: | C3/2. | F3/2. | C3/2. | G2/2. | A2/2. | C3/2. | G2/2. | C3/2. |
 H: | I/2. | IV/2. | I/2. | K46/4 V/4 V7/4 | vi/2 IV6/4 | I/2. | V/2. | I/2. |
}`;

const projectOf = (score: string) => compileScoreText(score).project;
function releases(score: string) {
  const project = projectOf(score);
  return inferPhrases(project).template.boundaries.filter(c => c.evidence.some(e => e.code === "articulated-release"))
    .map(c => c.tick / project.ppq);
}

describe("收束后实际起奏的句界", () => {
  it("齐收的原位属后，四声在属六五重起并解决到主", () => {
    expect(releases(dominantPickup)).toEqual([16]);
  });

  it("弱拍的属六五弱起凭延续过下拍的旋律进入候选", () => {
    const score = dominantPickup
      .replace("C5/2 D5/2 | F5/4", "C5/4 D5/2 F5/4~ | F5/4")
      .replace("G4/2 G4/2 | G4/4", "G4/4 G4/2 G4/4 | G4/4")
      .replace("E4/2 B3/2 | D4/4", "E4/4 B3/2 D4/4 | C4/4")
      .replace("C3/2 G2/2 | B2/4", "C3/4 G2/2 B2/4 | C3/4")
      .replace("I/2 V/2 | V65/4 I/2.", "I/4 V/2 V65/4 | I/1");
    expect(releases(score)).toEqual([15]);
    expect(releases(score.replace("F5/4~", "F5/4"))).toEqual([]);
  });

  it("双外声同节奏移位模进优先于属六五的齐奏", () => {
    const score = dominantPickup
      .replace("C5/2 D5/2 | F5/4 E5/2.", "D5/4 C5/4 D5/2 | F5/4 E5/4 F5/2")
      .replace("C3/2 G2/2 | B2/4 C3/2.", "F2/4 G2/4 G2/2 | B2/4 C3/4 C3/2");
    const project = projectOf(score);
    const result = analyzePhrases(project, { includeEventRejections: true });
    expect(result.eventRejections).toContainEqual({ tick: 16 * project.ppq, reason: "uninterrupted-sequence" });
    expect(releases(score)).toEqual([]);
  });

  it.each([
    ["持续属延长", dominantPickup.replace("V65/4 I/2.", "V65/4 V/2.")],
    ["普通换和弦", dominantPickup.replace("V65/4 I/2.", "ii6/4 I/2.")],
    ["内声连过起点", dominantPickup.replace("G4/2 G4/2 | G4/4", "G4/2 G4/2~ | G4/4")],
    ["没有实奏七音", dominantPickup.replace("F5/4 E5/2.", "D5/4 E5/2.")],
  ])("%s 不提供重起证据", (_name, score) => expect(releases(score)).toEqual([]));

  it("六级持续低音上的弱位重起决定阻碍终止的右界", () => {
    expect(releases(interrupted)).toEqual([13.5]);
    const project = projectOf(interrupted);
    project.structure.phraseBoundaries = [...inferPhrases(project).boundaries];
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "deceptive", fromTick: 9 * project.ppq, landingTick: 12 * project.ppq, toTick: 13.5 * project.ppq,
    }));
  });

  it.each([
    ["无终止四六准备", interrupted.replace("K46/4", "I64/4")],
    ["内声未重起", interrupted.replace("E4/4. A4/8", "E4/2")],
    ["低音重新起奏", interrupted.replace("A2/2.", "A2/4. A2/4.")],
  ])("%s 保留六级内的连贯", (_name, score) => expect(releases(score)).toEqual([]));

  it.each(["manual", "inferred"] as const)("尊重证据区间内的 %s 锚点", source => {
    const project = projectOf(interrupted);
    const boundary = { id: "fixed", tick: 12 * project.ppq, source, locked: source === "inferred", confidence: "certain" as const };
    project.structure.phraseBoundaries = [boundary];
    const result = inferPhrases(project);
    expect(result.boundaries).toContainEqual(expect.objectContaining(boundary));
    expect(result.candidates.some(c => c.evidence.some(e => e.code === "articulated-release"))).toBe(false);
  });

  it("前置齐休后的第一响有独立追踪原因", () => {
    const project = projectOf(dominantPickup);
    for (const track of project.satbTracks) track.notes.shift();
    project.chordTrack.regions.shift();
    const result = analyzePhrases(project, { includeEventRejections: true, includeInferredBoundaries: true });
    expect(result.eventRejections).toContainEqual({ tick: 4 * project.ppq, reason: "effective-opening" });
    expect(result.boundaries.some(b => b.tick === 4 * project.ppq)).toBe(false);
  });
});
