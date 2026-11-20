import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const ruleId = "melody.augmented-interval";
const warning = { messageKey: ruleId + ".增" };
const spelling = { messageKey: ruleId + ".structural-spelling", message: expect.stringContaining("B♭") };

function projectFor(entry = "Bb4", goalSeventh = "C#4") {
  return compileScoreText([
    "satb 1", "key D major", "meter 3/4", "bars 1..1 {",
    " S: | B4/4 " + entry + "/4 A4/4 |", " A: | G4/4 G4/4 E4/4 |",
    " T: | D4/2 " + goalSeventh + "/4 |", " B: | G3/4 E3/4 A3/4 |",
    " H: | IV/4 iiø7/4 V/4 |", "}",
  ].join("\n")).project;
}

function focus(project: ReturnType<typeof projectFor>) {
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === ruleId && d.tick === project.ppq && d.voiceIds.includes("soprano"));
}

describe("Written resolution of the major-mode lowered fifth of iiø7", () => {
  it("holds for bare score, matching manual labels, and a matching locked track", () => {
    for (const spellingAtEntry of ["Bb4", "A#4"]) {
      const expected = spellingAtEntry === "Bb4" ? [] : [spelling];
      const project = projectFor(spellingAtEntry);
      expect(focus(project)).toMatchObject(expected);
      project.chordTrack.locked = true;
      expect(focus(project)).toMatchObject(expected);
      project.chordTrack.regions = [];
      expect(focus(project)).toMatchObject(expected);
    }
  });

  it("still uses a fully supported preparation with a marked redundant root", () => {
    const project = projectFor();
    project.satbTracks.find(track => track.voice === "alto")!.notes[0].nonChordToneRole = "other";
    expect(focus(project)).toEqual([]);
  });

  it("recovers the same lowered degree after transposition", () => {
    const { project } = compileScoreText([
      "satb 1", "key Bb major", "meter 3/4", "bars 1..1 {",
      " S: | G4/4 F#4/4 F4/4 |", " A: | Eb4/2 C4/4 |",
      " T: | Bb3/2 A3/4 |", " B: | Eb3/4 C3/4 F3/4 |", "}",
    ].join("\n"));
    expect(focus(project)).toMatchObject([
      { messageKey: ruleId + ".structural-spelling", message: expect.stringContaining("G♭") },
    ]);
  });
  it.each([1, 2])("retains the proof when the same key is restated at beat %i", beat => {
    const project = projectFor("A#4");
    project.chordTrack.regions = [];
    project.keyEvents.push({ ...project.keyEvents[0], id: "restated", tick: beat * project.ppq });
    expect(focus(project)).toMatchObject([spelling]);
  });

  it("rejects a temporary change within the altered note, before the resolution", () => {
    const project = projectFor();
    project.chordTrack.regions = [];
    const startKey = project.keyEvents[0];
    project.keyEvents.push(
      { ...startKey, id: "detour", tick: project.ppq * 1.5, tonic: { step: "C", alter: 0 } },
      { ...startKey, id: "return", tick: project.ppq * 2 },
    );
    expect(focus(project)).toMatchObject([warning]);
  });

  it("does not use an octave displacement as the seventh's resolution", () => {
    const project = projectFor("Bb4", "C#5");
    project.chordTrack.regions = [];
    expect(focus(project)).toMatchObject([warning]);
  });

  it("falls back when a manual or whole-track locked identity conflicts", () => {
    const project = projectFor();
    project.chordTrack.regions[1].identity = structuredClone(project.chordTrack.regions[0].identity);
    expect(focus(project)).toMatchObject([warning]);
    for (const region of project.chordTrack.regions) {
      for (const reading of region.semantics!.interpretations) reading.source = "inferred";
    }
    expect(focus(project)).toEqual([]);
    project.chordTrack.locked = true;
    expect(focus(project)).toMatchObject([warning]);
  });

  it("does not infer through a marked entering note or an ornamental seventh resolution", () => {
    const entry = projectFor();
    entry.satbTracks.find(track => track.voice === "soprano")!.notes[1].nonChordToneRole = "passing";
    expect(focus(entry)).toMatchObject([warning]);
    const seventh = projectFor();
    seventh.satbTracks.find(track => track.voice === "tenor")!.notes[1].nonChordToneRole = "suspension";
    expect(focus(seventh)).toMatchObject([warning]);
  });
});
