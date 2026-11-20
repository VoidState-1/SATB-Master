import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { inferChords } from "../../inference/inferChords";
import { applyChordInference } from "../../inference/apply";
import { checkHarmony } from "../../registry";
import type { ProjectDocument } from "../../../project";

// Huang ch. 22, written exercise 7, reproducing the resolution in Spasobin 22-303.
const score = `satb 1
key G minor
meter 3/4
bars 1..2 {
  S: | D5/4 C5/4 Bb4/4 | C5/2. |
  A: | G4/4 F#4/4 G4/4 | Eb4/2. |
  T: | Bb3/4 A3/4 Bb3/4 | A3/2. |
  B: | G2/4 Eb3/4 D3/4 | C3/2. |
}
`;

function blind() {
  const project = compileScoreText(score).project;
  return applyChordInference(project, inferChords(project), { mode: "replace-unlocked" }).project;
}

function warnings(project: ProjectDocument) {
  return checkHarmony(project).diagnostics.filter(d => d.tick === 2 * project.ppq &&
    d.ruleId === "chord.second-inversion-voicing");
}

describe("导七二和弦解决到经过主四六的三音重复", () => {
  it("盲推和只给定和弦拼写时都认可原声部的规范解决", () => {
    const project = blind();
    const middle = project.chordTrack.regions.find(c => c.startTick === 2 * project.ppq);
    expect(middle?.identity).toMatchObject({ root: { step: "G", alter: 0 }, bass: { step: "D", alter: 0 } });
    expect(warnings(project)).toHaveLength(0);
    project.chordTrack.regions.forEach(chord => { delete chord.semantics; });
    expect(warnings(project)).toHaveLength(0);
  });

  it("实奏音级集合、重复数与给定和弦相同，但导七五音落错八度时仍报", () => {
    const project = blind();
    project.satbTracks[0].notes[2].pitch.octave++;
    expect(warnings(project)).toHaveLength(1);
  });

  it("缺少经过落点或句界分隔时仍报", () => {
    const noStep = blind();
    noStep.satbTracks[3].notes[3].pitch.octave--;
    expect(warnings(noStep)).toHaveLength(1);
    const cut = blind();
    cut.structure.phraseBoundaries.push({
      id: "cut", source: "manual", tick: 3 * cut.ppq, confidence: "certain",
    });
    expect(warnings(cut)).toHaveLength(1);
  });
});
