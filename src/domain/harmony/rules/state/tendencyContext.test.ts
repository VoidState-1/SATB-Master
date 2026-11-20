import { describe, expect, it } from "vitest";
import { validateProject } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const passage = `satb 1
key C major
meter 3/4
bars 1..1 {
  S: | B4/4 D5/4 C5/4 |
  A: | F4/4 G4/4 G4/4 |
  T: | D4/4 F4/4 E4/4 |
  B: | G2/4 B2/4 C3/4 |
  H: | D7/4 D65/4 T/4 |
}`;

function handoff() {
  const { project } = compileScoreText(passage);
  for (const chord of project.chordTrack.regions.slice(0, 2)) {
    chord.semantics!.interpretations[0].localKey = { tonic: { step: "C", alter: 0 }, mode: "major" };
  }
  return project;
}

function resolutionWarnings(project: ReturnType<typeof handoff>) {
  expect(validateProject(project)).toBe(true);
  return checkHarmony(project).diagnostics
    .filter(item => item.tick === project.ppq && (item.ruleId === "resolution.leading-tone" || item.ruleId === "resolution.chord-seventh"))
    .map(item => [item.ruleId, ...item.voiceIds]);
}

describe("转位时导音和七音在声部间交接", () => {
  it("同一局部调性用不同 JSON 字段顺序写入，两个声部照常交接", () => {
    const project = handoff();
    expect(resolutionWarnings(project)).toEqual([]);
    project.chordTrack.regions[1].semantics!.interpretations[0].localKey =
      { mode: "major", tonic: { alter: 0, step: "C" } };
    expect(resolutionWarnings(project)).toEqual([]);
  });

  it("实际改变局部调式时保留两个原声部的解决警告", () => {
    const project = handoff();
    project.chordTrack.regions[1].semantics!.interpretations[0].localKey!.mode = "minor";
    expect(resolutionWarnings(project)).toEqual(expect.arrayContaining([
      ["resolution.leading-tone", "soprano"],
      ["resolution.chord-seventh", "alto"],
    ]));
  });

  it("接手低音未奏出导音时，仍在原女高声部报警", () => {
    const project = handoff();
    project.satbTracks.find(track => track.id === "bass")!.notes[1].pitch = { step: "D", alter: 0, octave: 3 };
    expect(resolutionWarnings(project)).toEqual([["resolution.leading-tone", "soprano"]]);
  });
});
