import { describe, expect, it } from "vitest";
import { PPQ, type ProjectDocument } from "../../../project/types";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const rule = "voice-leading.overlap";

function atSecondBeat(
  project: ProjectDocument, strict = false, voices = ["alto", "soprano"],
) {
  const policy = strict ? { [rule]: { "same-harmony": "strict" } } as const : {};
  return checkHarmony(project, undefined, {}, policy).diagnostics
    .filter(diagnostic => diagnostic.ruleId === rule && diagnostic.tick === PPQ &&
      voices.every(voice => diagnostic.voiceIds.some(id => id === voice)))
    .map(({ tick, endTick, severity }) => ({ tick, endTick, severity }));
}

function expandsUnison({
  tenor = "B3/4 C4/4 G3/4 B3/4", bass = "G2/4 E3/4 E3/2", harmony = "r/4 I6/4 iii/2",
}: { tenor?: string; bass?: string; harmony?: string } = {}) {
  return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | G4/4 E6/2. |
 A: | G4/4 G5/4 B5/4 G5/4 |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${harmony} |
}`).project;
}

const warning = { tick: PPQ, endTick: 2 * PPQ, severity: "warning" };

describe("同度分开时的声部超越证据", () => {
  it.each(["r/4 I6/4 iii/2", "r/2 iii/2"])("还原实奏属到主六的超越 %s", harmony => {
    // G4/G4/B3/G2 -> E6/G5/C4/E3 before the unrelated E-minor revoicing.
    expect(atSecondBeat(expandsUnison({ harmony }))).toEqual([warning]);
  });

  it("出发和声不完整时仍报告越界", () => {
    const project = expandsUnison({ tenor: "G3/4 C4/4 G3/4 B3/4" });
    expect(atSecondBeat(project, true)).toEqual([warning]);
    expect(atSecondBeat(project)).toEqual([warning]);
  });

  it("到达低音与主六标签不符时仍报告越界", () => {
    const project = expandsUnison({ bass: "G2/4 Eb3/4 E3/2" });
    expect(atSecondBeat(project, true)).toEqual([warning]);
    expect(atSecondBeat(project)).toEqual([warning]);
  });

  it("局部属功能解释不使相邻连接的豁免生效", () => {
    const project = expandsUnison();
    const interpretation = project.chordTrack.regions[0].semantics!.interpretations[0];
    interpretation.localKey = { tonic: { step: "F", alter: 0 }, mode: "major" };
    interpretation.degree = 5;
    interpretation.designation = { notationSystem: "spasobin", kind: "primary", primaryFunction: "dominant" };
    expect(atSecondBeat(project, true)).toEqual([warning]);
    expect(atSecondBeat(project)).toEqual([warning]);
  });

  it("手动句界处仍检查实际越界", () => {
    const project = expandsUnison();
    project.structure.phraseBoundaries.push({ id: "boundary", tick: PPQ, source: "manual", confidence: "certain" });
    expect(atSecondBeat(project)).toEqual([warning]);
  });
});

it.each(["K46", "r"])("终止四六接属七只越二度时仍报告越界 %s", label => {
  const project = compileScoreText(`satb 1
key G major
meter 4/4
bars 1..1 {
 S: | B4/4 A4/4 D5/4 B4/4 |
 A: | G4/4 F#4/2 G4/4 |
 T: | D4/4 C4/2 B3/4 |
 B: | D4/4 D3/2 G2/4 |
 H: | ${label}/4 V7/2 I/4 |
}`).project;
  const pair = ["tenor", "bass"];
  expect(atSecondBeat(project, true, pair)).toEqual([warning]);
  expect(atSecondBeat(project, false, pair)).toEqual([warning]);
});

it("汇入同度的换和弦不借用下一连接的豁免", () => {
  const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | F4/4 G4/2. |
 A: | D4/4 G4/4 E4/4 G4/4 |
 T: | B3/4 E3/4 C4/4 E4/4 |
 B: | G2/4 C3/2. |
 H: | V7/4 I/2. |
}`).project;
  expect(atSecondBeat(project, true)).toEqual([warning]);
  expect(atSecondBeat(project)).toEqual([warning]);
  project.chordTrack.regions = [];
  expect(atSecondBeat(project)).toEqual([warning]);
});

it.each(["I/4 I6/2", "r/2."])("完整同和弦跨八度换位遵守默认和严格配置 %s", harmony => {
  const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | G4/4 C6/2 |
 A: | E4/4 G5/2 |
 T: | C4/4 C5/2 |
 B: | C3/4 E3/2 |
 H: | ${harmony} |
}`).project;
  expect(atSecondBeat(project, true)).toEqual([{ ...warning, endTick: 3 * PPQ }]);
  expect(atSecondBeat(project)).toEqual([]);
});

it("手动同和声的部分配声仍遵守用户配置的豁免和严格选项", () => {
  const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | G4/4 E5/2 |
 A: | E4/4 C5/2 |
 T: | r/2. |
 B: | r/2. |
 H: | I/2. |
}`).project;
  expect(atSecondBeat(project, true)).toEqual([{ ...warning, endTick: 3 * PPQ }]);
  expect(atSecondBeat(project)).toEqual([]);
});

