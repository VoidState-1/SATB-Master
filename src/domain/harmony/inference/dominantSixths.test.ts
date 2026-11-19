import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyChordInference } from "./apply";
import { buildChordInferenceCandidates } from "./candidates";
import { withDominantSixthSubstitutions } from "./dominantSixths";
import { fitChordObservation } from "./fit";
import { inferChords } from "./inferChords";
import { buildChordInferenceObservations } from "./observations";
import type { ChordInferenceOptions, ChordInferenceRegion } from "./types";

const toFifth = `satb 1
key C major
meter 2/4
bars 1..2 {
  S: | E5/4 D5/4 | C5/2 |
  A: | F4/2 | E4/2 |
  T: | B3/2 | A3/2 |
  B: | G2/2 | A2/2 |
}`;

const toTonic = `satb 1
key C major
meter 2/4
bars 1..2 {
  S: | D5/4 E5/4 | C5/2 |
  A: | G4/4 F4/4 | E4/2 |
  T: | B3/2 | C4/2 |
  B: | G2/4 G2/4 | C3/2 |
}`;

const toCompleteTonicOverHeldDominant = `satb 1
key C major
meter 2/4
bars 1..2 {
  S: | G5/4 E5/4 | C5/2 |
  A: | B4/2 | G4/2 |
  T: | F4/2 | E4/2 |
  B: | G2/2 | C3/2 |
}`;

const appliedToFifth = `satb 1
key C major
meter 2/4
bars 1..2 {
  S: | B4/4 A4/4 | D5/2 |
  A: | F#4/2 | G4/2 |
  T: | C4/2 | B3/2 |
  B: | D3/2 | G2/2 |
}`;

const heldAcrossHarmony = `satb 1
key C major
meter 3/4
bars 1..2 {
  S: | E5/2 D5/4 | C5/2. |
  A: | C4/4 F4/2 | E4/2. |
  T: | G3/4 B3/2 | C4/2. |
  B: | G3/4 G2/2 | C3/2. |
}`;

const toNewKey = `satb 1
key C major
meter 2/4
bars 1..4 {
  S: | E5/4 D5/4 | C5/4 B4/4 | D5/4 F#5/4 | D5/2 |
  A: | C5/4 B4/4 | G4/4 G4/4 | F#4/4 G4/4 | F#4/2 |
  T: | G3/4 F4/4 | E4/4 E4/4 | A3/4 C#4/4 | D4/2 |
  B: | C3/4 G2/4 | C3/4 E3/4 | A2/4 A2/4 | D3/2 |
}`;

function regionAt(regions: readonly ChordInferenceRegion[], tick: number) {
  return regions.find(region => region.fromTick <= tick && tick < region.toTick)!;
}

function inferAtBeat(score: string, beat: number, options?: ChordInferenceOptions) {
  const { project } = compileScoreText(score);
  return regionAt(inferChords(project, options).regions, beat * project.ppq);
}

function hasSubstitution(region: ChordInferenceRegion) {
  return [region.selected, ...region.alternatives].some(candidate =>
    candidate?.evidence.some(evidence => evidence.code === "dominant-sixth-substitution"),
  );
}

function expectDominant(region: ChordInferenceRegion, resolution: "fifth" | "tonic", root: string) {
  expect(region).toMatchObject({
    status: "resolved",
    selected: {
      confidence: "high",
      identity: { root: { step: root, alter: 0 }, bass: { step: root, alter: 0 },
        structure: { quality: "dominant7", extensions: [], alterations: [] } },
      evidence: expect.arrayContaining([
        expect.objectContaining({ code: "dominant-sixth-substitution", details: { resolution } }),
      ]),
      fit: { nonChordToneNoteIds: [], nonChordToneAssignments: {}, extraPitchClasses: [], omittedChordDegrees: [] },
    },
  });
}

