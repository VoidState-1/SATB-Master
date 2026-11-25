import { describe, expect, it } from "vitest";
import { functionalTargetForDegree } from "../../../../chordModel";
import { compileScoreText } from "../../../../scoreText";
import type { ProjectDocument } from "../../../../project/types";
import { checkHarmony } from "../../..";

function score(text: string) {
  return compileScoreText("satb 1\n" + text).project;
}

function cut(project: ProjectDocument, beat: number) {
  project.structure.phraseBoundaries.push({
    id: "manual-cut", tick: beat * project.ppq, source: "manual", confidence: "certain",
  });
  return project;
}

function findings(project: ProjectDocument, rule: string, beat?: number) {
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === rule && (beat === undefined || d.tick === beat * project.ppq));
}

describe("规则检查第二批的成对结构证据", () => {
  const inversion = "chord.inversion-bass";
  const passing = "nonchord.passing-tone";
  const incomplete = "chord.incomplete-members";
  const unclassified = "chord.unclassified-nonchord-tone";
  const applied = "function.applied-dominant-target";
  const inversion64 = "connection.second-inversion-context";
  const leading = "resolution.leading-tone";

  const passingSeventh = `key C major
meter 4/4
bars 1..2 {
 S: | D5/1 | C5/1 |
 A: | B4/1 | G4/1 |
 T: | F4/1 | C4/1 |
 B: | G3/2. F3/4@p | E3/1 |
 H: | V7/1 | I6/1 |
}
annotations {
 note p role=passing
}`;

  it("属七音仍可兼作 G–F–E 的线性低音", () => {
    const project = score(passingSeventh);
    expect(findings(project, inversion, 3)).toEqual([]);
    expect(findings(project, passing, 3)).toEqual([]);
  });

  it.each([
    ["反向跳进", "G3/2. F3/4", "D3/2. F3/4", undefined],
    ["准备中有休止", "G3/2. F3/4", "G3/2 r/4 F3/4", undefined],
    ["整段错转位", "V7/1 | I6/1", "V65/1 | I6/1", undefined],
    ["跨人工句界", "G3/2. F3/4", "G3/2. F3/4", 4],
  ] as const)("%s 时不能把属七音视为结构低音的替代", (_label, from, to, boundary) => {
    const project = score(passingSeventh.replace(from, to));
    if (boundary !== undefined) cut(project, boundary);
    expect(findings(project, inversion, 3)).toHaveLength(1);
    if (from !== "V7/1 | I6/1") expect(findings(project, passing, 3)).toHaveLength(1);
  });

  const group = `key B minor
meter 4/4
bars 1..2 {
 S: | F#4/2.. D5/8@s | D5/1 |
 A: | F#4/1 | F#4/1 |
 T: | C#4/2.. B3/8@t | B3/1 |
 B: | A#3/2.. B3/8@b | B3/1 |
 H: | V6/1 | i/1 |
}
annotations {
 note s role=anticipation
 note t role=anticipation
 note b role=anticipation
}`;

  it("同一组先现指向真实落点时恢复前一和弦实写三音与五音", () => {
    const project = score(group);
    expect(findings(project, incomplete, 3.5)).toEqual([]);
    expect(findings(project, inversion, 3.5)).toEqual([]);
  });

  it.each([
    ["整个源和弦真缺三音", "A#3/2..", "C#3/2.."],
    ["一个先现声部没有落在同音区", "B3/8@t | B3/1", "B3/8@t | B4/1"],
  ])("%s 时保留先现拍的缺音", (_label, from, to) => {
    expect(findings(score(group.replace(from, to)), incomplete, 3.5)).toHaveLength(1);
  });

  const seventhPreparation = `key C major
meter 4/4
bars 1..2 {
 S: | B4/1 | C5/1 |
 A: | G4/1 | G4/1 |
 T: | F4/1@prep | F4/4 E4/2. |
 B: | G2/1 | C3/1 |
 H: | V7/1 | I/1 |
}
annotations {
 note prep role=suspension
}`;

  it("前一属七中已实写的七音同高重奏并级进落地时只解释当前外音", () => {
    expect(findings(score(seventhPreparation), unclassified, 4)).toEqual([]);
  });

  it.each([
    ["准备休止", "F4/1@prep", "F4/2.@prep r/4"],
    ["落点跳离", "E4/2.", "C4/2."],
  ])("%s 时保留未分类外音", (_label, from, to) => {
    expect(findings(score(seventhPreparation.replace(from, to)), unclassified, 4)).toHaveLength(1);
  });

  const chromaticReturn = `key D minor
meter 4/4
bars 1..1 {
 S: | D5/1 |
 A: | A4/1 |
 T: | F4/4 F#4/8 G4/8 F4/2 |
 B: | D3/1 |
 H: | i/1 |
}`;

  it("同一和声内的半音辅助回归框覆盖两个外音切片", () => {
    expect(findings(score(chromaticReturn), unclassified)).toEqual([]);
  });

  it.each([
    ["离开时跳进而不是返回或继续级进", "G4/8 F4/2", "G4/8 C#4/2"],
    ["回归前插入休止", "G4/8 F4/2", "r/8 F4/2"],
    ["没有持续的结构低音", "D3/1", "D3/4 A3/4 D3/2"],
  ])("%s 时染色外音仍需确认", (_label, from, to) => {
    expect(findings(score(chromaticReturn.replace(from, to)), unclassified, 1)).toHaveLength(1);
  });

  const appliedChain = `key C major
meter 4/4
bars 1..1 {
 S: | A4/4 F#4/4 E4/4 D5/4 |
 A: | D4/4 C4/4 C4/4 B4/4 |
 T: | F#3/4 D3/4 G3/4 G3/4 |
 B: | D3/4 A2/4 G2/4 G2/4 |
 H: | V/V/4 V43/V/4 K46/4 V/4 |
}`;

  it("换位、加七和书写 K46 只延迟结案，真正的属和弦解决义务", () => {
    expect(findings(score(appliedChain), applied)).toEqual([]);
  });

  it("带相同目标标签但实谱没有落到目标，仍在最后的实写副属链之后报告", () => {
    const wrong = score(appliedChain.replace("B4/4 |", "C5/4 |"));
    expect(findings(wrong, applied, 3)).toMatchObject([{
      chordIds: expect.arrayContaining([wrong.chordTrack.regions[1].id, wrong.chordTrack.regions[3].id]),
    }]);
  });

  it("句界或不同真实目标不能借用后面的结案", () => {
    expect(findings(cut(score(appliedChain), 3), applied, 3)).toHaveLength(1);
    const different = score(appliedChain);
    different.chordTrack.regions[1].semantics!.interpretations[0].appliedTarget = functionalTargetForDegree(4);
    expect(findings(different, applied, 1)).toHaveLength(1);
  });

  const auxiliary = `key C major
meter 4/4
bars 1..1 {
 S: | D5/4 E5/4 Eb5/4 D5/4 |
 A: | B4/4 C5/4 C5/4 B4/4 |
 T: | F4/4 G4/4 G4/4 G4/4 |
 B: | G2/1 |
}
annotations {
 chord source range=[1:1,1:2) symbol=V7
 chord major range=[1:2,1:3) symbol=I64 role=pedal64
 chord minor range=[1:3,1:4) symbol=i64 role=pedal64
 chord return range=[1:4,2:1) symbol=V
}`;

  it("大小调变化在同一个实际持音上共用两端的回归框", () => {
    expect(findings(score(auxiliary), inversion64)).toEqual([]);
  });

  it.each([
    ["踏板换八度", "G2/1", "G2/2 G3/4 G2/4"],
    ["声明了经过四六但低音没有非零级进", "symbol=i64 role=pedal64", "symbol=i64 role=passing64"],
    ["未回到原和弦", "symbol=V\n", "symbol=iii\n"],
  ])("%s 时不能借用复合回归", (_label, from, to) => {
    expect(findings(score(auxiliary.replace(from, to)), inversion64)).not.toEqual([]);
  });

  it("复合回归不得跨人工句界", () => {
    expect(findings(cut(score(auxiliary), 2), inversion64)).not.toEqual([]);
  });

  const handoff = `key C minor
meter 4/4
bars 1..1 {
 S: | B4/4 Ab5/4 G5/2 |
 A: | G4/4 B4/4 C5/2 |
 T: | D4/2 G4/2 |
 B: | G3/4 F3/4 Eb3/2 |
 H: | V/4 #viio43/4 i6/2 |
}`;

  it("V 的第三音在同音区换声部成为导减七的根音，并在接管声部真正解决", () => {
    expect(findings(score(handoff), leading)).toEqual([]);
  });

  it.each([
    ["接管者跳走", "B4/4 C5/2", "B4/4 G4/2"],
    ["接管者悬而未解", "B4/4 C5/2", "B4/2."],
    ["接管者在另一八度", "B4/4 C5/2", "B3/4 C4/2"],
  ])("%s 时保留导音警告", (_label, from, to) => {
    expect(findings(score(handoff.replace(from, to)), leading, 1)).toHaveLength(1);
  });

  it("接管到解决之间的人工句界不证明导音已解决", () => {
    expect(findings(cut(score(handoff), 2), leading, 1)).toHaveLength(1);
  });
});
