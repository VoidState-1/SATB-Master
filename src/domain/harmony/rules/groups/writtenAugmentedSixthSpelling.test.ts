import { describe, expect, it } from "vitest";
import { parsePitchClass } from "../../../pitch";
import type { NonChordToneRole, VoiceId } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";

const ruleId = "melody.augmented-interval";
const warning = { messageKey: ruleId + ".增" };
const spelling = { messageKey: ruleId + ".structural-spelling", message: expect.stringContaining("C♯") };

function example(entry = "C#5", peer = "A#3", middleBass = "Eb3", goalBass = "D3") {
  return compileScoreText([
    "satb 1", "key G major", "meter 3/4", "bars 1..1 {",
    " S: | C5/4 " + entry + "/4 D5/4 |", " A: | G4/2. |",
    " T: | A3/4 " + peer + "/4 B3/4 |", " B: | " + middleBass + "/2 " + goalBass + "/4 |",
    " H: | I/4 I/4 I/4 |", "}",
  ].join("\n")).project;
}

function focus(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === ruleId && d.tick === project.ppq && d.voiceIds.includes("soprano"));
}

function role(project: ReturnType<typeof example>, voice: VoiceId, beat: number, mark: NonChordToneRole) {
  project.satbTracks.find(track => track.voice === voice)!.notes
    .find(note => note.startTick === beat * project.ppq)!.nonChordToneRole = mark;
}

function markIdentities(project: ReturnType<typeof example>, conflicting: boolean) {
  const [before, middle, goal] = project.chordTrack.regions;
  before.identity = {
    root: parsePitchClass("A:0")!, bass: parsePitchClass("E:-1")!,
    structure: { kind: "tertian", quality: "halfDiminished7", extensions: [], alterations: [] },
  };
  const flatSix = parsePitchClass("E:-1")!;
  middle.identity = {
    root: flatSix, bass: flatSix,
    structure: conflicting ? { kind: "tertian", quality: "dominant7", extensions: [], alterations: [] }
      : { kind: "augmented-sixth", variant: "doubleAugmented43" },
  };
  goal.identity = {
    root: parsePitchClass("G:0")!, bass: parsePitchClass("D:0")!,
    structure: { kind: "tertian", quality: "major", extensions: [], alterations: [] },
  };
}

describe("Written resolution of a lowered-sixth augmented-sixth sonority", () => {
  it("distinguishes the examined ascending alteration from an enharmonic error", () => {
    for (const [pitch, expected] of [["C#5", []], ["Db5", [spelling]]] as const) {
      const project = example(pitch);
      project.chordTrack.regions = [];
      expect(focus(project)).toMatchObject(expected);
    }
  });

  it.each([1, 2])("retains the proof when the same key is restated at beat %i", beat => {
    const project = example("Db5");
    project.chordTrack.regions = [];
    project.keyEvents.push({ ...project.keyEvents[0], id: "restated", tick: beat * project.ppq });
    expect(focus(project)).toMatchObject([spelling]);
  });

  it.each([0, 1])("rejects a change and return between attacks after beat %i", beat => {
    const project = example();
    project.chordTrack.regions = [];
    const startKey = project.keyEvents[0];
    project.keyEvents.push(
      { ...startKey, id: "detour", tick: (beat + 0.5) * project.ppq, mode: "minor" },
      { ...startKey, id: "return", tick: (beat + 1) * project.ppq },
    );
    const transition = buildHarmonyAnalysis(project).melodyTransitions.find(item =>
      item.voiceId === "soprano" && item.current.startTick === project.ppq);
    expect(transition?.sameKey).toBe(true);
    expect(focus(project)).toMatchObject([warning]);
  });

  it("can prove the entry without a marked redundant member of the preparation", () => {
    const project = example("Db5", "A#3");
    project.chordTrack.regions = [];
    const tenor = project.satbTracks.find(track => track.voice === "tenor")!;
    tenor.notes[0].pitch = { step: "G", alter: 0, octave: 3 };
    role(project, "tenor", 0, "other");
    expect(focus(project)).toMatchObject([spelling]);
  });

  it("requires the other written alteration and its true resolution", () => {
    for (const project of [example("C#5", "Bb3"), example("C#5", "A#3", "Eb3", "G3"),
      example("C#5", "A#3", "Eb5", "D5")]) {
      project.chordTrack.regions = [];
      expect(focus(project)).toMatchObject([warning]);
    }
  });

  it.each([
    { source: "inferred", trackLocked: false },
    { source: "manual", trackLocked: false },
    { source: "inferred", trackLocked: true },
  ] as const)("uses identical written identities under %o", ({ source, trackLocked }) => {
    const project = example("Db5");
    markIdentities(project, false);
    project.chordTrack.locked = trackLocked;
    for (const chord of project.chordTrack.regions) {
      for (const meaning of chord.semantics!.interpretations) meaning.source = source;
    }
    expect(focus(project)).toMatchObject([spelling]);
  });

  it.each([
    { source: "inferred", trackLocked: false, expected: [] },
    { source: "manual", trackLocked: false, expected: [warning] },
    { source: "inferred", trackLocked: true, expected: [warning] },
  ] as const)("honors an enharmonic identity conflict under %o", ({ source, trackLocked, expected }) => {
    const project = example();
    markIdentities(project, true);
    project.chordTrack.locked = trackLocked;
    for (const chord of project.chordTrack.regions) {
      for (const meaning of chord.semantics!.interpretations) meaning.source = source;
    }
    expect(focus(project)).toMatchObject(expected);
  });

  it("vetoes required preparation, peer, and landing roles", () => {
    for (const [voice, beat, mark] of [
      ["soprano", 0, "passing"], ["tenor", 1, "neighbor"], ["bass", 2, "pedal"],
    ] as const) {
      const project = example();
      project.chordTrack.regions = [];
      role(project, voice, beat, mark);
      expect(focus(project)).toMatchObject([warning]);
    }
  });
});
