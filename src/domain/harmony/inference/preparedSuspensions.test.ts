import { describe, expect, it } from "vitest";
import { buildMetricTimeline, compareMetricStrength, metricPositionAt } from "../../rhythm/metric";
import { compileScoreText } from "../../scoreText";
import { applyChordInference, inferChords } from "./index";
import type { ChordInferenceOptions } from "./types";

const single = `satb 1
key C major
meter 3/4
bars 1..2 {
  S: | D5/2. | C5/2. |
  A: | B4/2. | G4/2. |
  T: | F4/2.~ | F4/4 E4/2 |
  B: | G2/2. | C3/2. |
}`;

const double = `satb 1
key D major
meter 3/4
bars 1..2 {
  S: | E5/2.~ | E5/4 D5/2 |
  A: | A4/2. | A4/2. |
  T: | G4/2.~ | G4/4 F#4/2 |
  B: | C#4/2. | D4/2. |
}`;

const ninth = double.replace("G4/2.~ | G4/4 F#4/2", "G4/2. | F#4/2.");
const minor = single.replace("key C major", "key C minor").replace("E4/2", "Eb4/2");
const preparationWithSubdivision = single.replace("D5/2. |", "D5/2 D5/8 Eb5/8 |");

function hasSuspension(result: ReturnType<typeof inferChords>, tick: number) {
  const region = result.regions.find(r => r.fromTick <= tick && tick < r.toTick);
  return [region?.selected, ...(region?.alternatives ?? [])].some(candidate =>
    candidate?.evidence.some(item => item.code === "prepared-suspension"),
  );
}

function regionAt(score: string, options?: ChordInferenceOptions) {
  const { project } = compileScoreText(score);
  return inferChords(project, options).regions.find(r => r.fromTick <= 2880 && 2880 < r.toTick);
}

