
import { describe, expect, it } from "vitest";
import { inferChords, applyHarmonyInference } from "../index";
import { compileScoreText } from "../../scoreText";

function oneBar(key: string, soprano: string, alto: string, tenor: string, bass: string) {
  return compileScoreText([
    "satb 1", "key " + key, "meter 4/4", "bars 1..1 {",
    "S: | " + soprano + " |", "A: | " + alto + " |",
    "T: | " + tenor + " |", "B: | " + bass + " |", "}",
  ].join("\n")).project;
}

const passingTick = 1440;
const arrivalTick = 1920;

function at(result: ReturnType<typeof inferChords>, tick: number) {
  return result.regions.find(r => r.fromTick <= tick && tick < r.toTick);
}

function passingFifth(soprano = "C5/4. Bb4/8 A4/2", alto = "F4/1") {
  return oneBar("F major", soprano, alto, "A3/2 D4/2", "F3/2 D3/2");
}

describe("Passing tones that displace a written triad member", () => {
  it("holds the preceding triad when the only fifth moves down through the weak subdivision", () => {
    const project = passingFifth(), result = inferChords(project);
    const noteId = project.satbTracks[0].notes[1].id;
    expect(at(result, passingTick)).toMatchObject({
      fromTick: 0, toTick: arrivalTick, status: "resolved",
      selected: {
        identity: { root: { step: "F", alter: 0 }, bass: { step: "F", alter: 0 } },
        confidence: "medium",
        fit: { omittedChordDegrees: [5], nonChordToneAssignments: { [noteId]: "passing" } },
      },
    });
    expect(at(result, arrivalTick)?.selected?.identity).toMatchObject({ root: { step: "D" }, bass: { step: "D" } });
    expect(inferChords(project, { allowIncompleteVoicing: false })).toEqual(result);
    for (const write of [false, true]) {
      const applied = applyHarmonyInference(project, { chordInference: result },
        { mode: "replace-unlocked", writeNonChordToneRoles: write });
      expect(applied.project.satbTracks.flatMap(t => t.notes).filter(n => n.nonChordToneRole)
        .map(n => [n.id, n.nonChordToneRole])).toEqual(write ? [[noteId, "passing"]] : []);
    }
  });

  it("allows the sole root to depart upward and keeps the independently written next inversion", () => {
    const project = oneBar("D major", "B4/2 G4/2", "D4/1", "G3/4. A3/8 B3/2", "B2/2 G2/2");
    const result = inferChords(project);
    expect(at(result, passingTick)?.selected).toMatchObject({
      identity: { root: { step: "G", alter: 0 }, bass: { step: "B", alter: 0 } },
      fit: { omittedChordDegrees: [1], nonChordToneAssignments: { [project.satbTracks[2].notes[1].id]: "passing" } },
    });
    expect(at(result, arrivalTick)).toMatchObject({
      fromTick: arrivalTick,
      selected: { identity: { root: { step: "G", alter: 0 }, bass: { step: "G", alter: 0 } },
        fit: { omittedChordDegrees: [], nonChordToneAssignments: {} } },
    });
  });

  it("keeps an independently voiced weak first-inversion triad in the same melodic shape", () => {
    const project = oneBar("C major", "E5/4. F5/8 G5/2", "C4/2 E4/2", "A3/2 G3/2", "A2/2 C3/2");
    const result = inferChords(project);
    expect(at(result, passingTick)).toMatchObject({
      fromTick: passingTick, toTick: arrivalTick, status: "resolved",
      selected: { identity: { root: { step: "F" }, bass: { step: "A" } },
        fit: { omittedChordDegrees: [], nonChordToneAssignments: {} } },
    });
  });

  it("keeps a complete short first-inversion dominant seventh on the weak subdivision", () => {
    const project = oneBar("D major", "A4/4. G4/8 F#4/2", "E4/2 D4/2", "A3/1", "C#3/2 D3/2");
    const result = inferChords(project);
    expect(at(result, passingTick)).toMatchObject({
      fromTick: passingTick, toTick: arrivalTick, status: "resolved",
      selected: { identity: { root: { step: "A" }, bass: { step: "C", alter: 1 },
        structure: { kind: "tertian", quality: "dominant7" } }, fit: { nonChordToneAssignments: {} } },
    });
  });

  it.each([
    ["supporting voice rearticulated at the weak attack", "C5/4. Bb4/8 A4/2", "F4/4. F4/8 F4/2"],
    ["landing an octave away", "C5/4. Bb4/8 A5/2", "F4/1"],
    ["turning back to the original pitch", "C5/4. Bb4/8 C5/2", "F4/1"],
    ["chromatic spelling outside the confirmed scale", "C5/4. B4/8 A4/2", "F4/1"],
  ])("leaves passing unset with %s", (_label, soprano, alto) => {
    const result = inferChords(passingFifth(soprano, alto));
    expect(at(result, passingTick)?.selected?.fit.nonChordToneAssignments ?? {}).toEqual({});
  });

  it("does not infer a passing role with an unconfirmed shared landing", () => {
    const project = oneBar("C major", "C5/4. D5/8 E5/2", "A4/2 C5/2", "F4/2 G4/2", "F3/2 C3/2");
    const id = project.satbTracks[0].notes[1].id;
    expect(at(inferChords(project), passingTick)?.selected?.fit.nonChordToneAssignments[id]).toBeUndefined();
  });

  it("respects strict confidence, disabled ornaments and a phrase cut at the landing", () => {
    const project = passingFifth();
    for (const options of [{ minConfidence: "high" as const }, { allowNonChordToneCandidates: false }]) {
      expect(at(inferChords(project, options), passingTick)?.status).toBe("unclassified");
    }
    project.structure.phraseBoundaries = [{ id: "cut", source: "manual", confidence: "certain", tick: arrivalTick }];
    expect(at(inferChords(project), passingTick)?.status).toBe("unclassified");
  });
});
