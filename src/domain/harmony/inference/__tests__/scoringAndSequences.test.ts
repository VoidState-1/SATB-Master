import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  PPQ,
  type VoiceId,
  type CadenceAnnotation,
  type ProjectDocument,
} from "../../../project";
import { spellMidi } from "../../../pitch";
import { buildChordInferenceCandidates } from "../candidates";
import { buildChordInferenceObservations } from "../observations";
import { analyzeChordInferencePaths, selectChordInferencePath } from "../scoring";
import { buildChordInferenceRegions } from "../segmentation";
import { compileScoreText } from "../../../scoreText";
import { inferChords, applyChordInference } from "..";
import { annotationFromCadenceCandidate } from "../../cadence/model";
import { addCadenceAnnotation } from "../../../editing";
import { buildHarmonyAnalysis } from "../../analysis";
import { inferPhrases } from "../../phrase";
import { applyHarmonyInference, inferHarmony } from "../pipeline";

function sequenceFixture() {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 3;
  const pitches: Record<VoiceId, number[]> = {
    soprano: [76, 76, 77],
    alto: [72, 72, 74],
    tenor: [67, 67, 71],
    bass: [55, 55, 55],
  };
  for (const track of project.satbTracks) {
    track.notes = pitches[track.voice].map((midi, index) => ({
      id: `${track.id}-${index}`,
      startTick: index * PPQ,
      durationTicks: PPQ,
      pitch: spellMidi(midi),
      velocity: 88,
      spellingSource: "manual",
      locked: false,
    }));
  }
  const observations = buildChordInferenceObservations(project);
  const candidateSets = observations.map((observation, index) =>
    buildChordInferenceCandidates(observation)
      .filter((candidate) => index < 2
        ? candidate.functionalBaseId === "T" || candidate.functionalBaseId === "K46"
        : candidate.functionalBaseId === "D")
      .map((candidate) => ({
        ...candidate,
        score: { ...candidate.score, total: 10 },
      })),
  );
  return { observations, candidateSets };
}

describe("Chord inference path scores", () => {
  it("uses the same scores when regions receive the original candidate sets", () => {
    const fixture = sequenceFixture();
    const observations = fixture.observations.slice(0, 2);
    const candidateSets = fixture.candidateSets.slice(0, 2);
    const selected = selectChordInferencePath(observations, candidateSets);
    const regions = buildChordInferenceRegions(observations, candidateSets, selected);

    expect(regions).toHaveLength(1);
    expect(regions[0].status).toBe("ambiguous");
    expect(regions[0].selected?.pathScore).toBe(35);
    expect(regions[0].alternatives[0].pathScore).toBe(35);
  });

  it("compares every candidate using its best complete prefix and suffix", () => {
    const { observations, candidateSets } = sequenceFixture();
    const input = structuredClone(candidateSets);
    const result = analyzeChordInferencePaths(observations, candidateSets);

    // With local scores of 10: K-K-D = 30 + 15 + 14 = 59;
    // T-K-D = 55, K-T-D = 41, and T-T-D = 45.
    expect(result.selectedPath.map((candidate) => candidate?.functionalBaseId))
      .toEqual(["K46", "K46", "D"]);
    expect(result.candidateSets.map((candidates) => Object.fromEntries(
      candidates.map((candidate) => [candidate.functionalBaseId, candidate.pathScore]),
    ))).toEqual([{ T: 55, K46: 59 }, { T: 45, K46: 59 }, { D: 59 }]);
    expect(candidateSets).toEqual(input);

    const regions = buildChordInferenceRegions(observations, result.candidateSets, result.selectedPath);
    expect(regions[0].observationIndices).toEqual([0, 1]);
    expect(regions[0].selected?.pathScore).toBe(59);
    expect(regions[0].alternatives[0].pathScore).toBe(55);
    expect(regions[0].status).toBe("ambiguous");
  });

  it("does not reset complete paths when a prefix has a negative score", () => {
    const { observations, candidateSets } = sequenceFixture();
    const negative = candidateSets.map((candidates) => candidates.map((candidate) => ({
      ...candidate,
      score: { ...candidate.score, total: -10 },
    })));
    const result = analyzeChordInferencePaths(observations, negative);
    expect(result.selectedPath.map((candidate) => candidate?.pathScore)).toEqual([-1, -1, -1]);
    expect(result.candidateSets[0].find((candidate) => candidate.functionalBaseId === "T")?.pathScore)
      .toBe(-5);
  });

  it("keeps scores independent across intervals with no candidates", () => {
    const { observations, candidateSets } = sequenceFixture();
    candidateSets[1] = [];
    const result = analyzeChordInferencePaths(observations, candidateSets);
    expect(result.selectedPath[1]).toBeUndefined();
    expect(result.candidateSets[1]).toEqual([]);
    expect(result.candidateSets[0].map((candidate) => candidate.pathScore)).toEqual([10, 10]);
    expect(result.candidateSets[2][0].pathScore).toBe(10);
    expect(analyzeChordInferencePaths([], [])).toEqual({ selectedPath: [], candidateSets: [] });
  });
});

