import { describe, expect, it } from "vitest";
import { compileScoreText, renderScoreText } from "../../../scoreText";
import { applyChordInference, inferChords, applyHarmonyInference, inferHarmony } from "../pipeline";
import { buildChordInferenceCandidates } from "../candidates";
import { withDominantSixthSubstitutions } from "../dominantFamily";
import { fitChordObservation } from "../scoring";
import { buildChordInferenceObservations } from "../observations";
import type {
  ChordInferenceOptions,
  ChordInferenceRegion,
  ChordInferenceApplyOptions,
  ChordInferenceCandidate,
} from "../types";
import { PPQ, validateProject, migrateProject } from "../../../project";
import { checkHarmony } from "../../registry";
import {
  chordIdentityToneSpellingForDegree,
  primaryHarmonyInterpretation,
  chordIdentityEquals,
  chordIdentityToneSpellings,
  chordDraftFromIdentity,
  resolveChordIdentity,
} from "../../../chordModel";
import { formatPitchClass } from "../../../pitch";
import { formatChordIdentity } from "../../../chords";
import { parseMidi } from "midi-file";
import { applyChordEditorAction, createChordEditorModel } from "../../../chordEditorModel";
import { compatibleFunctionalInterpretations } from "../../../functionalHarmonyCatalog";
import { buildMidi } from "../../../midi";
import { buildMusicXml, type MusicXmlLayout } from "../../../musicxml";

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

function hasDominantSixthSubstitution(region: ChordInferenceRegion) {
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
    expect(hasDominantSixthSubstitution(inferAtBeat(score, beat))).toBe(false);
  });

  it("普通省五重复根的原位属七保持自身候选和证据", () => {
    const score = toCompleteTonicOverHeldDominant.replace("G5/4 E5/4", "G5/2");
    const region = inferAtBeat(score, 0);
    expect(region.selected).toMatchObject({
      functionalBaseId: "D", identity: { structure: { quality: "dominant7", extensions: [] } },
    });
    expect(hasDominantSixthSubstitution(region)).toBe(false);
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
    expect(hasDominantSixthSubstitution(regionAt(inferChords(project).regions, project.ppq))).toBe(false);
  });

  it("尊重女高音已标角色", () => {
    const { project } = compileScoreText(toFifth);
    const soprano = project.satbTracks.find(track => track.id === "soprano")!.notes[0];
    soprano.nonChordToneRole = "suspension";
    expect(hasDominantSixthSubstitution(inferChords(project).regions[0])).toBe(false);
    expect(soprano.nonChordToneRole).toBe("suspension");
  });

  it("女高音跨和声延续时保留竞争解释，原音重奏时采用 6→5", () => {
    const held = compileScoreText(heldAcrossHarmony).project;
    const reattacked = compileScoreText(heldAcrossHarmony.replace("E5/2 D5/4", "E5/4 E5/4 D5/4")).project;
    const heldRegion = inferChords(held).regions.find(region => region.fromTick === held.ppq)!;
    const reattackedRegion = inferChords(reattacked).regions.find(region => region.fromTick === reattacked.ppq)!;
    expect(hasDominantSixthSubstitution(heldRegion)).toBe(false);
    expectDominant(reattackedRegion, "fifth", "G");
  });

  it("完整副属及其目标都实写时也暂缓 6→5", () => {
    expect(inferAtBeat(appliedToFifth, 1).selected?.semantics?.interpretations[0].appliedTarget)
      .toMatchObject({ degree: 5 });
    expect(hasDominantSixthSubstitution(inferAtBeat(appliedToFifth, 0))).toBe(false);
  });

  it("暂缓推断的局部调，题面明示新调时使用该调", () => {
    const { project } = compileScoreText(toNewKey);
    const inferred = inferChords(project);
    const tonic = { step: "D", alter: 0 } as const;
    expect(regionAt(inferred.regions, 6 * project.ppq).selected?.semantics?.interpretations[0].localKey)
      .toEqual({ tonic, mode: "major" });
    expect(hasDominantSixthSubstitution(regionAt(inferred.regions, 5 * project.ppq))).toBe(false);

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
    expect(hasDominantSixthSubstitution(inferAtBeat(toTonic, 1, options))).toBe(false);
  });
});

const applied = `satb 1
key C major
meter 2/4
bars 1..3 {
  S: | E5/2 | C5/4 B4/4 | A4/2 |
  A: | G4/2 | G#4/2 | A4/2 |
  T: | C4/2 | D4/2 | C4/2 |
  B: | C3/2 | E3/2 | F3/2 |
}`;

const modulating = `satb 1
key F major
meter 2/4
bars 1..3 {
  S: | A4/4 B4/4 | G5/4 F#5/4 | E5/2 |
  A: | F4/4 E4/4 | D#4/2 | E4/2 |
  T: | A3/4 G3/4 | A3/2 | G3/2 |
  B: | F3/4 G2/4 | B2/2 | E2/2 |
}`;

const annotation = `
annotations {
chord v range=[2:1,3:1) symbol=V7/VI
chord s range=[3:1,4:1) symbol=IV
}`;
const sourceTick = 2 * PPQ;
const fifthTick = 3 * PPQ;
const landingTick = 4 * PPQ;
const substitution = "dominant-sixth-substitution";
const extraTone = "chord.unclassified-nonchord-tone";

function withManualBoundary(project: ReturnType<typeof compileScoreText>["project"], tick?: number) {
  if (tick !== undefined) {
    project.structure.phraseBoundaries.push({ id: "edge", tick, source: "manual", confidence: "certain" });
  }
  return project;
}

function inferScore(score: string, boundary?: number) {
  const project = withManualBoundary(compileScoreText(score).project, boundary);
  const result = inferHarmony(project);
  const written = applyHarmonyInference(project, result, { mode: "replace-unlocked", writeNonChordToneRoles: true });
  const region = result.chordInference.regions.find(item => item.fromTick <= sourceTick && sourceTick < item.toTick)!;
  return { region, diagnostics: checkHarmony(written.project).diagnostics };
}

function annotatedDiagnostics(score: string, boundary?: number, chords = annotation) {
  const project = withManualBoundary(compileScoreText(score + chords).project, boundary);
  return checkHarmony(project).diagnostics;
}

function hasContextualDominantSixthSubstitution(region: ReturnType<typeof inferScore>["region"]) {
  return [region.selected, ...region.alternatives].some(candidate =>
    candidate?.evidence.some(item => item.code === substitution),
  );
}

