import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyChordInference, inferChords, applyHarmonyInference, inferHarmony } from "../pipeline";
import { phraseInferenceFingerprint } from "../../phrase";
import type { ChordInferenceOptions } from "../types";
import { buildMetricTimeline, compareMetricStrength, metricPositionAt } from "../../../rhythm/metric";
import { PPQ } from "../../../project";
import { checkHarmony } from "../../registry";
import { buildHarmonyAnalysis } from "../../analysis";

function run(soprano: string, tenor = "G3/1", high = false, alto = "C4/1", key = "C major") {
  const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | C3/1 |
}`);
  return inferChords(project, high ? { minConfidence: "high" } : {}).regions;
}

describe("静止和声中的短时上声部级进", () => {
  it("在两次相同的主和弦之间延续和声，保存所据的音符", () => {
    const [region] = run("E5/4 F5/8 E5/8 E5/2");
    expect(region).toMatchObject({
      fromTick: 0, toTick: 3840,
      selected: { functionalBaseId: "T", confidence: "medium" },
    });
    expect(region.selected?.fit.nonChordToneNoteIds).toHaveLength(1);
    expect(region.selected?.evidence).toContainEqual({
      kind: "sequence-context", code: "prolonged-harmony", noteIds: region.selected?.fit.nonChordToneNoteIds,
    });
    expect(Object.values(region.selected!.fit.nonChordToneAssignments)).toEqual(["neighbor"]);
  });
  it("下辅助在同声部返回，只有启用写回时才标注角色", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
  S: | E5/4 D5/8 E5/8 |
  A: | G4/2 |
  T: | G3/2 |
  B: | C3/2 |
}`);
    const answer = inferChords(project);
    const noteId = project.satbTracks[0].notes[1].id;
    expect(answer.regions[0].selected?.fit.nonChordToneAssignments).toEqual({ [noteId]: "neighbor" });
    const disabled = inferChords(project, { allowNonChordToneCandidates: false });
    expect(disabled.regions.some(region => region.selected?.fit.nonChordToneAssignments[noteId])).toBe(false);
    for (const write of [false, true]) {
      const applied = applyChordInference(project, answer, { mode: "fill-gaps", writeNonChordToneRoles: write });
      expect(applied.project.satbTracks[0].notes[1].nonChordToneRole).toBe(write ? "neighbor" : undefined);
    }
    for (const tick of [960, 1200, 1440]) {
      project.structure.phraseBoundaries = [{ id: "split", source: "manual", confidence: "certain", tick }];
      const across = inferChords(project).regions;
      expect(across.flatMap(region => region.selected?.evidence ?? []).map(item => item.code))
        .not.toContain("prolonged-harmony");
      expect(across.some(region => region.selected?.fit.nonChordToneAssignments[noteId])).toBe(false);
    }
  });
  it("同调号的新调性事件只在证据窗口内阻断延续", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
  S: | E5/4 F5/8 E5/8 E5/4 |
  A: | C4/2. |
  T: | G3/2. |
  B: | C3/2. |
}`);
    const original = project.keyEvents[0];
    const result = () => inferChords(project).regions.flatMap(r => r.selected?.evidence ?? []).map(e => e.code);
    expect(result()).toContain("prolonged-harmony");
    for (const tick of [960, 1200, 1440]) {
      project.keyEvents = [original, { ...original, id: "new-key", tick }];
      expect(result()).not.toContain("prolonged-harmony");
    }
    project.keyEvents = [original, { ...original, id: "later-key", tick: 1920 }];
    expect(result()).toContain("prolonged-harmony");
  });

  it("他声部随弱音重奏时保留和声解释并留空辅助音角色", () => {
    const [region] = run("E5/4 F5/8 E5/8 E5/2", "G3/4 G3/2.");
    expect(region.selected?.fit.nonChordToneNoteIds).toHaveLength(1);
    expect(region.selected?.fit.nonChordToneAssignments).toEqual({});
  });
  it.each([
    ["起奏比两侧更强", "E5/8 E5/8 F5/8 E5/8 E5/2", "C4/1", "C major"],
    ["完整大七和弦与下邻竞争", "C5/4 B4/8 C5/8 C5/2", "E4/1", "C major"],
    ["功能模板未枚举的小大七和弦与下邻竞争", "C5/4 B4/8 C5/8 C5/2", "Eb4/1", "C minor"],
  ])("%s时留空角色", (_reason, soprano, alto, key) => {
    const regions = run(soprano, "G3/1", false, alto, key);
    expect(regions.flatMap(r => r.selected?.evidence ?? []).some(e => e.code === "prolonged-harmony")).toBe(true);
    expect(regions.flatMap(r => Object.values(r.selected?.fit.nonChordToneAssignments ?? {}))).toEqual([]);
  });
  it.each([
    ["E5/4 F5/8 E5/8 E5/2", "G3/1", true],
    ["E5/4 A5/8 E5/8 E5/2", "G3/1", false],
    ["E5/4 F5/8 E5/8 E5/2", "G3/4 A3/8 G3/8 G3/2", false],
    ["E5/2 F5/4 E5/4", "G3/1", false],
  ] as const)("高置信过滤、跳进、多声部变化及强位分别保留自身解释 %s / %s / %s", (s, t, high) => {
    expect(run(s, t, high).flatMap(r => r.selected?.evidence ?? []).map(e => e.code)).not.toContain("prolonged-harmony");
  });
});

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

function anticipationRegionAt(score: string, tick = 480, options?: ChordInferenceOptions) {
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
    const region = anticipationRegionAt(twoUpperVoices, 1680);
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
    const region = anticipationRegionAt(literalSeventh);
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
    const region = anticipationRegionAt(writtenAugmentedTriad, 1440);
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
    expect(anticipationRegionAt(competingSixth)).toMatchObject({ fromTick: 480, toTick: 960, status: "unclassified", alternatives: [] });
  });

  it.each([
    [earlyBass.replace("D3/8 D3/4", "D3/8 D2/4"), {}],
    [earlyBass, { minConfidence: "high" }],
    [earlyBass, { allowNonChordToneCandidates: false }],
  ] as const)("预先音没有同音确认或筛选禁止时保留弃权", (score, options) => {
    expect(anticipationRegionAt(score, 480, options).status).toBe("unclassified");
  });
});

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

function preparedSuspensionRegionAt(score: string, options?: ChordInferenceOptions) {
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
    const region = preparedSuspensionRegionAt(score);
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
    const region = preparedSuspensionRegionAt(score);
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
    expect(preparedSuspensionRegionAt(single, { minConfidence: "high" })?.status).toBe("unclassified");
    expect(preparedSuspensionRegionAt(single, { allowNonChordToneCandidates: false })?.status).toBe("unclassified");
  });
});

const sixFour = `satb 1
key C major
meter 3/4
bars 1..2 {
  S: | E5/8 F5/8 E5/4 D5/4 | C5/2. |
  A: | G4/2 G4/4 | G4/2. |
  T: | C4/8 D4/8 C4/4 B3/4 | E4/2. |
  B: | G2/2 G2/4 | C3/2. |
}`;

const dominant = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | D5/8 C#5/8 D5/4 |
  A: | G4/2 |
  T: | B3/8 A#3/8 B3/4 |
  B: | G2/2 |
}`;

