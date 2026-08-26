import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  PPQ,
  type NoteEvent,
  type ProjectDocument,
} from "../../project";
import {
  analyzePhrases,
  inferPhrases,
  isCurrentPhraseBoundary,
  phraseAtTick,
} from "./index";

function note(id: string, startTick: number, durationTicks: number): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: { step: "C", alter: 0, octave: 4 },
    velocity: 80,
    locked: false,
    spellingSource: "manual",
  };
}

function setIntervals(
  project: ProjectDocument,
  intervals: readonly (readonly [number, number])[],
) {
  project.satbTracks.forEach((track) => {
    track.notes = intervals.map(([startTick, endTick], index) =>
      note(track.id + "-" + index, startTick, endTick - startTick));
  });
}

describe("乐句分析", () => {
  it("将工程首尾作为确定边界并生成单个乐句", () => {
    const result = analyzePhrases(createEmptyProject());

    expect(result.boundaries.map((boundary) => boundary.tick)).toEqual([
      0,
      PPQ * 4 * 16,
    ]);
    expect(result.segments).toMatchObject([{
      fromTick: 0,
      toTick: PPQ * 4 * 16,
      source: "inferred",
      confidence: "certain",
    }]);
    expect(result.candidates).toEqual([]);
    expect(result.template.kind).toBe("single");
  });

  it("按人工边界生成相邻且不重叠的乐句", () => {
    const project = createEmptyProject();
    project.structure.phraseBoundaries = [{
      id: "phrase-middle",
      tick: PPQ * 4,
      source: "manual",
      confidence: "certain",
    }];

    const result = analyzePhrases(project);

    expect(result.segments.map((segment) => [segment.fromTick, segment.toTick])).toEqual([
      [0, PPQ * 4],
      [PPQ * 4, PPQ * 4 * 16],
    ]);
    expect(result.segments.every((segment) => segment.confidence === "certain")).toBe(true);
    expect(phraseAtTick(result.segments, PPQ * 4)).toMatchObject({
      fromTick: PPQ * 4,
    });
  });

  it("合并重复边界并优先保留人工边界", () => {
    const project = createEmptyProject();
    project.structure.phraseBoundaries = [
      {
        id: "ambiguous",
        tick: PPQ,
        source: "inferred",
        confidence: "ambiguous",
      },
      {
        id: "certain",
        tick: PPQ,
        source: "manual",
        confidence: "certain",
      },
    ];

    const result = analyzePhrases(project);

    expect(result.boundaries.filter((boundary) => boundary.tick === PPQ)).toEqual([
      expect.objectContaining({ id: "certain", source: "manual" }),
    ]);
  });

  it("按有效时长中点识别具有实际停顿的双乐句模板", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 4],
      [PPQ * 5, PPQ * 8],
    ]);

    const analyzed = analyzePhrases(project);
    const inferred = inferPhrases(project);
    const boundary = inferred.boundaries.find((item) => item.tick === PPQ * 4);

    expect(analyzed.template.kind).toBe("duple");
    expect(analyzed.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tick: PPQ * 4,
        targetRatio: "half",
        support: "strong",
      }),
    ]));
    expect(boundary).toMatchObject({
      source: "inferred",
      confidence: "probable",
      stale: false,
    });
    expect(isCurrentPhraseBoundary(project, boundary!)).toBe(true);
  });

  it("普通整齐重奏和强拍不会把连续材料切成多个乐句", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 12;
    project.loop.endTick = project.lengthTicks;
    setIntervals(
      project,
      Array.from({ length: 12 }, (_, index) =>
        [index * PPQ, (index + 1) * PPQ] as const),
    );

    const result = inferPhrases(project);

    expect(result.template.kind).toBe("single");
    expect(result.boundaries.map((boundary) => boundary.tick)).toEqual([
      0,
      project.lengthTicks,
    ]);
  });

  it("长音在同一拍立即重奏时不建立强乐句边界", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 4],
      [PPQ * 4, PPQ * 8],
    ]);

    const result = inferPhrases(project);

    expect(result.template.kind).toBe("single");
    expect(result.boundaries).toHaveLength(2);
  });

  it("同时支持两个规整断点时选择三乐句模板", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 24;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 8],
      [PPQ * 9, PPQ * 16],
      [PPQ * 17, PPQ * 24],
    ]);

    const result = inferPhrases(project);

    expect(result.template.kind).toBe("triple");
    expect(result.boundaries.filter((boundary) =>
      boundary.tick > 0 && boundary.tick < project.lengthTicks)
      .map((boundary) => boundary.tick)).toEqual([PPQ * 8, PPQ * 16]);
  });

  it("即使三个比例位置都有强断点，也最多生成两个内部边界", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 48;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 16],
      [PPQ * 17, PPQ * 24],
      [PPQ * 25, PPQ * 32],
      [PPQ * 33, PPQ * 48],
    ]);

    const result = inferPhrases(project);
    const automatic = result.boundaries.filter(
      (boundary) => boundary.tick > 0 && boundary.tick < project.lengthTicks,
    );

    expect(automatic.length).toBeLessThanOrEqual(2);
    expect(result.segments.length).toBeLessThanOrEqual(3);
  });

  it("有效时长会排除结尾空白，不把音乐结束误作内部边界", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [[0, PPQ * 4]]);

    const result = inferPhrases(project);

    expect(result.template.kind).toBe("single");
    expect(result.boundaries).toHaveLength(2);
  });

  it("输入改变后不再将旧的自动边界用于实时分析", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 8;
    project.loop.endTick = project.lengthTicks;
    setIntervals(project, [
      [0, PPQ * 4],
      [PPQ * 5, PPQ * 8],
    ]);
    project.structure.phraseBoundaries = inferPhrases(project).boundaries.filter(
      (item) => item.tick > 0 && item.tick < project.lengthTicks,
    );
    project.satbTracks[0].notes[0].durationTicks += 1;

    const result = analyzePhrases(project, { generateCandidates: false });

    expect(result.boundaries.map((boundary) => boundary.tick)).toEqual([
      0,
      project.lengthTicks,
    ]);
  });
});