describe("有实奏确认的局部小调属七 6→5", () => {
  it("副属的六音从实际起奏恢复和弦，阻碍进行维持副属身份", () => {
    const { region, diagnostics } = inferScore(applied);
    expect(region).toMatchObject({
      fromTick: sourceTick, toTick: landingTick,
      selected: {
        semantics: { interpretations: [{ appliedTarget: { degree: 6 } }] },
        evidence: expect.arrayContaining([expect.objectContaining({ code: substitution, noteIds: [`note-S-${sourceTick}`] })]),
      },
    });
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
    expect(annotatedDiagnostics(applied)).not.toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
  });

  it("独立确认小主音后，起奏与完整属七拼合并保留小调身份", () => {
    const { region } = inferScore(modulating);
    expect(region).toMatchObject({
      fromTick: sourceTick, toTick: landingTick,
      selected: {
        semantics: { interpretations: [{ localKey: { tonic: { step: "E", alter: 0 }, mode: "minor" } }] },
        evidence: expect.arrayContaining([expect.objectContaining({ code: substitution })]),
      },
    });
  });

  it.each([
    ["低音同高度重奏", applied.replace("E3/2", "E3/4 E3/4")],
    ["低音换八度", applied.replace("E3/2", "E3/4 E2/4")],
    ["内声同音重奏", applied.replace("D4/2", "D4/4 D4/4")],
    ["六音改写为等音升五", applied.replace("C5/4", "B#4/4")],
    ["真实属七音未按级下行", applied.replace("D4/2 | C4/2", "D4/2 | C3/2")],
    ["落点属七音换声部且不重三", applied.replace("G#4/2 | A4/2", "G#4/2 | C5/2").replace("D4/2 | C4/2", "D4/2 | F4/2")],
  ])("%s 时不补足开头和声且给和弦后仍报告外音", (_description, score) => {
    expect(hasContextualDominantSixthSubstitution(inferScore(score).region)).toBe(false);
    expect(annotatedDiagnostics(score)).toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
  });

  it.each([fifthTick, landingTick])("显式句界 %s 截断证据", tick => {
    expect(hasContextualDominantSixthSubstitution(inferScore(applied, tick).region)).toBe(false);
    expect(annotatedDiagnostics(applied, tick)).toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
  });

  it("6→5 的内部同和声不能豁免女低进入副属七前的实际减四度", () => {
    const leap = applied.replace("G4/2", "C5/2").replace("C4/2 | D4", "A3/2 | D4")
      .replace("C3/2", "A2/2");
    const { region, diagnostics } = inferScore(leap);
    expect(hasContextualDominantSixthSubstitution(region)).toBe(true);
    const diminished = expect.objectContaining({
      ruleId: "melody.diminished-interval", tick: sourceTick, voiceIds: ["alto"],
      params: expect.objectContaining({ intervalNumber: 4 }),
    });
    expect(diagnostics).toContainEqual(diminished);
    expect(annotatedDiagnostics(leap)).toContainEqual(diminished);
  });

  it("同一解读的标签拆分不能改变音符起奏；实际标签冲突需要报警", () => {
    const split = annotation.replace(
      "chord v range=[2:1,3:1) symbol=V7/VI",
      "chord v1 range=[2:1,2:1+1/2) symbol=V7/VI\nchord v2 range=[2:1+1/2,3:1) symbol=V7/VI",
    );
    const conflict = split.replace("symbol=V7/VI\nchord s", "symbol=I\nchord s");
    expect(annotatedDiagnostics(applied, undefined, split)).not.toContainEqual(expect.objectContaining({ ruleId: extraTone }));
    expect(annotatedDiagnostics(applied, undefined, conflict)).toContainEqual(expect.objectContaining({ ruleId: extraTone, tick: sourceTick }));
  });
});

function analyze(text: string, options: ChordInferenceOptions = { minConfidence: "high" }) {
  const { project } = compileScoreText(text);
  const result = inferHarmony(project, options);
  return {
    project,
    regions: result.chordInference.regions,
    apply: (settings: Omit<ChordInferenceApplyOptions, "mode"> = {}) =>
      applyHarmonyInference(project, result, { mode: "replace-unlocked", ...settings }).project,
  };
}

function ninth(candidate: ChordInferenceCandidate | undefined) {
  const pitch = candidate && chordIdentityToneSpellingForDegree(candidate.identity, 9);
  return pitch && formatPitchClass(pitch);
}

function sameRootReadings(region: ReturnType<typeof analyze>["regions"][number]) {
  const readings = [region.selected, ...region.alternatives];
  return {
    extended: readings.find(reading => ninth(reading)),
    prepared: readings.find(reading => reading?.evidence.some(item => item.code === "prepared-suspension")),
  };
}

const isolated = (mode: string, pitch: string) => `satb 1
key C ${mode}
meter 2/4
bars 1..1 {
 S: | ${pitch}/2 |
 A: | F4/2 |
 T: | B3/2 |
 B: | G2/2 |
}`;

// Preparation from ex. 23–319, paired with the same-root exit in 23–329.
const tied = `satb 1
key C minor
meter 2/4
bars 1..2 {
 S: | Ab4/2~ | Ab4/4 G4/4 |
 A: | F4/2~ | F4/2 |
 T: | C4/2 | B3/2 |
 B: | F2/2 | G2/2 |
}`;

const weakOnset = `satb 1
key C minor
meter 2/4
bars 1..2 {
 S: | Ab4/2 | G4/2 |
 A: | F4/2~ | F4/2 |
 T: | C4/4 B3/4~ | B3/2 |
 B: | F2/4 G2/4~ | G2/2 |
}`;

