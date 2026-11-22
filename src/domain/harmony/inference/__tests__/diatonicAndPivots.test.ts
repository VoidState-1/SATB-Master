import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { inferChords } from "../pipeline";
import { validateProject, PPQ } from "../../../project";
import { applyChordInference } from "..";
import { applyHarmonyInference, checkHarmony, inferHarmony, buildHarmonyAnalysis } from "../..";
import { inferLocalKeys } from "../localKeys";
import { buildChordInferenceObservations } from "../observations";
import { primaryHarmonyInterpretation } from "../../../chordModel";
import { inferPhrases, phraseInferenceFingerprint } from "../../phrase";
import type { ChordInferenceOptions } from "../types";

function ascendingFourthChain(firstSeventh = "D5", secondSoprano = "C5", secondTenor = "E4") {
  return compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
 S: | ${firstSeventh}/2 | ${secondSoprano}/2 | C5/2 |
 A: | G4/2 | G4/2 | F4/2 |
 T: | B3/2 | ${secondTenor}/2 | A3/2 |
 B: | E3/2 | A2/2 | D3/2 |
}`).project;
}

describe("自然音副七和弦的模进推导", () => {
  it("用同声部七音下行辨认 iii7 与 vi7", () => {
    const project = ascendingFourthChain();
    const regions = inferChords(project).regions;
    expect(regions[0].selected).toMatchObject({
      functionalBaseId: "DTIII", identity: { root: { step: "E", alter: 0 }, structure: { quality: "minor7" } },
      evidence: expect.arrayContaining([expect.objectContaining({ code: "diatonic-seventh-sequence" })]),
    });
    expect(regions.find(region => region.fromTick === 2 * project.ppq)?.selected).toMatchObject({
      functionalBaseId: "TSVI", identity: { root: { step: "A", alter: 0 }, structure: { quality: "minor7" } },
    });
  });

  it.each([
    ["D5", "E5", "C4"],
    ["C##5", "C5", "E4"],
  ])("%s→%s 缺少规范拼写或同声部下行解决", (firstSeventh, secondSoprano, secondTenor) => {
    const regions = inferChords(ascendingFourthChain(firstSeventh, secondSoprano, secondTenor)).regions;
    expect([regions[0].selected, ...regions[0].alternatives].some(candidate =>
      candidate?.evidence.some(evidence => evidence.code === "diatonic-seventh-sequence"),
    )).toBe(false);
  });

  it("两个相邻转位之间的单声部和弦内换音仍可确认七和弦", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..2 {
 S: | E4/4 A4/4 | G4/2 |
 A: | C4/2 | E4/2 |
 T: | A3/2 | C4/2 |
 B: | G3/2 | A3/2 |
}`).project;
    const regions = inferChords(project).regions;
    expect(regions[0].selected?.identity).toMatchObject({ root: { step: "A" }, bass: { step: "G" }, structure: { quality: "minor7" } });
    expect(regions.find(region => region.fromTick === 2 * project.ppq)?.selected?.identity)
      .toMatchObject({ root: { step: "A" }, bass: { step: "A" }, structure: { quality: "minor7" } });
  });

  it("自然小调主七和弦使用自然 VII 而非升导音", () => {
    const project = compileScoreText(`satb 1
key G minor
meter 2/4
bars 1..2 {
 S: | F4/2 | Eb4/2 |
 A: | D4/2 | G4/2 |
 T: | Bb3/2 | C4/2 |
 B: | G2/2 | C3/2 |
}`).project;
    expect(inferChords(project).regions[0].selected).toMatchObject({
      functionalBaseId: "t", identity: { structure: { quality: "minor7" } },
    });
  });

  it("属七共用音重奏后识别主大七，随后回到主三和弦", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
 S: | B4/2 | B4/2 | C5/2 |
 A: | F4/2 | E4/2 | E4/2 |
 T: | D4/2 | C4/2 | G3/2 |
 B: | G2/2 | G3/2 | C3/2 |
}`).project;
    expect(inferChords(project).regions.find(region => region.fromTick === 2 * project.ppq)?.selected)
      .toMatchObject({ functionalBaseId: "T", identity: { structure: { quality: "major7" } } });
  });
});

const shape = {
  root: { step: "A", alter: -1 },
  bass: { step: "G", alter: 0 },
  structure: { kind: "tertian", quality: "major7" },
};

function descendingBass(middle = "G3", landing = "F3", soprano = "C5/2") {
  return compileScoreText(`satb 1
