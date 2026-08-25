import { describe, expect, it } from "vitest";
import { createChordRegion } from "../../chords";
import { createEmptyProject, PPQ, type ChordDraft, type NoteEvent } from "../../project";
import { spellMidi } from "../../pitch";
import { buildHarmonyAnalysis } from "../analysis";
import { detectCadences } from "./detect";

function note(id: string, startTick: number, midi: number): NoteEvent {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    pitch: spellMidi(midi),
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function chord(
  project: ReturnType<typeof createEmptyProject>,
  id: string,
  startTick: number,
  draft: Omit<ChordDraft, "source" | "confidence">,
) {
  project.chordTrack.regions.push(
    createChordRegion(
      project,
      startTick,
      PPQ,
      { ...draft, source: "manual", confidence: "certain" },
      id,
    ),
  );
}

function baseProject() {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 2;
  project.satbTracks.find((track) => track.id === "bass")!.notes = [
    note("bass-dominant", 0, 43),
    note("bass-tonic", PPQ, 36),
  ];
  project.satbTracks.find((track) => track.id === "soprano")!.notes = [
    note("soprano-dominant", 0, 62),
    note("soprano-tonic", PPQ, 60),
  ];
  chord(project, "dominant", 0, {
    degree: 5,
    degreeAlteration: 0,
    quality: "major",
    inversion: 0,
  });
  chord(project, "tonic", PPQ, {
    degree: 1,
    degreeAlteration: 0,
    quality: "major",
    inversion: 0,
  });
  return project;
}

describe("终止候选检测", () => {
  it("只在乐句末端识别 D -> T 为全终止", () => {
    const project = baseProject();
    const analysis = buildHarmonyAnalysis(project);
    const candidates = detectCadences(analysis);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "full",
      form: "authentic",
      completion: "perfect",
      fromTick: 0,
      toTick: PPQ * 2,
      confidence: "certain",
    });
  });

  it("乐句中间的 D -> T 不产生终止候选", () => {
    const project = baseProject();
    project.structure.phraseBoundaries = [
      {
        id: "middle",
        tick: PPQ,
        source: "manual",
        confidence: "certain",
      },
    ];
    const analysis = buildHarmonyAnalysis(project);

    const candidates = detectCadences(analysis);
    expect(candidates.some((candidate) => candidate.kind === "full")).toBe(
      false,
    );
    expect(candidates.some((candidate) => candidate.kind === "half")).toBe(
      true,
    );
  });

  it("乐句置信度会限制终止置信度", () => {
    const project = baseProject();
    project.structure.phraseBoundaries = [
      {
        id: "probable",
        tick: PPQ,
        source: "inferred",
        confidence: "probable",
      },
    ];
    const analysis = buildHarmonyAnalysis(project);

    const candidates = detectCadences(analysis);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.confidence !== "certain")).toBe(
      true,
    );
  });
});