describe("Written identity and motion of a dominant ninth", () => {
  it.each([
    ["major", "A4", "A"],
    ["minor", "A4", "A"],
  ])("keeps the exact %s spelling %s at high confidence", (mode, pitch, expected) => {
    const analysis = analyze(isolated(mode, pitch));
    const [region] = analysis.regions;
    expect(region).toMatchObject({ status: "resolved", selected: { confidence: "high" } });
    expect(ninth(region.selected)).toBe(expected);
    expect(analysis.apply().chordTrack.regions[0]?.identity).toEqual(region.selected!.identity);
  });

  it.each(["major", "minor"])("offers the isolated small ninth in %s for review at its written pitch", mode => {
    expect(analyze(isolated(mode, "Ab4")).regions[0].selected).toBeUndefined();
    const analysis = analyze(isolated(mode, "Ab4"), {});
    const [region] = analysis.regions;
    expect(region).toMatchObject({ status: "ambiguous", selected: { confidence: "low", fit: { spellingConsistent: true } } });
    expect(ninth(region.selected)).toBe("A♭");
    expect(analysis.apply().chordTrack.regions).toHaveLength(0);
    const applied = analysis.apply({ candidateChoices: new Map([[region.id, region.selected!.id]]) });
    expect(applied.chordTrack.regions[0]?.identity).toEqual(region.selected?.identity);
  });

  it.each([["major", "Bbb4"], ["minor", "G#4"]])("keeps %s enharmonic spelling for review", (mode, pitch) => {
    expect(analyze(isolated(mode, pitch)).regions[0].selected).toBeUndefined();
    const analysis = analyze(isolated(mode, pitch), {});
    expect(analysis.regions[0]).toMatchObject({ status: "ambiguous", selected: { confidence: "low" } });
    expect(analysis.apply().chordTrack.regions).toHaveLength(0);
  });

  it("returns two applicable readings for an accented and actually held 9–8", () => {
    const analysis = analyze(tied);
    const start = 2 * analysis.project.ppq;
    const region = analysis.regions.find(item => item.fromTick === start)!;
    const { extended, prepared } = sameRootReadings(region);
    expect(region).toMatchObject({ status: "resolved", selected: { id: extended?.id } });
    expect(extended?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "dominant-ninth-preparation", details: { atTick: start } }),
      expect.objectContaining({ code: "dominant-ninth-same-root-9-8", details: { atTick: start + analysis.project.ppq } }),
    ]));
    expect(prepared?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "prepared-suspension", details: { figure: "9-8", fromTick: start, toTick: start + analysis.project.ppq } }),
    ]));
    for (const candidate of [extended!, prepared!]) {
      const applied = analysis.apply({ candidateChoices: new Map([[region.id, candidate.id]]), writeNonChordToneRoles: true });
      expect(applied.chordTrack.regions.find(item => item.startTick === start)?.identity).toEqual(candidate.identity);
      expect(applied.satbTracks).toEqual(analysis.project.satbTracks);
      expect(checkHarmony(applied).diagnostics.some(item =>
        item.ruleId === "chord.unclassified-nonchord-tone" && item.tick === start)).toBe(false);
    }
    const invalid = analysis.apply({ candidateChoices: new Map([[region.id, "not-a-candidate"]]) });
    expect(invalid.chordTrack.regions.find(item => item.startTick === start)).toBeUndefined();
    const literal = analyze(tied, { minConfidence: "high", allowNonChordToneCandidates: false });
    expect(sameRootReadings(literal.regions.find(item => item.fromTick === start)!).prepared).toBeUndefined();
  });

  it.each(["2:1", "2:2"])("retains both 9–8 readings across a restated key at %s", beat => {
    const input = tied.replace("meter 2/4", "meter 2/4\nat " + beat + " key C minor");
    const analysis = analyze(input);
    const start = 2 * analysis.project.ppq;
    const region = analysis.regions.find(item => item.fromTick === start)!;
    const { prepared, extended } = sameRootReadings(region);
    expect(ninth(extended)).toBe("A♭");
    expect(prepared).toBeDefined();
    const applied = analysis.apply({ candidateChoices: new Map([[region.id, prepared!.id]]) });
    expect(checkHarmony(applied).diagnostics.some(d =>
      d.ruleId === "chord.unclassified-nonchord-tone" && d.tick === start)).toBe(false);
  });

  it("does not infer a 9–8 suspension over a real change of mode", () => {
    const input = tied.replace("meter 2/4", "meter 2/4\nat 2:2 key C major");
    const analysis = analyze(input);
    const region = analysis.regions.find(item => item.fromTick === 2 * analysis.project.ppq)!;
    expect(sameRootReadings(region).prepared).toBeUndefined();
  });

  it("retains D.1 for the same written V7 when the supposed preparation is reattacked", () => {
    const score = tied.replace("Ab4/2~", "Ab4/2").replace("\n}", "\n H: | s/2 | D7/2 |\n}");
    const { project } = compileScoreText(score);
    expect(checkHarmony(project).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      ruleId: "chord.unclassified-nonchord-tone", tick: 2 * project.ppq, voiceIds: ["soprano"],
    })]));
  });

  it.each([
    ["同音重奏", tied.replace("Ab4/2~", "Ab4/2"), 2, true],
    ["弱位经过强位落根", weakOnset, 1, true],
    ["另一个上声部也换八度", tied.replace("B3/2", "B3/4 B2/4"), 2, false],
  ])("区分%s的证据", (_label, text, beat, expectedExit) => {
    const analysis = analyze(text);
    const start = beat * analysis.project.ppq;
    const { extended, prepared } = sameRootReadings(analysis.regions.find(item => item.fromTick === start)!);
    expect(ninth(extended)).toBe("A♭");
    expect(prepared).toBeUndefined();
    expect(extended?.evidence.some(item => item.code === "dominant-ninth-same-root-9-8") ?? false).toBe(expectedExit);
  });

  it.each([
    ["minor", "F5/2", "Ab4/4 G4/4", "B3/2", "G3/2"],
    ["major", "Ab5/4 G5/4", "B4/2", "F4/2", "G3/2"],
  ])("keeps ex. 23–329 in %s as a ninth with a known exit and no proved preparation", (mode, s, a, t, b) => {
    const analysis = analyze(`satb 1
key C ${mode}
meter 2/4
bars 1..1 {
 S: | ${s} |
 A: | ${a} |
 T: | ${t} |
 B: | ${b} |
}`);
    const { extended, prepared } = sameRootReadings(analysis.regions[0]);
    expect(ninth(extended)).toBe("A♭");
    expect(extended?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ code: "dominant-ninth-same-root-9-8" })]));
    expect(prepared).toBeUndefined();
    expect(analysis.apply().chordTrack.regions[0]?.identity).toEqual(extended?.identity);
  });

  it("records a direct tonic resolution separately from same-root motion", () => {
    const analysis = analyze(`satb 1
key C minor
meter 2/4
bars 1..1 {
 S: | Ab4/4 G4/4 |
 A: | B3/4 C4/4 |
 T: | F3/4 Eb3/4 |
 B: | G2/4 C3/4 |
}`);
    const { extended, prepared } = sameRootReadings(analysis.regions[0]);
    expect(ninth(extended)).toBe("A♭");
    expect(extended?.evidence.filter(item => item.kind === "sequence-context").map(item => item.code))
      .toEqual(["dominant-ninth-to-tonic"]);
    expect(prepared).toBeUndefined();
  });

  it("does not write the fleeting vertical small ninth in the A-major pedal counterexample", () => {
    // Huang, vol. 2, p. 419, written exercise 1 (1), isolated pedal figure.
    const analysis = analyze(`satb 1
key A major
meter 3/4
bars 1..1 {
 S: | C#5/4 D5/8 C#5/8 B4/4 |
 A: | G#4/2 G#4/4 |
 T: | E4/4 F4/8 E4/8 D4/4 |
 B: | E3/2. |
}`, {});
    const at = analysis.project.ppq;
    const region = analysis.regions.find(item => item.fromTick === at)!;
    expect(region).toMatchObject({ status: "ambiguous", selected: { confidence: "low" } });
    expect(ninth(region.selected)).toBe("F");
    expect(analysis.apply().chordTrack.regions.some(item => item.startTick === at)).toBe(false);
  });
});