key Ab major
meter 3/4
bars 1..1 {
  S: | ${soprano} Ab4/4 |
  A: | Ab4/2 F4/4 |
  T: | Eb4/2 C4/4 |
  B: | Ab3/4 ${middle}/4 ${landing}/4 |
}`).project;
}

function hasPassingSeventh(result: ReturnType<typeof inferChords>, tick: number) {
  const middle = result.regions.find(region => region.fromTick <= tick && tick < region.toTick);
  return [middle?.selected, ...middle?.alternatives ?? []].some(candidate =>
    candidate?.evidence.some(evidence => evidence.code === "passing-tonic-seventh"),
  );
}

describe("主三和弦经过七音的低音转位", () => {
  it("低音从降 A 经 G 下行至 F 时写入第三转位", () => {
    const project = descendingBass();
    const result = inferChords(project, { minConfidence: "high" });
    const middle = result.regions.find(region => region.fromTick === project.ppq);
    expect(middle).toMatchObject({
      toTick: 2 * project.ppq,
      status: "resolved",
      selected: {
        functionalBaseId: "T",
        identity: shape,
        fit: { nonChordToneNoteIds: [], omittedChordDegrees: [], spellingConsistent: true },
      },
    });
    expect(hasPassingSeventh(result, project.ppq)).toBe(true);

    const application = applyChordInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(validateProject(JSON.parse(JSON.stringify(application.project)))).toBe(true);
    expect(application.project.chordTrack.regions.find(region => region.startTick === project.ppq))
      .toMatchObject({ identity: shape, durationTicks: project.ppq });
    expect(application.writtenNonChordToneRoleCount).toBe(0);
  });

  it.each([
    ["停在 G", "G3", "G3", "C5/2"],
    ["回到降 A", "G3", "Ab3", "C5/2"],
    ["等音写成重升 F", "F##3", "F3", "C5/2"],
    ["上声部换八度", "G3", "F3", "C5/4 C6/4"],
  ])("%s 不产生该经过七和弦候选", (_control, middle, landing, soprano) => {
    const project = descendingBass(middle, landing, soprano);
    expect(hasPassingSeventh(inferChords(project), project.ppq)).toBe(false);
  });

  it("上声部加倍根音而缺五音时保留原判", () => {
    const project = descendingBass();
    const tenor = project.satbTracks.find(track => track.voice === "tenor")!;
    tenor.notes[0].pitch = { step: "A", alter: -1, octave: 3 };
    expect(hasPassingSeventh(inferChords(project), project.ppq)).toBe(false);
  });

  it("不跨实际到达处已标的乐句边界或独立调号事件", () => {
    const project = descendingBass();
    const tick = 2 * project.ppq;
    project.structure.phraseBoundaries = [{ id: "phrase-cut", tick, source: "manual", confidence: "certain" }];
    expect(hasPassingSeventh(inferChords(project), project.ppq)).toBe(false);
    project.structure.phraseBoundaries = [];
    project.keyEvents.push({ ...project.keyEvents[0], id: "new-signature", tick, mode: "minor" });
    expect(hasPassingSeventh(inferChords(project), project.ppq)).toBe(false);
  });
});

const minor = `satb 1
key D minor
meter 4/4
bars 1..1 {
 S: | F5/4 D#5/4 E5/4 F5/4 |
 A: | A4/4 B4/4 B4/4 A4/4 |
 T: | D4/4 F#4/4 E4/4 D4/4 |
 B: | D3/4 A2/4 G2/4 D3/4 |
}`;
const supertonicResolutionCode = "written-supertonic-resolution";
type Setup = (p: ReturnType<typeof compileScoreText>["project"]) => void;

function inferSupertonicResolution(text: string, setup?: Setup, options: Parameters<typeof inferChords>[1] = {}) {
  const { project } = compileScoreText(text);
  setup?.(project);
  const inference = inferChords(project, options);
  const applied = applyHarmonyInference(project, { chordInference: inference },
    { mode: "replace-unlocked", writeNonChordToneRoles: true });
  const at = (beat: number) => applied.project.chordTrack.regions.find(r =>
    r.startTick <= beat * project.ppq && beat * project.ppq < r.startTick + r.durationTicks);
  const proven = inference.regions.filter(r => r.selected?.evidence.some(e => e.code === supertonicResolutionCode));
  return { project, applied, inference, at, proven };
}

describe("complete third-inversion secondary dominant resolving to a chromatic supertonic triad", () => {
  it("writes the two actual identities and no home SII function on the minor goal", () => {
    const { at, applied, project, proven } = inferSupertonicResolution(minor);
    expect(proven).toHaveLength(2);
    expect(at(1)).toMatchObject({ identity: { root: { step: "B", alter: 0 }, bass: { step: "A", alter: 0 },
      structure: { quality: "dominant7" } }, semantics: { interpretations: [{ degree: 6, degreeAlteration: 1 }] } });
    expect(at(1)?.semantics?.interpretations[0].designation).toBeUndefined();
    expect(at(2)?.identity).toMatchObject({ root: { step: "E", alter: 0 }, bass: { step: "G", alter: 0 },
      structure: { quality: "minor" } });
    expect(at(2)?.semantics).toBeUndefined();
    expect(applied.project.keyEvents).toEqual(project.keyEvents);
    expect(applied.project.satbTracks).toEqual(project.satbTracks);
    expect(checkHarmony(applied.project).diagnostics.some(d =>
      d.tick === 2 * project.ppq && d.ruleId === "chord.first-inversion-doubling")).toBe(false);
  });

  it("preserves the major goal's existing double-dominant interpretation", () => {
    const { at, proven } = inferSupertonicResolution(minor.replace("G2/4", "G#2/4"));
    expect(proven).toHaveLength(1);
    expect(at(1)?.identity.structure).toMatchObject({ quality: "dominant7" });
    expect(at(2)?.semantics?.interpretations[0]).toMatchObject({ appliedTarget: { degree: 5 } });
    expect(at(2)?.identity).toMatchObject({ root: { step: "E" }, bass: { step: "G", alter: 1 },
      structure: { quality: "major" } });
  });

  it("retains existing absolute fallback behavior outside the proven pair and respects confidence", () => {
    expect(inferSupertonicResolution(minor, undefined, { allowAbsoluteFallback: true }).proven).toHaveLength(2);
    expect(inferSupertonicResolution(minor, undefined, { minConfidence: "high" }).proven).toHaveLength(0);
  });

  it("uses the full score as evidence for a selection inside the arrival", () => {
    const { project } = compileScoreText(minor);
    const range = { fromTick: 2.25 * project.ppq, toTick: 2.75 * project.ppq };
    const { inference } = inferSupertonicResolution(minor, undefined, range);
    expect(inference.regions).toMatchObject([{ ...range, status: "resolved",
      selected: { identity: { root: { step: "E" }, structure: { quality: "minor" } } } }]);
  });

  it.each([
    ["leading tone in the wrong octave", minor.replace("E5/4", "E6/4")],
    ["fifth in the wrong octave", minor.replace("F#4/4 E4/4", "F#4/4 E3/4")],
    ["seventh in the wrong octave", minor.replace("G2/4", "G3/4")],
    ["common tone transferred an octave", minor.replace("B4/4 B4/4", "B4/4 B3/4")],
    ["voices exchange the common tone and tonic", minor.replace("B4/4 B4/4", "B4/4 E4/4")
      .replace("F#4/4 E4/4", "F#4/4 B4/4")],
    ["enharmonic leading tone", minor.replace("D#5/4", "Eb5/4")],
    ["enharmonic third of the goal", minor.replace("G2/4", "F##2/4")],
    ["seventh absent", minor.replace("A2/4", "B2/4")],
    ["diminished goal", minor.replace("B4/4 B4/4", "B4/4 Bb4/4")],
    ["silence between endpoints", minor.replace("D#5/4", "D#5/8 r/8")],
    ["bass is above another voice", minor.replace("A2/4 G2/4", "A4/4 G4/4")],
    ["remote goal", minor.replace("D minor", "G minor")],
    ["major home key", minor.replace("D minor", "D major")],
  ])("does not infer the exceptional connection with %s", (_reason, text) => {
    expect(inferSupertonicResolution(text).proven).toHaveLength(0);
  });

  it("respects manual phrase and printed-key boundaries even with the same notes", () => {
    expect(inferSupertonicResolution(minor, p => p.structure.phraseBoundaries.push({
      id: "break", tick: 2 * p.ppq, source: "manual", confidence: "certain",
    })).proven).toHaveLength(0);
    expect(inferSupertonicResolution(minor, p => p.keyEvents.push({
      ...p.keyEvents[0], id: "new-key", tick: 2 * p.ppq, tonic: { step: "A", alter: 0 },
    })).proven).toHaveLength(0);
  });

  it.each([1, 2])("respects an explicit nonchord role on either end, beat %i", beat => {
    expect(inferSupertonicResolution(minor, p => {
      const note = p.satbTracks[0].notes.find(n => n.startTick === beat * p.ppq)!;
      note.nonChordToneRole = "passing";
    }).proven).toHaveLength(0);
  });

  it("retains the written cross-relation immediately before the pair", () => {
    const { applied, project } = inferSupertonicResolution(minor);
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "voice-leading.cross-relation-successive", tick: project.ppq,
      voiceIds: ["bass", "soprano"],
    }));
  });

  it("retains a real unresolved soprano leading tone in the ordinary dominant", () => {
    const bad = minor.replace("D minor", "E minor").replace("D#5/4 E5/4", "D#5/4 B4/4");
    const { applied, project, proven } = inferSupertonicResolution(bad);
    expect(proven).toHaveLength(0);
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "resolution.leading-tone", tick: 2 * project.ppq, voiceIds: ["soprano"],
    }));
  });

  it("leaves ordinary D2 in its key and still reports an unresolved seventh", () => {
    const bad = minor.replace("D minor", "E minor").replace("G2/4", "E3/4")
      .replace("F#4/4 E4/4", "F#4/4 G4/4");
    const { applied, at, proven } = inferSupertonicResolution(bad);
    expect(proven).toHaveLength(0);
    expect(at(1)?.identity.structure).toMatchObject({ quality: "dominant7" });
    expect(checkHarmony(applied.project).diagnostics.some(d => d.ruleId === "resolution.chord-seventh" && d.tick === 1920 &&
      d.voiceIds.includes("bass"))).toBe(true);
  });
});

const home = "Ab4 F4 C4 F3";
const d2 = "C#5 A4 E4 G3";
const six = "D5 A4 D4 F#3";
const passing = "E5 A4 C#4 E3";
const root = "F#5 A4 D4 D3";
const fourThree = "G5 C#5 A4 E3";
const close = "F#5 D5 A4 D3";
const iiSix = "B4 G4 E4 G3";
const route = [home, d2, six, passing, root, home, home, home];
const repeated = [home, d2, six, fourThree, close, iiSix, d2, six, home, home, home, home];

function thirdInversionAnchorsScore(chords: string[], key = "F minor") {
  const tracks = ["S", "A", "T", "B"].map((voice, part) => {
    const notes = chords.map(c => c.split(" ")[part] + "/4");
    const bars = Array.from({ length: chords.length / 4 }, (_, i) => notes.slice(i * 4, i * 4 + 4).join(" "));
    return voice + ": | " + bars.join(" | ") + " |";
  });
  return compileScoreText(`satb 1\nkey ${key}\nmeter 4/4\nbars 1..${chords.length / 4} {\n${tracks.join("\n")}\n}`).project;
}

type ThirdInversionAnchorsProject = ReturnType<typeof thirdInversionAnchorsScore>;
function analyzeThirdInversionAnchor(chords: string[], options: Parameters<typeof inferHarmony>[1] = {}, setup?: (p: ThirdInversionAnchorsProject) => void, key?: string) {
  const p = thirdInversionAnchorsScore(chords, key);
  setup?.(p);
  const { chordInference: r } = inferHarmony(p, options);
  const applied = applyHarmonyInference(p, { chordInference: r }, { mode: "fill-gaps", writeNonChordToneRoles: true });
  const at = (beat: number) => applied.project.chordTrack.regions.find(c =>
    c.startTick <= beat * p.ppq && beat * p.ppq < c.startTick + c.durationTicks);
  const region = (beat: number) => r.regions.find(c => c.fromTick <= beat * p.ppq && beat * p.ppq < c.toTick);
  const proof = (beat: number) => region(beat)?.selected?.evidence.find(e => e.code === "written-third-inversion-return")?.details;
  return { p, r, applied, at, region, proof };
}

function change(chords: string[], beat: number, voicing: string) {
  return chords.map((c, i) => i === beat ? voicing : c);
}

describe("written third-inversion resolutions supported by another dominant inversion", () => {
  it.each([
    [route, "major", 1], [route.map(c => c.replaceAll("F#","F")), "minor", 0],
  ] as const)("recovers an independent passing return in either mode", (music, mode, alter) => {
    const { p, applied, at, proof } = analyzeThirdInversionAnchor([...music]);
    expect(proof(1)).toMatchObject({ role: "D2", anchor: "passing-six-four", rootTonicTick: 4 * p.ppq, mode });
    expect(at(1)?.identity).toMatchObject({ root: { step: "A", alter: 0 }, bass: { step: "G", alter: 0 },
      structure: { quality: "dominant7" } });
    expect(at(2)?.identity).toMatchObject({ root: { step: "D", alter: 0 }, bass: { step: "F", alter },
      structure: { quality: mode } });
    expect(at(1)?.semantics?.interpretations[0].localKey).toBeUndefined();
    expect(at(2)?.semantics?.interpretations[0].localKey).toBeUndefined();
    expect(at(2)?.semantics?.interpretations[0].designation).toBeUndefined();
    expect(proof(3)).toBeUndefined();
    expect(applied.project.keyEvents).toEqual(p.keyEvents);
    expect(applied.project.satbTracks).toEqual(p.satbTracks);
  });

  it("uses a metrical root arrival and a following ii6 as independent witnesses on either side", () => {
    const { p, at, proof, applied } = analyzeThirdInversionAnchor(repeated);
    for (const [beat, role] of [[1,"D2"],[2,"T6"],[3,"D43"],[4,"T"],[6,"D2"],[7,"T6"]] as const)
      expect(proof(beat)).toMatchObject({ role, rootTonicTick: 4 * p.ppq, tonicStep: "D", mode: "major" });
    expect(proof(1)?.anchor).toBe("root-position-close");
    expect(proof(6)?.anchor).toBe("preceding-close-and-ii6");
    expect(at(4)?.identity.bass).toEqual({ step: "D", alter: 0 });
    expect(applied.project.chordTrack.regions.every(c => !c.semantics?.interpretations[0].localKey)).toBe(true);
    expect(checkHarmony(applied.project).diagnostics.some(d => d.ruleId === "tonality.unmarked-key-change")).toBe(false);
  });

  it("does not promote a lone remote V2–I6 or its verbatim repeat", () => {
    const { at, proof } = analyzeThirdInversionAnchor([home,d2,six,home,home,d2,six,home]);
    expect(at(1)).toBeUndefined();
    expect(proof(2)).toBeUndefined();
    expect(at(5)).toBeUndefined();
  });

  it("preserves explicit selection of low-confidence absolute fallbacks", () => {
    const { p, r, at, region } = analyzeThirdInversionAnchor([home,d2,six,home,home,d2,six,home], { allowAbsoluteFallback: true });
    const suggestion = region(1)!;
    expect(suggestion.status).toBe("ambiguous");
    expect(at(1)).toBeUndefined();
    const manual = applyHarmonyInference(p, { chordInference: r }, { mode: "fill-gaps", selection: new Set([suggestion.id]) });
    expect(manual.project.chordTrack.regions.map(c => c.identity)).toEqual([suggestion.selected!.identity]);
  });

  it.each([
    ["wrong initial octave", change(route, 2, "D6 A4 D4 F#3")],
    ["enharmonic initial third", change(route, 1, "Db5 A4 E4 G3")],
    ["exchanged anchor voices", change(route, 3, "C#5 A4 E4 E3")],
    ["anchor bass octave leap", change(route, 4, "F#5 A4 D4 D2")],
    ["missing final third", change(route, 4, "D5 A4 D4 D3")],
    ["rest on corroboration", change(route, 3, "r A4 C#4 E3")],
    ["wrong 4/3 seventh resolution", change(repeated, 4, "F#6 D5 A4 D3")],
    ["mixed final modes", change(route, 4, "F5 A4 D4 D3")],
  ])("withholds the new reading for %s", (_name, music) => {
    expect(analyzeThirdInversionAnchor(music).proof(1)).toBeUndefined();
  });

  it("keeps the forward reading when the returning predominant is absent", () => {
    const { proof } = analyzeThirdInversionAnchor(change(repeated, 5, home));
    expect(proof(1)).toBeDefined();
    expect(proof(6)).toBeUndefined();
  });

  it.each([2,3,4])("respects a phrase boundary at %i inside the corroboration", beat => {
    const { proof } = analyzeThirdInversionAnchor(route, {}, p => p.structure.phraseBoundaries.push({
      id: "boundary", tick: beat * p.ppq, source: "manual", confidence: "certain",
    }));
    expect(proof(1)).toBeUndefined();
  });

  it("respects a written key event and an explicit nonchord note on the anchor", () => {
    expect(analyzeThirdInversionAnchor(route, {}, p => p.keyEvents.push({ ...p.keyEvents[0], id: "other", tick: 3 * p.ppq })).proof(1)).toBeUndefined();
    expect(analyzeThirdInversionAnchor(route, {}, p => { p.satbTracks[0].notes[3].nonChordToneRole = "neighbor"; }).proof(1)).toBeUndefined();
  });

  it("checks the full context when applying a clipped selection, preserving high confidence", () => {
    expect(analyzeThirdInversionAnchor(route, { fromTick: 1440, toTick: 1920, minConfidence: "medium" }).r.regions).toMatchObject([
      { fromTick: 1440, toTick: 1920, status: "resolved", selected: { confidence: "medium" } },
    ]);
    expect(analyzeThirdInversionAnchor(route, { minConfidence: "high", allowAbsoluteFallback: true }).proof(1)).toBeUndefined();
  });

  it("honors a locked contradictory chord at application without treating it as note evidence", () => {
    const { p, r, at } = analyzeThirdInversionAnchor(route);
    const manual = { ...at(0)!, id: "held-label", startTick: p.ppq, durationTicks: p.ppq, locked: true };
    p.chordTrack.regions.push(manual);
    const incoming = inferHarmony(p);
    expect(incoming.chordInference.regions).toEqual(r.regions);
    for (const mode of ["fill-gaps", "replace-unlocked"] as const) {
      const applied = applyHarmonyInference(p, incoming, { mode });
      expect(applied.project.chordTrack.regions.find(c => c.startTick === p.ppq)).toEqual(manual);
    }
  });

  it("requires complete, properly spelled voices even with both legacy switches enabled", () => {
    for (const allowAbsoluteFallback of [true, false]) {
      for (const allowIncompleteVoicing of [true, false]) {
        const options = { allowAbsoluteFallback, allowIncompleteVoicing, allowNonChordToneCandidates: true };
        expect(analyzeThirdInversionAnchor(change(route, 3, "E5 A4 Db4 E3"), options).proof(1)).toBeUndefined();
      }
    }
    expect(analyzeThirdInversionAnchor(route, { allowAbsoluteFallback: true, minConfidence: "medium" }).proof(1)).toBeDefined();
  });

  it("a strong beat under a six-four cannot identify the weak passing chord", () => {
    const moved = [home,home,d2,six,passing,root,home,home];
    expect(analyzeThirdInversionAnchor(moved).proof(2)).toBeUndefined();
  });

  it("leaves independent cadential key inference in control at a real phrase end", () => {
    const { at, proof } = analyzeThirdInversionAnchor(repeated.slice(0, 8));
    expect(proof(1)).toBeUndefined();
    expect(at(7)?.semantics?.interpretations[0].localKey).toEqual({ tonic: { step: "D", alter: 0 }, mode: "major" });
  });

  it("still reports the cross-relation in the next harmony", () => {
    const { p, applied } = analyzeThirdInversionAnchor(change(repeated, 8, "F5 C5 Db4 F3"));
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "voice-leading.cross-relation-successive", tick: 8 * p.ppq,
      noteIds: expect.arrayContaining(["note-S-6720", "note-T-7680"]),
    }));
  });

  it("keeps bass doubling in a real home SII6 and reports doubled root there", () => {
    const scores = ["F5 A4 D4 F3","D5 A4 D4 F3"];
    for (const [i,c] of scores.entries()) {
      const { p, applied, at } = analyzeThirdInversionAnchor(["E5 G4 C4 C3",c,"D5 G4 B3 G3","E5 G4 C4 C3",home,home,home,home], {}, undefined, "C major");
      expect(at(1)?.semantics?.interpretations[0].degree).toBe(2);
      expect(checkHarmony(applied.project).diagnostics.some(d => d.tick === p.ppq &&
        d.ruleId === "chord.first-inversion-doubling")).toBe(i === 1);
    }
  });
});

const evidenceCode = "written-leading-seventh-into-confirmed-key";

function leadingSeventhIntoConfirmedKeyProjectFor(leading = "A#4", altoArrival = "B4", tenorArrival = "F#4", firstSurfaceNote = "F#5") {
  return compileScoreText(`satb 1
