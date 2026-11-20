import { describe, expect, it } from "vitest";
import { primaryHarmonyInterpretation } from "../../chordModel";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference } from "./harmonyInference";
import { inferChords } from "./inferChords";

const motif = `satb 1
key C major
meter 3/4
bars 1..2 {
  S: | E5/2 G5/4 | F5/2 E5/4 |
  A: | C5/2 E5/4 | E5/4 D5/4 C5/4 |
  T: | G4/2 A4/4 | A4/2 G4/4 |
  B: | C4/2 C#4/4 | D4/2 C4/4 |
}`;

const resolution = "reattacked-tonic-ninth-resolution";

function regionsAt(project: ReturnType<typeof compileScoreText>["project"], options?: Parameters<typeof inferChords>[1]) {
  const result = inferChords(project, options);
  const at = (beats: number) => result.regions.find(region =>
    region.fromTick <= beats * project.ppq && beats * project.ppq < region.toTick);
  return { result, at };
}

function hasDelayedCandidate(result: ReturnType<typeof inferChords>) {
  return result.regions.some(region => [region.selected, ...region.alternatives].some(
    candidate => candidate?.evidence.some(item => item.code === resolution),
  ));
}

describe("a written dominant fifth reattacked as a tonic ninth", () => {
  it("recovers V65/ii and extends the complete ii back to the tonic-bass attack", () => {
    const { project } = compileScoreText(motif);
    const { result, at } = regionsAt(project);
    const source = at(2)!;
    const target = at(3)!;
    expect(source.status).toBe("resolved");
    expect(source.selected?.identity).toMatchObject({
      root: { step: "A", alter: 0 },
      bass: { step: "C", alter: 1 },
      structure: { quality: "dominant7" },
    });
    expect(primaryHarmonyInterpretation(source.selected!.semantics!).appliedTarget?.degree).toBe(2);
    expect(target.status).toBe("resolved");
    expect(target.fromTick).toBe(3 * project.ppq);
    expect(target.toTick).toBe(5 * project.ppq);
    expect(target.selected?.identity).toMatchObject({
      root: { step: "D", alter: 0 },
      bass: { step: "D", alter: 0 },
      structure: { quality: "minor" },
    });
    expect(target.selected?.evidence).toContainEqual(expect.objectContaining({
      code: resolution,
      details: { arrivalTick: 3 * project.ppq, confirmationTick: 4 * project.ppq },
    }));
    const written = applyHarmonyInference(project, { chordInference: result }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
    const alto = written.satbTracks.find(track => track.id === "alto")!.notes;
    expect(alto.filter(note => note.nonChordToneRole).map(note => [note.startTick, note.nonChordToneRole]))
      .toEqual([[3 * project.ppq, "suspension"]]);
  });

  it("reuses the recognized dominant when a soprano reattack delays the tonic", () => {
    const { project } = compileScoreText(`satb 1
key A minor
meter 2/4
bars 1..2 {
  S: | C5/4 B4/4 | B4/8 A4/8 E4/4 |
  A: | E4/2~ | E4/4 C4/4 |
  T: | C4/4 D4/4 | C4/2 |
  B: | A3/4 G#3/4 | A3/2 |
}`);
    const { at } = regionsAt(project);
    expect(at(1)?.selected?.identity.structure).toMatchObject({ quality: "dominant7" });
    expect(at(2)?.selected?.identity.structure).toMatchObject({ quality: "minor" });
    expect(at(2)?.selected?.evidence).toContainEqual(expect.objectContaining({
      code: resolution,
      details: { arrivalTick: 2 * project.ppq, confirmationTick: 2.5 * project.ppq },
    }));
  });

  it.each([
    ["octave transfer of the reattack", "E5/4 | E5/4", "E5/4 | E4/4"],
    ["enharmonic pitch at the reattack", "E5/4 | E5/4", "E5/4 | Fb5/4"],
    ["a tie instead of a reattack", "E5/4 | E5/4", "E5/4~ | E5/4"],
    ["no tonic octave at the landing", "E5/4 D5/4 C5/4", "E5/4 C5/4 C5/4"],
    ["third missing from the final triad", "F5/2 E5/4", "F5/4 D5/4 E5/4"],
    ["wrong bass at the target", "D4/2 C4/4", "F4/2 C4/4"],
    ["seventh transfers an octave", "F5/2 E5/4", "F4/2 E5/4"],
    ["another voice reattacks at settlement", "A4/2 G4/4", "A4/4 A4/4 G4/4"],
  ])("requires a real delayed resolution with %s excluded", (_case, from, to) => {
    expect(motif).toContain(from);
    expect(hasDelayedCandidate(inferChords(compileScoreText(motif.replace(from, to)).project))).toBe(false);
  });

  it.each([3, 4])("respects an explicit phrase boundary at quarter %i", beats => {
    const { project } = compileScoreText(motif);
    project.structure.phraseBoundaries = [
      { id: "cut", source: "manual", confidence: "certain", tick: beats * project.ppq },
    ];
    expect(hasDelayedCandidate(inferChords(project))).toBe(false);
  });

  it("uses the surrounding score without writing chord or note changes outside the selection", () => {
    const { project } = compileScoreText(motif);
    const fromTick = 3.5 * project.ppq, toTick = 4 * project.ppq;
    const result = inferChords(project, { fromTick, toTick });
    expect(result.regions.map(region => [region.fromTick, region.toTick, region.selected?.identity.root.step]))
      .toEqual([[fromTick, toTick, "D"]]);
    const written = applyHarmonyInference(project, { chordInference: result }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
    expect(written.chordTrack.regions.map(chord => [chord.startTick, chord.durationTicks]))
      .toEqual([[fromTick, toTick - fromTick]]);
    expect(written.satbTracks.flatMap(track => track.notes).some(note => note.nonChordToneRole)).toBe(false);
  });

  it("preserves a conflicting explicit note role", () => {
    const { project } = compileScoreText(motif);
    project.satbTracks.find(track => track.id === "alto")!.notes.find(note =>
      note.startTick === 3 * project.ppq)!.nonChordToneRole = "passing";
    expect(hasDelayedCandidate(inferChords(project))).toBe(false);
  });

  it.each([{ allowNonChordToneCandidates: false }, { minConfidence: "high" as const }])(
    "keeps the exact dominant but suppresses an ornamental target with options %o", options => {
      const { project } = compileScoreText(motif);
      const { result, at } = regionsAt(project, options);
      expect(at(2)?.selected?.identity.structure).toMatchObject({ quality: "dominant7" });
      expect(at(3)?.selected?.fit.nonChordToneAssignments ?? {}).toEqual({});
      expect(at(4)?.selected?.identity.structure).toMatchObject({ quality: "minor" });
      const written = applyHarmonyInference(project, { chordInference: result }, {
        mode: "replace-unlocked", writeNonChordToneRoles: true,
      }).project;
      expect(written.satbTracks.flatMap(track => track.notes).some(note => note.nonChordToneRole)).toBe(false);
    },
  );
});