const motif = `satb 1
key C major
meter 3/4
bars 1..2 {
  S: | E5/2 G5/4 | F5/2 E5/4 |
  A: | C5/2 E5/4 | E5/4 D5/4 C5/4 |
  T: | G4/2 A4/4 | A4/2 G4/4 |
  B: | C4/2 C#4/4 | D4/2 C4/4 |
}`;

const resolution = "reattacked-tonic-ninth-resolution";

function regionsAt(project: ReturnType<typeof compileScoreText>["project"], options?: Parameters<typeof inferChords>[1]) {
  const result = inferChords(project, options);
  const at = (beats: number) => result.regions.find(region =>
    region.fromTick <= beats * project.ppq && beats * project.ppq < region.toTick);
  return { result, at };
}

function hasDelayedCandidate(result: ReturnType<typeof inferChords>) {
  return result.regions.some(region => [region.selected, ...region.alternatives].some(
    candidate => candidate?.evidence.some(item => item.code === resolution),
  ));
}

describe("a written dominant fifth reattacked as a tonic ninth", () => {
  it("recovers V65/ii and extends the complete ii back to the tonic-bass attack", () => {
    const { project } = compileScoreText(motif);
    const { result, at } = regionsAt(project);
    const source = at(2)!;
    const target = at(3)!;
    expect(source.status).toBe("resolved");
    expect(source.selected?.identity).toMatchObject({
      root: { step: "A", alter: 0 },
      bass: { step: "C", alter: 1 },
      structure: { quality: "dominant7" },
    });
    expect(primaryHarmonyInterpretation(source.selected!.semantics!).appliedTarget?.degree).toBe(2);
    expect(target.status).toBe("resolved");
    expect(target.fromTick).toBe(3 * project.ppq);
    expect(target.toTick).toBe(5 * project.ppq);
    expect(target.selected?.identity).toMatchObject({
      root: { step: "D", alter: 0 },
      bass: { step: "D", alter: 0 },
      structure: { quality: "minor" },
    });
    expect(target.selected?.evidence).toContainEqual(expect.objectContaining({
      code: resolution,
      details: { arrivalTick: 3 * project.ppq, confirmationTick: 4 * project.ppq },
    }));
    const written = applyHarmonyInference(project, { chordInference: result }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
    const alto = written.satbTracks.find(track => track.id === "alto")!.notes;
    expect(alto.filter(note => note.nonChordToneRole).map(note => [note.startTick, note.nonChordToneRole]))
      .toEqual([[3 * project.ppq, "suspension"]]);
  });

  it("reuses the recognized dominant when a soprano reattack delays the tonic", () => {
    const { project } = compileScoreText(`satb 1
key A minor
meter 2/4
bars 1..2 {
  S: | C5/4 B4/4 | B4/8 A4/8 E4/4 |
  A: | E4/2~ | E4/4 C4/4 |
  T: | C4/4 D4/4 | C4/2 |
  B: | A3/4 G#3/4 | A3/2 |
}`);
    const { at } = regionsAt(project);
    expect(at(1)?.selected?.identity.structure).toMatchObject({ quality: "dominant7" });
    expect(at(2)?.selected?.identity.structure).toMatchObject({ quality: "minor" });
    expect(at(2)?.selected?.evidence).toContainEqual(expect.objectContaining({
      code: resolution,
      details: { arrivalTick: 2 * project.ppq, confirmationTick: 2.5 * project.ppq },
    }));
  });

  it.each([
    ["octave transfer of the reattack", "E5/4 | E5/4", "E5/4 | E4/4"],
    ["enharmonic pitch at the reattack", "E5/4 | E5/4", "E5/4 | Fb5/4"],
    ["a tie instead of a reattack", "E5/4 | E5/4", "E5/4~ | E5/4"],
    ["no tonic octave at the landing", "E5/4 D5/4 C5/4", "E5/4 C5/4 C5/4"],
    ["third missing from the final triad", "F5/2 E5/4", "F5/4 D5/4 E5/4"],
    ["wrong bass at the target", "D4/2 C4/4", "F4/2 C4/4"],
    ["seventh transfers an octave", "F5/2 E5/4", "F4/2 E5/4"],
    ["another voice reattacks at settlement", "A4/2 G4/4", "A4/4 A4/4 G4/4"],
  ])("requires a real delayed resolution with %s excluded", (_case, from, to) => {
    expect(motif).toContain(from);
    expect(hasDelayedCandidate(inferChords(compileScoreText(motif.replace(from, to)).project))).toBe(false);
  });

  it.each([3, 4])("respects an explicit phrase boundary at quarter %i", beats => {
    const { project } = compileScoreText(motif);
    project.structure.phraseBoundaries = [
      { id: "cut", source: "manual", confidence: "certain", tick: beats * project.ppq },
    ];
    expect(hasDelayedCandidate(inferChords(project))).toBe(false);
  });

  it("uses the surrounding score without writing chord or note changes outside the selection", () => {
    const { project } = compileScoreText(motif);
    const fromTick = 3.5 * project.ppq, toTick = 4 * project.ppq;
    const result = inferChords(project, { fromTick, toTick });
    expect(result.regions.map(region => [region.fromTick, region.toTick, region.selected?.identity.root.step]))
      .toEqual([[fromTick, toTick, "D"]]);
    const written = applyHarmonyInference(project, { chordInference: result }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
    expect(written.chordTrack.regions.map(chord => [chord.startTick, chord.durationTicks]))
      .toEqual([[fromTick, toTick - fromTick]]);
    expect(written.satbTracks.flatMap(track => track.notes).some(note => note.nonChordToneRole)).toBe(false);
  });

  it("preserves a conflicting explicit note role", () => {
    const { project } = compileScoreText(motif);
    project.satbTracks.find(track => track.id === "alto")!.notes.find(note =>
      note.startTick === 3 * project.ppq)!.nonChordToneRole = "passing";
    expect(hasDelayedCandidate(inferChords(project))).toBe(false);
  });

  it.each([{ allowNonChordToneCandidates: false }, { minConfidence: "high" as const }])(
    "keeps the exact dominant but suppresses an ornamental target with options %o", options => {
      const { project } = compileScoreText(motif);
      const { result, at } = regionsAt(project, options);
      expect(at(2)?.selected?.identity.structure).toMatchObject({ quality: "dominant7" });
      expect(at(3)?.selected?.fit.nonChordToneAssignments ?? {}).toEqual({});
      expect(at(4)?.selected?.identity.structure).toMatchObject({ quality: "minor" });
      const written = applyHarmonyInference(project, { chordInference: result }, {
        mode: "replace-unlocked", writeNonChordToneRoles: true,
      }).project;
      expect(written.satbTracks.flatMap(track => track.notes).some(note => note.nonChordToneRole)).toBe(false);
    },
  );
});

function appliedDominantReading(s: string, a: string, t: string, b: string) {
  const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
  S: | ${s} |
  A: | ${a} |
  T: | ${t} |
  B: | ${b} |
}`).project;
  return inferChords(project).regions;
}
describe("离调的属和弦", () => {
  it("离调减七按实写导音同声部上行半音至局部主音判读", () => {
    const [vii] = appliedDominantReading("Bb4/2 A4/2", "G4/2 F4/2", "E4/2 D4/2", "C#3/2 D3/2");
    expect(vii).toMatchObject({ status: "resolved", selected: {
      identity: { root: { step: "C", alter: 1 }, structure: { quality: "diminished7" } },
      semantics: { interpretations: [{ degree: 7, appliedTarget: { degree: 2 } }] },
    } });
  });
  it("目标三和弦换位、原导音同声部跳开时不指派副导七", () => {
    const [vii] = appliedDominantReading("Bb4/2 A4/2", "G4/2 F4/2", "E4/2 D4/2", "C#3/2 F3/2");
    expect(vii.selected?.semantics?.interpretations[0].appliedTarget).toBeUndefined();
  });
  it("半音化的 A7/C# 解决到 D 小三和弦，仍使用原调与明确的目标级数", () => {
    const [v, ii] = appliedDominantReading("G4/2 F4/2", "E4/2 D4/2", "A3/1", "C#3/2 D3/2");
    expect(v).toMatchObject({ status: "resolved", selected: { identity: { root: { step: "A" }, bass: { step: "C", alter: 1 } },
      semantics: { interpretations: [{ degree: 5, appliedTarget: { degree: 2 } }] } } });
    expect(ii.selected?.functionalBaseId).toBe("SII");
  });
  it("谱面缺少后续解决时保留孤立的半音和弦未定", () => {
    const [v] = appliedDominantReading("G4/1", "E4/1", "A3/1", "C#3/1");
    expect(v.selected?.semantics?.interpretations[0].appliedTarget).toBeUndefined();
  });
  it("调内 T–S 保留主和弦读法", () => {
    const [t] = appliedDominantReading("G4/2 A4/2", "E4/2 F4/2", "C4/1", "C3/2 F2/2");
    expect(t.selected?.functionalBaseId).toBe("T");
    expect(t.selected?.semantics?.interpretations[0].appliedTarget).toBeUndefined();
  });
});

function appliedSequenceScore(chords: string[][]) {
  const lines = ["S", "A", "T", "B"].map((voice, i) =>
    "  " + voice + ": | " + chords.map(notes => notes[i] + "/4").join(" ") + " |");
  return compileScoreText(["satb 1", "key C major", "meter " + chords.length + "/4",
    "bars 1..1 {", ...lines, "}"].join("\n")).project;
}

const G7 = ["F5", "B4", "D4", "G2"];
const C7 = ["E5", "Bb4", "C4", "C3"];
const F7 = ["Eb5", "A4", "C4", "F2"];
const Bb7 = ["D5", "Ab4", "Bb3", "Bb2"];
const Eb7 = ["Db5", "G4", "Bb3", "Eb3"];
const C = ["G5", "E4", "C4", "C3"];
const K64 = ["G5", "E4", "C4", "G2"];

describe("实写属七的四度连锁", () => {
  it("连续两次根音四度可辨识省五音的 V7/IV，再次起音仍沿用相同功能", () => {
    const project = appliedSequenceScore([G7, C7, C7, F7, Bb7, Eb7]);
    const { regions } = inferChords(project, { fromTick: project.ppq, toTick: 3 * project.ppq });
    expect(regions).toHaveLength(1);
    const selected = regions[0].selected!;
    expect(selected.identity).toMatchObject({ root: { step: "C" }, structure: { quality: "dominant7" } });
    expect(selected.semantics?.interpretations[0]).toMatchObject({ degree: 5, appliedTarget: { degree: 4 } });
    expect(selected.semantics?.interpretations[0].localKey).toBeUndefined();
    expect(selected.fit.chordToneNoteIds).toHaveLength(8);
    expect(selected.fit.nonChordToneNoteIds).toEqual([]);
  });

  it("变音目标保存和弦身份与书写方向，保留工程调号", () => {
    const project = appliedSequenceScore([G7, C7, F7, Bb7, Eb7]);
    const { regions } = inferChords(project, { fromTick: 2 * project.ppq, toTick: 3 * project.ppq });
    expect(regions[0].selected?.identity).toMatchObject({ root: { step: "F" }, structure: { quality: "dominant7" } });
    expect(regions[0].selected?.semantics).toBeUndefined();
    expect(regions[0].selected?.evidence).toContainEqual({
      kind: "sequence-context", code: "dominant-seventh-chain", details: { targetStep: "B", targetAlter: -1 },
    });
    expect(project.keyEvents).toHaveLength(1);
  });

  it("单次四度连接与被其他和弦截断的进行不建立属七模进", () => {
    const { regions } = inferChords(appliedSequenceScore([G7, C7, C, Bb7]));
    expect(regions.every(r => !r.selected?.evidence.some(e => e.code === "dominant-seventh-chain"))).toBe(true);
  });
});

describe("和声大调的二级下属", () => {
  it.each([
    { tones: ["F5", "Ab4", "C4", "D3"], quality: "halfDiminished7", bass: "D" },
    { tones: ["D5", "Ab4", "F4", "F3"], quality: "diminished", bass: "F" },
  ])("依据完整的书写和属准备辨识 $quality", ({ tones, quality, bass }) => {
    const { regions } = inferChords(appliedSequenceScore([tones, K64, G7, C]));
    expect(regions[0].selected).toMatchObject({ functionalBaseId: "SII", identity: {
      root: { step: "D" }, bass: { step: bass }, structure: { quality },
    } });
    expect(regions[0].selected?.evidence.some(e => e.code === "harmonic-major-supertonic")).toBe(true);
  });

  it.each([
    ["D5", "Ab4", "F4", "D3"],
    ["D5", "G#4", "F4", "F3"],
  ])("减三原位与同音异名不单凭音高套用下属六和弦", (s, a, t, b) => {
    const { regions } = inferChords(appliedSequenceScore([[s, a, t, b], K64, G7, C]));
    expect(regions[0].selected?.evidence.some(e => e.code === "harmonic-major-supertonic")).not.toBe(true);
  });
});

function projectFor({
  key = "C major",
  soprano = "D#5/4 E5/4",
  alto = "F#4/4 G4/4",
  tenor = "C4/4 C4/4",
  bass = "Ab2/4 G2/4",
  harmony = "",
} = {}) {
  return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 ${harmony ? `H: | ${harmony} |` : ""}
}`).project;
}

