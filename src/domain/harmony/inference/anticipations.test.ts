import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { phraseInferenceFingerprint } from "../phrase";
import { applyChordInference } from "./apply";
import { inferChords } from "./inferChords";
import type { ChordInferenceOptions } from "./types";

const earlyBass = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | E4/4 G4/4 |
  A: | C4/4 F4/4 |
  T: | G3/4 B3/4 |
  B: | C3/8 D3/8 D3/4 |
}`;

const twoUpperVoices = `satb 1
key C minor
meter 2/4
bars 1..2 {
  S: | B4/4. C5/8 | C5/2 |
  A: | F4/4. Eb4/8 | Eb4/2 |
  T: | G3/2 | G3/2 |
  B: | D3/2 | C3/2 |
}`;

const literalSeventh = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | A4/4 G4/4 |
  A: | F4/4 E4/4 |
  T: | C4/2 |
  B: | F3/8 E3/8 E3/4 |
}`;

const leadingToTonic = `satb 1
key F major
meter 2/4
bars 1..2 {
  S: | Bb4/4. A4/8 | A4/2 |
  A: | F4/4 E4/4 | F4/2 |
  T: | D4/4 C4/4 | C4/2 |
  B: | Bb3/8 A3/8 G3/8 F3/8 | F3/2 |
}`;

const leadingToDmOverF = leadingToTonic
  .replace("E4/4 | F4/2", "E4/4 | D4/2")
  .replace("C4/4 | C4/2", "C4/4 | A3/2");

const transposedToG = leadingToTonic
  .replace("key F major", "key G major")
  .replace("Bb4/4. A4/8 | A4/2", "C5/4. B4/8 | B4/2")
  .replace("F4/4 E4/4 | F4/2", "G4/4 F#4/4 | G4/2")
  .replace("D4/4 C4/4 | C4/2", "E4/4 D4/4 | D4/2")
  .replace("Bb3/8 A3/8 G3/8 F3/8 | F3/2", "C4/8 B3/8 A3/8 G3/8 | G3/2");

const writtenAugmentedTriad = `satb 1
key C major
meter 2/4
bars 1..2 {
  S: | A4/4. G#4/8 | G#4/4 A4/4 |
  A: | E4/2 | E4/4 E4/4 |
  T: | C4/2 | B3/4 C4/4 |
  B: | C3/2 | G#2/4 A2/4 |
}`;

