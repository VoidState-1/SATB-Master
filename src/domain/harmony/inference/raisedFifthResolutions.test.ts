import { describe, expect, it } from "vitest";
import { formatChordRegion } from "../../chords";
import { validateProject } from "../../project";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference, inferHarmony } from "./harmonyInference";

const resolution = "raised-fifth-to-doubled-third";
const score = `satb 1
key F major
meter 4/4
bars 1..1 {
  S: | G4/4 G#4/4 A4/2 |
  A: | E4/2 F4/2 |
  T: | Bb3/2 A3/2 |
  B: | C3/2 F3/2 |
}`;

describe("原位升五属七到重复三音的原位大主和弦", () => {
  it("保留普通属七，默认写回变音与只省五音的主和弦", () => {
    const { project } = compileScoreText(score);
    const result = inferHarmony(project);
    const [ordinary, altered, tonic] = result.chordInference.regions;
    expect(result.chordInference.unresolvedObservationIndices).toEqual([]);
    expect(ordinary.selected?.identity.structure).toMatchObject({ quality: "dominant7", alterations: [] });
    expect(altered.selected?.fit).toMatchObject({ omittedChordDegrees: [], nonChordToneNoteIds: [] });
    expect(tonic.selected?.fit).toMatchObject({ omittedChordDegrees: [5], nonChordToneNoteIds: [] });
    expect([altered, tonic].map(region => region.status)).toEqual(["resolved", "resolved"]);
    for (const region of [altered, tonic]) {
      expect(region.selected?.evidence.some(evidence => evidence.code === resolution)).toBe(true);
    }

    const { project: written, skipped } = applyHarmonyInference(project, result, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    });
    expect(skipped).toEqual([]);
    expect(written.satbTracks).toEqual(project.satbTracks);
    expect(validateProject(JSON.parse(JSON.stringify(written)))).toBe(true);
    expect(written.chordTrack.regions.map(region => formatChordRegion(written, region).functional))
      .toEqual(["D7", "D7(♯5)", "T"]);
    expect(written.chordTrack.regions[1].identity.structure).toMatchObject({
      quality: "dominant7", alterations: [{ degree: 5, alter: 1, tendency: "up" }],
    });
  });

  it("选区内仍可用选区外相邻配置证明变音与省五", () => {
    const { project } = compileScoreText(score);
    const fromTick = project.ppq + 1;
    const toTick = 2 * project.ppq + 1;
    const selected = inferHarmony(project, { fromTick, toTick }).chordInference;
    expect(selected.regions.map(region => [region.fromTick, region.toTick, region.selected?.functionalBaseId]))
      .toEqual([[fromTick, 2 * project.ppq, "D"], [2 * project.ppq, toTick, "T"]]);
    const onlyTonic = inferHarmony(project, { fromTick: 2 * project.ppq, toTick }).chordInference;
    expect(onlyTonic.regions[0].selected?.fit.omittedChordDegrees).toEqual([5]);
  });

  it.each([
    ["降拼等音", score.replace("G#4/4", "Ab4/4")],
    ["升五音越过八度", score.replace("A4/2", "A5/2")],
    ["七音越过八度", score.replace("Bb3/2 A3/2", "Bb3/2 A4/2")],
    ["导音越过八度", score.replace("E4/2 F4/2", "E4/2 F5/2")],
    ["低音越过一个八度", score.replace("C3/2 F3/2", "C3/2 F1/2")],
    ["低音在解决前休止", score.replace("C3/2 F3/2", "C3/4. r/8 F3/2")],
    ["来源为第一转位", score.replace("E4/2 F4/2", "C4/2 F4/2").replace("C3/2 F3/2", "E3/2 F3/2")],
    ["落点包含五音", score.replace("Bb3/2 A3/2", "Bb3/2 C4/2")],
    ["小调", score.replace("F major", "F minor")],
    ["落点变调", score.replace("meter 4/4", "meter 4/4\nat 1:3 key C major")],
    ["落点重申调号", score.replace("meter 4/4", "meter 4/4\nat 1:3 key F major")],
  ])("%s 时保留普通推导，无成对解决证据", (_name, text) => {
    const { project } = compileScoreText(text);
    const regions = inferHarmony(project).chordInference.regions;
    const candidates = regions.flatMap(region => [region.selected, ...region.alternatives]);
    expect(candidates.some(candidate => candidate?.evidence.some(e => e.code === resolution))).toBe(false);
  });

  it("承认改调之后完全位于新调的连接", () => {
    const { project } = compileScoreText(score.replace("key F major", "key C major")
      .replace("meter 4/4", "meter 4/4\nat 1:2 key F major"));
    const regions = inferHarmony(project).chordInference.regions;
    expect(regions.slice(-2).map(region => region.selected?.evidence.some(e => e.code === resolution)))
      .toEqual([true, true]);
  });

  it("沿用独立确立的本地调，单靠这组音不建立新调", () => {
    const local = `satb 1
key C major
meter 4/4
bars 1..2 {
  S: | G4/2. G4/8 G#4/8 | A4/1 |
  A: | D4/2. E4/4 | F4/1 |
  T: | Bb3/2. Bb3/4 | A3/1 |
  B: | G2/2. C3/4 | F3/1 |
}`;
    const { project } = compileScoreText(local);
    const pair = inferHarmony(project).chordInference.regions.slice(-2);
    expect(pair.map(region => region.selected?.semantics?.interpretations[0].localKey))
      .toEqual(Array(2).fill({ tonic: { step: "F", alter: 0 }, mode: "major" }));
    expect(pair.map(region => region.selected?.evidence.some(e => e.code === resolution))).toEqual([true, true]);

    const unprepared = compileScoreText(local.replace("Bb3/2.", "B3/2.")).project;
    const regions = inferHarmony(unprepared).chordInference.regions;
    const candidates = regions.flatMap(region => [region.selected, ...region.alternatives]);
    expect(candidates.some(candidate => candidate?.evidence.some(e => e.code === resolution))).toBe(false);
  });

  it("解决不能跨手动画定的句界", () => {
    const { project } = compileScoreText(score);
    project.structure.phraseBoundaries = [{
      id: "manual-phrase", tick: 2 * project.ppq, source: "manual", confidence: "certain",
    }];
    const regions = inferHarmony(project).chordInference.regions;
    const candidates = regions.flatMap(region => [region.selected, ...region.alternatives]);
    expect(candidates.some(candidate => candidate?.evidence.some(e => e.code === resolution))).toBe(false);
  });
});