function opening(project: ReturnType<typeof projectFor>) {
  return inferChords(project).regions.find(region => region.fromTick === 0);
}

function firstRuleIds(project: ReturnType<typeof projectFor>, ruleId: string, tick = 0) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === ruleId && item.tick === tick);
}

describe("实写升二的重属倍增三四", () => {
  it("以独立身份写回 [降六、主、升二、升四]，显示不同于德增六", () => {
    const project = projectFor();
    const inference = inferChords(project);
    const first = inference.regions[0].selected!;
    expect(first.functionalBaseId).toBe("DD++43");
    expect(first.fit).toMatchObject({ spellingConsistent: true, nonChordToneNoteIds: [] });
    expect(inference.regions[0].alternatives.map(item => item.functionalBaseId)).not.toContain("Ger+6");
    expect(chordIdentityToneSpellings(first.identity).map(formatPitchClass)).toEqual(["A♭", "C", "D♯", "F♯"]);
    expect(formatChordIdentity(first.identity, first.semantics)).toMatchObject({
      roman: "DD++43", absolute: "A♭-C-D♯-F♯",
    });
    const written = applyHarmonyInference(project, { chordInference: inference },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(written.satbTracks).toEqual(project.satbTracks);
    expect(validateProject(JSON.parse(JSON.stringify(written)))).toBe(true);
    expect(renderScoreText(written)).toContain("symbol=DD++43");
    expect(firstRuleIds(written, "chord.augmented-sixth-voicing")).toHaveLength(0);
    expect(firstRuleIds(written, "chord.unclassified-nonchord-tone")).toHaveLength(0);
  });

  it("F♯ 大调保留重升 G，并分别对 D→C♯、B♯→C♯及 G𝄪→A♯取证", () => {
    const project = projectFor({
      key: "F# major", soprano: "F#4/2", alto: "B#3/4 C#4/4", tenor: "G##3/4 A#3/4", bass: "D3/4 C#3/4",
    });
    const chord = opening(project)?.selected;
    expect(chord?.functionalBaseId).toBe("DD++43");
    expect(chordIdentityToneSpellings(chord!.identity).map(formatPitchClass)).toEqual(["D", "F♯", "G𝄪", "B♯"]);
  });

  it("等音 E♭ 仍是标准德增六，显式用错标签时配置检查分别报警", () => {
    const german = projectFor({ soprano: "Eb5/4 E5/4", harmony: "Ger+6/4 K46/4" });
    const doubled = projectFor({ harmony: "DD++43/4 K46/4" });
    expect(chordIdentityEquals(german.chordTrack.regions[0].identity, doubled.chordTrack.regions[0].identity)).toBe(false);
    expect(opening(german)?.selected?.functionalBaseId).toBe("Ger+6");
    expect(firstRuleIds(german, "chord.augmented-sixth-voicing")).toHaveLength(0);
    expect(firstRuleIds(doubled, "chord.augmented-sixth-voicing")).toHaveLength(0);
    expect(firstRuleIds(projectFor({ harmony: "Ger+6/4 K46/4" }), "chord.augmented-sixth-voicing")).toHaveLength(1);
    expect(firstRuleIds(projectFor({ soprano: "Eb5/4 E5/4", harmony: "DD++43/4 K46/4" }),
      "chord.augmented-sixth-voicing")).toHaveLength(1);
  });

  it.each([
    ["升二音错八度", { soprano: "D#5/4 E6/4" }],
    ["降六音未下行半音", { bass: "Ab2/4 G3/4" }],
    ["共同主音换八度", { tenor: "C4/4 C3/4", bass: "Ab2/4 G2/4" }],
    ["改到原位属七而非主四六", { soprano: "D#5/4 F5/4", tenor: "C4/4 B3/4" }],
    ["低音先到属音，两上声部后到同一主四六", {
      soprano: "D#5/4. E5/8", alto: "F#4/4. G4/8", tenor: "C4/2", bass: "Ab2/4 G2/4",
    }],
  ])("%s 时和声实音仍能确定书写身份", (_description, voicing) => {
    expect(opening(projectFor(voicing))?.selected?.functionalBaseId).toBe("DD++43");
  });

  it("明确的原位属七后继仍触发真正的解决错误", () => {
    const project = projectFor({ soprano: "D#5/4 F5/4", tenor: "C4/4 B3/4" });
    const result = applyHarmonyInference(project, {chordInference: inferChords(project)},
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(firstRuleIds(result, "resolution.augmented-sixth", project.ppq)).toHaveLength(1);
  });

  it("实写倍增三四保留独立身份，主音连持且回到同配置原位主和弦时解决成立", () => {
    const project = compileScoreText(`satb 1
key D major
meter 3/4
bars 1..1 {
 S: | D5/2. |
 A: | F#4/4 E#4/4 F#4/4 |
 T: | A3/4 G#3/4 A3/4 |
 B: | D3/4 Bb2/4 D3/4 |
}`).project;
    const inference = inferChords(project);
    expect(inference.regions.find(region => region.fromTick === project.ppq)?.selected?.functionalBaseId)
      .toBe("DD++43");
    const result = applyHarmonyInference(project, { chordInference: inference },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(firstRuleIds(result, "resolution.augmented-sixth", 2 * project.ppq)).toEqual([]);
  });

  it.each([
    ["没有可证的后继功能", { alto: "F#4/4 F4/4" }],
    ["没有可证的前置原位主功能", { bass: "Ab2/4 C3/4" }],
    ["名义低音高于实奏其他声部", { bass: "Ab5/4 G5/4" }],
    ["书面是小调且无独立大调证据", { key: "C minor", soprano: "D#5/4 Eb5/4" }],
    ["升二级误写作降三级", { soprano: "Eb5/4 E5/4" }],
    ["升四级改成等音降五级", { alto: "Gb4/4 G4/4" }],
  ])("%s 时不认作倍增三四", (_description, voicing) => {
    const region = opening(projectFor(voicing));
    expect([region?.selected, ...(region?.alternatives ?? [])].map(item => item?.functionalBaseId))
      .not.toContain("DD++43");
  });

  it.each(["key", "phrase"])("功能落点不能跨手动 %s 边界", (boundary) => {
    const project = projectFor();
    if (boundary === "key") {
      project.keyEvents.push({ id: "other", tick: project.ppq,
        tonic: { step: "G", alter: 0 }, mode: "major" });
    } else {
      project.structure.phraseBoundaries.push({
        id: "phrase", tick: project.ppq, source: "manual", confidence: "certain",
      });
    }
    expect(opening(project)?.selected?.functionalBaseId).not.toBe("DD++43");
  });

  it("同一调号内有独立新调准备时，不借新调主和弦证明旧调重属", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..4 {
 S: | E5/4 D5/4 | D#5/4 D5/4 | D5/4 C5/4 | B4/2 |
 A: | C5/4 A4/4 | F#4/4 G4/4 | G4/4 F#4/4 | G4/2 |
 T: | G3/4 D4/4 | C4/4 B3/4 | B3/4 A3/4 | D4/2 |
 B: | C3/4 F#2/4 | Ab2/4 G2/4 | D3/4 D3/4 | G2/2 |
}`).project;
    const regionAt = (beat: number) => inferChords(project).regions.find(
      region => region.fromTick <= beat * project.ppq && beat * project.ppq < region.toTick,
    );
    expect(regionAt(3)?.selected?.semantics?.interpretations[0].localKey?.tonic.step).toBe("G");
    expect(regionAt(2)?.selected?.functionalBaseId).not.toBe("DD++43");
  });

  it("推导与填空应用保留手工给定和弦", () => {
    const project = projectFor({ harmony: "Ger+6/4 K46/4" });
    const given = structuredClone(project.chordTrack.regions);
    const inference = inferChords(project);
    expect(inference.regions[0].selected?.functionalBaseId).toBe("DD++43");
    expect(project.chordTrack.regions).toEqual(given);
    expect(applyHarmonyInference(project, { chordInference: inference }, {
      mode: "fill-gaps",
    }).project.chordTrack.regions).toEqual(given);
    expect(firstRuleIds(project, "chord.augmented-sixth-voicing")).toHaveLength(1);
  });

  it("显式倍增三四不能仅凭增六两端正确解决到普通属和弦", () => {
    const passing = projectFor({ harmony: "DD++43/4 I64/4" });
    const dominant = projectFor({ soprano: "D#5/4 D5/4", tenor: "C4/4 B3/4", harmony: "DD++43/4 D/4" });
    expect(firstRuleIds(passing, "resolution.augmented-sixth", passing.ppq)).toHaveLength(0);
    expect(firstRuleIds(dominant, "resolution.augmented-sixth", dominant.ppq)).toHaveLength(1);
  });
});

const doubleAugmentedInterchangeScore = `satb 1
key F# major
meter 2/4
bars 1..1 {
 S: | F#4/2 |
 A: | B#3/4 C#4/4 |
 T: | G##3/4 A#3/4 |
 B: | D3/4 C#3/4 |
 H: | DD++43/4 K46/4 |
}`;

describe("倍增三四的实际输入、目录与输出", () => {
  it("SATBT 输入经 JSON 重开仍保留独立身份和实写重升音", () => {
    const { project } = compileScoreText(doubleAugmentedInterchangeScore);
    const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(reopened).toBeDefined();
    expect(reopened?.chordTrack.regions).toEqual(project.chordTrack.regions);
    expect(reopened?.satbTracks).toEqual(project.satbTracks);
    const chord = reopened!.chordTrack.regions[0];
    expect(chord.identity.structure).toEqual({ kind: "augmented-sixth", variant: "doubleAugmented43" });
    expect(chordIdentityToneSpellings(chord.identity).map(formatPitchClass)).toEqual(["D", "F♯", "G𝄪", "B♯"]);
    expect(renderScoreText(reopened!)).toContain("symbol=DD++43");
    expect(renderScoreText(reopened!)).toContain("G##3/4");
    const draft = chordDraftFromIdentity(chord.identity, chord.semantics!);
    const catalog = createChordEditorModel(draft, project.keyEvents[0]);
    expect(catalog.baseId).toBe("DD++43");
    expect(catalog.maximumInversion).toBe(0);
    expect(resolveChordIdentity(draft, project.keyEvents[0])).toEqual(chord.identity);
  });

  it("小调不列该项或接受名称，标注局部大调仍可录入", () => {
    const minor = doubleAugmentedInterchangeScore.replace("F# major", "F# minor");
    expect(() => compileScoreText(minor)).toThrow("需要大调语境");
    const localMajor = minor.replace(" H: | DD++43/4 K46/4 |", "") + `
annotations {
 chord c at=1:1 duration=1/4 symbol=DD++43 localKey="F# major"
}
`;
    const { project } = compileScoreText(localMajor);
    const { identity, semantics } = project.chordTrack.regions[0];
    const draft = chordDraftFromIdentity(identity, semantics!);
    expect(compatibleFunctionalInterpretations(identity).map(item => item.localKey.mode)).toEqual(["major"]);
    const degreeInMinor = { ...draft, localKey: undefined, augmentedSixthVariant: undefined };
    expect(createChordEditorModel(degreeInMinor, project.keyEvents[0]).availableDefinitions.map(item => item.id))
      .not.toContain("DD++43");
    expect(applyChordEditorAction(degreeInMinor, project.keyEvents[0],
      { type: "select-functional-definition", id: "DD++43" })).toBe(degreeInMinor);
    expect(createChordEditorModel(draft, project.keyEvents[0]).availableDefinitions.map(item => item.id))
      .toContain("DD++43");
    const malformed = structuredClone(project);
    malformed.chordTrack.regions[0].semantics!.interpretations[0].localKey = { tonic: { step: "F", alter: 1 }, mode: "minor" };
    expect(validateProject(malformed)).toBe(false);
  });

  it("纯实体仍能正确显示，且无语义工程也校验固定低音", () => {
    const { project } = compileScoreText(doubleAugmentedInterchangeScore);
    const chord = project.chordTrack.regions[0];
    chord.semantics = undefined;
    expect(validateProject(project)).toBe(true);
    expect(formatChordIdentity(chord.identity)).toMatchObject({ functional: "DD++43", roman: "DD++43" });
    expect(renderScoreText(project)).toContain("symbol=DD++43");
    chord.identity.bass = { step: "F", alter: 1 };
    expect(validateProject(project)).toBe(false);
  });

  it.each<MusicXmlLayout>(["single-staff", "grand-staff", "satb-separate"])(
    "MusicXML %s 保留升降号与正确和弦名", layout => {
      const { project } = compileScoreText(doubleAugmentedInterchangeScore);
      const xml = buildMusicXml(project, { layout });
      expect(xml).toContain("D-F♯-G𝄪-B♯");
      expect(xml).toContain("DD++43</words>");
      expect(xml).toMatch(/<step>G<\/step>\s*<alter>2<\/alter>\s*<octave>3<\/octave>/);
      expect(xml).not.toContain("Ger+6");
    },
  );

  it.each([["It+6", "italian"], ["Fr+6", "french"], ["Ger+6", "german"]])(
    "旧 schema v3 的 %s 原样重开", (symbol, variant) => {
      const { project } = compileScoreText(doubleAugmentedInterchangeScore.replaceAll("DD++43", symbol));
      const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
      expect(reopened?.chordTrack.regions[0].identity.structure).toEqual({ kind: "augmented-sixth", variant });
      expect(reopened?.chordTrack.regions).toEqual(project.chordTrack.regions);
    },
  );

  it("MIDI 保留实际音高和可读的倍增三四和弦标记", () => {
    const { project } = compileScoreText(doubleAugmentedInterchangeScore);
    const events = parseMidi(buildMidi(project, true)).tracks.flat();
    expect(events).toContainEqual(expect.objectContaining({ type: "marker", text: "DD++43" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "noteOn", noteNumber: 57 }));
  });
});

const evidenceCode = "local-deceptive-dominant-resolution";

function deceptiveDominantReading(parts: readonly [string, string, string, string], events = "", bars = 3, phraseTick?: number) {
  const score = `satb 1
key C major
meter 2/4
${events}
bars 1..${bars} {
  S: | ${parts[0]} |
  A: | ${parts[1]} |
  T: | ${parts[2]} |
  B: | ${parts[3]} |
}`;
  const { project } = compileScoreText(score);
  if (phraseTick !== undefined) {
    project.structure.phraseBoundaries.push({ id: "edge", tick: phraseTick, source: "manual", confidence: "certain" });
  }
  const result = inferChords(project);
  return result.regions.find(region => region.fromTick <= 960 && 960 < region.toTick)!;
}

const diatonic = [
  "G4/4 G#4/4 | A4/2 | G4/2",
  "E4/4 D4/4 | C4/2 | E4/2",
  "C4/4 B3/4 | A3/2 | C4/2",
  "C3/4 E3/4 | F3/2 | C3/2",
] as const;
const chromatic = [
  "G4/4 F##4/4 | G#4/2 | B4/2",
  "E4/4 C#4/4 | B3/2 | G#4/2",
  "C4/4 A#3/4 | G#3/2 | D#4/2",
  "C3/4 D#3/4 | E3/2 | D#3/2",
] as const;

function lacksDeceptiveEvidence(region: ReturnType<typeof deceptiveDominantReading>) {
  for (const candidate of [region.selected, ...region.alternatives]) {
    expect(candidate?.evidence.some(evidence => evidence.code === evidenceCode)).not.toBe(true);
  }
}

describe("完整原位属七的局部阻碍进行", () => {
  it("C 大调的 E7 可按指向 vi 的副属进入 a 小调 VI，保留实写根低音", () => {
    const region = deceptiveDominantReading(diatonic);
    expect(region).toMatchObject({ status: "resolved", selected: {
      identity: { root: { step: "E", alter: 0 }, bass: { step: "E", alter: 0 }, structure: { quality: "dominant7" } },
      semantics: { interpretations: [{ appliedTarget: { degree: 6 } }] },
    } });
    expect(region.selected?.evidence.some(evidence => evidence.code === evidenceCode)).toBe(true);
  });

  it("谱面稍后出现同拼写的小主三和弦时，支持非调内目标的局部读法", () => {
    const region = deceptiveDominantReading(chromatic);
    expect(region).toMatchObject({ status: "resolved", selected: {
      identity: { root: { step: "D", alter: 1 }, structure: { quality: "dominant7" } },
      semantics: { interpretations: [{ localKey: { tonic: { step: "G", alter: 1 }, mode: "minor" } }] },
    } });
    expect(region.selected?.evidence.some(evidence => evidence.code === evidenceCode)).toBe(true);
    expect(region.selected?.evidence.some(evidence => evidence.code === "local-key-cadence")).toBe(false);
  });

  it.each([
    ["属七五音跳到目标八度", [diatonic[0], diatonic[1], "C4/4 B3/4 | A4/2 | C4/2", diatonic[3]]],
    ["另一个声部降八度后位于实谱低音下方", [diatonic[0], "E4/4 D4/4 | C3/2 | E4/2", diatonic[2], diatonic[3]]],
    ["三条解决均为级进但有声部处在名义低音下方", [diatonic[0], diatonic[1], "C4/4 B2/4 | A2/2 | C4/2", diatonic[3]]],
    ["落点不重三音", [diatonic[0], diatonic[1], "C4/4 B3/4 | C4/2 | C4/2", diatonic[3]]],
    ["七音未在原声部下行", [diatonic[0], "E4/4 D4/4 | A3/2 | E4/2", "C4/4 B3/4 | C4/2 | C4/2", diatonic[3]]],
    ["同音异名的变化音", ["G4/4 Ab4/4 | A4/2 | G4/2", diatonic[1], diatonic[2], diatonic[3]]],
    ["省掉属七的五音", [diatonic[0], diatonic[1], "C4/4 E4/4 | A3/2 | C4/2", diatonic[3]]],
    ["源低音是属七的五音", [diatonic[0], diatonic[1], "C4/4 E3/4 | A3/2 | C4/2", "C3/4 B2/4 | F3/2 | C3/2"]],
    ["非调内目标只出现同主音大三和弦", ["G4/4 F##4/4 | G#4/2 | B#4/2", chromatic[1], chromatic[2], chromatic[3]]],
  ] satisfies (readonly [string, readonly [string, string, string, string]])[])("拒绝%s", (_name, parts) => {
    lacksDeceptiveEvidence(deceptiveDominantReading(parts));
  });

  it("不跨过实际调号边界", () => {
    lacksDeceptiveEvidence(deceptiveDominantReading(diatonic, "at 2:1 key A minor"));
  });

  it("非调内小主超过两拍才出现时，不使用该解读", () => {
    lacksDeceptiveEvidence(deceptiveDominantReading([
      "G4/4 F##4/4 | G#4/2 | G4/2 | B4/2",
      "E4/4 C#4/4 | B3/2 | E4/2 | G#4/2",
      "C4/4 A#3/4 | G#3/2 | C4/2 | D#4/2",
      "C3/4 D#3/4 | E3/2 | C3/2 | D#3/2",
    ], "", 4));
  });

  it.each([1440, 1920])("实际句界 %s 切断源与 VI", tick => {
    lacksDeceptiveEvidence(deceptiveDominantReading(diatonic, "", 3, tick));
  });

  it("同拼写非调内小主在句界或实际调号后也不充当同句锚点", () => {
    lacksDeceptiveEvidence(deceptiveDominantReading(chromatic, "", 3, 2400));
    lacksDeceptiveEvidence(deceptiveDominantReading(chromatic, "", 3, 3840));
    lacksDeceptiveEvidence(deceptiveDominantReading(chromatic, "at 3:1 key G# minor"));
  });

  it("已有本调正格解决仍选择原位 G7", () => {
    const region = deceptiveDominantReading([
      "G4/4 B4/4 | C5/2 | G4/2",
      "E4/4 F4/4 | E4/2 | E4/2",
      "C4/4 D4/4 | C4/2 | C4/2",
      "C3/4 G2/4 | C3/2 | C3/2",
    ]);
    expect(region).toMatchObject({ status: "resolved", selected: {
      identity: { root: { step: "G", alter: 0 }, structure: { quality: "dominant7" } },
    } });
    lacksDeceptiveEvidence(region);
  });
});
