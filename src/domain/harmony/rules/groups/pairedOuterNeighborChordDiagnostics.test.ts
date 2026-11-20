import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const score = `satb 1
key G minor
meter 2/4
bars 1..2 {
 S: | G5/4. F#5/8 | G5/2 |
 A: | D4/2~ | D4/2 |
 T: | G3/2~ | G3/2 |
 B: | Bb2/4. C3/8 | Bb2/2 |
 H: | i6/2 | i6/2 |
}`;
const inversion = "chord.inversion-bass";
const unclassified = "chord.unclassified-nonchord-tone";
const incomplete = "chord.incomplete-members";
const ruleIds = [inversion, unclassified, incomplete];

const projectFor = (input = score) => compileScoreText(input).project;

function atNeighbors(project: ReturnType<typeof projectFor>) {
  return checkHarmony(project).diagnostics.filter(d => d.tick >= project.ppq * 1.5 && d.tick < project.ppq * 2 && ruleIds.includes(d.ruleId));
}

describe("Chord diagnostics use the proved outer-voice neighbors", () => {
  it("identifies the pair and the bracketed complete voicings", () => {
    expect(atNeighbors(projectFor())).toEqual([]);
  });

  it("follows the same written key through a repeated declaration", () => {
    const project = projectFor();
    project.keyEvents.push({ ...project.keyEvents[0], id: "reminder", tick: 1.75 * project.ppq });
    expect(atNeighbors(project)).toEqual([]);
  });

  it("keeps the reports when the mode changes and returns within the neighbor", () => {
    const project = projectFor();
    project.keyEvents.push(
      { ...project.keyEvents[0], mode: "major", id: "changed", tick: 1.625 * project.ppq },
      { ...project.keyEvents[0], id: "restored", tick: 1.875 * project.ppq },
    );
    expect(new Set(atNeighbors(project).map(item => item.ruleId))).toEqual(new Set(ruleIds));
  });

  it.each([
    ["an unresolved bass", score.replace("Bb2/2 |", "A2/2 |")],
    ["a soprano leap", score.replace("F#5/8", "E5/8")],
    ["a contradictory return inversion", score.replace("i6/2 | i6/2", "i6/2 | i/2")],
  ])("preserves every report for %s", (_description, text) => {
    expect(atNeighbors(projectFor(text)).map(item => item.ruleId).sort()).toEqual([...ruleIds].sort());
  });

  it("reports a simultaneous unrelated inner error", () => {
    const project = projectFor(score.replace("D4/2~ | D4/2", "D4/4. Eb4/8 | D4/2"));
    const result = atNeighbors(project);
    expect(result).toContainEqual(expect.objectContaining({
      ruleId: unclassified, voiceIds: expect.arrayContaining(["alto"]),
    }));
    expect(result.map(item => item.ruleId).sort()).toEqual([...ruleIds].sort());
  });

  it("keeps the existing role veto for both a required fifth and a repeated root", () => {
    const required = projectFor();
    required.satbTracks.find(track => track.voice === "alto")!.notes[0].nonChordToneRole = "other";
    expect(atNeighbors(required).map(item => item.ruleId).sort()).toEqual([...ruleIds].sort());
    const redundant = projectFor();
    redundant.satbTracks.find(track => track.voice === "tenor")!.notes[0].nonChordToneRole = "other";
    expect(atNeighbors(redundant).map(item => item.ruleId).sort()).toEqual([...ruleIds].sort());
  });
});