const modulation = `satb 1
key C major
meter 2/4
bars 1..4 {
  S: | E5/4 D5/4 | C5/4 B4/4 | D5/4 C#5/4 | D5/2 |
  A: | C5/4 B4/4 | G4/4 G4/4 | F#4/4 G4/4 | F#4/2 |
  T: | G3/4 F4/4 | E4/4 E4/4 | A3/4 E4/4 | A3/2 |
  B: | C3/4 G2/4 | C3/4 E3/4 | A2/4 A2/4 | D3/2 |
}`;

describe("从谱面的终止识别局部调", () => {
  it("在原调主和弦之后用新调的 K46–D7–T 识别转调，保留题面调号", () => {
    const { project } = compileScoreText(modulation);
    const originalKeys = structuredClone(project.keyEvents);
    const result = inferChords(project);
    const expected = { tonic: { step: "D", alter: 0 }, mode: "major" };
    const destination = result.regions.filter(r => r.fromTick >= 4 * project.ppq);
    expect(destination).toHaveLength(3);
    expect(destination.map(r => r.selected?.semantics?.interpretations[0].localKey))
      .toEqual([expected, expected, expected]);
    expect(destination.at(-1)?.selected?.functionalBaseId).toBe("T");
    expect(result.regions[0].selected?.semantics?.interpretations[0].localKey).toBeUndefined();
    const applied = applyChordInference(project, result, { mode: "replace-unlocked" });
    expect(applied.project.keyEvents).toEqual(originalKeys);
    expect(applied.project.chordTrack.regions.at(-1)?.semantics?.interpretations[0].localKey)
      .toEqual(expected);
  });

  it("仅选终止主和弦的一部分仍使用全谱提供的局部调", () => {
    const { project } = compileScoreText(modulation);
    const result = inferChords(project, { fromTick: project.lengthTicks - project.ppq / 2 });
    expect(result.regions).toMatchObject([{ selected: { functionalBaseId: "T",
      semantics: { interpretations: [{ localKey: { tonic: { step: "D", alter: 0 }, mode: "major" } }] } } }]);
  });

  it("显式新调调号使后续和弦直接归属该调", () => {
    const { project } = compileScoreText(modulation);
    project.keyEvents.push({ id: "d", tick: 4 * project.ppq, tonic: { step: "D", alter: 0 }, mode: "major" });
    const last = inferChords(project).regions.at(-1)!;
    expect(last.selected?.functionalBaseId).toBe("T");
    expect(last.selected?.semantics?.interpretations[0].localKey).toBeUndefined();
  });

  it("目的调主和弦重新起音并持续一小节，回原调后使用原调的属主", () => {
    const returning = modulation.replace("1..4", "1..6")
      .replace("D5/2 |", "D5/4 D5/4 | B4/4 C5/4 | C5/2 |")
      .replace("F#4/2 |", "F#4/4 F#4/4 | F4/4 G4/4 | G4/2 |")
      .replace("A3/2 |", "A3/4 A3/4 | D4/4 E4/4 | E4/2 |")
      .replace("D3/2 |", "D3/4 D3/4 | G2/4 C3/4 | C3/2 |");
    const { project } = compileScoreText(returning);
    project.meterEvents.push({ id: "six-eight", tick: 8 * project.ppq, numerator: 6, denominator: 8 });
    const result = inferChords(project);
    const at = (beat: number) => result.regions.find(r => r.fromTick <= beat * project.ppq && beat * project.ppq < r.toTick)?.selected;
    expect([6, 7].map(i => at(i)?.semantics?.interpretations[0].localKey?.tonic.step)).toEqual(["D", "D"]);
    expect(at(8)?.functionalBaseId).toBe("D");
    expect(at(10)?.functionalBaseId).toBe("T");
    expect(at(8)?.semantics?.interpretations[0].localKey).toBeUndefined();
    expect(at(10)?.semantics?.interpretations[0].localKey).toBeUndefined();
  });

  it("原调主音持续与同主音大小调色彩均不能单独触发转调", () => {
    const { project } = compileScoreText(`satb 1
key C minor
meter 2/4
bars 1..3 {
  S: | G4/2 | F4/4 B4/4 | E5/2 |
  A: | Eb4/2 | D4/4 G4/4 | G4/2 |
  T: | C4/2 | A3/4 F4/4 | C4/2 |
  B: | C3/2 | C3/4 G2/4 | C3/2 |
}`);
    expect(inferChords(project).regions.every(r => !r.selected?.semantics?.interpretations[0].localKey)).toBe(true);
  });

  it("转位属七的实写七音下行到主和弦三音也能确立新调", () => {
    const { project } = compileScoreText(modulation.replace("A3/4 E4/4 | A3/2", "A3/4 A3/4 | A3/2")
      .replace("F#4/4 G4/4 | F#4/2", "F#4/4 E4/4 | F#4/2")
      .replace("A2/4 A2/4 | D3/2", "A2/4 G2/4 | F#2/2"));
    const regions = inferChords(project).regions.filter(r => r.fromTick >= 5 * project.ppq);
    expect(regions.map(r => r.selected?.semantics?.interpretations[0].localKey?.tonic.step)).toEqual(["D", "D"]);
    expect(regions.map(r => r.selected?.identity.bass.step)).toEqual(["G", "F"]);
  });

  it("缺少目的调预备时保持句末重属到属以及调内主和弦的原调归属", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
  S: | E5/2 | F5/4 F#5/4 | G5/2 |
  A: | C5/2 | C5/4 C5/4 | B4/2 |
  T: | G3/2 | A3/4 A3/4 | D4/2 |
  B: | C3/2 | F2/4 D3/4 | G2/2 |
}`);
    const result = inferChords(project);
    expect(result.regions.map(r => r.selected?.functionalBaseId)).toEqual(["T","S","DD","D"]);
    expect(result.regions.every(r => !r.selected?.semantics?.interpretations[0].localKey)).toBe(true);
  });
});

describe("降二级的三和弦和大七和弦", () => {
  const preparation = `satb 1
key C minor
meter 2/4
bars 1..2 {
  S: | Db5/4 C5/4 | B4/4 C5/4 |
  A: | Ab4/4 Ab4/4 | F4/4 G4/4 |
  T: | F4/4 F4/4 | D4/4 Eb4/4 |
  B: | Db3/4 Db3/4 | G2/4 C3/4 |
}`;
  it("下降二级根音上的三和弦增加大七度后解决到属，保留转位与功能", () => {
    const { project } = compileScoreText(preparation);
    const regions = inferChords(project).regions;
    for (const [i, quality] of ["major", "major7"].entries()) {
      expect(regions[i]).toMatchObject({ status: "resolved", selected: {
        identity: { root: { step: "D", alter: -1 }, structure: { quality }, bass: { step: "D", alter: -1 } },
        semantics: { interpretations: [{ degree: 2, degreeAlteration: -1,
          designation: { kind: "side-degree", primaryFunction: "subdominant" } }] },
      } });
    }
    const inverted = compileScoreText(preparation.replace("F4/4 F4/4", "Db4/4 Db4/4")
      .replace("Db3/4 Db3/4", "F3/4 F3/4"));
    const selected = inferChords(inverted.project).regions.map(r => r.selected);
    expect(selected[0]?.functionalBaseId).toBe("N6");
    expect(selected[1]).toMatchObject({ functionalBaseId: "SII", identity: {
      bass: { step: "F", alter: 0 }, structure: { quality: "major7" },
    } });
  });

  it("孤立的降二级与等音拼写不触发带有解决依据的下属解释", () => {
    const isolated = compileScoreText(preparation.replace("B4/4 C5/4","C5/4 C5/4")
      .replace("F4/4 G4/4","G4/4 G4/4").replace("D4/4 Eb4/4","Eb4/4 Eb4/4")
      .replace("G2/4 C3/4","C3/4 C3/4"));
    const respelled = compileScoreText(preparation.replaceAll("Db","C#"));
    for (const { project } of [isolated, respelled]) {
      expect(inferChords(project).regions.every(r =>
        !r.selected?.evidence.some(e => e.code === "lowered-supertonic-resolution"))).toBe(true);
    }
  });

  it("截取降二级和弦中段时保留全谱的解决证据，输出只覆盖选区内的音符", () => {
    const { project } = compileScoreText(preparation);
    const range = { fromTick: project.ppq / 2, toTick: project.ppq };
    const result = inferChords(project, range);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toMatchObject({ ...range, observationIndices: [0], selected: {
      observationIndex: 0, functionalBaseId: "SII", identity: { structure: { quality: "major" } },
    } });
    expect(result.regions[0].selected?.fit.chordToneNoteIds).toHaveLength(4);
    expect(applyChordInference(project, result, { mode: "replace-unlocked" }).project.chordTrack.regions)
      .toMatchObject([{ startTick: range.fromTick, durationTicks: range.toTick - range.fromTick }]);
  });
});

const midpoint = 8 * PPQ;
const release = 16 * PPQ;
const score = `satb 1
key D major
meter 4/4
bars 1..4 {
  S: | A4/1 | A4/2. E5/4 | D5/1~ | D5/1 |
  A: | D4/1 | D4/2. C#4/4 | D4/4 C4/4 B3/4 Bb3/4 | A3/1 |
  T: | F#3/1 | F#3/2. G3/4 | F#3/4 A3/4 G3/4 E3/4 | F#3/1 |
  B: | A2/1~ | A2/1 | D3/1~ | D3/1 |
  H: | I64/1 | I64/2. V7/4 | I/4 r/4 IV64/4 r/4 | I/1 |
}`;

function make(text = score) {
  return compileScoreText(text).project;
}

function apply(project: ProjectDocument) {
  return applyHarmonyInference(project, inferHarmony(project), {
    // Exercise the normal boundary writeback while retaining the written
    // synthetic harmonies needed for the controlled comparison.
    mode: "fill-gaps",
    selection: new Set(),
  });
}

function hasRevoicing(project: ProjectDocument) {
  return buildHarmonyAnalysis(project).cadenceCandidates.some(candidate =>
    candidate.kind === "full" && candidate.toTick === release &&
    candidate.evidence.some(item => item.code === "closing-tonic-revoicing"));
}

function assertHalf(project: ProjectDocument) {
  const analysis = buildHarmonyAnalysis(project);
  expect(analysis.cadenceCandidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "half", toTick: midpoint }),
  ]));
  expect(hasRevoicing(project)).toBe(false);
}

describe("规整二分遇到实写属持续音与结束主持续音", () => {
  it("在最终写回统一归属到真正齐收，并保持旧的纯模板接口可复用", () => {
    const input = make();
    expect(inferPhrases(input).template).toMatchObject({
      kind: "duple", boundaries: [{ tick: midpoint, support: "moderate" }],
    });
    const result = apply(input);
    expect(result.appliedPhraseTemplate).toBe("single");
    expect(result.appliedPhraseBoundaryCount).toBe(0);
    expect(input.structure.phraseBoundaries).toEqual([]);
    const analyzed = buildHarmonyAnalysis(result.project);
    expect(analyzed.phraseSegments.map(p => [p.fromTick, p.toTick])).toEqual([[0, release]]);
    expect(analyzed.cadenceCandidates).toEqual([expect.objectContaining({
      kind: "full", completion: "perfect", phraseId: analyzed.phraseSegments[0].id, toTick: release,
      evidence: expect.arrayContaining([expect.objectContaining({
        code: "closing-tonic-revoicing",
        refs: expect.arrayContaining([analyzed.harmonySpans.find(span => span.fromTick === midpoint)?.id]),
      })]),
    })]);
  });

  it("已保存的推断切点在实时分析中照旧，重跑推导才重新裁定", () => {
    const input = make();
    input.structure.phraseBoundaries = inferPhrases(input).boundaries.filter(boundary => boundary.tick === midpoint);
    assertHalf(input);
    expect(hasRevoicing(apply(input).project)).toBe(true);
  });

  it.each([
    ["手工", (p: ProjectDocument) => p.structure.phraseBoundaries.push({
      id: "confirmed", tick: midpoint, source: "manual", confidence: "certain",
    })],
    ["同音调号重申", (p: ProjectDocument) => p.keyEvents.push({
      ...p.keyEvents[0], id: "fresh-key-event", tick: midpoint,
    })],
  ] as const)("保留%s的切点", (_name, mark) => {
    const input = make();
    mark(input);
    const result = apply(input);
    expect(result.project.structure.phraseBoundaries).toEqual([expect.objectContaining({ tick: midpoint })]);
    assertHalf(result.project);
  });

  it("保留旧工程里已经确认的半终止与其乐句归属", () => {
    const input = make();
    input.structure.phraseBoundaries = inferPhrases(input).boundaries.filter(boundary => boundary.tick === midpoint);
    input.chordTrack.cadenceAnnotations.push({
      id: "accepted-half", phraseId: `phrase-0-${midpoint}`, fromTick: midpoint - PPQ, toTick: midpoint,
      kind: "half", form: "authentic", source: "accepted-candidate", confidence: "certain", locked: true,
    });
    const result = apply(input);
    assertHalf(result.project);
    expect(result.project.chordTrack.cadenceAnnotations).toEqual(input.chordTrack.cadenceAnnotations);
  });

  it.each([
    ["新句虽立即落主，但前句女高在二拍属七上停住",
      score.replace("A4/2. E5/4", "A4/2 E5/2").replace("D4/2. C#4/4", "D4/2 C#4/2")
        .replace("F#3/2. G3/4", "F#3/2 G3/2").replace("I64/2. V7/4", "I64/2 V7/2"), true],
    ["低音同音重新起奏，早先的和声不能算在同次持续音内",
      score.replace("A2/1~ | A2/1", "A2/1 | A2/1"), true],
    ["前有长属低音，但此前只实奏同根属和弦",
      score.replace("D4/1 | D4/2.", "C#4/1 | C#4/2.").replace("F#3/1 | F#3/2.", "E3/1 | E3/2.")
        .replace("I64/1 | I64/2.", "V/1 | V/2."), true],
    ["新句内部的同音女高重新起奏",
      score.replace("D5/1~ | D5/1", "D5/1 | D5/1"), false],
    ["女低导音错走，即使标签与尾部完全一致",
      score.replace("C#4/4 | D4/4", "C#4/4 | A3/4"), false],
    ["男高的属七音错误上行",
      score.replace("G3/4 | F#3/4", "G3/4 | F#4/4"), false],
  ] as const)("%s，保留前句半终止", (_name, source, hasProofWhenJoined) => {
    const input = make(source);
    expect(hasRevoicing(input)).toBe(hasProofWhenJoined);
    assertHalf(apply(input).project);
  });

  it("属上齐收后留下整拍实际停顿再开新句", () => {
    const withRest = score.replace("A4/2. E5/4", "A4/2 E5/4 r/4").replace("D4/2. C#4/4", "D4/2 C#4/4 r/4")
      .replace("F#3/2. G3/4", "F#3/2 G3/4 r/4").replace("A2/1~ | A2/1", "A2/1~ | A2/2. r/4")
      .replace("I64/2. V7/4", "I64/2 V7/4 r/4");
    const result = apply(make(withRest));
    const analysis = buildHarmonyAnalysis(result.project);
    expect(result.appliedPhraseTemplate).toBe("duple");
    expect(analysis.phraseSegments[0].toTick).toBe(midpoint - PPQ);
    expect(analysis.cadenceCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "half", toTick: midpoint - PPQ }),
    ]));
    expect(hasRevoicing(result.project)).toBe(false);
  });
});

const continuousLocalScore = `satb 1
key G major
meter 4/4
bars 1..4 {
  S: | D5/2 E5/2 | A4/2. E5/4 | D5/1~ | D5/1 |
  A: | D4/2 C#4/2 | D4/2. C#4/4 | D4/2 B3/4 A3/4 | A3/1 |
  T: | F#3/2 A3/2 | F#3/2. G3/4 | F#3/2 G3/4 F#3/4 | F#3/1 |
  B: | A2/1~ | A2/1 | D3/1~ | D3/1 |
}
annotations {
  chord prior-tonic range=[1:1,1:3) symbol=I64 localKey="D major"
  chord prior-dominant range=[1:3,2:1) symbol=V localKey="D major"
  chord final-preparation range=[2:1,2:4) symbol=I64 localKey="D major"
  chord final-dominant range=[2:4,3:1) symbol=V7 localKey="D major"
  chord landing range=[3:1,3:3) symbol=I localKey="D major"
  chord subdominant range=[3:3,3:4) symbol=IV64 localKey="D major"
  chord end-voicing range=[3:4,5:1) symbol=I localKey="D major"
}`;

const priorPhraseId = `phrase-0-${midpoint}`;
const joinedPhraseId = `phrase-0-${release}`;

function annotate(project: ProjectDocument, fields: Partial<CadenceAnnotation> = {}) {
  const result = addCadenceAnnotation(project, {
    id: "saved-cadence", phraseId: joinedPhraseId, fromTick: midpoint - PPQ, toTick: release,
    kind: "full", form: "authentic", completion: "perfect", source: "accepted-candidate",
    confidence: "probable", locked: false, ...fields,
  });
  expect(result.error).toBeUndefined();
  return result.project;
}

function withOldSplit(project: ProjectDocument) {
  return {
    ...project, structure: { ...project.structure,
      phraseBoundaries: inferPhrases(project).boundaries.filter(boundary => boundary.tick === midpoint) },
  };
}

describe("重跑和声推导时的终止占用", () => {
  it("保留按实奏确认的非连续终止及其落点", () => {
    const first = apply(make()).project;
    const closing = buildHarmonyAnalysis(first).cadenceCandidates.find(candidate => candidate.observedLandingTick === midpoint)!;
    const accepted = addCadenceAnnotation(first, annotationFromCadenceCandidate(closing, "confirmed"));
    expect(accepted.error).toBeUndefined();
    const retried = apply(accepted.project);
    expect(retried.project.structure.phraseBoundaries).toEqual([]);
    expect(buildHarmonyAnalysis(retried.project).cadenceAnnotations[0]).toMatchObject({
      observedLandingTick: midpoint, stale: false, phraseId: closing.phraseId,
    });
  });
  it("首次、重复、确认后重跑均保留真正的齐收和有效标注", () => {
    const once = apply(make(continuousLocalScore)).project;
    expect(once.structure.phraseBoundaries).toEqual([]);
    expect(apply(once).project).toBe(once);
    const closing = buildHarmonyAnalysis(once).cadenceCandidates.find(candidate =>
      candidate.evidence.some(item => item.code === "closing-tonic-revoicing"))!;
    const accepted = annotate(once, {
      phraseId: closing.phraseId, fromTick: closing.fromTick, toTick: closing.toTick,
      kind: closing.kind, form: closing.form, completion: closing.completion,
    });
    const retried = apply(accepted).project;
    expect(retried).toBe(accepted);
    expect(apply(retried).project).toBe(retried);
    expect(hasRevoicing(retried)).toBe(true);
    expect(buildHarmonyAnalysis(retried).phraseSegments.map(phrase => phrase.id)).toEqual([closing.phraseId]);
  });

  it("已被旧版回插切点的同一确认标注可恢复原属乐句", () => {
    const accepted = annotate(apply(make(continuousLocalScore)).project);
    const retried = apply(withOldSplit(accepted)).project;
    expect(retried.structure.phraseBoundaries).toEqual([]);
    expect(retried.chordTrack.cadenceAnnotations).toEqual([
      { ...accepted.chordTrack.cadenceAnnotations[0], stale: false },
    ]);
    expect(hasRevoicing(retried)).toBe(true);
  });

  it.each([
    ["手工半终止", "manual", false],
    ["锁定的已确认半终止", "accepted-candidate", true],
  ] as const)("%s占用同一个属和弦，仍保留句界", (_name, source, locked) => {
    const saved = annotate(withOldSplit(make(continuousLocalScore)), {
      phraseId: priorPhraseId, toTick: midpoint, kind: "half", completion: undefined, source, locked,
    });
    expect(apply(saved).project).toBe(saved);
    expect(saved.structure.phraseBoundaries.map(boundary => boundary.tick)).toEqual([midpoint]);
  });

  it("邻接的先前标注不阻止合并，旧的局部乐句归属随之更新", () => {
    const first = withOldSplit(make(continuousLocalScore));
    const saved = annotate(first, {
      fromTick: 4 * PPQ, toTick: midpoint - PPQ, phraseId: priorPhraseId,
      kind: "half", completion: undefined, source: "manual", locked: true,
    });
    const retried = apply(saved).project;
    expect(retried.structure.phraseBoundaries).toEqual([]);
    expect(retried.chordTrack.cadenceAnnotations).toEqual([
      { ...saved.chordTrack.cadenceAnnotations[0], phraseId: joinedPhraseId, stale: false },
    ]);
    expect(apply(retried).project).toBe(retried);
  });

  it.each([
    ["限定省略", { form: undefined, completion: undefined }],
    ["前段准备更长", { fromTick: 4 * PPQ }],
    ["人工完满性", { completion: "imperfect" }],
  ] as const)("同一全终止的%s保留原标注及统一句界", (_name, fields) => {
    const once = apply(make(continuousLocalScore)).project;
    const saved = annotate(once, { ...fields, source: "manual", locked: true });
    expect(apply(saved).project).toBe(saved);
    expect(hasRevoicing(saved)).toBe(true);
  });

  it.each([
    ["阻碍", { kind: "deceptive", completion: undefined }],
    ["变格", { form: "plagal" }],
    ["提前结束", { toTick: 10 * PPQ }],
  ] as const)("重叠的%s解释保护原有结构", (_name, fields) => {
    const first = withOldSplit(make(continuousLocalScore));
    const saved = annotate(first, { ...fields, phraseId: priorPhraseId, source: "manual" });
    expect(apply(saved).project).toBe(saved);
    expect(saved.structure.phraseBoundaries.map(boundary => boundary.tick)).toEqual([midpoint]);
  });
});
