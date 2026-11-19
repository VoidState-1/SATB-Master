import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function bassProject(previous: string, ornament: string, target: string, role: string,
  bassLine = `${previous}/2 ${previous}/4 ${ornament}/4@ornament | ${target}/1`,
  chords = "I/1 | I6/1", soprano = "G4/1 | C5/1") {
  return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | ${soprano} |
 A: | E4/1 | G4/1 |
 T: | C4/1 | C4/1 |
 B: | ${bassLine} |
 H: | ${chords} |
}
${role ? "annotations {\n note ornament role=" + role + "\n}" : ""}`).project;
}

describe("经过低音与标注转位", () => {
  it.each([
    ["C3", "D3", "E3", "passing", false],
    ["C3", "D3", "E3", "", true],
    ["C3", "D3", "E3", "other", true],
    ["E3", "D3", "E3", "passing", true],
    ["C3", "D3", "F3", "passing", true],
    ["C3", "G3", "E3", "passing", true],
    ["C3", "D4", "E3", "passing", true],
  ] as const)("%s–%s–%s, role=%s, 应报=%s", (previous, passing, target, role, reports) => {
    const project = bassProject(previous, passing, target, role);
    const errors = checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "chord.inversion-bass" && item.tick === 3 * project.ppq && item.severity === "error");
    expect(errors.length > 0).toBe(reports);
  });

  it.each([
    ["改变前转位", "C3/2 C3/4 D3/4@ornament | E3/1", "I6/1 | I6/1", 3, true],
    ["改变后转位", "C3/2 C3/4 D3/4@ornament | E3/1", "I/1 | I/1", 3, true],
    ["终点前休止", "C3/2 D3/4@ornament r/4 | E3/1", "I/1 | I6/1", 2, true],
    ["经过音长于前音", "C3/4 D3/2.@ornament | E3/1", "I/1 | I6/1", 1, true],
    ["变化经过音", "E3/2 F#3/4@ornament G3/4 | G3/1", "I6/2. I64/4 | I64/1", 2, true],
    ["次强拍", "C3/2 D3/2@ornament | E3/1", "I/1 | I6/1", 2, false],
    ["下行连接转位", "E3/2 E3/4 D3/4@ornament | C3/1", "I6/1 | I/1", 3, false],
  ] as const)("%s", (_label, bassLine, chords, beat, reports) => {
    const project = bassProject("C3", "D3", "E3", "passing", bassLine, chords);
    expect(checkHarmony(project).diagnostics.some(item =>
      item.ruleId === "chord.inversion-bass" && item.tick === beat * project.ppq)).toBe(reports);
  });

  it("上声部重新起奏不把持续的经过音变成结构音", () => {
    const project = bassProject("C3", "D3", "E3", "passing", undefined, undefined, "G4/2. G4/8 G4/8 | C5/1");
    expect(checkHarmony(project).diagnostics.some(item => item.ruleId === "chord.inversion-bass")).toBe(false);
  });

  it.each([3.5, 4])("在拍位 %s 起奏，占据下一小节强拍时仍报错", onset => {
    const project = bassProject("C3", "D3", "E3", "passing");
    const notes = project.satbTracks.find(track => track.voice === "bass")!.notes;
    const start = onset * project.ppq;
    const landing = start + project.ppq;
    notes[1].durationTicks = start - notes[1].startTick;
    notes[2].startTick = start;
    notes[3].startTick = landing;
    notes[3].durationTicks = project.lengthTicks - landing;
    const [source, target] = project.chordTrack.regions;
    source.durationTicks = landing;
    target.startTick = landing;
    target.durationTicks = project.lengthTicks - landing;
    expect(checkHarmony(project).diagnostics.some(item =>
      item.ruleId === "chord.inversion-bass" && item.tick === start)).toBe(true);
  });
});

describe("先现低音与标注转位", () => {
  it.each([
    ["目标重奏过短", "C3/2 C3/4 B2/4@ornament | B2/8 B2/8 B2/2.", "I/1 | V6/1", 3],
    ["换和弦后才重奏", "C3/2 C3/4 B2/4@ornament~ | B2/8 B2/8 B2/2.", "I/1 | V6/1", 3],
    ["次强拍提前起奏", "C3/2 B2/2@ornament | B2/1", "I/1 | V6/1", 2],
  ] as const)("%s 时不豁免", (_label, line, chords, onset) => {
    const project = bassProject("C3", "B2", "B2", "anticipation", line, chords);
    expect(checkHarmony(project).diagnostics.some(item => item.ruleId === "chord.inversion-bass" &&
      item.tick === onset * project.ppq && item.severity === "error")).toBe(true);
  });

  it.each([
    ["弱拍先现并在换和弦时重奏", "C3", "B2", "B2", "anticipation", "I/1 | V6/1", false],
    ["未标角色", "C3", "B2", "B2", "", "I/1 | V6/1", true],
    ["无明确角色", "C3", "B2", "B2", "other", "I/1 | V6/1", true],
    ["重奏时换八度", "C3", "B2", "B3", "anticipation", "I/1 | V6/1", true],
    ["同音异名", "C3", "Cb3", "B2", "anticipation", "I/1 | V6/1", true],
    ["前一和弦转位不符", "C3", "B2", "B2", "anticipation", "I6/1 | V6/1", true],
    ["后一和弦转位不符", "C3", "B2", "B2", "anticipation", "I/1 | V/1", true],
    ["中间低音是当前和弦的三音", "C3", "E3", "E3", "anticipation", "I/1 | I6/1", true],
  ] as const)("%s", (_label, previous, ornament, target, role, chords, reports) => {
    const project = bassProject(previous, ornament, target, role, undefined, chords);
    expect(checkHarmony(project).diagnostics.some(item => item.ruleId === "chord.inversion-bass" &&
      item.tick === 3 * project.ppq && item.severity === "error")).toBe(reports);
  });
});