function subdominantToMediant(harmony: string) {
  return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | A4/4 E6/2. |
 A: | A4/4 B5/4 C6/4 G5/4 |
 T: | C4/4 G3/4 G3/4 C4/4 |
 B: | F3/4 E3/4 E3/2 |
 H: | ${harmony} |
}`).project;
}

it("越过大九度的 IV→iii 由完整实奏取证", () => {
  expect(atSecondBeat(subdominantToMediant("IV/4 iii/4 I6/2"))).toEqual([warning]);
});

it("标签相冲突的两个不同实奏实体仍报告越界", () => {
  const project = subdominantToMediant("IV/4 I6/4 I6/2");
  expect(atSecondBeat(project, true)).toEqual([warning]);
  expect(atSecondBeat(project)).toEqual([warning]);
});

it("替代解释未决时仍报告实奏越界", () => {
  const project = subdominantToMediant("IV/4 iii/4 I6/2");
  project.chordTrack.regions[1].semantics!.interpretations[0].confidence = "ambiguous";
  expect(atSecondBeat(project, true)).toEqual([warning]);
  expect(atSecondBeat(project)).toEqual([warning]);
});

it("真实换和弦只越三度时仍报告越界", () => {
  const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | G4/4 E5/2. |
 A: | G4/4 B4/4 C5/4 G4/4 |
 T: | E4/4 G3/4 G3/4 C4/4 |
 B: | C3/4 E3/4 E3/2 |
 H: | I/4 iii/4 I6/2 |
}`).project;
  expect(atSecondBeat(project, true)).toEqual([warning]);
  expect(atSecondBeat(project)).toEqual([warning]);
});


it("下行离开同度时，iii→I 的跨八度超越也取实奏证据", () => {
  const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | B4/4 C4/4 E4/4 |
 A: | G4/4 G3/4 C4/4 |
 T: | E3/4 E2/2 |
 B: | E3/4 C2/2 |
 H: | iii/4 I/2 |
}`).project;
  expect(atSecondBeat(project, false, ["tenor", "bass"])).toEqual([warning]);
});

it("同和弦内从同度分开并越过整八度时，仍遵守同和声豁免", () => {
  const project = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | G4/4 C6/2 |
 A: | G4/4 G5/2 |
 T: | E4/2. |
 B: | C3/2. |
 H: | I/2. |
}`).project;
  expect(atSecondBeat(project, true)).toEqual([{ ...warning, endTick: 3 * PPQ }]);
  expect(atSecondBeat(project)).toEqual([]);
});

it.each([
  ["增七度实响十二个半音", "G#5", "B#4", "D#4 G#3 E4", "G#2/4 E3/2", "E5 B4", "III"],
  ["减八度实响只有十一个半音", "Ab5", "Cb5", "Eb4 C4 F4", "Ab2/4 F3/2", "F5 C5", "iv"],
])("%s 时仍检查实际越界", (_, soprano, alto, tenor, bass, nextAlto, label) => {
  const quarterNotes = (pitches: string) => pitches.split(" ").map(pitch => `${pitch}/4`).join(" ");
  const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | C4/4 ${soprano}/2. |
 A: | C4/4 ${alto}/4 ${quarterNotes(nextAlto)} |
 T: | E3/4 ${quarterNotes(tenor)} |
 B: | C3/4 ${bass} |
 H: | I/4 r/4 ${label}/2 |
}`).project;
  expect(atSecondBeat(project, true)).toEqual([warning]);
  expect(atSecondBeat(project)).toEqual([warning]);
});

it("汇入同度的换和弦不借用上一连接的豁免", () => {
  const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | F5/4 F4/4 G4/2 |
 A: | D4/2 G4/2 |
 T: | B3/2 E3/2 |
 B: | G2/2 C3/2 |
 H: | V7/2 I/2 |
}`);
  const match = expect.objectContaining({
    ruleId: rule, tick: 2 * PPQ, endTick: 4 * PPQ, severity: "warning",
    voiceIds: ["alto", "soprano"],
  });
  expect(checkHarmony(project).diagnostics).toContainEqual(match);
  project.chordTrack.regions = [];
  expect(checkHarmony(project).diagnostics).toContainEqual(match);
});

it.each(["E5/4 D5/4", "D5/2"])("两个实写和弦之间的超越不借用前一和弦的换位 %s", alto => {
  const { project } = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..2 {
  S: | F5/2 A5/4 | G5/2. |
  A: | ${alto} F#5/4 | F#5/4 E5/2 |
  T: | A4/2 B4/4 | B4/2. |
  B: | D4/2 D#4/4 | E4/2. |
  H: | ii/2 V65/III/4 | iii/2. |
}`);
  const match = expect.objectContaining({
    ruleId: rule, tick: 2 * project.ppq, voiceIds: expect.arrayContaining(["soprano", "alto"]),
  });
  expect(checkHarmony(project).diagnostics).toContainEqual(match);
});
