import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../project";
import {
  analyzePhrases,
  inferPhrases,
  isCurrentPhraseBoundary,
  phraseAtTick,
} from "./index";

describe("乐句分析", () => {
  it("将工程首尾作为确定边界并生成单个乐句", () => {
    const result = analyzePhrases(createEmptyProject());

    expect(result.boundaries.map((boundary) => boundary.tick)).toEqual([0, 960 * 4 * 16]);
    expect(result.segments).toMatchObject([
      {
        fromTick: 0,
        toTick: 960 * 4 * 16,
        source: "inferred",
        confidence: "certain",
      },
    ]);
    expect(result.candidates).toEqual([]);
  });

  it("按人工边界生成相邻且不重叠的乐句", () => {
    const project = createEmptyProject();
    project.structure.phraseBoundaries = [
      {
        id: "phrase-middle",
        tick: 960 * 4,
        source: "manual",
        confidence: "certain",
      },
    ];

    const result = analyzePhrases(project);

    expect(result.segments.map((segment) => [segment.fromTick, segment.toTick])).toEqual([
      [0, 960 * 4],
      [960 * 4, 960 * 4 * 16],
    ]);
    expect(result.segments.every((segment) => segment.confidence === "certain")).toBe(
      true,
    );
    expect(phraseAtTick(result.segments, 960 * 4)).toMatchObject({
      fromTick: 960 * 4,
    });
  });

  it("合并重复边界并优先保留更高置信度", () => {
    const project = createEmptyProject();
    project.structure.phraseBoundaries = [
      {
        id: "ambiguous",
        tick: 960,
        source: "inferred",
        confidence: "ambiguous",
      },
      {
        id: "certain",
        tick: 960,
        source: "manual",
        confidence: "certain",
      },
    ];

    const result = analyzePhrases(project);

    expect(result.boundaries.filter((boundary) => boundary.tick === 960)).toEqual([
      expect.objectContaining({ id: "certain", source: "manual" }),
    ]);
  });

  it("从全声部结束和结束后空白生成只读边界候选", () => {
    const project = createEmptyProject();
    project.lengthTicks = 960 * 4;
    project.loop.endTick = project.lengthTicks;
    project.satbTracks.forEach((track) => {
      track.notes = [
        {
          id: `${track.id}-ending`,
          startTick: 0,
          durationTicks: 960 * 2,
          pitch: { step: "C", alter: 0, octave: 4 },
          velocity: 80,
          locked: false,
          spellingSource: "manual",
        },
      ];
    });

    const result = analyzePhrases(project);

    expect(result.candidates).toMatchObject([
      {
        tick: 960 * 2,
        score: 7,
        confidence: "probable",
      },
    ]);
    expect(result.segments).toHaveLength(1);
  });

  it("仅在显式推导时将高置信度候选写为自动边界", () => {
    const project = createEmptyProject();
    project.lengthTicks = 960 * 4;
    project.loop.endTick = project.lengthTicks;
    project.satbTracks.forEach((track) => {
      track.notes = [
        {
          id: `${track.id}-ending`,
          startTick: 0,
          durationTicks: 960 * 2,
          pitch: { step: "C", alter: 0, octave: 4 },
          velocity: 80,
          locked: false,
          spellingSource: "manual",
        },
      ];
    });

    const realtime = analyzePhrases(project, { generateCandidates: false });
    const inferred = inferPhrases(project);
    const boundary = inferred.boundaries.find((item) => item.tick === 960 * 2);

    expect(realtime.boundaries).toHaveLength(2);
    expect(boundary).toMatchObject({
      source: "inferred",
      confidence: "probable",
      stale: false,
    });
    expect(isCurrentPhraseBoundary(project, boundary!)).toBe(true);
  });

  it("输入改变后不再将旧的自动边界用于实时乐句分析", () => {
    const project = createEmptyProject();
    project.lengthTicks = 960 * 4;
    project.loop.endTick = project.lengthTicks;
    project.satbTracks.forEach((track) => {
      track.notes = [
        {
          id: `${track.id}-ending`,
          startTick: 0,
          durationTicks: 960 * 2,
          pitch: { step: "C", alter: 0, octave: 4 },
          velocity: 80,
          locked: false,
          spellingSource: "manual",
        },
      ];
    });
    project.structure.phraseBoundaries = inferPhrases(project).boundaries.filter(
      (item) => item.tick > 0 && item.tick < project.lengthTicks,
    );
    project.satbTracks[0].notes[0].durationTicks = 960 * 3;

    const result = analyzePhrases(project, { generateCandidates: false });

    expect(result.boundaries.map((boundary) => boundary.tick)).toEqual([
      0,
      project.lengthTicks,
    ]);
  });
});
