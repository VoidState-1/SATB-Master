import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function passage(key: string, chords: string[], voices: string[]) {
  const staff = (pitches: string[]) => pitches.map(pitch => pitch + "/4").join(" ");
  const tracks = voices.map((line, i) => `${"SATB"[i]}: | ${staff(line.split(" "))} |`);
  return compileScoreText([
    "satb 1", "key " + key, `meter ${chords.length}/4`, "bars 1..1 {",
    ...tracks, `H: | ${staff(chords)} |`, "}",
  ].join("\n")).project;
}

function warnings(project: ReturnType<typeof passage>) {
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === "resolution.chord-seventh");
}

function bassExchange() {
  return passage("C major", ["D2", "D7"], ["G5 F5", "B4 B4", "D4 D4", "F3 G3"]);
}

describe("属二和弦换位中的低音七音", () => {
  it("低音 F3 上二度到根音时，女高新起的七音不能免除原低音的告警", () => {
    const score = bassExchange();
    expect(warnings(score)).toEqual([expect.objectContaining({
      voiceIds: ["bass"], tick: score.ppq, endTick: 2 * score.ppq, severity: "warning",
    })]);
  });

  it("移调到 F 大调，同声重奏后从 Bb 上行，接手的女高随后正常解决", () => {
    const score = passage("F major", ["D2", "D2", "D7", "T"],
      ["C5 C5 Bb4 A4", "G4 G4 G4 F4", "E4 E4 E4 F4", "Bb2 Bb2 C3 F3"]);
    expect(warnings(score)).toEqual([expect.objectContaining({ voiceIds: ["bass"], tick: 2 * score.ppq })]);
  });

  it("辅导书改正的低音七音下三度到五音，女高接手七音", () => {
    expect(warnings(passage("C major", ["D2", "D43"], ["G5 F5", "B4 B4", "D4 G4", "F3 D3"]))).toEqual([]);
  });

  it("同和声重复后，男低七音在异和弦中下行解决", () => {
    expect(warnings(passage("C major", ["D2", "D2", "T6"],
      ["G5 G5 G5", "B4 B4 C5", "D4 D4 C4", "F3 F3 E3"]))).toEqual([]);
  });

  it("低音与新七音跨手动句界时保留原有交接处理", () => {
    const project = bassExchange();
    project.structure.phraseBoundaries.push({
      id: "end", tick: project.ppq, source: "manual", confidence: "certain",
    });
    expect(warnings(project)).toEqual([]);
  });

  it("男低落点标明为和弦外音时，不能按结构低音换位确定告警", () => {
    const project = bassExchange();
    project.satbTracks.find(track => track.voice === "bass")!.notes[1].nonChordToneRole = "anticipation";
    expect(warnings(project)).toEqual([]);
  });

  it("女高新起七音标作和弦外音时，不能据此确立新的结构交接", () => {
    const project = bassExchange();
    project.satbTracks.find(track => track.voice === "soprano")!.notes[1].nonChordToneRole = "passing";
    expect(warnings(project)).toEqual([]);
  });

  it("上声部七音到根音不进入严格低音分支", () => {
    expect(warnings(passage("C major", ["D7", "D2"], ["F5 G5", "G4 B4", "B3 D4", "G3 F3"]))).toEqual([]);
  });

  it.each([
    ["落点含变五音", "D4 Db4"],
    ["男高在实际低音下方", "D3 D3"],
  ])("%s 时不凭原位属七标签追报低音", (_name, tenor) => {
    const project = passage("C major", ["D2", "D7"], ["G5 F5", "B4 B4", tenor, "F3 G3"]);
    expect(warnings(project).filter(item => item.voiceIds.includes("bass"))).toEqual([]);
  });
});
