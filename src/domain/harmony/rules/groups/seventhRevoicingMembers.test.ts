import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project/types";
import { checkHarmony } from "../../registry";

const exercise = `satb 1
key D major
meter 4/4
bars 1..1 {
  S: | A4/2 A4/2 |
  A: | G4/2 F#4/2 |
  T: | E4/4 A3/4 D4/2 |
  B: | C#3/2 D3/2 |
  H: | D65/2 T/2 |
}`;
const missingRule = "chord.incomplete-members";
const missingAt = (project: ProjectDocument, tick: number = project.ppq) =>
  checkHarmony(project).diagnostics.filter(d => d.ruleId === missingRule && d.tick === tick);
const score = (text = exercise) => compileScoreText(text).project;

describe("member check after a complete written seventh", () => {
  it("assesses the complete first inversion when only the tenor substitutes the root for the fifth", () => {
    expect(missingAt(score())).toEqual([]);
  });

  it.each([
    ["minor7", `satb 1
key G major
meter 2/4
bars 1..1 {
  S: | E5/8 A5/8 F#5/4 |
  A: | C5/4 A4/4 |
  T: | A3/4 D4/4 |
  B: | G3/4 D3/4 |
  H: | ii2/4 V/4 |
}`],
    ["major7", `satb 1
key G major
meter 2/4
bars 1..1 {
  S: | D5/8 G5/8 E5/4 |
  A: | B4/4 C5/4 |
  T: | G4/4 G4/4 |
  B: | F#3/4 E3/4 |
  H: | I2/4 IV6/4 |
}`],
  ])("assesses the full %s in third inversion before the soprano exchanges the fifth", (_quality, text) => {
    const project = score(text);
    expect(missingAt(project, project.ppq / 2)).toEqual([]);
  });

  it.each([
    ["incomplete first statement", "E4/4 A3/4", "A4/4 A3/4"],
    ["a second moving part", "G4/2 F#4/2", "G4/4 G3/4 F#4/2"],
    ["a second rearticulated upper part", "A4/2 A4/2", "A4/4 A4/4 A4/2"],
    ["the original bass rearticulating", "C#3/2 D3/2", "C#3/4 C#3/4 D3/2"],
    ["an enharmonic fifth in the first statement", "E4/4 A3/4", "Fb4/4 A3/4"],
    ["an upper part sounding below the stated bass", "E4/4 A3/4", "E2/4 A2/4"],
    ["a separate same-name short chord", "D65/2 T/2", "D65/4 D65/4 T/2"],
  ])("continues to report fifth omission with %s", (_label, from, to) => {
    const project = score(exercise.replace(from, to));
    expect(missingAt(project)).toMatchObject([{ params: { missing: "E" } }]);
  });

  it("keeps the omitted seventh warning when the seventh is the member that moves", () => {
    const changed = exercise.replace("G4/2 F#4/2", "E4/2 F#4/2").replace("E4/4 A3/4", "G4/4 A3/4");
    expect(missingAt(score(changed))).toMatchObject([{ params: { missing: "G" } }]);
  });

  it("keeps the warning on an independent incomplete first attack in the next region", () => {
    const changed = exercise.replace("D65/2 T/2", "D65/4 vi2/4 T/2")
      .replace("G4/2 F#4/2", "G4/4 A4/4 F#4/2");
    const project = score(changed);
    expect(missingAt(project)).toHaveLength(1);
  });

  it.each([960, 1200])("respects the manual phrase boundary at %i", tick => {
    const project = score();
    project.structure.phraseBoundaries.push({ id: "cut", tick, source: "manual", confidence: "certain" });
    expect(missingAt(project)).toHaveLength(1);
  });

  it("retains an omission when the alleged fifth is already labelled as passing", () => {
    const project = score();
    project.satbTracks[2].notes[0].nonChordToneRole = "passing";
    expect(missingAt(project)).toHaveLength(1);
  });

  it("retains the warning when the key event changes between the two attacks", () => {
    const project = score();
    project.keyEvents.push({ ...project.keyEvents[0], id: "new-key", tick: project.ppq, mode: "minor" });
    expect(missingAt(project)).toHaveLength(1);
  });

  it("retains the configured result for an applied-function interpretation", () => {
    const project = score(exercise.replace("key D major", "key G major").replace("D65/2 T/2", "V65/V/2 V/2"));
    expect(missingAt(project)).toMatchObject([{ params: { missing: "E" } }]);
  });

  it("retains an omitted fifth in a half-diminished seventh", () => {
    const halfDiminished = `satb 1
key C minor
meter 2/4
bars 1..1 {
  S: | Ab4/8 D5/8 Eb5/4 |
  A: | F4/4 G4/4 |
  T: | D4/4 C4/4 |
  B: | C3/4 C3/4 |
  H: | iiø2/4 i/4 |
}`;
    const project = score(halfDiminished);
    expect(missingAt(project, project.ppq / 2)).toMatchObject([{ params: { missing: "A♭" } }]);
  });

  it("retains an omitted fifth for a span longer than a quarter", () => {
    const sustained = `satb 1
key D major
meter 4/4
bars 1..1 {
  S: | A4/1 |
  A: | G4/1 |
  T: | E4/2 A3/2 |
  B: | C#3/1 |
  H: | D65/1 |
}`;
    const project = score(sustained);
    expect(missingAt(project, 2 * project.ppq)).toHaveLength(1);
  });

  it("retains an omitted fifth at an equally strong metric position", () => {
    const bothWeak = `satb 1
key D major
meter 3/4
bars 1..1 {
  S: | A4/4 A4/2 |
  A: | F#4/4 G4/2 |
  T: | D4/4 E4/4 A3/4 |
  B: | D3/4 C#3/2 |
  H: | T/4 D65/2 |
}`;
    const project = score(bothWeak);
    expect(missingAt(project, 2 * project.ppq)).toHaveLength(1);
  });

  it("still records an unresolved seventh on the next real harmony", () => {
    const project = score(exercise.replace("G4/2 F#4/2", "G4/2 A4/2"));
    const diagnostics = checkHarmony(project).diagnostics;
    expect(missingAt(project)).toEqual([]);
    expect(diagnostics).toContainEqual(expect.objectContaining({ ruleId: "resolution.chord-seventh", tick: 1920 }));
  });
});
