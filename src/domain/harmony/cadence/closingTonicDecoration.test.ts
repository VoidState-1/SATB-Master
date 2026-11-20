import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";

const withBassOctave = `satb 1
key D minor
meter 4/4
bars 1..2 {
  S: | F4/2. A4/4 | D4/2 r/2 |
  A: | D4/2. C#4/4 | D4/8 G#3/8 A3/4 r/2 |
  T: | A3/2. G3/4 | F3/8 E3/8 F3/4 r/2 |
  B: | D3/2. A2/4 | D3/4 D2/4 r/2 |
  H: | i/2. V7/4 | i/8 r/8 i/4 r/2 |
}`;

const contraryPassing = `satb 1
key E minor
meter 3/4
bars 1..2 {
  S: | B4/8 C5/8 B4/4. A4/8 | G4/8 F#4/8 E4/2 |
  A: | E4/2 D#4/4 | B3/2. |
  T: | G3/8 A3/8 G3/4 F#3/4 | E3/8 F#3/8 G3/2 |
  B: | B2/2 B2/4 | E3/2. |
  H: | I64/2 V/8 V7/8 | i/8 r/8 i/2 |
}`;

function findCadence(project: ReturnType<typeof compileScoreText>["project"]) {
  return buildHarmonyAnalysis(project).cadenceCandidates.find(candidate =>
    candidate.evidence.some(evidence => evidence.code === "closing-tonic-decoration"));
}

describe("a decorated final tonic after a written authentic arrival", () => {
  it.each([
    [withBassOctave, 3 * PPQ, 4 * PPQ, 6 * PPQ, "perfect"],
    [contraryPassing, 2 * PPQ, 3 * PPQ, 6 * PPQ, "imperfect"],
  ] as const)("keeps the actual first tonic as the landing and the final joint release", (text, _from, arrival, release, completion) => {
    const { project } = compileScoreText(text);
    expect(findCadence(project)).toMatchObject({
      kind: "full", form: "authentic", completion, observedLandingTick: arrival, toTick: release,
    });
  });

  it.each([
    ["bass reattacks inside the decoration", "D3/4 D2/4", "D3/8 D3/8 D2/4"],
    ["final bass is a different chord member", "D3/4 D2/4", "D3/4 F2/4"],
    ["unchanged soprano is reattacked on return", "D4/2 r/2", "D4/4 D4/4 r/2"],
    ["decoration is left by a leap", "G#3/8 A3/4", "E3/8 A3/4"],
    ["literal gap is labeled as an independent chord", "i/8 r/8 i/4", "i/8 V7/V/8 i/4"],
    ["final tenor releases early", "E3/8 F3/4 r/2", "E3/8 F3/8 r/8 r/2"],
    ["dominant loses its written seventh", "A3/2. G3/4", "A3/2. E3/4"],
  ] as const)("does not connect through an ornament when %s", (_name, before, after) => {
    expect(withBassOctave).toContain(before);
    const { project } = compileScoreText(withBassOctave.replace(before, after));
    expect(findCadence(project)).toBeUndefined();
  });

  it.each([
    [contraryPassing, "soprano", 3.5, "passing", true],
    [contraryPassing, "tenor", 3.5, "passing", true],
    [contraryPassing, "soprano", 3.5, "neighbor", false],
    [withBassOctave, "tenor", 4.5, "neighbor", true],
    [withBassOctave, "tenor", 4.5, "passing", false],
    [withBassOctave, "alto", 4.5, "passing", false],
    [contraryPassing, "soprano", 3.5, "suspension", false],
  ] as const)("matches the declared ornament to its written entry and exit", (text, voice, beat, role, accepted) => {
    const { project } = compileScoreText(text);
    const track = project.satbTracks.find(part => part.voice === voice)!;
    track.notes.find(note => note.startTick === beat * PPQ)!.nonChordToneRole = role;
    expect(Boolean(findCadence(project))).toBe(accepted);
  });

  it("honors a phrase break at the returned tonic, or a cut inside a ringing dominant", () => {
    for (const tick of [5 * PPQ, 3.5 * PPQ]) {
      const { project } = compileScoreText(withBassOctave);
      project.structure.phraseBoundaries = [{ id: "split", tick, source: "manual", confidence: "certain" }];
      expect(findCadence(project)).toBeUndefined();
    }
  });

  it.each([4.5, 4.75, 5.5])("recognizes the same sounding decoration across a key restatement at %s", beat => {
    const { project } = compileScoreText(withBassOctave);
    project.keyEvents.push({ ...project.keyEvents[0], id: "restate", tick: beat * PPQ });
    expect(findCadence(project)?.observedLandingTick).toBe(4 * PPQ);
  });

  it("rejects a brief change of key even when the original key returns at the tonic", () => {
    const { project } = compileScoreText(withBassOctave);
    project.keyEvents.push(
      { id: "change", tick: 4.75 * PPQ, tonic: { step: "F", alter: 0 }, mode: "major" },
      { ...project.keyEvents[0], id: "return", tick: 5 * PPQ },
    );
    expect(findCadence(project)).toBeUndefined();
  });

  it("respects an actual change of key during the decoration", () => {
    const { project } = compileScoreText(withBassOctave);
    project.keyEvents.push({ id: "new-key", tick: 4.5 * PPQ, tonic: { step: "F", alter: 0 }, mode: "major" });
    expect(findCadence(project)).toBeUndefined();
  });

  it("does not attach new music at the same release to the earlier tonic", () => {
    const { project } = compileScoreText(withBassOctave);
    const at = 6 * PPQ;
    for (const track of project.satbTracks) {
      const next = track.notes.at(-1)!;
      track.notes.push({ ...next, id: "restart-" + next.id, startTick: at, durationTicks: PPQ });
    }
    project.structure.phraseBoundaries = [{
      id: "split", tick: at, confidence: "certain", source: "manual",
    }];
    expect(findCadence(project)).toBeUndefined();
  });
});