const literalRival = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | E5/8 F5/8 E5/4 |
  A: | G4/8 A4/8 G4/4 |
  T: | C4/2 |
  B: | C3/2 |
}`;

const simultaneousNeighborEnclosure = `satb 1
key G minor
meter 4/4
bars 1..1 {
  S: | Bb4/1 |
  A: | C#4/4 D4/8 B#3/8 C#4/2 |
  T: | E3/4 F3/8 D#3/8 E3/2 |
  B: | G2/1 |
}`;

type Project = ReturnType<typeof compileScoreText>["project"];

function simultaneousNeighborAt(project: Project, tick = PPQ / 2, options?: ChordInferenceOptions) {
  return inferHarmony(project, options).chordInference.regions.find(region =>
    region.fromTick <= tick && tick < region.toTick);
}

const marker = "written-double-neighbor";
function hasDouble(project: Project, options?: ChordInferenceOptions) {
  return inferHarmony(project, options).chordInference.regions.some(region =>
    region.selected?.evidence.some(evidence => evidence.code === marker));
}

describe("持续低音上的两个同拍辅助音", () => {
  it("从完整强拍识别 K46，并用正常产品入口写回两个辅助音", () => {
    const { project } = compileScoreText(sixFour);
    const selected = simultaneousNeighborAt(project);
    expect(selected).toMatchObject({
      fromTick: 0, toTick: 2 * PPQ, status: "resolved",
      selected: {
        functionalBaseId: "K46",
        fit: { nonChordToneAssignments: { "note-S-480": "neighbor", "note-T-480": "neighbor" } },
        evidence: expect.arrayContaining([expect.objectContaining({ code: marker })]),
      },
    });
    const applied = applyHarmonyInference(project, inferHarmony(project), {
      mode: "fill-gaps", writeNonChordToneRoles: true,
    });
    expect(applied.writtenNonChordToneRoleCount).toBe(2);
    expect(applied.project.chordTrack.regions[0]).toMatchObject({
      startTick: 0, durationTicks: 2 * PPQ, semantics: { cadenceRole: "cadential64" },
    });
    expect(checkHarmony(applied.project).diagnostics.some(item =>
      item.tick === PPQ / 2 && item.ruleId === "nonchord.neighbor-tone")).toBe(false);
  });

  it("原位属上的平行十度或同样闭合的反向辅助，可连续覆盖短弱位", () => {
    for (const text of [dominant, dominant.replace("C#5/8", "E5/8")]) {
      const { project } = compileScoreText(text);
      expect(simultaneousNeighborAt(project)).toMatchObject({
        fromTick: 0, toTick: 2 * PPQ, status: "resolved",
        selected: { functionalBaseId: "D",
          evidence: expect.arrayContaining([expect.objectContaining({ code: marker })]) },
      });
    }
  });

  it("平行纯五度保持可见，不能借双辅助连续化", () => {
    const text = dominant.replace("C#5/8", "E5/8")
      .replace("G4/2", "B4/2").replace("B3/8 A#3/8 B3/4", "G3/8 A3/8 G3/4");
    const { project } = compileScoreText(text);
    expect(hasDouble(project)).toBe(false);
    const applied = applyHarmonyInference(project, inferHarmony(project), { mode: "fill-gaps" });
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "voice-leading.parallel-fifths", tick: PPQ / 2, voiceIds: ["soprano", "tenor"],
    }));
  });
  it("T–实奏下属四六–T 中完整的三和弦照常保留", () => {
    const { project } = compileScoreText(literalRival);
    expect(simultaneousNeighborAt(project)?.selected).toMatchObject({
      functionalBaseId: "S", identity: { bass: { step: "C" }, root: { step: "F" } },
      semantics: { cadenceRole: "pedal64" },
    });
    expect(hasDouble(project)).toBe(false);
  });

  it("两拍上下围绕与完整小七音集竞争时不写作两个相邻的普通辅助音", () => {
    const { project } = compileScoreText(simultaneousNeighborEnclosure);
    const applied = applyHarmonyInference(project, inferHarmony(project), {
      mode: "fill-gaps", writeNonChordToneRoles: true,
    });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(simultaneousNeighborAt(project, 0)?.selected?.identity.structure).toMatchObject({ quality: "diminished7" });
    expect(simultaneousNeighborAt(project, 2 * PPQ)?.selected?.identity.structure).toMatchObject({ quality: "diminished7" });
    expect(hasDouble(project)).toBe(false);
  });

  it.each([
    ["低音同音重奏", "G2/2 |", "G2/8 G2/4. |"],
    ["低音跨八度", "G2/2 |", "G2/8 G3/4. |"],
    ["固定内声部重奏", "G4/2 |", "G4/8 G4/4. |"],
    ["不返回原音区", "A#3/8 B3/4", "A#3/8 B4/4"],
    ["用等音异名代替书写级进", "C#5/8", "Db5/8"],
    ["缺第二返回声部", "B3/8 A#3/8 B3/4", "B3/8 r/8 B3/4"],
  ])("%s 时保留原分析", (_label, old, replacement) => {
    const { project } = compileScoreText(dominant.replace(old, replacement));
    expect(hasDouble(project)).toBe(false);
  });

  it("K46 没有真正的属到主闭合时，返回只提供原有候选", () => {
    const text = sixFour.replace("C5/2. |", "D5/2. |").replace("E4/2. |", "B3/2. |")
      .replace("C3/2. |", "G2/2. |");
    const { project } = compileScoreText(text);
    expect(hasDouble(project)).toBe(false);
    expect(simultaneousNeighborAt(project)?.status).toBe("unclassified");
  });

  it.each([PPQ / 2, PPQ])("显式句界 %s 截断回证", tick => {
    const { project } = compileScoreText(dominant);
    project.structure.phraseBoundaries = [{ id: "boundary", tick, source: "manual", confidence: "certain" }];
    expect(hasDouble(project)).toBe(false);
  });

  it("重复同一调号事件也不跨事件借回，且尊重产品置信和非和弦音选项", () => {
    const { project } = compileScoreText(dominant);
    expect(hasDouble(project, { minConfidence: "high" })).toBe(false);
    expect(hasDouble(project, { allowNonChordToneCandidates: false })).toBe(false);
    project.keyEvents.push({ ...project.keyEvents[0], id: "split-key", tick: PPQ });
    expect(hasDouble(project)).toBe(false);
  });
});

function score(tenor = "C4/4. D4/8 E4/4", alto = "C5/2 C5/4", bass = "A2/2 G2/4") {
  return compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
  S: | E5/2 G5/4 |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
}`).project;
}