key Ab major
meter 4/4
bars 1..4 {
  S: | Ab5/2 Eb5/4 G5/4 | r/4 ${firstSurfaceNote}/8 E5/8 D5/4 B5/4 | F#5/2 A#5/4 F#5/4 | B5/2 F#5/2 |
  A: | C5/2. ${leading}/4 | ${altoArrival}/1 | A#4/2 C#5/4 A#4/4 | B4/1 |
  T: | Eb4/2. C#4/4 | ${tenorArrival}/1 | C#4/2 F#4/2 | F#4/1 |
  B: | Ab2/2. E3/4 | D3/1 | F#3/2 E3/2 | D3/1 |
}`).project;
}

function inferConfirmedKeyLeadingSeventh(project: ReturnType<typeof leadingSeventhIntoConfirmedKeyProjectFor>) {
  const pivotTick = 3 * project.ppq;
  const arrivalTick = 4 * project.ppq;
  const inferred = inferHarmony(project);
  const pivot = inferred.chordInference.regions.find(region => region.fromTick === pivotTick);
  const written = applyHarmonyInference(project, inferred, { mode: "fill-gaps", writeNonChordToneRoles: true });
  const accepted = pivot?.selected?.evidence.some(item => item.code === evidenceCode) === true;
  return { pivot, written, accepted, pivotTick, arrivalTick };
}

describe("完整实写导减七直接进入已确认新调", () => {
  it("低三声部在女高休止时写全 b 小调 t6，后续属主确认 A♯°7/E", () => {
    const { pivot, written, accepted, pivotTick, arrivalTick } = inferConfirmedKeyLeadingSeventh(leadingSeventhIntoConfirmedKeyProjectFor());
    expect(accepted).toBe(true);
    expect(pivot).toMatchObject({
      status: "resolved",
      selected: {
        identity: {
          root: { step: "A", alter: 1 },
          bass: { step: "E", alter: 0 },
          structure: { kind: "tertian", quality: "diminished7" },
        },
        semantics: {
          interpretations: [expect.objectContaining({
            localKey: { tonic: { step: "B", alter: 0 }, mode: "minor" },
          })],
        },
      },
    });
    expect(written.project.chordTrack.regions.find(region => region.startTick === pivotTick)?.identity.root)
      .toEqual({ step: "A", alter: 1 });
    const focus = new Set(["chord.incomplete-members", "chord.unclassified-nonchord-tone", "resolution.leading-tone"]);
    expect(checkHarmony(written.project).diagnostics.filter(item =>
      (item.tick === pivotTick || item.tick === arrivalTick) && focus.has(item.ruleId),
    )).toEqual([]);
  });

  it.each([
    ["等音写成 B♭", "Bb4", "B4", "F#4"],
    ["导音跳至属音", "A#4", "F#5", "B4"],
  ])("%s 时不回溯后调导减七", (_label, leading, alto, tenor) => {
    expect(inferConfirmedKeyLeadingSeventh(leadingSeventhIntoConfirmedKeyProjectFor(leading, alto, tenor)).accepted).toBe(false);
  });

  it("女低在落点休止，导音在女高解决时也能核对新调主和弦", () => {
    const { project } = compileScoreText(`satb 1