const competingSixth = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | F4/8 E4/8 E4/4 |
  A: | D4/4 C4/4 |
  T: | B3/4 A3/4 |
  B: | G3/4 A2/4 |
}`;

function regionAt(score: string, tick = 480, options?: ChordInferenceOptions) {
  const { project } = compileScoreText(score);
  return inferChords(project, options).regions.find(r => r.fromTick <= tick && tick < r.toTick)!;
}

describe("弱位先现音的和弦推导", () => {
  it("保留前和弦的原位和时值，并可按正常入口写回先现低音", () => {
    const { project } = compileScoreText(earlyBass);
    const result = inferChords(project);
    const bass = project.satbTracks.find(track => track.id === "bass")!;
    const early = bass.notes[1].id;
    const [tonic, dominant] = result.regions;
    expect(tonic).toMatchObject({
      fromTick: 0, toTick: 960, status: "resolved",
      selected: {
        functionalBaseId: "T", confidence: "medium",
        identity: { root: { step: "C" }, bass: { step: "C" } },
        fit: { bassMatchesInversion: false, nonChordToneAssignments: { [early]: "anticipation" } },
      },
    });
    expect(dominant.selected?.identity).toMatchObject({
      root: { step: "G" }, bass: { step: "D" }, structure: { quality: "dominant7" },
    });
    const applied = applyChordInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(applied.appliedRegionCount).toBe(2);
    expect(applied.writtenNonChordToneRoleCount).toBe(1);
    expect(applied.project.satbTracks.find(track => track.id === "bass")?.notes.map(note => note.nonChordToneRole))
      .toEqual([undefined, "anticipation", undefined]);
  });

  it("两个上声部反向级进到小调主和弦时保留 D43 和两个先现音", () => {
    const region = regionAt(twoUpperVoices, 1680);
    expect(region).toMatchObject({
      fromTick: 0, toTick: 1920, status: "resolved",
      selected: {
        identity: { root: { step: "G" }, bass: { step: "D" }, structure: { quality: "dominant7" } },
        fit: { omittedChordDegrees: [3, 7], bassMatchesInversion: true },
      },
    });
    expect(Object.values(region.selected?.fit.nonChordToneAssignments ?? {})).toEqual(["anticipation", "anticipation"]);
  });

  it("保留能按实音解释的第三转位下属七和弦", () => {
    const region = regionAt(literalSeventh);
    expect(region).toMatchObject({
      fromTick: 480, toTick: 960, status: "resolved",
      selected: { identity: { root: { step: "F" }, bass: { step: "E" }, structure: { quality: "major7" } } },
    });
    expect(region.alternatives.flatMap(candidate => candidate.evidence)).not.toContainEqual(expect.objectContaining({ code: "anticipation" }));
  });

  it.each([
    ["七音上行到原位 F", leadingToTonic, "C", "G", "F", "major"],
    ["七音下行到 Dm/F", leadingToDmOverF, "C", "G", "D", "minor"],
    ["移调后完整 Gmaj7", transposedToG, "D", "A", "G", "major"],
  ])("%s 时对超出模板的完整实音主动弃权", (_name, score, dominant, fifth, landing, quality) => {
    const { project } = compileScoreText(score);
    const result = inferChords(project);
    expect(result.regions.find(region => region.fromTick === 960)).toMatchObject({
      toTick: 1440, status: "resolved",
      selected: { identity: { root: { step: dominant }, bass: { step: fifth }, structure: { quality: "dominant7" } } },
    });
    expect(result.regions.find(region => region.fromTick === 1440)).toEqual(expect.objectContaining({
      toTick: 1920, status: "unclassified", alternatives: [],
    }));
    expect(result.regions.find(region => region.fromTick === 1920)).toMatchObject({
      selected: { identity: { root: { step: landing }, structure: { quality } } },
    });
    const applied = applyChordInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(applied.project.chordTrack.regions.some(chord => chord.startTick === 1440)).toBe(false);
  });

  it("C–E–G# 的完整增三和弦也阻止将 G# 当成 E/G# 的唯一先现", () => {
    const region = regionAt(writtenAugmentedTriad, 1440);
    expect(region).toMatchObject({ fromTick: 1440, toTick: 1920, status: "unclassified", alternatives: [] });
  });

  it.each([1440, 1680, 1920])("明确句界在 tick %i 时停止使用两侧先现证据", tick => {
    const { project } = compileScoreText(twoUpperVoices);
    project.structure.phraseBoundaries.push({ id: "manual-boundary", tick, source: "manual", confidence: "certain" });
    const result = inferChords(project);
    expect(result.regions.find(region => region.fromTick === 1440)).toMatchObject({
      toTick: 1920, status: "unclassified", alternatives: [],
    });
    const applied = applyChordInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
  });

  it.each([[false, "unclassified"], [true, "resolved"]] as const)(
    "已写入工程的推导句界 stale=%s 时，先现切片为 %s",
    (stale, expectedStatus) => {
      const { project } = compileScoreText(twoUpperVoices);
      project.structure.phraseBoundaries.push({
        id: "inferred-boundary", tick: 1680, source: "inferred", confidence: "probable",
        inferenceFingerprint: phraseInferenceFingerprint(project), stale,
      });
      const region = inferChords(project).regions.find(item => item.fromTick <= 1440 && 1440 < item.toTick);
      expect(region?.status).toBe(expectedStatus);
    },
  );

  it("三和弦加六度已完整写出时保留弃权，避免强行续接前一七和弦", () => {
    expect(regionAt(competingSixth)).toMatchObject({ fromTick: 480, toTick: 960, status: "unclassified", alternatives: [] });
  });

  it.each([
    [earlyBass.replace("D3/8 D3/4", "D3/8 D2/4"), {}],
    [earlyBass, { minConfidence: "high" }],
    [earlyBass, { allowNonChordToneCandidates: false }],
  ] as const)("预先音没有同音确认或筛选禁止时保留弃权", (score, options) => {
    expect(regionAt(score, 480, options).status).toBe("unclassified");
  });
});