describe("已准备的 4–3 与 9–8 延留", () => {
  it.each([
    ["大调单延留", single, "C", "major", ["4-3"]],
    ["小调单延留", minor, "C", "minor", ["4-3"]],
    ["准备后的弱细分仍有续响", preparationWithSubdivision, "C", "major", ["4-3"]],
    ["只有 9–8，三五音已在原声部", ninth, "D", "major", ["9-8"]],
    ["同时有 9–8", double, "D", "major", ["9-8", "4-3"]],
  ] as const)("%s 从强拍起推导落地主和弦", (_name, score, root, quality, figures) => {
    const { project } = compileScoreText(score);
    const result = inferChords(project);
    const found = result.regions.find(region => region.fromTick === 2880);
    expect(found).toMatchObject({
      fromTick: 2880, toTick: 5760, status: "resolved",
      selected: {
        identity: { root: { step: root }, bass: { step: root }, structure: { quality } },
        fit: { omittedChordDegrees: figures.some(f => f === "4-3") ? [3] : [], nonChordToneAssignments: {} },
      },
    });
    const evidence = found?.selected?.evidence.filter(item => item.code === "prepared-suspension") ?? [];
    expect(evidence.map(item => item.details)).toEqual(figures.map(figure => ({ figure, fromTick: 2880, toTick: 3840 })));
    const applied = applyChordInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(applied.project.satbTracks).toEqual(project.satbTracks);
    expect(applied.project.chordTrack.regions.at(-1)).toMatchObject({ startTick: 2880, durationTicks: 2880 });
  });

  it.each([
    ["强位重新起奏", single.replace("F4/2.~", "F4/2.")],
    ["等音异名的解决音", single.replace("F4/4 E4/2", "F4/4 Fb4/2")],
    ["另一声部奏出三音", single.replace("G4/2.", "G4/4 E4/2").replace("F4/4 E4/2", "F4/4 G3/2")],
    ["延留低音到解决时重新起奏", single.replace("C3/2.", "C3/4 C3/2")],
    ["9–8 解决时第三声部也重新起奏", ninth.replace("F#4/2.", "F#4/4 F#4/2")],
    ["9–8 解决后缺五音", ninth.replace("A4/2. | A4/2.", "A4/2. | D5/2.")],
  ])("%s 时不使用这条延留路径", (_name, score) => {
    const region = regionAt(score);
    expect(region?.selected?.evidence.some(item => item.code === "prepared-suspension")).not.toBe(true);
  });

  it.each([
    ["F#4", "major"], ["F4", "minor"],
  ] as const)("单九度延留延伸 D %s 的落地读法", (third, quality) => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..4 {
 S: | E5/1~ | E5/4 D5/2. | D5/1 | C5/1 |
 A: | G4/1 | ${third}/1 | F4/1 | E4/1 |
 T: | C4/1 | A3/1 | B3/1 | G3/1 |
 B: | C3/1 | D3/1 | G2/1 | C3/1 |
}`);
    const result = inferChords(project);
    const arrival = result.regions.find(r => r.fromTick === 3840);
    expect(arrival).toMatchObject({ toTick: 7680, status: "resolved", selected: {
      identity: { root: { step: "D" }, structure: { quality } },
      fit: { omittedChordDegrees: [], nonChordToneAssignments: {} },
    } });
    expect(arrival?.selected?.evidence).toContainEqual(expect.objectContaining({
      code: "prepared-suspension", details: { figure: "9-8", fromTick: 3840, toTick: 4800 },
    }));
    const applied = applyChordInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(applied.project.satbTracks).toEqual(project.satbTracks);
  });

  it("切片已完整拼出 F/C，保留字面替代和弦", () => {
    const score = single.replace("G4/2.", "A4/4 G4/2");
    const region = regionAt(score);
    expect(region?.selected?.identity).toMatchObject({
      root: { step: "F" }, bass: { step: "C" }, structure: { quality: "major" },
    });
    expect(region?.selected?.evidence.some(item => item.code === "prepared-suspension")).toBe(false);
  });

  it("临近准备切片已完整写成调外 Gm7 时不回找之前的 G7", () => {
    const score = single.replace("B4/2. |", "B4/2 B4/8 Bb4/8 |");
    const { project } = compileScoreText(score);
    const result = inferChords(project);
    expect(result.regions.find(r => r.fromTick === 2400)?.status).toBe("unclassified");
    expect(hasSuspension(result, 2880)).toBe(false);
  });

  it("同一延音早已起奏但实际属和弦仅准备半拍时不推导", () => {
    const tooShort = single.replace("D5/2. |", "C5/2 C5/8 D5/8 |")
      .replace("B4/2. |", "A4/2 A4/8 B4/8 |")
      .replace("G2/2. |", "F3/2 F3/8 G2/8 |");
    const { project } = compileScoreText(tooShort);
    const result = inferChords(project);
    expect(result.regions.find(r => r.fromTick === 2400)?.selected?.identity.root).toMatchObject({ step: "G" });
    expect(hasSuspension(result, 2880)).toBe(false);
  });

  it.each([2880, 3360, 3840])("明确句界在 tick %i 时阻断延留证据", tick => {
    const { project } = compileScoreText(single);
    project.structure.phraseBoundaries.push({ id: "new-phrase", tick, source: "manual", confidence: "certain" });
    expect(hasSuspension(inferChords(project), 2880)).toBe(false);
  });

  it("不能越过准备音末尾弱细分处的句界回找属和声", () => {
    const { project } = compileScoreText(preparationWithSubdivision);
    project.structure.phraseBoundaries.push({ id: "new-phrase", tick: 2400, source: "manual", confidence: "certain" });
    expect(hasSuspension(inferChords(project), 2880)).toBe(false);
  });

  it.each([2880, 3840])("即使音高吻合也不能越过 tick %i 的调号事件", tick => {
    const { project } = compileScoreText(single);
    project.keyEvents.push({ ...project.keyEvents[0], id: "new-key", tick });
    expect(hasSuspension(inferChords(project), 2880)).toBe(false);
  });

  it("从大调属和弦到同主音小调时保留调性边界", () => {
    const { project } = compileScoreText(minor);
    project.keyEvents[0].mode = "major";
    project.keyEvents.push({ ...project.keyEvents[0], id: "minor-key", tick: 2880, mode: "minor" });
    expect(hasSuspension(inferChords(project), 2880)).toBe(false);
  });

  it("弱拍仅相对强于解决的次分位置时仍不推导延留", () => {
    const weakStart = single.replace("| C5/2.", "| D5/4 C5/2")
      .replace("| G4/2.", "| B4/4 G4/2")
      .replace("F4/4 E4/2", "F4/4. E4/8 E4/4")
      .replace("| C3/2.", "| G2/4 C3/2");
    const { project } = compileScoreText(weakStart);
    const timeline = buildMetricTimeline(project);
    const onset = metricPositionAt(timeline, 3840);
    expect(onset?.role).toBe("weak-beat");
    expect(compareMetricStrength(onset, metricPositionAt(timeline, 4320))).toBe("stronger");
    expect(hasSuspension(inferChords(project), 3840)).toBe(false);
  });

  it("解决点与延留起点同为强拍时不推导延留", () => {
    const { project } = compileScoreText(single);
    project.meterEvents[0].numerator = 1;
    const timeline = buildMetricTimeline(project);
    expect(compareMetricStrength(metricPositionAt(timeline, 2880), metricPositionAt(timeline, 3840))).toBe("equal");
    expect(hasSuspension(inferChords(project), 2880)).toBe(false);
  });

  it("遵守置信度与外音选项", () => {
    expect(regionAt(single, { minConfidence: "high" })?.status).toBe("unclassified");
    expect(regionAt(single, { allowNonChordToneCandidates: false })?.status).toBe("unclassified");
  });
});
