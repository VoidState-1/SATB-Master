import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function passage(chords: string, voices: string[], key = "C major") {
  const line = (sequence: string) => sequence.split(" ").map(p => p + "/4").join(" ");
  return compileScoreText([
    "satb 1", "key " + key, "meter 2/4", "bars 1..1 {",
    ...voices.map((sequence, i) => `${"SATB"[i]}: | ${line(sequence)} |`),
    `H: | ${line(chords)} |`, "}",
  ].join("\n")).project;
}

function warnings(project: ReturnType<typeof passage>) {
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === "resolution.chord-seventh");
}

const rising = ["F4 G4", "D4 D4", "B3 F3", "G2 B2"];
const falling = ["F5 G4", "B4 F4", "G4 D4", "D3 B2"];
const swap = ["D5 D5", "F4 G4", "G4 F4", "B2 B2"];

describe("属七和弦上声部换位的实音交接", () => {
  it.each([
    ["七音上二度，接手者下增四度", "D7 D65", rising, "soprano", "F3"],
    ["七音下七度，接手者下增四度", "D43 D65", falling, "soprano", "F4"],
    ["内声部原音区互换", "D65 D65", swap, "alto", "F4"],
  ] as const)("%s 时仅向原七音声部发出 E.2", (_, chords, voices, voice, seventh) => {
    const project = passage(chords, voices);
    const found = warnings(project);
    expect(found).toEqual([expect.objectContaining({
      tick: project.ppq, endTick: 2 * project.ppq, voiceIds: [voice], severity: "warning",
    })]);
    expect(found[0].evidence).toContainEqual(expect.objectContaining({ label: "接手的七音", value: seventh }));
  });

  it.each([
    ["女高保持七音", "D7 D65", ["F4 F4", "D4 D4", "B3 G3", "G2 B2"]],
    ["女高移至五音，低音接七音", "D7 D2", ["F5 D5", "G4 G4", "B3 B3", "G3 F3"]],
    ["女高保持，女低下三度", "D43 D65", ["F5 F5", "B4 G4", "G4 D4", "D3 B2"]],
    ["内声部保持，男高改变音区", "D65 D43", ["D5 G4", "F4 F4", "G3 B3", "B2 D3"]],
    ["七音与五音原音区互换", "D65 D65", ["G4 G4", "F4 D4", "D4 F4", "B2 B2"]],
  ] as const)("%s 时保留七音交接或重奏", (_, chords, voices) => {
    expect(warnings(passage(chords, [...voices]))).toEqual([]);
  });

  it("小调的属七和弦同样按拼写核对根音和七音", () => {
    const score = passage("D65 D65", ["B4 B4", "D4 E4", "E4 D4", "G#2 G#2"], "A minor");
    expect(warnings(score)).toEqual([expect.objectContaining({ tick: score.ppq, voiceIds: ["alto"] })]);
  });

  it("跨手动句界或接手者是显式外音时放行", () => {
    const boundary = passage("D65 D65", swap);
    boundary.structure.phraseBoundaries.push({ id: "phrase-end", tick: boundary.ppq, source: "manual", confidence: "certain" });
    expect(warnings(boundary)).toEqual([]);
    const ornament = passage("D65 D65", swap);
    ornament.satbTracks.find(track => track.voice === "tenor")!.notes[1].nonChordToneRole = "anticipation";
    expect(warnings(ornament)).toEqual([]);
  });

  it("来源七音持续期间，接手者只在末半拍唱根音时保留原交接", () => {
    const score = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
  S: | G5/4 D5/4 |
  A: | F4/4 G4/4 |
  T: | D4/8 G4/8 F4/4 |
  B: | B2/4 B2/4 |
  H: | D65/4 D65/4 |
}`).project;
    expect(warnings(score)).toEqual([]);
  });
});
