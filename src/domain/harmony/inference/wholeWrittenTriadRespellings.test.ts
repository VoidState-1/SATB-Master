import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyHarmonyInference, inferHarmony } from "./index";

const code = "whole-written-triad-respelling";

function example(voices = { soprano: "B4", alto: "E4", tenor: "B3", bass: "G#2" }) {
  return compileScoreText(`satb 1
key Eb minor
meter 2/4
bars 1..2 {
  S: | Ab4/4 ${voices.soprano}/4 | Bb4/4 Gb4/4 |
  A: | F4/4 ${voices.alto}/4 | F4/4 Eb4/4 |
  T: | Cb4/4 ${voices.tenor}/4 | Bb3/4 Bb3/4 |
  B: | D3/4 ${voices.bass}/4 | Bb2/4 Eb3/4 |
}`).project;
}

function infer(project: ReturnType<typeof example>, allowAbsoluteFallback = false) {
  const result = inferHarmony(project, { allowAbsoluteFallback });
  const region = result.chordInference.regions.find(item =>
    item.fromTick <= project.ppq && item.toTick > project.ppq);
  return {
    result, region,
    hasWrittenReading: region?.selected?.evidence.some(evidence => evidence.code === code) === true,
  };
}

function inversionReported(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics.some(diagnostic =>
    diagnostic.tick === project.ppq && diagnostic.ruleId === "chord.inversion-bass" &&
    diagnostic.severity === "error");
}

describe("完整三和弦一致等音换写的推导", () => {
  it("开启绝对回退时按实写 E/G♯ 提供待确认候选", () => {
    const project = example();
    const { result, region, hasWrittenReading } = infer(project, true);
    expect(hasWrittenReading).toBe(true);
    expect(region?.status).toBe("ambiguous");
    expect(region?.selected?.identity).toMatchObject({
      root: { step: "E", alter: 0 },
      bass: { step: "G", alter: 1 },
      structure: { kind: "tertian", quality: "major" },
    });
    expect(region?.selected?.semantics).toBeUndefined();
    const normal = applyHarmonyInference(project, result, { mode: "fill-gaps" }).project;
    expect(normal.chordTrack.regions.some(item => item.startTick === project.ppq)).toBe(false);
    const explicit = applyHarmonyInference(project, result, {
      mode: "fill-gaps", selection: new Set([region!.id]),
    }).project;
    expect(explicit.chordTrack.regions[0]?.identity).toEqual(region?.selected?.identity);
    expect(inversionReported(explicit)).toBe(false);
  });

  it("关闭绝对回退时不生成未经证实的功能或绝对候选", () => {
    const project = example();
    const { result, region } = infer(project);
    expect(region?.status).toBe("unclassified");
    expect(region?.selected).toBeUndefined();
    expect(applyHarmonyInference(project, result, { mode: "fill-gaps" }).project.chordTrack.regions
      .some(chord => chord.startTick === project.ppq)).toBe(false);
  });

  it("置信度过滤隐藏待确认项时也不写回旧等音功能", () => {
    const project = example();
    const result = inferHarmony(project, { minConfidence: "medium", allowAbsoluteFallback: true });
    const region = result.chordInference.regions.find(item =>
      item.fromTick <= project.ppq && item.toTick > project.ppq);
    expect(region?.status).toBe("unclassified");
    const applied = applyHarmonyInference(project, result, { mode: "fill-gaps" }).project;
    expect(applied.chordTrack.regions.some(item => item.startTick === project.ppq)).toBe(false);
  });
  it("真实的单低音拼写冲突仍由规则报告", () => {
    const project = example({ soprano: "Cb5", alto: "Fb4", tenor: "Cb4", bass: "G#2" });
    const { result, region, hasWrittenReading } = infer(project);
    expect(hasWrittenReading).toBe(false);
    expect(region?.status).toBe("resolved");
    expect(inversionReported(applyHarmonyInference(project, result, { mode: "fill-gaps" }).project)).toBe(true);
  });

  it("已经有完整实写功能时仍正常应用", () => {
    const project = example({ soprano: "Cb5", alto: "Fb4", tenor: "Cb4", bass: "Ab2" });
    const { result, region, hasWrittenReading } = infer(project);
    expect(hasWrittenReading).toBe(false);
    expect(region?.selected?.functionalBaseId).toBe("N6");
    expect(region?.status).toBe("resolved");
    expect(inversionReported(applyHarmonyInference(project, result, { mode: "fill-gaps" }).project)).toBe(false);
  });

  it("只有低音攻入、其余声部仍在持续时不切作新三和弦", () => {
    const project = compileScoreText(`satb 1
key Eb minor
meter 2/4
bars 1..2 {
  S: | B4/2 | Bb4/4 Gb4/4 |
  A: | E4/2 | F4/4 Eb4/4 |
  T: | B3/2 | Bb3/4 Bb3/4 |
  B: | F#2/4 G#2/4 | Bb2/4 Eb3/4 |
}`).project;
    expect(infer(project, true).hasWrittenReading).toBe(false);
  });

  it("显式句界禁止借相邻的另一句成立候选", () => {
    const project = example();
    project.structure.phraseBoundaries = [{
      id: "manual-boundary", tick: 2 * project.ppq, source: "manual", confidence: "certain",
    }];
    expect(infer(project, true).hasWrittenReading).toBe(false);
  });

  it("标签低音不是最低实音时不接受书写替代", () => {
    const project = example({ soprano: "B4", alto: "E4", tenor: "B1", bass: "G#2" });
    expect(infer(project, true).hasWrittenReading).toBe(false);
  });
});
