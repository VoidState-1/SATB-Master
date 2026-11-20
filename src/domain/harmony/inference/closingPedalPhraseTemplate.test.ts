import { describe, expect, it } from "vitest";
import { annotationFromCadenceCandidate } from "../cadence/confirmation";
import { addCadenceAnnotation } from "../../editing";
import { PPQ, type CadenceAnnotation, type ProjectDocument } from "../../project";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { inferPhrases } from "../phrase";
import { applyHarmonyInference, inferHarmony } from "./harmonyInference";

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