key Ab major
meter 4/4
bars 1..4 {
 S: | C5/2. A#4/4 | B4/1 | F#5/2 A#5/4 F#5/4 | B5/2 F#5/2 |
 A: | Ab4/2 Eb4/4 G4/4 | r/4 F#4/8 E4/8 D4/4 B4/4 | A#4/2 C#5/4 A#4/4 | B4/1 |
 T: | Eb4/2. C#4/4 | F#4/1 | C#4/2 F#4/2 | F#4/1 |
 B: | Ab2/2. E3/4 | D3/1 | F#3/2 E3/2 | D3/1 |
}`);
    expect(inferConfirmedKeyLeadingSeventh(project).accepted).toBe(true);
  });

  it("目的小三和弦缺少后调属主证据时不回溯", () => {
    const project = leadingSeventhIntoConfirmedKeyProjectFor();
    project.lengthTicks = 8 * project.ppq;
    for (const track of project.satbTracks) {
      track.notes = track.notes.filter(note => note.startTick < project.lengthTicks);
    }
    expect(inferConfirmedKeyLeadingSeventh(project).accepted).toBe(false);
  });

  it("人工句界阻断后调属主的回溯", () => {
    const project = leadingSeventhIntoConfirmedKeyProjectFor();
    project.structure.phraseBoundaries = [{
      id: "phrase-cut", tick: 4 * project.ppq, source: "manual", confidence: "certain",
    }];
    expect(inferConfirmedKeyLeadingSeventh(project).accepted).toBe(false);
  });

  it("降 A 大调中途改为 E 大调再返回，原调相同也不跨两个调号事件", () => {
    const project = leadingSeventhIntoConfirmedKeyProjectFor();
    const initial = project.keyEvents[0];
    project.keyEvents.push(
      { ...initial, id: "changed-signature", tonic: { step: "E", alter: 0 }, tick: 5 * project.ppq },
      { ...initial, id: "restored-signature", tick: 6 * project.ppq },
    );
    const proof = inferLocalKeys(buildChordInferenceObservations(project), new Set([project.lengthTicks]));
    expect([...proof.values()].some(({ key }) =>
      key.tonic.step === "B" && key.tonic.alter === 0 && key.mode === "minor",
    )).toBe(true);
    expect(inferConfirmedKeyLeadingSeventh(project).accepted).toBe(false);
  });

  it("到达后的女高和弦音低过持续的实际低音 D3 时拒绝回溯", () => {
    const project = leadingSeventhIntoConfirmedKeyProjectFor("A#4", "B4", "F#4", "B2");
    const { accepted, written, arrivalTick } = inferConfirmedKeyLeadingSeventh(project);
    expect(accepted).toBe(false);
    expect(checkHarmony(written.project).diagnostics.some(item =>
      item.tick === arrivalTick + project.ppq && item.ruleId === "voice.crossing",
    )).toBe(true);
  });
});

const toD = `satb 1
key C minor
meter 3/4
bars 1..3 {
  S: | Eb5/2 Db5/4 | C#5/4 C#5/2 | D5/2. |
  A: | G4/2 G4/4 | G4/4 G4/2 | F#4/2. |
  T: | C4/2 E4/4 | E4/4 E4/2 | A3/2. |
  B: | C3/2 Bb2/4 | Bb2/4 A2/2 | D3/2. |
}`;

const toEb = `satb 1
key G minor
meter 3/4
bars 1..3 {
  S: | Bb4/2 B4/4 | Cb5/4 Bb4/2 | Bb4/2. |
  A: | G4/2 D4/4 | D4/4 D4/2 | Eb4/2. |
  T: | D4/2 F3/4 | F3/4 F3/2 | Eb3/2. |
  B: | G2/2 Ab2/4 | Ab2/4 Ab2/2 | G2/2. |
}`;

const destinationCases = [
  {
    name: "D 大调，七音在低音",
    score: toD,
    tonic: { step: "D", alter: 0 },
    leadingTone: { step: "C", alter: 1 },
    bass: { step: "B", alter: -1 },
    sameSpelling: toD.replace("Db5/4", "C#5/4"),
    naturalSeventh: toD.replace("Bb2/4 A2/2", "B2/4 A2/2"),
    exchangedDominant: toD.replace("Bb2/4 A2/2", "Bb2/4 E2/2").replace("E4/4 E4/2", "E4/4 A3/2"),
  },
  {
    name: "降 E 大调，七音在女高音",
    score: toEb,
    tonic: { step: "E", alter: -1 },
    leadingTone: { step: "D", alter: 0 },
    bass: { step: "A", alter: -1 },
    sameSpelling: toEb.replace("B4/4", "Cb5/4"),
    naturalSeventh: toEb.replace("Cb5/4", "C5/4"),
    exchangedDominant: toEb.replace("Cb5/4 Bb4/2", "Cb5/4 F4/2").replace("F3/4 F3/2", "F3/4 Bb3/2"),
  },
];

function progression(score: string) {
  const { project } = compileScoreText(score);
  const { regions } = inferChords(project);
  const [pivot, dominant, tonic] = [3, 4, 6].map(beat =>
    regions.find(region => region.fromTick <= beat * project.ppq && beat * project.ppq < region.toTick),
  );
  expect(dominant?.selected).toMatchObject({
    functionalBaseId: "D", identity: { structure: { quality: "dominant7" } },
  });
  expect(tonic?.selected).toMatchObject({
    functionalBaseId: "T", identity: { structure: { quality: "major" } },
  });
  return pivot!;
}

describe.each(destinationCases)("等音改写后的减导七和弦（$name）", fixture => {
  it("按实写根音和低音识别减导七，确认减七经属七解决到主和弦", () => {
    expect(progression(fixture.score)).toMatchObject({
      status: "resolved",
      selected: {
        functionalBaseId: "DVII",
        confidence: "high",
        identity: {
          root: fixture.leadingTone, bass: fixture.bass, structure: { quality: "diminished7" },
        },
        semantics: { interpretations: [{ localKey: { tonic: fixture.tonic, mode: "major" } }] },
        evidence: expect.arrayContaining([
          expect.objectContaining({ code: "written-pivot-leading-seventh" }),
        ]),
      },
    });
  });

  it("自然六级构成半减导七", () => {
    expect(progression(fixture.naturalSeventh).selected).toMatchObject({
      functionalBaseId: "DVII", identity: { structure: { quality: "halfDiminished7" } },
    });
  });

  it.each([
    ["前一片采用相同拼写", fixture.sameSpelling],
    ["属七保持原音级集合但七音未在原声部下行", fixture.exchangedDominant],
  ])("%s 时不生成等音改写候选", (_description, score) => {
    const { selected, alternatives } = progression(score);
    expect([selected, ...alternatives].some(candidate =>
      candidate?.evidence.some(evidence => evidence.code === "written-pivot-leading-seventh"),
    )).toBe(false);
  });
});

it("允许缺音和和弦外音时，局部首选与全谱一致，减七与半减七使用不同 ID", () => {
  const score = toEb
    .replace("key G minor", "key C minor")
    .replace("Bb4/2 B4/4", "C5/2 B4/4")
    .replace("G4/2 D4/4", "Eb4/2 D4/4")
    .replace("D4/2 F3/4", "G3/2 F3/4")
    .replace("G2/2 Ab2/4", "C3/2 Ab2/4");
  const { project } = compileScoreText(score);
  const options = { allowIncompleteVoicing: true, allowNonChordToneCandidates: true };
  const fromTick = 3.5 * project.ppq;
  const toTick = 4 * project.ppq;
  const fullRegion = inferChords(project, options).regions.find(region =>
    region.fromTick <= fromTick && fromTick < region.toTick,
  );
  expect(fullRegion?.selected).toBeDefined();
  const { regions } = inferChords(project, { ...options, fromTick, toTick });
  expect(regions).toHaveLength(1);
  const [region] = regions;
  expect(region).toMatchObject({
    fromTick, toTick, observationIndices: [0],
    selected: {
      observationIndex: 0, id: fullRegion?.selected?.id, identity: fullRegion?.selected?.identity,
    },
  });
  const leadingSevenths = [region.selected, ...region.alternatives].filter(candidate =>
    candidate?.functionalBaseId === "DVII" && candidate.identity.structure.kind === "tertian" &&
    (candidate.identity.structure.quality === "diminished7" ||
      candidate.identity.structure.quality === "halfDiminished7"),
  );
  expect(leadingSevenths.map(candidate => candidate?.identity.structure)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ quality: "diminished7" }),
      expect.objectContaining({ quality: "halfDiminished7" }),
    ]),
  );
  expect(new Set(leadingSevenths.map(candidate => candidate?.id)).size).toBe(leadingSevenths.length);
});

const neapolitanPivotDominantsCode = "dominant-to-neapolitan-pivot";
const rootPivot = [
  "D5/4 D5/4 | D5/4 E#5/4 | F#5/2",
  "A4/4 C5/4 | B4/4 B4/4 | A4/2",
  "F4/4 F#4/4 | G4/4 G#4/4 | C#4/2",
  "D3/4 A3/4 | G3/4 C#3/4 | F#2/2",
];
const sixthPivot = [
  "D5/4 F#5/4 | G5/4 E#5/4 | F#5/2",
  "A4/4 D5/4 | D5/4 B4/4 | A4/2",
  "F4/4 A4/4 | G4/4 G#4/4 | C#4/2",
  "D3/4 C3/4 | B2/4 C#3/4 | F#2/2",
];
const articulated = [
  "D5/2 | D5/2~ | D5/4 E#5/4 | F#5/2",
  "A4/2 | C5/2 | B4/4 B4/4 | A4/2",
  "F4/2 | F#4/2 | G4/4 G#4/4 | C#4/2",
  "D3/2 | A3/2 | G3/4 C#3/4 | F#2/2",
];

function edit(changes: Partial<Record<number, string>>) {
  return rootPivot.map((part, index) => changes[index] ?? part);
}

function neapolitanPivotDominantsProjectFor(parts = rootPivot, events = "") {
  const measures = parts[0].split("|").length;
  const voices = parts.map((part, index) => `${"SATB"[index]}: | ${part} |`).join("\n");
  return compileScoreText(`satb 1