describe("One weak upper passing note over a complete held triad", () => {
  it("recovers the minor triad under a passing tenor and writes only the intervening note", () => {
    const project = score(), result = inferChords(project);
    const id = project.satbTracks[2].notes[1].id;
    expect(result.regions.find(r => r.fromTick <= 1440 && r.toTick > 1440)?.selected)
      .toMatchObject({ identity: { root: { step: "A" }, bass: { step: "A" } },
        fit: { omittedChordDegrees: [], nonChordToneAssignments: { [id]: "passing" } } });
    expect(result.regions.find(r => r.fromTick === 1920)?.selected?.identity.root.step).toBe("C");
    for (const write of [false, true]) {
      const applied = applyChordInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: write });
      expect(applied.project.satbTracks.flatMap(t => t.notes).filter(n => n.nonChordToneRole)
        .map(n => n.id)).toEqual(write ? [id] : []);
    }
  });

  it.each([
    ["neighbor", "C4/4. D4/8 C4/4", "C5/2 C5/4"],
    ["wrong octave", "C4/4. D4/8 E3/4", "C5/2 C5/4"],
    ["handoff to another voice", "C4/4. D4/8 G3/4", "C5/2 E4/4"],
    ["another attack", "C4/4. D4/8 E4/4", "C5/4. C5/8 C5/4"],
    ["missing third of the anchor", "C4/4. D4/8 E4/4", "A4/2 C5/4"],
    ["stronger middle", "C4/8 C4/8 D4/8 E4/4.", "C5/2 C5/4"],
  ])("leaves the passing role unset with %s", (_label, tenor, alto) => {
    const result = inferChords(score(tenor, alto));
    expect(result.regions.flatMap(r => Object.values(r.selected?.fit.nonChordToneAssignments ?? {}))).not.toContain("passing");
  });

  it("respects strict confidence, disabled ornaments and intervening phrase cuts", () => {
    const project = score(), id = project.satbTracks[2].notes[1].id;
    for (const options of [{ minConfidence: "high" as const }, { allowNonChordToneCandidates: false }]) {
      expect(inferChords(project, options).regions.some(r => r.selected?.fit.nonChordToneAssignments[id])).toBe(false);
    }
    for (const tick of [1200, 1440, 1820, 1920]) {
      project.structure.phraseBoundaries = [{ id: "boundary", source: "manual", confidence: "certain", tick }];
      expect(inferChords(project).regions.some(r => r.selected?.fit.nonChordToneAssignments[id])).toBe(false);
    }
  });
});

