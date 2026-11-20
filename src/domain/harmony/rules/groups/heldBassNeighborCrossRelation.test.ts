import { describe, expect, it } from "vitest";
import { PPQ, type ProjectDocument } from "../../../project/types";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const eighth = PPQ / 2;
const rule = "voice-leading.cross-relation-simultaneous";

function neighbor({
  soprano = "A4/2.",
  alto = "D#4/2.",
  bass = "B2/8 A#2/8 B2/2",
  harmony = "",
}: { soprano?: string; alto?: string; bass?: string; harmony?: string } = {}) {
  return compileScoreText(`satb 1
key E major
meter 6/8
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | F#3/2. |
 B: | ${bass} |
}
${harmony}`).project;
}

function crossings(project: ProjectDocument, tick = eighth) {
  return checkHarmony(project).diagnostics
    .filter(diagnostic => diagnostic.ruleId === rule && diagnostic.tick === tick)
    .map(({ voiceIds, endTick, severity }) => ({ voiceIds, endTick, severity }));
}

const outer = { voiceIds: ["bass", "soprano"], endTick: PPQ, severity: "warning" };

describe("低音下方半音辅助遇到跨八度的持续异变音", () => {
  it("三上声部持续不重奏，弱位下行半音返回同一个完整属七，标签空白也静默", () => {
    expect(crossings(neighbor())).toEqual([]);
  });

  it("完整属七标签覆盖辅助段时仍按实奏上下文静默", () => {
    const project = neighbor({ harmony: 'annotations {\n chord base at=1:1 duration=1/2. symbol=D7\n}' });
    expect(crossings(project)).toEqual([]);
  });

  it("上声部重奏相同音高时，两个独立起奏的异变仍警告", () => {
    expect(crossings(neighbor({ soprano: "A4/8 A4/8 A4/2" }))).toEqual([outer]);
  });

  it("低音去往下一音的半音经过仍警告", () => {
    expect(crossings(neighbor({ bass: "B2/8 A#2/8 A2/2" }))).toEqual([outer]);
  });

  it("低音同字母原位改变升降号即使回到锚点也仍警告", () => {
    const project = neighbor({ soprano: "B4/2.", bass: "B2/8 Bb2/8 B2/2" });
    expect(crossings(project)).toEqual([outer]);
  });

  it("有独立起奏的其他和弦成员，低音回返不掩盖实际换和弦", () => {
    const project = neighbor({ alto: "D#4/8 C#4/8 D#4/2" });
    // F# major/A# sounds in the middle, with A4 held above it.
    expect(crossings(project)).toEqual([outer]);
  });

  it("外形相同但明确标出另一个实奏三和弦时保留异变诊断", () => {
    const project = neighbor({
      harmony: 'annotations {\n chord alternate at=1:2 duration=1/8 symbol=iii64 localKey="B major"\n}',
    });
    const chord = project.chordTrack.regions[0];
    expect(chord).toMatchObject({
      startTick: eighth, durationTicks: eighth,
      identity: { root: { step: "D", alter: 1 }, bass: { step: "A", alter: 1 }, structure: { quality: "minor" } },
    });
    expect(crossings(project)).toEqual([outer]);
  });

  it("辅助外形跨手动句界时继续检查", () => {
    const project = neighbor();
    project.structure.phraseBoundaries.push({ id: "boundary", tick: PPQ, source: "manual", confidence: "certain" });
    expect(crossings(project)).toEqual([outer]);
  });

  it("强拍开始的同形不借用弱位辅助音条件", () => {
    const project = compileScoreText(`satb 1
key E major
meter 3/4
bars 1..2 {
 S: | A4/2.~ | A4/2. |
 A: | D#4/2.~ | D#4/2. |
 T: | F#3/2.~ | F#3/2. |
 B: | B2/2. | A#2/4 B2/2 |
}
`).project;
    expect(crossings(project, 3 * PPQ)).toEqual([{ ...outer, endTick: 4 * PPQ }]);
  });

  it("相同音区的两个不同声部使用自然音和升音时仍警告", () => {
    const project = neighbor({ soprano: "C5/8 E#4/8 C5/2", alto: "E4/8 E4/8 E4/2", bass: "B2/2." });
    expect(crossings(project)).toEqual([{ ...outer, voiceIds: ["alto", "soprano"] }]);
  });
});
