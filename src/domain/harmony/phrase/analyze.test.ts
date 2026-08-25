import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../project";
import { analyzePhrases, phraseAtTick } from "./index";

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
});