function oneBar(key: string, soprano: string, alto: string, tenor: string, bass: string) {
  return compileScoreText([
    "satb 1", "key " + key, "meter 4/4", "bars 1..1 {",
    "S: | " + soprano + " |", "A: | " + alto + " |",
    "T: | " + tenor + " |", "B: | " + bass + " |", "}",
  ].join("\n")).project;
}

const passingTick = 1440;
const arrivalTick = 1920;

function displacedUpperPassingAt(result: ReturnType<typeof inferChords>, tick: number) {
  return result.regions.find(r => r.fromTick <= tick && tick < r.toTick);
}

function passingFifth(soprano = "C5/4. Bb4/8 A4/2", alto = "F4/1") {
  return oneBar("F major", soprano, alto, "A3/2 D4/2", "F3/2 D3/2");
}

describe("Passing tones that displace a written triad member", () => {
  it("holds the preceding triad when the only fifth moves down through the weak subdivision", () => {
    const project = passingFifth(), result = inferChords(project);
    const noteId = project.satbTracks[0].notes[1].id;
    expect(displacedUpperPassingAt(result, passingTick)).toMatchObject({
      fromTick: 0, toTick: arrivalTick, status: "resolved",
      selected: {
        identity: { root: { step: "F", alter: 0 }, bass: { step: "F", alter: 0 } },
        confidence: "medium",
        fit: { omittedChordDegrees: [5], nonChordToneAssignments: { [noteId]: "passing" } },
      },
    });
    expect(displacedUpperPassingAt(result, arrivalTick)?.selected?.identity).toMatchObject({ root: { step: "D" }, bass: { step: "D" } });
    expect(inferChords(project, { allowIncompleteVoicing: false })).toEqual(result);
    for (const write of [false, true]) {
      const applied = applyHarmonyInference(project, { chordInference: result },
        { mode: "replace-unlocked", writeNonChordToneRoles: write });
      expect(applied.project.satbTracks.flatMap(t => t.notes).filter(n => n.nonChordToneRole)
        .map(n => [n.id, n.nonChordToneRole])).toEqual(write ? [[noteId, "passing"]] : []);
    }
  });

  it("allows the sole root to depart upward and keeps the independently written next inversion", () => {
    const project = oneBar("D major", "B4/2 G4/2", "D4/1", "G3/4. A3/8 B3/2", "B2/2 G2/2");
    const result = inferChords(project);
    expect(displacedUpperPassingAt(result, passingTick)?.selected).toMatchObject({
      identity: { root: { step: "G", alter: 0 }, bass: { step: "B", alter: 0 } },
      fit: { omittedChordDegrees: [1], nonChordToneAssignments: { [project.satbTracks[2].notes[1].id]: "passing" } },
    });
    expect(displacedUpperPassingAt(result, arrivalTick)).toMatchObject({
      fromTick: arrivalTick,
      selected: { identity: { root: { step: "G", alter: 0 }, bass: { step: "G", alter: 0 } },
        fit: { omittedChordDegrees: [], nonChordToneAssignments: {} } },
    });
  });

  it("keeps an independently voiced weak first-inversion triad in the same melodic shape", () => {
    const project = oneBar("C major", "E5/4. F5/8 G5/2", "C4/2 E4/2", "A3/2 G3/2", "A2/2 C3/2");
    const result = inferChords(project);
    expect(displacedUpperPassingAt(result, passingTick)).toMatchObject({
      fromTick: passingTick, toTick: arrivalTick, status: "resolved",
      selected: { identity: { root: { step: "F" }, bass: { step: "A" } },
        fit: { omittedChordDegrees: [], nonChordToneAssignments: {} } },
    });
  });

  it("keeps a complete short first-inversion dominant seventh on the weak subdivision", () => {
    const project = oneBar("D major", "A4/4. G4/8 F#4/2", "E4/2 D4/2", "A3/1", "C#3/2 D3/2");
    const result = inferChords(project);
    expect(displacedUpperPassingAt(result, passingTick)).toMatchObject({
      fromTick: passingTick, toTick: arrivalTick, status: "resolved",
      selected: { identity: { root: { step: "A" }, bass: { step: "C", alter: 1 },
        structure: { kind: "tertian", quality: "dominant7" } }, fit: { nonChordToneAssignments: {} } },
    });
  });

  it.each([
    ["supporting voice rearticulated at the weak attack", "C5/4. Bb4/8 A4/2", "F4/4. F4/8 F4/2"],
    ["landing an octave away", "C5/4. Bb4/8 A5/2", "F4/1"],
    ["turning back to the original pitch", "C5/4. Bb4/8 C5/2", "F4/1"],
    ["chromatic spelling outside the confirmed scale", "C5/4. B4/8 A4/2", "F4/1"],
  ])("leaves passing unset with %s", (_label, soprano, alto) => {
    const result = inferChords(passingFifth(soprano, alto));
    expect(displacedUpperPassingAt(result, passingTick)?.selected?.fit.nonChordToneAssignments ?? {}).toEqual({});
  });

  it("does not infer a passing role with an unconfirmed shared landing", () => {
    const project = oneBar("C major", "C5/4. D5/8 E5/2", "A4/2 C5/2", "F4/2 G4/2", "F3/2 C3/2");
    const id = project.satbTracks[0].notes[1].id;
    expect(displacedUpperPassingAt(inferChords(project), passingTick)?.selected?.fit.nonChordToneAssignments[id]).toBeUndefined();
  });

  it("respects strict confidence, disabled ornaments and a phrase cut at the landing", () => {
    const project = passingFifth();
    for (const options of [{ minConfidence: "high" as const }, { allowNonChordToneCandidates: false }]) {
      expect(displacedUpperPassingAt(inferChords(project, options), passingTick)?.status).toBe("unclassified");
    }
    project.structure.phraseBoundaries = [{ id: "cut", source: "manual", confidence: "certain", tick: arrivalTick }];
    expect(displacedUpperPassingAt(inferChords(project), passingTick)?.status).toBe("unclassified");
  });
});

