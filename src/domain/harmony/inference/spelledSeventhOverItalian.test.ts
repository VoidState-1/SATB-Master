import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyChordInference } from "./apply";
import { inferChords } from "./inferChords";

// First tonicization in Huang §47, written exercise 10, with straight eighths.
const seventh = `satb 1
key Ab major
meter 2/4
bars 1..2 {
  S: | Ab4/8 Ab4/8~ Ab4/8 Bbb4/8 | G4/2 |
  A: | Cb4/8 Ebb4/8 Db4/4 | Db4/2 |
  T: | Ab3/8 Fb3/8 Fb3/4 | Eb3/2 |
  B: | Fb3/4 Bbb2/4 | Bb2/2 |
}`;

const italian = `satb 1
key Ab major
meter 2/4
bars 1..2 {
  S: | Ab4/8 Ab4/8 G4/4 | Ab4/2 |
  A: | Cb4/8 D4/8 Eb4/4 | Eb4/2 |
  T: | Ab3/8 Ab3/8 Bb3/4 | C4/2 |
  B: | Fb3/4 Eb3/4 | Ab2/2 |
}`;

function analyze(score: string, cut?: number) {
  const project = compileScoreText(score).project;
  if (cut !== undefined) project.structure.phraseBoundaries = [
    { id: "cut", source: "manual", tick: cut, confidence: "certain" },
  ];
  const inferred = inferChords(project);
  const applied = applyChordInference(project, inferred, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  });
  const at = (tick: number) => applied.project.chordTrack.regions.find(r => r.startTick === tick);
  const source = inferred.regions.find(r => r.fromTick === 480)?.selected;
  return { source, at, applied, project, diagnostics: checkHarmony(applied.project).diagnostics };
}

describe("书写小七度与等音意式增六", () => {
  it("核实先行低音和后到上方导音后才写回省五属七", () => {
    const { source, at, applied, project, diagnostics } = analyze(seventh);
    expect(source?.evidence).toContainEqual(expect.objectContaining({
      code: "written-seventh-over-enharmonic-italian",
      details: { targetRoot: "B:-2", targetQuality: "major", omittedDegree: 5, bassArrivalTick: 960, upperResolutionTick: 1440 },
    }));
    expect(at(480)).toMatchObject({
      startTick: 480, durationTicks: 480,
      identity: { root: { step: "F", alter: -1 }, bass: { step: "F", alter: -1 }, structure: { quality: "dominant7" } },
    });
    const reading = at(480)?.semantics?.interpretations[0];
    expect(reading).toMatchObject({ degree: 6, degreeAlteration: -1 });
    expect(reading?.localKey).toBeUndefined();
    expect(reading?.appliedTarget).toBeUndefined();
    expect(at(1440)?.identity).toMatchObject({ root: { step: "B", alter: -2 }, structure: { quality: "major" } });
    expect(applied.project.keyEvents).toEqual(project.keyEvents);
    expect(applied.project.satbTracks).toEqual(project.satbTracks);
    expect(diagnostics.filter(d => d.ruleId === "chord.augmented-sixth-voicing")).toEqual([]);
  });

  it("开启绝对回退仍选取有解决证据的实写属七，并遵守高置信门槛", () => {
    const { project } = compileScoreText(seventh);
    const atSource = (options: Parameters<typeof inferChords>[1]) =>
      inferChords(project, options).regions.find(region => region.fromTick <= 480 && 480 < region.toTick);
    const resolved = atSource({ allowAbsoluteFallback: true });
    expect(resolved).toMatchObject({
      status: "resolved", selected: { identity: { root: { step: "F", alter: -1 }, structure: { quality: "dominant7" } } },
    });
    expect(atSource({ minConfidence: "high" })?.selected).toBeUndefined();
  });

  it("同一写实解决可同步到达", () => {
    const direct = seventh.replace("Ab4/8 Ab4/8~ Ab4/8 Bbb4/8", "Ab4/8 Ab4/8 Bbb4/4");
    expect(analyze(direct).source?.evidence).toContainEqual(expect.objectContaining({
      code: "written-seventh-over-enharmonic-italian",
      details: expect.objectContaining({ bassArrivalTick: 960, upperResolutionTick: 960 }),
    }));
  });

  it("实写增六的两声部向属低音反向解决", () => {
    const { at, diagnostics } = analyze(italian);
    expect(at(480)?.identity.structure).toMatchObject({ kind: "augmented-sixth", variant: "italian" });
    expect(diagnostics.filter(d => d.ruleId === "chord.augmented-sixth-voicing")).toEqual([]);
  });

  it("同声响改写为 D 后仍查意式增六的错误重复", () => {
    const { at, diagnostics } = analyze(seventh.replace("Ebb4/8", "D4/8"));
    expect(at(480)?.identity.structure).toMatchObject({ kind: "augmented-sixth", variant: "italian" });
    expect(diagnostics).toContainEqual(expect.objectContaining({ ruleId: "chord.augmented-sixth-voicing", tick: 480 }));
  });

  it.each([
    ["目标低音错误，即使上三声部同音", seventh.replace("Bbb2/4", "Db3/4"), undefined],
    ["实际七音解决错八度，音级集合不变", seventh.replace("Ebb4/8 Db4/4", "Ebb4/8 Db5/4"), undefined],
    ["实际导音解决错八度，音级集合不变", seventh.replace("Bbb4/8", "Bbb5/8"), undefined],
    ["前一低音没有保持到切片", seventh.replace("Fb3/4 Bbb2/4", "Fb3/8 Fb3/8 Bbb2/4"), undefined],
    ["邻拍没有结束原属七的五音", seventh.replace("Cb4/8", "C4/8"), undefined],
    ["导音重新起奏，不能代替原音符的延线", seventh.replace("Ab4/8~ Ab4/8", "Ab4/8 Ab4/8"), undefined],
    ["句界切断延迟解决", seventh, 1440],
  ] as const)("证据不足时保留原候选（%s）", (_label, score, cut) => {
    expect(analyze(score, cut).at(480)?.identity.structure).toMatchObject({ kind: "augmented-sixth", variant: "italian" });
  });
});