key D minor
meter 2/4
${events}
bars 1..${measures} {
${voices}
}`).project;
}

function sourceRegion(project: ReturnType<typeof neapolitanPivotDominantsProjectFor>, beat = 1) {
  const tick = project.ppq * beat;
  return inferChords(project).regions.find(region => region.fromTick <= tick && tick < region.toTick)!;
}

function pivotEvidence(region: ReturnType<typeof sourceRegion>) {
  return [region.selected, ...region.alternatives].flatMap(candidate => candidate?.evidence ?? [])
    .find(item => item.code === neapolitanPivotDominantsCode);
}

describe("经实写转位属七引入后调降 II", () => {
  it.each([[rootPivot, "A"], [sixthPivot, "C"]] as const)(
    "在同句下识别完全解决的属七，保留可回放证据和双解", (parts, bass) => {
      const project = neapolitanPivotDominantsProjectFor(parts);
      const source = sourceRegion(project);
      expect(source.selected?.identity).toMatchObject({
        root: { step: "D", alter: 0 }, bass: { step: bass, alter: 0 }, structure: { quality: "dominant7" },
      });
      const semantics = source.selected!.semantics!;
      expect(primaryHarmonyInterpretation(semantics)).toMatchObject({ appliedTarget: { degree: 4 } });
      expect(primaryHarmonyInterpretation(semantics).localKey).toBeUndefined();
      expect(semantics.alternatives).toMatchObject([{
        localKey: { tonic: { step: "G", alter: 0 }, mode: "major" },
        designation: { kind: "primary", primaryFunction: "dominant" }, confidence: "ambiguous",
      }]);
      expect(pivotEvidence(source)).toMatchObject({
        details: { pivotTick: 1920, destinationDominantTick: 2880, destinationTonicTick: 3840,
          destinationTonicEndTick: 5760 },
        noteIds: expect.arrayContaining(["note-S-2880", "note-S-3840"]),
      });
    },
  );

  it.each([1440, 1920, 2400, 2880, 3840, 4320])(
    "拒绝源到主和弦证据末端之间的人工句界 %i", tick => {
      const project = neapolitanPivotDominantsProjectFor();
      project.structure.phraseBoundaries = [{ id: "cut", source: "manual", confidence: "certain", tick }];
      expect(pivotEvidence(sourceRegion(project))).toBeUndefined();
    },
  );

  it("拒绝本次新推导的句界，保存这条边界后同样拒绝", () => {
    const project = neapolitanPivotDominantsProjectFor(articulated);
    const boundary = inferPhrases(project).boundaries.find(item => item.tick === 3840);
    expect(boundary).toMatchObject({ source: "inferred", confidence: "probable" });
    expect(pivotEvidence(sourceRegion(project, 2))).toBeUndefined();
    project.structure.phraseBoundaries = [boundary!];
    expect(pivotEvidence(sourceRegion(project, 2))).toBeUndefined();
  });

  it("保留当前有效的已保存句界，忽略同位置的失效推导旧界", () => {
    const project = neapolitanPivotDominantsProjectFor();
    expect(inferPhrases(project).boundaries.some(item => item.tick === 2880)).toBe(false);
    const boundary = { id: "cut", source: "inferred", confidence: "probable", tick: 2880,
      inferenceFingerprint: phraseInferenceFingerprint(project) } as const;
    project.structure.phraseBoundaries = [boundary];
    expect(pivotEvidence(sourceRegion(project))).toBeUndefined();
    project.structure.phraseBoundaries = [{ ...boundary, stale: true }];
    expect(pivotEvidence(sourceRegion(project))).toBeDefined();
  });

  it.each([
    ["七音错声部", edit({ 0: "D5/4 D5/4 | B4/4 E#5/4 | F#5/2", 1: "A4/4 C5/4 | D5/4 B4/4 | A4/2" })],
    ["根音跳八度", edit({ 0: "D5/4 D5/4 | D6/4 E#5/4 | F#5/2" })],
    ["五音上行且属三四落六和弦", edit({ 3: "D3/4 A3/4 | B3/4 C#3/4 | F#2/2" })],
    ["属二的五音跳进而落点仍完整", sixthPivot.map((part, index) =>
      index === 2 ? "F4/4 A4/4 | G3/4 G#4/4 | C#4/2" : part)],
    ["实际最低音落到男高轨", edit({ 2: "F4/4 F#3/4 | G3/4 G#4/4 | C#4/2" })],
    ["导音同音异名", edit({ 2: "F4/4 Gb4/4 | G4/4 G#4/4 | C#4/2" })],
    ["根音同音异名", edit({ 0: "D5/4 C##5/4 | D5/4 E#5/4 | F#5/2" })],
    ["源省根", edit({ 0: "D5/4 C5/4 | D5/4 E#5/4 | F#5/2" })],
    ["中隔低音休止", edit({ 3: "D3/4 A3/8 r/8 | G3/4 C#3/4 | F#2/2" })],
    ["后调属导音跳到另一八度的主音", edit({ 0: "D5/4 D5/4 | D5/4 E#5/4 | F#6/2" })],
    ["末尾回 d 小调", [
      "D5/4 D5/4 | D5/4 E5/4 | F5/2", "A4/4 C5/4 | B4/4 C#5/4 | A4/2",
      "F4/4 F#4/4 | G4/4 E4/4 | D4/2", "D3/4 A3/4 | G3/4 A3/4 | D3/2",
    ]],
  ] as const)("拒绝 %s", (_name, parts) => {
    expect(pivotEvidence(sourceRegion(neapolitanPivotDominantsProjectFor([...parts])))).toBeUndefined();
  });

  it("拒绝落点处另写的新调号", () => {
    expect(pivotEvidence(sourceRegion(neapolitanPivotDominantsProjectFor(rootPivot, "at 2:1 key F# minor")))).toBeUndefined();
  });
});

const parts = [
  "G4/4 Ab4/4 G4/4 | C5/2. | Bb4/2 A4/4 | G4/2.",
  "Eb4/4 D4/4 Eb4/4 | Ab4/2. | G4/2 F#4/4 | G4/2.",
  "Bb3/4 F3/4 Bb3/4 | Eb4/2. | D4/2 C4/4 | Bb3/2.",
  "Eb3/4 Bb2/4 Eb3/4 | Ab2/2 C3/4 | D3/2 D3/4 | G2/2.",
];
const neapolitanPivotSixthsCode = "neapolitan-pivot-to-cadential-six-four";
function neapolitanPivotSixthsScore(changes: Partial<Record<number, string>> = {}) {
  return compileScoreText(`satb 1