const lowerNeighborEnclosure = `satb 1
key A minor
meter 4/4
bars 1..3 {
  S: | E5/2 D5/4 A4/4 | C5/1 | B4/2 A4/2 |
  A: | C5/2 B4/4 D#4/4 | D#4/4 E4/8 C##4/8 D#4/2 | G#4/2 E4/2 |
  T: | A3/2 E3/4 F#3/4 | F#3/4 G3/8 E#3/8 F#3/2 | D4/2 C4/2 |
  B: | A2/2 G2/4 B2/4 | A2/1 | E3/2 A2/2 |
}`;

const upperTick = 5 * PPQ;
const lowerTick = upperTick + PPQ / 2;
const returnTick = 6 * PPQ;


function analyzeLowerNeighborPair(text: string, change?: (project: ReturnType<typeof compileScoreText>["project"]) => void) {
  const { project } = compileScoreText(text);
  change?.(project);
  const inference = inferHarmony(project);
  const applied = applyHarmonyInference(project, inference, { mode: "fill-gaps", writeNonChordToneRoles: true });
  const at = (tick: number) => inference.chordInference.regions.find(region => region.fromTick <= tick && tick < region.toTick);
  const warnings = checkHarmony(applied.project).diagnostics;
  return { project, applied, inference, at, warnings };
}