describe("原位属七的六度替代五音", () => {
  it("同低音的 6→5 由完整属七确认，即使本调随后阻碍解决", () => {
    expectDominant(inferAtBeat(toFifth, 0), "fifth", "G");
  });

  it("外声部新起奏时支持直落主及三根一三的省五配置，允许内声保持", () => {
    const { project } = compileScoreText(toTonic);
    const inference = inferChords(project);
    const source = regionAt(inference.regions, project.ppq);
    expectDominant(source, "tonic", "G");
    expect(regionAt(inference.regions, 2 * project.ppq).selected).toMatchObject({
      functionalBaseId: "T", fit: { omittedChordDegrees: [5] },
    });
    const observation = buildChordInferenceObservations(project)[1];
    const soprano = observation.activeNotes.soprano!;
    expect(observation.activeNotes.tenor?.startTick).toBe(0);
    expect(source.selected?.evidence).toContainEqual(expect.objectContaining({
      code: "dominant-sixth-substitution", noteIds: [soprano.id],
    }));
    expect(source.selected?.fit.chordToneNoteIds).toContain(soprano.id);
    expect(fitChordObservation(observation, source.selected!.identity, { allowIncompleteVoicing: true }))
      .toMatchObject({ hardRejected: "unexplained-extra-tone", nonChordToneNoteIds: [soprano.id] });
    const applied = applyChordInference(project, inference, { mode: "replace-unlocked", writeNonChordToneRoles: true });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(applied.project.satbTracks).toEqual(project.satbTracks);
  });

  it("小调直落主时使用实际调式的降三音", () => {
    const minor = toTonic.replace("key C major", "key C minor").replace("E5/4", "Eb5/4").replace("E4/2", "Eb4/2");
    expectDominant(inferAtBeat(minor, 1), "tonic", "G");
  });

  it.each([
    ["同一属七的实际低音持续", toCompleteTonicOverHeldDominant],
    ["前一拍为实际含五音的普通属七", toCompleteTonicOverHeldDominant.replace("G5/4 E5/4", "D5/4 E5/4")],
    ["同属音上的低音换八度重新起奏", toCompleteTonicOverHeldDominant.replace("G2/2 | C3/2", "G2/4 G3/4 | C3/2")],
  ])("内声导音下行大三度到完整主和弦五音，%s 时识别替代六音", (_description, score) => {
    expectDominant(inferAtBeat(score, 1), "tonic", "G");
  });

  it.each([
    ["六度与题面调式不符", toFifth.replace("E5/4", "Eb5/4"), 0],
    ["小调六度改写为同响的升五", toFifth.replace("key C major", "key C minor").replace("E5/4", "D#5/4"), 0],
    ["相同主三和弦但导音换声部", toTonic.replace("F4/4 | E4/2", "F4/4 | C5/2").replace("B3/2 | C4/2", "B3/2 | E4/2"), 1],
    ["同音高低音从上一和弦延入", toTonic.replace("G2/4 G2/4", "G2/2"), 1],
    ["持续属音的前一拍没有属七及保持的七音", toCompleteTonicOverHeldDominant.replace("F4/2 | E4/2", "E4/4 F4/4 | E4/2"), 1],
    ["持续属音前一拍的女高实写降五音", toCompleteTonicOverHeldDominant.replace("G5/4 E5/4", "Db5/4 E5/4"), 1],
    ["导音落到低八度的主和弦五音", toCompleteTonicOverHeldDominant.replace("B4/2 | G4/2", "B4/2 | G3/2"), 1],
    ["属七音跳到主和弦五音", toCompleteTonicOverHeldDominant.replace("F4/2 | E4/2", "F4/2 | G3/2"), 1],
  ])("%s 时保留原有候选行为", (_description, score, beat) => {
    expect(hasSubstitution(inferAtBeat(score, beat))).toBe(false);
  });

  it("普通省五重复根的原位属七保持自身候选和证据", () => {
    const score = toCompleteTonicOverHeldDominant.replace("G5/4 E5/4", "G5/2");
    const region = inferAtBeat(score, 0);
    expect(region.selected).toMatchObject({
      functionalBaseId: "D", identity: { structure: { quality: "dominant7", extensions: [] } },
    });
    expect(hasSubstitution(region)).toBe(false);
  });

  it("连续属七合并后只把替代证据记在实际六音的起奏上", () => {
    const { project } = compileScoreText(toCompleteTonicOverHeldDominant);
    const observations = buildChordInferenceObservations(project);
    const sixth = observations[1].activeNotes.soprano!;
    const merged = regionAt(inferChords(project).regions, 0);
    const evidence = merged.selected?.evidence.filter(item => item.code === "dominant-sixth-substitution");
    expect(evidence?.map(item => item.noteIds)).toEqual([[sixth.id]]);
  });

  it.each([0.5, 1, 2])("显式句界在第 %s 拍时不跨界取证", (beat) => {
    const { project } = compileScoreText(toCompleteTonicOverHeldDominant);
    project.structure.phraseBoundaries = [
      { id: "manual", tick: beat * project.ppq, source: "manual", confidence: "certain" },
    ];
    expect(hasSubstitution(regionAt(inferChords(project).regions, project.ppq))).toBe(false);
  });

  it("尊重女高音已标角色", () => {
    const { project } = compileScoreText(toFifth);
    const soprano = project.satbTracks.find(track => track.id === "soprano")!.notes[0];
    soprano.nonChordToneRole = "suspension";
    expect(hasSubstitution(inferChords(project).regions[0])).toBe(false);
    expect(soprano.nonChordToneRole).toBe("suspension");
  });

  it("女高音跨和声延续时保留竞争解释，原音重奏时采用 6→5", () => {
    const held = compileScoreText(heldAcrossHarmony).project;
    const reattacked = compileScoreText(heldAcrossHarmony.replace("E5/2 D5/4", "E5/4 E5/4 D5/4")).project;
    const heldRegion = inferChords(held).regions.find(region => region.fromTick === held.ppq)!;
    const reattackedRegion = inferChords(reattacked).regions.find(region => region.fromTick === reattacked.ppq)!;
    expect(hasSubstitution(heldRegion)).toBe(false);
    expectDominant(reattackedRegion, "fifth", "G");
  });

  it("完整副属及其目标都实写时也暂缓 6→5", () => {
    expect(inferAtBeat(appliedToFifth, 1).selected?.semantics?.interpretations[0].appliedTarget)
      .toMatchObject({ degree: 5 });
    expect(hasSubstitution(inferAtBeat(appliedToFifth, 0))).toBe(false);
  });

  it("暂缓推断的局部调，题面明示新调时使用该调", () => {
    const { project } = compileScoreText(toNewKey);
    const inferred = inferChords(project);
    const tonic = { step: "D", alter: 0 } as const;
    expect(regionAt(inferred.regions, 6 * project.ppq).selected?.semantics?.interpretations[0].localKey)
      .toEqual({ tonic, mode: "major" });
    expect(hasSubstitution(regionAt(inferred.regions, 5 * project.ppq))).toBe(false);

    project.keyEvents.push({ id: "printed-d", tick: 4 * project.ppq, tonic, mode: "major" });
    expectDominant(regionAt(inferChords(project).regions, 5 * project.ppq), "tonic", "A");
  });

  it("阈值筛选只约束新增候选", () => {
    const { project } = compileScoreText(toFifth);
    const observations = buildChordInferenceObservations(project);
    const sets = observations.map(observation =>
      buildChordInferenceCandidates(observation, { allowNonChordToneCandidates: true }),
    );
    expect(withDominantSixthSubstitutions(observations, sets, candidate => candidate.confidence === "high")[0])
      .toHaveLength(sets[0].length + 1);
    expect(withDominantSixthSubstitutions(observations, sets, () => false)[0]).toBe(sets[0]);
  });

  it("非默认缺音和外音选项下，局部范围首选及 ID 与全谱一致", () => {
    const { project } = compileScoreText(toFifth);
    const options = { allowIncompleteVoicing: true, allowNonChordToneCandidates: true };
    const full = inferChords(project, options).regions[0];
    const fromTick = project.ppq / 4;
    const toTick = project.ppq / 2;
    const { regions } = inferChords(project, { ...options, fromTick, toTick });
    expect(regions).toHaveLength(1);
    const [partial] = regions;
    expect(partial).toMatchObject({ fromTick, toTick, selected: {
      id: full.selected?.id, identity: full.selected?.identity, observationIndex: 0,
    } });
    expectDominant(partial, "fifth", "G");
    const choices = [partial.selected, ...partial.alternatives];
    expect(new Set(choices.map(candidate => candidate?.id)).size).toBe(choices.length);
  });

  it("高置信阈值允许完整属七锚点，排除依赖中置信落主锚点的新增候选", () => {
    const options = {
      minConfidence: "high",
      allowAbsoluteFallback: true,
      allowIncompleteVoicing: true,
      allowNonChordToneCandidates: true,
    } as const;
    expectDominant(inferAtBeat(toFifth, 0, options), "fifth", "G");
    expect(hasSubstitution(inferAtBeat(toTonic, 1, options))).toBe(false);
  });
});
