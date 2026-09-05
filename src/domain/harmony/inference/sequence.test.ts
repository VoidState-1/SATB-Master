import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ, type VoiceId } from "../../project";
import { spellMidi } from "../../pitch";
import { buildChordInferenceCandidates } from "./candidates";
import { buildChordInferenceObservations } from "./observations";
import { analyzeChordInferencePaths, selectChordInferencePath } from "./sequence";
import { buildChordInferenceRegions } from "./segmentation";

function sequenceFixture() {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 3;
  const pitches: Record<VoiceId, number[]> = {
    soprano: [76, 76, 77],
    alto: [72, 72, 74],
    tenor: [67, 67, 71],
    bass: [55, 55, 55],
  };
  for (const track of project.satbTracks) {
    track.notes = pitches[track.voice].map((midi, index) => ({
      id: `${track.id}-${index}`,
      startTick: index * PPQ,
      durationTicks: PPQ,
      pitch: spellMidi(midi),
      velocity: 88,
      spellingSource: "manual",
      locked: false,
    }));
  }
  const observations = buildChordInferenceObservations(project);
  const candidateSets = observations.map((observation, index) =>
    buildChordInferenceCandidates(observation)
      .filter((candidate) => index < 2
        ? candidate.functionalBaseId === "T" || candidate.functionalBaseId === "K46"
        : candidate.functionalBaseId === "D")
      .map((candidate) => ({
        ...candidate,
        score: { ...candidate.score, total: 10 },
      })),
  );
  return { observations, candidateSets };
}

describe("Chord inference path scores", () => {
  it("uses the same scores when regions receive the original candidate sets", () => {
    const fixture = sequenceFixture();
    const observations = fixture.observations.slice(0, 2);
    const candidateSets = fixture.candidateSets.slice(0, 2);
    const selected = selectChordInferencePath(observations, candidateSets);
    const regions = buildChordInferenceRegions(observations, candidateSets, selected);

    expect(regions).toHaveLength(1);
    expect(regions[0].status).toBe("ambiguous");
    expect(regions[0].selected?.pathScore).toBe(35);
    expect(regions[0].alternatives[0].pathScore).toBe(35);
  });

  it("compares every candidate using its best complete prefix and suffix", () => {
    const { observations, candidateSets } = sequenceFixture();
    const input = structuredClone(candidateSets);
    const result = analyzeChordInferencePaths(observations, candidateSets);

    // With local scores of 10: K-K-D = 30 + 15 + 14 = 59;
    // T-K-D = 55, K-T-D = 41, and T-T-D = 45.
    expect(result.selectedPath.map((candidate) => candidate?.functionalBaseId))
      .toEqual(["K46", "K46", "D"]);
    expect(result.candidateSets.map((candidates) => Object.fromEntries(
      candidates.map((candidate) => [candidate.functionalBaseId, candidate.pathScore]),
    ))).toEqual([{ T: 55, K46: 59 }, { T: 45, K46: 59 }, { D: 59 }]);
    expect(candidateSets).toEqual(input);

    const regions = buildChordInferenceRegions(observations, result.candidateSets, result.selectedPath);
    expect(regions[0].observationIndices).toEqual([0, 1]);
    expect(regions[0].selected?.pathScore).toBe(59);
    expect(regions[0].alternatives[0].pathScore).toBe(55);
    expect(regions[0].status).toBe("ambiguous");
  });

  it("does not reset complete paths when a prefix has a negative score", () => {
    const { observations, candidateSets } = sequenceFixture();
    const negative = candidateSets.map((candidates) => candidates.map((candidate) => ({
      ...candidate,
      score: { ...candidate.score, total: -10 },
    })));
    const result = analyzeChordInferencePaths(observations, negative);
    expect(result.selectedPath.map((candidate) => candidate?.pathScore)).toEqual([-1, -1, -1]);
    expect(result.candidateSets[0].find((candidate) => candidate.functionalBaseId === "T")?.pathScore)
      .toBe(-5);
  });

  it("keeps scores independent across intervals with no candidates", () => {
    const { observations, candidateSets } = sequenceFixture();
    candidateSets[1] = [];
    const result = analyzeChordInferencePaths(observations, candidateSets);
    expect(result.selectedPath[1]).toBeUndefined();
    expect(result.candidateSets[1]).toEqual([]);
    expect(result.candidateSets[0].map((candidate) => candidate.pathScore)).toEqual([10, 10]);
    expect(result.candidateSets[2][0].pathScore).toBe(10);
    expect(analyzeChordInferencePaths([], [])).toEqual({ selectedPath: [], candidateSets: [] });
  });
});