const writtenMinorSeventh = lowerNeighborEnclosure.replace("C##4/8", "D4/8").replace("E#3/8", "F3/8");
const diminishedWarningsAt = (result: ReturnType<typeof analyzeLowerNeighborPair>) =>
  result.warnings.filter(item => item.tick === lowerTick && item.ruleId === "melody.diminished-interval");

describe("弱细分上的书写下辅助配对", () => {
  it("只用回到已证锚点的后一细分，保留较强处的完整小七拼写", () => {
    const result = analyzeLowerNeighborPair(lowerNeighborEnclosure);
    expect(result.at(upperTick)?.toTick).toBe(lowerTick);
    expect(result.at(lowerTick)).toMatchObject({
      fromTick: lowerTick, toTick: returnTick, status: "unclassified", alternatives: [],
    });
    expect(result.at(lowerTick)?.selected).toBeUndefined();
    expect(result.at(returnTick)?.selected).toMatchObject({
      functionalBaseId: "DDVII",
      identity: { root: { step: "D", alter: 1 }, bass: { step: "A", alter: 0 } },
    });
    expect(result.applied.writtenNonChordToneRoleCount).toBe(0);
    expect(diminishedWarningsAt(result)).toEqual([]);
    expect(result.warnings.filter(item => item.tick === lowerTick &&
      ["chord.unclassified-nonchord-tone", "chord.incomplete-members", "nonchord.neighbor-tone"].includes(item.ruleId))).toEqual([]);
    expect(checkHarmony(result.project).diagnostics.filter(item =>
      item.tick === lowerTick && item.ruleId === "melody.diminished-interval")).toHaveLength(2);
  });

  it("同音的实写 Dm7/A 保持自己的身份与转位", () => {
    const result = analyzeLowerNeighborPair(writtenMinorSeventh);
    expect(result.at(lowerTick)?.selected).toMatchObject({
      identity: { root: { step: "D", alter: 0 }, bass: { step: "A", alter: 0 },
        structure: { quality: "minor7" } },
      fit: { spellingConsistent: true },
    });
  });

  it.each([
    ["未回到原音", "D#4/2 |", "E4/2 |"],
    ["低音重新起奏", "A2/1 |", "A2/4. A2/8 A2/2 |"],
    ["固定高声部改音", "C5/1 |", "C5/4. E5/8 C5/2 |"],
    ["独立准备缺失", "F#3/4 |", "A3/4 |"],
  ])("%s 时保留对应减三度报告", (_description, before, after) => {
    const result = analyzeLowerNeighborPair(lowerNeighborEnclosure.replace(before, after));
    expect(diminishedWarningsAt(result)).toHaveLength(2);
  });

  it("用户给定的错误 Dm7/A 标注仍接受常规检查", () => {
    const rival = analyzeLowerNeighborPair(writtenMinorSeventh).applied.project.chordTrack.regions.find(
      region => region.startTick === lowerTick,
    )!;
    const result = analyzeLowerNeighborPair(lowerNeighborEnclosure, input => input.chordTrack.regions.push(rival));
    expect(diminishedWarningsAt(result)).toHaveLength(2);
    expect(result.warnings.filter(item => item.tick === lowerTick).map(item => item.ruleId))
      .toContain("chord.unclassified-nonchord-tone");
  });

  it("可同时保留用户写入的上一细分完整 Am7", () => {
    const { identity } = analyzeLowerNeighborPair(writtenMinorSeventh).at(lowerTick)!.selected!;
    const result = analyzeLowerNeighborPair(lowerNeighborEnclosure, project => project.chordTrack.regions.push({
      id: "written-upper-am7",
      locked: false,
      startTick: upperTick,
      durationTicks: PPQ / 2,
      identity: { ...identity, root: { step: "A", alter: 0 } },
    }));
    expect(result.applied.project.chordTrack.regions.find(region => region.startTick === upperTick)).toMatchObject({
      id: "written-upper-am7",
      durationTicks: PPQ / 2,
      identity: { root: { step: "A", alter: 0 }, bass: { step: "A", alter: 0 }, structure: { quality: "minor7" } },
    });
    expect(diminishedWarningsAt(result)).toEqual([]);
  });

  it("声部实响低于男低音时保留减三度报告", () => {
    const result = analyzeLowerNeighborPair(lowerNeighborEnclosure.replace("A2/1 |", "A3/1 |"));
    expect(diminishedWarningsAt(result)).toHaveLength(2);
  });

  it("按两端标签的显式有效调性检查，同一调号下存在冲突则照报", () => {
    const project = analyzeLowerNeighborPair(lowerNeighborEnclosure).applied.project;
    const at = (tick: number) => project.chordTrack.regions.find(region => region.startTick === tick)!;
    const relabel = (tick: number) => {
      const anchor = at(tick);
      const interpretation = anchor.semantics!.interpretations[0];
      anchor.semantics = {
        ...anchor.semantics!,
        interpretations: [{
          ...interpretation,
          localKey: { tonic: { step: "E", alter: 0 }, mode: "minor" },
          designation: { notationSystem: "spasobin", kind: "primary", primaryFunction: "dominant" },
          appliedTarget: undefined,
          source: "manual",
          confidence: "certain",
        }],
      };
    };
    const atLower = () => checkHarmony(project).diagnostics.filter(item =>
      item.tick === lowerTick && item.ruleId === "melody.diminished-interval");
    relabel(returnTick);
    expect(atLower()).toHaveLength(2);
    relabel(4 * PPQ);
    expect(atLower()).toEqual([]);
  });

  it("和弦推导只使用当前保存的自动句界，陈旧标记或指纹不同均不阻断", () => {
    const boundaryTick = lowerTick + PPQ / 4;
    for (const state of ["current", "stale-flag", "old-fingerprint"] as const) {
      const result = analyzeLowerNeighborPair(lowerNeighborEnclosure, project => project.structure.phraseBoundaries.push({
        id: state, tick: boundaryTick, source: "inferred", confidence: "certain",
        stale: state === "stale-flag",
        inferenceFingerprint: state === "old-fingerprint" ? "old" : phraseInferenceFingerprint(project),
      }));
      if (state === "current") {
        expect(result.at(lowerTick)?.selected?.identity.structure).toMatchObject({ quality: "minor7" });
        expect(diminishedWarningsAt(result)).toHaveLength(2);
      } else {
        expect(result.at(lowerTick)?.selected).toBeUndefined();
        expect(diminishedWarningsAt(result)).toEqual([]);
      }
    }
  });

  it("规则侧使用当前切片中的有效句界，而非历史自动标记", () => {
    for (const stale of [false, true]) {
      const project = analyzeLowerNeighborPair(lowerNeighborEnclosure).applied.project;
      project.structure.phraseBoundaries.push({
        id: "saved-automatic", tick: lowerTick + PPQ / 4, source: "inferred",
        confidence: "certain", inferenceFingerprint: phraseInferenceFingerprint(project), stale,
      });
      expect(checkHarmony(project).diagnostics.filter(item =>
        item.tick === lowerTick && item.ruleId === "melody.diminished-interval")).toHaveLength(stale ? 0 : 2);
    }
  });

  it("在未改名的调号切片及句界处停止延续", () => {
    const keySplit = analyzeLowerNeighborPair(lowerNeighborEnclosure, project => {
      project.keyEvents.push({ ...project.keyEvents[0], id: "during-lower", tick: lowerTick + PPQ / 4 });
    });
    const phraseSplit = analyzeLowerNeighborPair(lowerNeighborEnclosure, project => {
      project.structure.phraseBoundaries.push({ id: "stop", tick: returnTick, source: "manual", confidence: "certain" });
    });
    for (const result of [keySplit, phraseSplit]) {
      expect(diminishedWarningsAt(result)).toHaveLength(2);
    }
  });
});