key Eb major
meter 3/4
bars 1..4 {
${parts.map((part, v) => "SATB"[v] + ": | " + (changes[v] ?? part) + " |").join("\n")}
}`).project;
}
type NeapolitanPivotSixthsProject = ReturnType<typeof neapolitanPivotSixthsScore>;
function inferNeapolitanPivotSixth(project: NeapolitanPivotSixthsProject, options?: ChordInferenceOptions) {
  const inference = inferChords(project, options);
  const at = (beat: number) => inference.regions.find(r => r.fromTick <= project.ppq * beat && project.ppq * beat < r.toTick);
  return { inference, at, hasPivot: inference.regions.some(r => r.selected?.evidence.some(e => e.code === neapolitanPivotSixthsCode)) };
}
const key = { tonic: { step: "G", alter: 0 }, mode: "minor" };

describe("降二级共同和弦进入经证实的终止", () => {
  it("保留降 A 原位进入时的降 E 大调 IV，六和弦离开时在 g 小调承接", () => {
    const project = neapolitanPivotSixthsScore();
    const { inference, at, hasPivot } = inferNeapolitanPivotSixth(project);
    expect(hasPivot).toBe(true);
    expect(at(3)?.selected?.semantics).toMatchObject({
      interpretations: [{ localKey: key, degree: 2, degreeAlteration: -1 }, { degree: 4 }],
    });
    expect(at(3)?.selected?.semantics?.interpretations[1].localKey).toBeUndefined();
    expect(at(5)?.selected?.semantics?.interpretations).toMatchObject([
      { localKey: key, degree: 2, designation: { kind: "neapolitan" } },
    ]);
    expect(at(6)?.selected?.functionalBaseId).toBe("K46");
    expect(at(8)?.selected?.functionalBaseId).toBe("D");
    expect(at(9)?.selected?.functionalBaseId).toBe("t");
    const applied = applyHarmonyInference(project, { chordInference: inference }, { mode: "replace-unlocked", writeNonChordToneRoles: true });
    expect(applied.project.keyEvents).toEqual(project.keyEvents);
    expect(applied.project.satbTracks).toEqual(project.satbTracks);
    expect(checkHarmony(applied.project).diagnostics.some(d => d.ruleId === "tonality.pivot-reinterpretation")).toBe(false);
    const range = { fromTick: project.ppq * 5, toTick: project.ppq * 6 };
    expect(inferNeapolitanPivotSixth(project, range).at(5)?.selected?.semantics).toEqual(at(5)?.selected?.semantics);
  });

  it("同一六和弦仅换一个上声部时，写成连续的双读区域", () => {
    const project = neapolitanPivotSixthsScore({ 0: parts[0].replace("C5/2.", "Eb5/2 C5/4"), 3: parts[3].replace("Ab2/2 C3/4", "C3/2.") });
    const { at } = inferNeapolitanPivotSixth(project);
    expect(at(3)).toBe(at(5));
    expect(at(3)?.selected?.semantics?.interpretations).toMatchObject([{ localKey: key, degree: 2 }, { degree: 4 }]);
  });

  it.each([
    ["旧调属七的七音未按原声部解决", { 0: parts[0].replace("Ab4/4 G4/4", "Ab4/4 Bb4/4") }],
    ["只有新调属三和弦", { 2: parts[2].replace("D4/2 C4/4", "D4/2 D4/4") }],
    ["目的调七音错声部", { 0: parts[0].replace("G4/2.", "Bb4/2."), 2: parts[2].replace("Bb3/2.", "G3/2.") }],
    ["降二级根音在共同和弦中改为同音异名", { 1: parts[1].replace("Ab4/2.", "G#4/2.") }],
    ["属低音换八度", { 3: parts[3].replace("D3/2 D3/4", "D3/2 D2/4") }],
    ["共同和弦的另一声部也重新发音", { 1: parts[1].replace("Ab4/2.", "Ab4/2 Ab4/4") }],
    ["降二级第三音未在原声部下行", { 0: parts[0].replace("Bb4/2", "G4/2"), 1: parts[1].replace("G4/2 F#4", "Bb4/2 F#4") }],
    ["后续回到原调主和弦", { 0: parts[0].replace("G4/2.", "Bb4/2."),
      2: parts[2].replace("Bb3/2.", "Eb4/2."), 3: parts[3].replace("G2/2.", "Eb3/2.") }],
  ] as const)("%s 不引入双重功能", (_reason, edit) => {
    expect(inferNeapolitanPivotSixth(neapolitanPivotSixthsScore(edit)).hasPivot).toBe(false);
  });

  it("短暂到 g 后立即经原属七落回降 E，保留实际短离调", () => {
    const project = neapolitanPivotSixthsScore({
      0: parts[0].replace("G4/2.", "G4/4 Ab4/4 G4/4"),
      1: parts[1].replace("G4/2.", "G4/4 D4/4 Eb4/4"),
      2: parts[2].replace("Bb3/2.", "Bb3/4 F3/4 Bb3/4"),
      3: parts[3].replace("G2/2.", "G2/4 Bb2/4 Eb3/4"),
    });
    const { hasPivot, at } = inferNeapolitanPivotSixth(project);
    expect(hasPivot).toBe(false);
    expect(at(11)?.selected?.functionalBaseId).toBe("T");
    expect(at(11)?.selected?.semantics?.interpretations[0].localKey).toBeUndefined();
  });

  it.each([2, 4, 6, 8, 9])("人工句界切断书写证据链，第 %i 拍", beat => {
    const project = neapolitanPivotSixthsScore();
    project.structure.phraseBoundaries.push({ id: "cut", tick: beat * project.ppq, source: "manual", confidence: "certain" });
    expect(inferNeapolitanPivotSixth(project).hasPivot).toBe(false);
  });

  it("后半另写调号时保留显式调性", () => {
    const project = neapolitanPivotSixthsScore();
    project.keyEvents.push({ ...project.keyEvents[0], id: "printed", tick: 6 * project.ppq, tonic: { step: "G", alter: 0 }, mode: "minor" });
    expect(inferNeapolitanPivotSixth(project).hasPivot).toBe(false);
  });
});

const flatRoute = `satb 1
key C major
meter 2/4
bars 1..5 {
 S: | E5/4 D5/4 | C5/4 Bb4/4 | Eb5/4 Db5/4 | C5/4 Bb4/4 | Ab4/2 |
 A: | G4/4 G4/4 | G4/4 G4/4 | Ab4/4 Bb4/4 | Ab4/4 G4/4 | Eb4/2 |
 T: | C4/4 B3/4 | C4/4 Eb4/4 | Eb4/4 Fb4/4 | Eb4/4 Db4/4 | C4/2 |
 B: | C3/4 F3/4 | Eb3/4 Db3/4 | C3/4 Db3/4 | Eb3/4 Eb2/4 | Ab2/2 |
}`;

const sharpRoute = `satb 1
key A minor
meter 2/4
bars 1..5 {
 S: | C5/4 D5/4 | C#5/4 C#5/4 | B4/4 B4/4 | D5/4 A#4/4 | B4/2 |
 A: | E4/4 E4/4 | E4/4 E4/4 | D4/4 E4/4 | F#4/4 E4/4 | D4/2 |
 T: | A3/4 G#3/4 | A3/4 A#3/4 | B3/4 B3/4 | B3/4 C#4/4 | B3/2 |
 B: | A2/4 B2/4 | A2/4 F#2/4 | G2/4 G2/4 | F#2/4 F#2/4 | B2/2 |
}`;

function analyzeParallelTonicPivot(text: string, prepare?: (p: ReturnType<typeof compileScoreText>["project"]) => void) {
  const p = compileScoreText(text).project;
  prepare?.(p);
  const result = inferChords(p);
  const written = applyHarmonyInference(p, { chordInference: result },
    { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
  const at = (beat: number) => written.chordTrack.regions.find(r =>
    r.startTick <= beat * p.ppq && beat * p.ppq < r.startTick + r.durationTicks);
  const meaning = (beat: number) => at(beat)?.semantics?.interpretations[0];
  return { p, written, meaning, at };
}

describe("parallel tonic as a common chord with a cadentially confirmed destination", () => {
  it.each([
    [flatRoute, "C", "minor", "A", -1, "major"],
    [sharpRoute, "A", "major", "B", 0, "minor"],
  ] as const)("recognizes the changed third in the written tonic and preserves the destination cadence", (score, tonic, mode, step, alter, finalMode) => {
    const { p, written, meaning, at } = analyzeParallelTonicPivot(score);
    expect(meaning(0)?.localKey).toBeUndefined();
    expect(meaning(1)?.localKey).toBeUndefined();
    expect(meaning(2)).toMatchObject({ degree: 1, localKey: { tonic: { step: tonic, alter: 0 }, mode } });
    expect(at(2)?.identity.structure).toMatchObject({ kind: "tertian", quality: mode });
    expect(meaning(8)).toMatchObject({ degree: 1, localKey: { tonic: { step, alter }, mode: finalMode } });
    expect(written.keyEvents).toEqual(p.keyEvents);
    expect(buildHarmonyAnalysis(written).cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "full", toTick: p.lengthTicks,
    }));
    expect(checkHarmony(written).diagnostics.some(d => d.tick === 2 * p.ppq &&
      d.ruleId === "resolution.leading-tone")).toBe(false);
    const range = { fromTick: 2.5 * p.ppq, toTick: 3 * p.ppq };
    expect(inferChords(p, range).regions).toMatchObject([{ ...range, selected: {
      identity: at(2)?.identity, semantics: { interpretations: [{ localKey: meaning(2)?.localKey }] },
    } }]);
  });

  it("carries a repeated attack of the same written voicing through the pivot", () => {
    const split = flatRoute.replace("C5/4 Bb4/4", "C5/8 C5/8 Bb4/4");
    const { meaning } = analyzeParallelTonicPivot(split);
    for (const t of [2, 2.5]) expect(meaning(t)?.localKey).toEqual({ tonic: { step: "C", alter: 0 }, mode: "minor" });
  });

  it.each([
    ["the leading tone resolves in the wrong octave", flatRoute.replace("C4/4 Eb4/4", "C5/4 Eb4/4")],
    ["the seventh resolves in the wrong octave", flatRoute.replace("Eb3/4 Db3/4", "Eb2/4 Db3/4")],
    ["the home dominant is merely a triad", flatRoute.replace("C3/4 F3/4", "C3/4 G3/4")],
    ["only the original minor-mode tonic is present", sharpRoute.replace("C#5/4 C#5/4", "C5/4 C#5/4")],
  ])("keeps the original key with %s despite the same destination", (_why, score) => {
    const { meaning } = analyzeParallelTonicPivot(score);
    expect(meaning(2)?.degree).toBe(1);
    expect(meaning(2)?.localKey).toBeUndefined();
    expect(meaning(8)?.localKey).toBeDefined();
  });

  it("keeps an isolated Picardy third and a borrowed minor tonic without a subsequent modulation", () => {
    for (const [score, first, middle, last] of [
      [sharpRoute, "A minor", ["C5 E4 A3 A2", "D5 E4 G#3 B2"], "C#5 E4 A3 A2"],
      [flatRoute, "C major", ["E5 G4 C4 C3", "D5 G4 B3 F3"], "C5 G4 C4 Eb3"],
    ] as const) {
      const text = `satb 1\nkey ${first}\nmeter 2/4\nbars 1..2 {\n` +
        ["S","A","T","B"].map((v,i) => v + ": | " + middle.map(c => c.split(" ")[i] + "/4").join(" ") +
          " | " + last.split(" ")[i] + "/2 |").join("\n") + "\n}";
      expect(analyzeParallelTonicPivot(text).meaning(2)?.localKey).toBeUndefined();
      expect(analyzeParallelTonicPivot(score).meaning(8)?.localKey).toBeDefined();
    }
  });

  it("requires a sounded tonic establishing the original mode", () => {
    const sameMinorTonic = flatRoute.replace("E5/4 D5/4", "Eb5/4 D5/4");
    const { meaning } = analyzeParallelTonicPivot(sameMinorTonic);
    expect(meaning(2)?.localKey).toBeUndefined();
    expect(meaning(8)?.localKey?.tonic).toEqual({ step: "A", alter: -1 });
  });

  it("distinguishes a real modulation whose destination does not contain the proposed common chord", () => {
    const score = `satb 1
key C major
meter 2/4
bars 1..5 {
 S: | E5/4 D5/4 | C5/4 A4/4 | D5/4 C5/4 | B4/4 A4/4 | G4/2 |
 A: | G4/4 G4/4 | G4/4 F#4/4 | G4/4 A4/4 | G4/4 F#4/4 | D4/2 |
 T: | C4/4 B3/4 | C4/4 D4/4 | D4/4 Eb4/4 | D4/4 C4/4 | B3/2 |
 B: | C3/4 F3/4 | Eb3/4 C3/4 | B2/4 C3/4 | D3/4 D2/4 | G2/2 |
}`;
    const { meaning } = analyzeParallelTonicPivot(score);
    expect(meaning(2)?.localKey).toBeUndefined();
    expect(meaning(8)?.localKey).toEqual({ tonic: { step: "G", alter: 0 }, mode: "major" });
  });

  it("requires a later cadence in the destination even after its own applied dominant and tonic", () => {
    const score = flatRoute.replace("Eb2/4 | Ab2/2", "Eb2/4 | G2/2");
    expect(analyzeParallelTonicPivot(score).meaning(2)?.localKey).toBeUndefined();
  });

  it.each([2, 3, 7])("respects a manual phrase break at beat %i", beat => {
    const { meaning } = analyzeParallelTonicPivot(flatRoute, p => {
      p.structure.phraseBoundaries.push({ id: "break", tick: beat * p.ppq, source: "manual", confidence: "certain" });
    });
    expect(meaning(2)?.localKey).toBeUndefined();
  });

  it("respects silence and a printed key change after the pivot", () => {
    expect(analyzeParallelTonicPivot(flatRoute.replace("C5/4 Bb4/4", "C5/8 r/8 Bb4/4")).meaning(2)?.localKey).toBeUndefined();
    const { meaning } = analyzeParallelTonicPivot(flatRoute, p => {
      p.keyEvents.push({ ...p.keyEvents[0], id: "printed", tick: 3 * p.ppq,
        tonic: { step: "A", alter: -1 }, mode: "major" });
    });
    expect(meaning(2)?.localKey).toBeUndefined();
  });
});

const example = {
  key: "Bb major", soprano: "A4/2 Bb4/4", alto: "F4/2 F4/4",
  tenor: "C4/4 F3/4 F3/4", bass: "Eb3/2 D3/4",
};
function project(parts: Partial<typeof example> = {}) {
  const { key, soprano, alto, tenor, bass } = { ...example, ...parts };
  return compileScoreText(`satb 1
key ${key}
meter 3/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
}`).project;
}
function region(score: ReturnType<typeof project>, tick = PPQ, options?: ChordInferenceOptions) {
  return inferHarmony(score, options).chordInference.regions.find(r => r.fromTick <= tick && tick < r.toTick);
}
const seventhRevoicingCode = "single-voice-seventh-revoicing";

describe("完整七和弦陈述后的弱位换音", () => {
  it("男高五音下跳到根音，固定七音低音随后解决；保持实际缺五与原始角色", () => {
    const score = project();
    const inference = inferHarmony(score);
    expect(region(score)).toMatchObject({
      status: "resolved", selected: {
        functionalBaseId: "D", confidence: "medium",
        identity: { root: { step: "F", alter: 0 }, bass: { step: "E", alter: -1 } },
        fit: { omittedChordDegrees: [5], nonChordToneNoteIds: [], nonChordToneAssignments: {} },
        evidence: expect.arrayContaining([{ kind: "sequence-context", code: seventhRevoicingCode, noteIds: ["note-T-0", "note-T-960"] }]),
      },
    });
    const applied = applyHarmonyInference(score, inference, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(applied.project.satbTracks).toEqual(score.satbTracks);
    expect(checkHarmony(applied.project).diagnostics).not.toContainEqual(expect.objectContaining({
      ruleId: "chord.incomplete-members", tick: PPQ, severity: "warning", params: { missing: "C" },
    }));
    expect(region(score, 2 * PPQ)?.selected?.identity).toMatchObject({ root: { step: "B", alter: -1 }, bass: { step: "D" } });
    expect(region(score, PPQ, { minConfidence: "high" })?.status).toBe("unclassified");
  });

  it.each([
    ["五音改重三音", { tenor: "C4/4 A3/4 F3/4" }],
    ["低音原音重新起奏", { bass: "Eb3/4 Eb3/4 D3/4" }],
    ["另一上声部原音重奏", { soprano: "A4/4 A4/4 Bb4/4" }],
    ["五音异名", { tenor: "B#3/4 F3/4 F3/4" }],
    ["省五延续两拍", { soprano: "A4/2.", alto: "F4/2.", tenor: "C4/4 F3/2", bass: "Eb3/2." }],
  ] satisfies [string, Partial<typeof example>][])("%s 保留推导缺口", (_label, parts) => {
    expect(region(project(parts))?.status).toBe("unclassified");
  });

  it.each([
    ["major7", { soprano: "D5/2 A4/4", alto: "Bb4/2 F4/4", tenor: "F4/4 Bb3/4 D4/4", bass: "A3/2 Bb2/4" }],
    ["minor7", { soprano: "Eb5/2 Bb4/4", alto: "C5/2 G4/4", tenor: "G4/4 C4/4 Eb4/4", bass: "Bb3/2 C3/4" }],
  ] satisfies [string, Partial<typeof example>][])("%s 延续同一拼写和转位", (quality, parts) => {
    const selected = region(project(parts))?.selected;
    expect(selected?.identity.structure).toMatchObject({ quality });
    expect(selected?.evidence.some(e => e.code === seventhRevoicingCode)).toBe(true);
  });

  it("半减七、重属和已记外音保留各自推导入口", () => {
    const halfDiminished = project({ soprano: "C5/2 Bb4/4", alto: "A4/2 F4/4", tenor: "Eb4/4 A3/4 F3/4", bass: "G3/2 D3/4" });
    const applied = project({ key: "C major", soprano: "F#4/2 G4/4", alto: "D4/2 D4/4", tenor: "A3/4 D3/4 D3/4", bass: "C3/2 B2/4" });
    const decorated = project();
    decorated.satbTracks.find(t => t.id === "tenor")!.notes[1].nonChordToneRole = "anticipation";
    for (const score of [halfDiminished, applied, decorated]) {
      expect(region(score)?.selected?.evidence.some(e => e.code === seventhRevoicingCode)).not.toBe(true);
    }
  });

  it("先不完整后出现五音，保留此前的缺口", () => {
    const score = project({ tenor: "F3/4 C4/4 F3/4" });
    expect(region(score, 0)?.status).toBe("unclassified");
    expect(region(score)?.selected?.identity.structure).toMatchObject({ quality: "dominant7" });
  });

  it("失去根音后保留实际完整的减三和弦", () => {
    const score = project({ alto: "F4/4 C4/4 F4/4", tenor: "C4/2 F3/4" });
    expect(region(score)?.selected?.identity).toMatchObject({
      root: { step: "A", alter: 0 }, bass: { step: "E", alter: -1 }, structure: { quality: "diminished" },
    });
  });

  it("同级弱拍不能证明前一陈述更强", () => {
    const score = project({ soprano: "r/4 A4/2", alto: "r/4 F4/2", tenor: "r/4 C4/4 F3/4", bass: "r/4 Eb3/2" });
    expect(region(score, 2 * PPQ)?.status).toBe("unclassified");
  });

  it("句界或新调号事件切断借用", () => {
    const phrase = project();
    phrase.structure.phraseBoundaries = [{ id: "cut", tick: PPQ, source: "manual", confidence: "certain" }];
    expect(region(phrase)?.status).toBe("unclassified");
    const key = project();
    key.keyEvents.push({ ...key.keyEvents[0], id: "new-key", tick: PPQ });
    expect(region(key)?.status).toBe("unclassified");
  });
});