const close = `satb 1
key C major
meter 3/4
bars 1..2 {
 S: | G4/4 E5/4 D5/4 | C5/4 A4/4 G4/4 |
 A: | E4/4 G4/4 G4/4 | E4/4 F4/4 E4/4 |
 T: | C4/2 B3/4 | C4/2. |
 B: | G3/2 G2/4 | C3/2. |
}`;

function analyzeOmittedTonicPedal(text: string, cut?: number) {
  const { project } = compileScoreText(text);
  if (cut !== undefined) project.structure.phraseBoundaries = [
    { id: "split", tick: cut, confidence: "certain", source: "manual" },
  ];
  const inference = inferChords(project);
  const written = applyHarmonyInference(project, { chordInference: inference },
    { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
  return {
    role: written.chordTrack.regions.find(region => region.startTick === 3840)?.semantics?.cadenceRole,
    cadences: buildHarmonyAnalysis(written).cadenceCandidates,
    warnings: checkHarmony(written).diagnostics.filter(d => d.severity === "warning"),
  };
}

describe("从不完全主和弦进入辅助下属四六", () => {
  const missingFifth = { tick: 2880, ruleId: "chord.incomplete-members" };
  const unsupportedSixFour = { tick: 3840, ruleId: "chord.second-inversion-voicing" };

  it("写回弱拍辅助四六，保留正格与补充变格两个终止", () => {
    const { role, cadences, warnings } = analyzeOmittedTonicPedal(close);
    expect(role).toBe("pedal64");
    expect(cadences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "full", form: "authentic", completion: "perfect", toTick: 3840 }),
      expect.objectContaining({ kind: "supplementary", form: "plagal", fromTick: 3840, toTick: 5760 }),
    ]));
    expect(warnings).not.toContainEqual(expect.objectContaining(missingFifth));
    expect(warnings).not.toContainEqual(expect.objectContaining(unsupportedSixFour));
  });

  it.each([
    ["无声部下三度", close.replace("A4/4 G4/4", "F5/4 G4/4").replace("E4/4 F4/4", "E4/4 A4/4")],
    ["前一主和弦重复三音", close.replace("B3/4 | C4/2.", "B3/4 | E4/4 C4/2")],
    ["四六重复根音", close.replace("B3/4 | C4/2.", "B3/4 | C4/4 F4/4 C4/4")],
    ["低音在四六上重新起奏", close.replace("C3/2.", "C3/4 C3/2")],
  ])("%s时保留四六配置警告", (_label, text) => {
    const { role, warnings } = analyzeOmittedTonicPedal(text);
    expect(role).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining(unsupportedSixFour));
  });

  it("未形成正格终止时可识别辅助角色，仍提示前一主和弦缺五音", () => {
    const noDominant = close.replace("G4/4 E5/4 D5/4", "A4/2.")
      .replace("E4/4 G4/4 G4/4", "F4/2.").replace("C4/2 B3/4", "C4/2.")
      .replace("G3/2 G2/4", "F3/2.");
    const { role, warnings } = analyzeOmittedTonicPedal(noDominant);
    expect(role).toBe("pedal64");
    expect(warnings).toContainEqual(expect.objectContaining(missingFifth));
  });

  it.each([3360, 3840, 4800])("人工句界 %i 分开两侧时保留四六配置警告", cut => {
    const { role, warnings } = analyzeOmittedTonicPedal(close, cut);
    expect(role).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining(unsupportedSixFour));
  });
});
