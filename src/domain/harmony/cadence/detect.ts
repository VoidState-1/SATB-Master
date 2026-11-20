import {
  chordIdentityInversion,
  chordIdentityToneSpellings,
  chordStructureQuality,
  harmonySemanticsConfidence,
  primaryHarmonyInterpretation,
  type FunctionalFamily,
  type HarmonyInterpretation,
  type KeyReference,
} from "../../chordModel";
import { effectiveFunctionalDesignation } from "../../functionalHarmonyCatalog";
import { pitchClassEquals, pitchClassValue, scaleDegreePitchClass } from "../../pitch";
import { buildMeasures, measureAtTick, ticksPerBeat, type MeasureInfo } from "../../time";
import { buildMetricTimeline, compareMetricStrength, metricPositionAt } from "../../rhythm/metric";
import { dominantNeighborEvidence } from "./dominantNeighbors";
import { detachedAuthenticEvidence, detachedSparseTonicEvidence } from "./detachedAuthentic";
import { dominantLandingGapEvidence } from "./dominantLandingGap";
import { tonicBassSuspensionEvidence } from "./tonicBassSuspension";
import { closingTonicPedalEvidence, closingTonicRevoicingEvidence } from "./tonicPedalEnding";
import { continuesThroughParallelTonic } from "./parallelTonicPivot";
import { isWrittenAuxiliaryReturn } from "./auxiliaryReturn";
import { precedingDetachedDeception } from "./detachedDeceptive";
import { articulatedEndingEvidence } from "./articulatedEnding";
import { octaveTonicEndingEvidence } from "./octaveTonicEnding";
import type {
  AnalysisChord,
  AnalysisSlice,
  HarmonyAnalysis,
  HarmonySpan,
} from "../analysis";
import { isCadential64Span } from "../rules/connector";
import type { PhraseSegment } from "../phrase";
import { clipHarmonySpan, sliceWithinSpan } from "./spanRange";
import type {
  CadenceCandidate,
  CadenceConfidence,
  CadenceCompletion,
  CadenceEvidence,
  CadenceForm,
  CadenceKind,
  CadenceSpanFacts,
} from "./types";

const confidenceRank: Record<CadenceConfidence, number> = {
  ambiguous: 0,
  probable: 1,
  certain: 2,
};

function keyAtTick(analysis: Pick<HarmonyAnalysis, "project">, tick: number) {
  return (
    analysis.project.keyEvents
      .filter((event) => event.tick <= tick)
      .at(-1) ?? analysis.project.keyEvents[0]
  );
}

function sameKey(left: KeyReference | undefined, right: KeyReference | undefined) {
  return Boolean(
    left &&
      right &&
      left.mode === right.mode &&
      pitchClassEquals(left.tonic, right.tonic),
  );
}

function representativeChord(
  analysis: Pick<HarmonyAnalysis, "chordById">,
  span: HarmonySpan,
) {
  return span.regionIds
    .map((id) => analysis.chordById.get(id))
    .find(Boolean);
}

function boundarySlice(
  analysis: Pick<HarmonyAnalysis, "slices">,
  span: HarmonySpan,
) {
  const first = analysis.slices[span.sliceIndices[0]];
  return first && sliceWithinSpan(first, span);
}

function familyOf(
  span: HarmonySpan,
  chord: AnalysisChord | undefined,
): FunctionalFamily | undefined {
  if (!span.semantics || !chord) return undefined;
  return effectiveFunctionalDesignation(
    span.semantics,
    chordStructureQuality(chord.identity),
  )?.primaryFunction;
}

function interpretationOf(span: HarmonySpan): HarmonyInterpretation | undefined {
  if (!span.semantics) return undefined;
  const confidence = harmonySemanticsConfidence(span.semantics);
  if (confidence === "ambiguous" || confidence === "unknown") return undefined;
  return primaryHarmonyInterpretation(span.semantics);
}

function factsFor(
  analysis: Pick<HarmonyAnalysis, "project" | "chordById" | "slices">,
  span: HarmonySpan,
): CadenceSpanFacts {
  const chord = representativeChord(analysis, span);
  const slice = boundarySlice(analysis, span);
  const interpretation = interpretationOf(span);
  const semanticConfidence = span.semantics
    ? harmonySemanticsConfidence(span.semantics)
    : "unknown";
  const projectKey = keyAtTick(analysis, span.fromTick);
  const localKey = interpretation?.localKey ?? projectKey;
  const unavailable = !span.semantics || !chord || !interpretation;
  const ambiguous =
    span.status !== "complete" ||
    semanticConfidence === "ambiguous" ||
    semanticConfidence === "unknown" ||
    Boolean(interpretation?.appliedTarget);
  const family = ambiguous ? undefined : familyOf(span, chord);
  const degree = ambiguous ? undefined : interpretation?.degree;
  return {
    span,
    key: localKey,
    chord,
    boundarySlice: slice,
    family,
    degree,
    isTonic: family === "tonic" && degree === 1,
    isDominant: family === "dominant",
    isSubdominant: family === "subdominant",
    isCadential64: isCadential64Span(span),
    isStable:
      ambiguous || !family
        ? undefined
        : family === "tonic" || family === "subdominant" || family === "dominant",
    interpretationStatus: unavailable
      ? "unavailable"
      : ambiguous
        ? "ambiguous"
        : "resolved",
  };
}

function connectionIsValid(
  previous: CadenceSpanFacts,
  current: CadenceSpanFacts,
) {
  return (
    previous.span.toTick === current.span.fromTick &&
    sameKey(previous.key, current.key) &&
    previous.interpretationStatus === "resolved" &&
    current.interpretationStatus === "resolved"
  );
}

function scoreFor(kind: CadenceKind, phrase: PhraseSegment, evidence: readonly CadenceEvidence[]) {
  const base =
    kind === "full"
      ? 90
      : kind === "deceptive"
        ? 84
        : kind === "supplementary"
          ? 80
          : 78;
  const support = evidence.some((item) => item.code === "bass-formula") ? 5 : 0;
  const metric = evidence.some((item) => item.code === "metric-support") ? 3 : 0;
  const phrasePenalty = phrase.confidence === "probable" ? 8 : 0;
  return Math.max(0, Math.min(100, base + support + metric - phrasePenalty));
}

function confidenceFor(
  score: number,
  phrase: PhraseSegment,
): CadenceConfidence {
  const evidenceConfidence: CadenceConfidence =
    score >= 85 ? "certain" : score >= 65 ? "probable" : "ambiguous";
  return confidenceRank[evidenceConfidence] <= confidenceRank[phrase.confidence]
    ? evidenceConfidence
    : phrase.confidence;
}

function hasBassFormula(
  source: CadenceSpanFacts,
  target: CadenceSpanFacts,
  sourceDegree: 4 | 5,
  targetDegree: 1 | 5 | 6,
) {
  const sourceBass = source.boundarySlice?.notes.bass;
  const targetBass = target.boundarySlice?.notes.bass;
  if (!sourceBass || !targetBass) return false;
  return (
    pitchClassEquals(
      sourceBass.pitch,
      scaleDegreePitchClass(source.key, sourceDegree),
    ) &&
    pitchClassEquals(
      targetBass.pitch,
      scaleDegreePitchClass(target.key, targetDegree),
    )
  );
}

function isFifthDegreeDominant(facts: CadenceSpanFacts) {
  return facts.isDominant && facts.degree === 5 && facts.chord !== undefined &&
    pitchClassEquals(facts.chord.identity.root, scaleDegreePitchClass(facts.key, 5));
}

function isDominantHalfEnding(facts: CadenceSpanFacts) {
  if (isFifthDegreeDominant(facts)) return true;
  if (!facts.isDominant || facts.degree !== 7 || !facts.chord) return false;
  const quality = chordStructureQuality(facts.chord.identity);
  return (quality === "diminished7" || quality === "halfDiminished7") &&
    (pitchClassValue(facts.key.tonic) - pitchClassValue(facts.chord.identity.root) + 12) % 12 === 1;
}

function writtenBassMatches(facts: CadenceSpanFacts) {
  const bass = facts.boundarySlice?.notes.bass;
  return bass && facts.chord && pitchClassEquals(bass.pitch, facts.chord.identity.bass);
}

function completionFor(
  source: CadenceSpanFacts,
  target: CadenceSpanFacts,
): CadenceCompletion | undefined {
  if (!source.chord || !target.chord) return undefined;
  if (
    chordIdentityInversion(source.chord.identity) !== 0 ||
    chordIdentityInversion(target.chord.identity) !== 0
  ) {
    if (isFifthDegreeDominant(source) && pitchClassEquals(target.chord.identity.root, target.key.tonic) &&
        writtenBassMatches(source) && writtenBassMatches(target)) return "imperfect";
    return undefined;
  }
  if (!hasBassFormula(source, target, 5, 1)) return undefined;
  const soprano = target.boundarySlice?.notes.soprano;
  if (!soprano) return "imperfect";
  return pitchClassEquals(
    soprano.pitch,
    scaleDegreePitchClass(target.key, 1),
  )
    ? "perfect"
    : "imperfect";
}

function candidate(
  phrase: PhraseSegment,
  kind: CadenceKind,
  path: readonly CadenceSpanFacts[],
  evidence: readonly CadenceEvidence[],
  options: {
    readonly form?: CadenceForm;
    readonly completion?: CadenceCompletion;
    readonly confidenceCap?: CadenceConfidence;
    readonly unharmonizedLanding?: AnalysisSlice;
    readonly observedLandingTick?: number;
  } = {},
): CadenceCandidate {
  const score = scoreFor(kind, phrase, evidence);
  const first = path[0].span;
  const last = path.at(-1)!.span;
  const evidenceConfidence = confidenceFor(score, phrase);
  const confidence =
    options.confidenceCap &&
    confidenceRank[evidenceConfidence] > confidenceRank[options.confidenceCap]
      ? options.confidenceCap
      : evidenceConfidence;
  const observedLandingTick = options.observedLandingTick ?? options.unharmonizedLanding?.tick;
  return {
    ...(observedLandingTick !== undefined && { observedLandingTick }),
    id: `cadence:${phrase.id}:${kind}:${first.id}:${last.id}` +
      (options.unharmonizedLanding ? `:notes-${options.unharmonizedLanding.tick}` : ""),
    phraseId: phrase.id,
    fromTick: first.fromTick,
    toTick: options.unharmonizedLanding?.endTick ?? last.toTick,
    ...(options.unharmonizedLanding && { unharmonizedLandingTick: options.unharmonizedLanding.tick }),
    kind,
    form: options.form,
    completion: options.completion,
    confidence,
    score,
    spanIds: path.map((item) => item.span.id),
    chordIds: path.flatMap((item) => item.span.regionIds),
    evidence,
  };
}

function resolveConflicts(candidates: readonly CadenceCandidate[]) {
  const byLanding = new Map<string, CadenceCandidate[]>();
  candidates.forEach((item) => {
    const key = `${item.phraseId}:${item.toTick}`;
    const group = byLanding.get(key) ?? [];
    group.push(item);
    byLanding.set(key, group);
  });
  const resolved: CadenceCandidate[] = [];
  for (const group of byLanding.values()) {
    const ordered = [...group].sort(
      (left, right) =>
        right.score - left.score ||
        left.toTick - left.fromTick - (right.toTick - right.fromTick),
    );
    const best = ordered[0];
    const alternative = ordered.find((item) => item.kind !== best.kind);
    if (alternative && best.score - alternative.score < 10) {
      resolved.push({
        ...best,
        confidence: "ambiguous",
        alternatives: [alternative],
      });
    } else {
      resolved.push(best);
    }
  }
  return resolved;
}

function evidenceForPhrase(phrase: PhraseSegment): CadenceEvidence {
  return {
    code: "phrase-boundary",
    value: `乐句 ${phrase.id} 结束于 ${phrase.toTick}`,
    refs: [phrase.endBoundary?.id ?? phrase.id],
  };
}

function spansForPhrase(
  analysis: Pick<HarmonyAnalysis, "harmonySpans" | "slices">,
  phrase: PhraseSegment,
) {
  return analysis.harmonySpans.flatMap((span) => {
    const part = clipHarmonySpan(span, analysis.slices, phrase.fromTick, phrase.toTick);
    if (!part) return [];
    if (part.toTick < span.toTick && phrase.endBoundary?.source !== "manual") {
      const following = analysis.slices[part.sliceIndices.at(-1)! + 1];
      if (following?.tick !== part.toTick || following.attackVoiceIds.length !== 4) return [];
    }
    return [part];
  });
}

interface DominantApproach {
  readonly path: readonly CadenceSpanFacts[];
  readonly evidence: readonly CadenceEvidence[];
}

function dominantApproach(
  facts: readonly CadenceSpanFacts[],
  dominantIndex: number,
  evidenceForGap?: (left: CadenceSpanFacts, right: CadenceSpanFacts) => CadenceEvidence | undefined,
  canInclude?: (item: CadenceSpanFacts) => boolean,
): DominantApproach {
  let start = dominantIndex;
  const evidence: CadenceEvidence[] = [];
  while (start > 0) {
    const left = facts[start - 1], right = facts[start];
    if (canInclude?.(left) === false || !isRootPosition(left) ||
        !isFifthDegreeDominant(left) || !isFifthDegreeDominant(right)) break;
    if (!connectionIsValid(left, right)) {
      if (left.span.toTick >= right.span.fromTick || !sameKey(left.key, right.key) ||
          left.interpretationStatus !== "resolved" || right.interpretationStatus !== "resolved") break;
      const gap = evidenceForGap?.(left, right);
      if (!gap) break;
      evidence.unshift(gap);
    }
    start--;
  }
  const preparation = facts[start - 1];
  if (preparation?.isCadential64 && canInclude?.(preparation) !== false &&
      connectionIsValid(preparation, facts[start])) start--;
  return { path: facts.slice(start, dominantIndex + 1), evidence };
}

function followsTonicRevoicingRelease(
  slices: readonly AnalysisSlice[],
  terminal: CadenceSpanFacts,
  boundary: PhraseSegment["endBoundary"],
  beatTicks: number | undefined,
) {
  const nextIndex = terminal.span.sliceIndices.at(-1)! + 1;
  for (let index = nextIndex; index < slices.length; index++) {
    const slice = slices[index];
    if (!Object.keys(slice.notes).length) continue;
    const rest = slice.tick - terminal.span.toTick;
    if (rest <= 0) return false;
    // An inferred internal ending needs more than a silent analysis subdivision.
    return boundary?.source === "manual" || (beatTicks !== undefined && rest >= beatTicks);
  }
  return true;
}

function isRootPosition(facts: CadenceSpanFacts) {
  return facts.chord !== undefined && chordIdentityInversion(facts.chord.identity) === 0;
}

function fullApproach(
  facts: readonly CadenceSpanFacts[],
  dominantIndex: number,
  tonic: CadenceSpanFacts,
  measure: ReturnType<typeof measureAtTick>,
  approach: DominantApproach,
) {
  if (approach.evidence.length) return approach;
  const first = approach.path[0];
  const subdominant = facts[dominantIndex - approach.path.length];
  if (measure && subdominant?.isSubdominant && subdominant.degree === 4 &&
      isRootPosition(subdominant) && writtenBassMatches(subdominant) &&
      isFifthDegreeDominant(first) && connectionIsValid(subdominant, first) &&
      subdominant.span.fromTick === measure.startTick && tonic.span.fromTick === measure.endTick &&
      subdominant.span.toTick - subdominant.span.fromTick > tonic.span.fromTick - first.span.fromTick) {
    return { ...approach, path: [subdominant, ...approach.path] };
  }
  return approach;
}

function authenticCadence(
  phrase: PhraseSegment,
  approach: DominantApproach,
  tonic: CadenceSpanFacts,
  landingEvidence: CadenceEvidence,
  landingGap?: CadenceEvidence,
  extension?: { readonly path: readonly CadenceSpanFacts[]; readonly evidence: CadenceEvidence },
) {
  const dominant = approach.path.at(-1)!;
  const completion = completionFor(dominant, tonic);
  const path = [...approach.path, tonic, ...(extension?.path ?? [])];
  const bassFormula = hasBassFormula(dominant, tonic, 5, 1);
  const evidence: CadenceEvidence[] = [
    landingEvidence,
    ...approach.evidence,
    ...(landingGap ? [landingGap] : []),
    ...(extension ? [extension.evidence] : []),
    { code: "dominant-to-tonic", value: "当前调性 D -> T" },
  ];
  if (approach.path[0].isCadential64) evidence.push({ code: "cadential64-chain", value: "K46 -> D -> T" });
  if (approach.path[0].isSubdominant) evidence.push({ code: "predominant-to-dominant", value: "强拍下属功能准备随后属、主的完全终止" });
  if (bassFormula) evidence.push({ code: "bass-formula", value: "低音 5 -> 1" });
  evidence.push({ code: "stable-ending", value: "末端主功能稳定" });
  return candidate(phrase, "full", path, evidence, {
    form: "authentic",
    completion,
    observedLandingTick: extension || landingGap?.code === "detached-dominant-to-tonic"
      ? tonic.span.fromTick
      : undefined,
    confidenceCap: completion && bassFormula && tonic.span.toTick === phrase.toTick &&
      !landingGap && !extension
      ? undefined
      : "probable",
  });
}

function isImperfectPlagalClosing(
  source: CadenceSpanFacts,
  target: CadenceSpanFacts,
  lastSourceSlice: AnalysisSlice | undefined,
) {
  const sourceChord = source.chord;
  const targetChord = target.chord;
  const isTriad = ({ identity: { structure } }: AnalysisChord) =>
    structure.kind === "tertian" &&
    (structure.quality === "major" || structure.quality === "minor") &&
    structure.extensions.length === 0 && structure.alterations.length === 0;
  if (!sourceChord || !targetChord || !isTriad(sourceChord) || !isTriad(targetChord) ||
      source.degree !== 4 ||
      !pitchClassEquals(sourceChord.identity.root, scaleDegreePitchClass(source.key, 4)) ||
      !pitchClassEquals(targetChord.identity.root, target.key.tonic) ||
      !writtenBassMatches(source) || !writtenBassMatches(target) || !isRootPosition(target)) return false;

  const inversion = chordIdentityInversion(sourceChord.identity);
  if (inversion !== 0 && inversion !== 1) return false;
  const arrival = target.boundarySlice;
  const soprano = arrival?.notes.soprano;
  const precedingSoprano = lastSourceSlice?.notes.soprano;
  const precedingBass = lastSourceSlice?.notes.bass;
  if (!soprano || !precedingSoprano || !precedingBass ||
      !pitchClassEquals(precedingBass.pitch, sourceChord.identity.bass) ||
      soprano.startTick !== target.span.fromTick ||
      arrival?.notes.bass?.startTick !== target.span.fromTick ||
      pitchClassEquals(soprano.pitch, precedingSoprano.pitch)) return false;

  const [root, third, fifth] = chordIdentityToneSpellings(targetChord.identity);
  return pitchClassEquals(soprano.pitch, third) || pitchClassEquals(soprano.pitch, fifth) ||
    (inversion === 1 && pitchClassEquals(soprano.pitch, root));
}

function hasAuthenticTailAnchor(
  analysis: Pick<HarmonyAnalysis, "project" | "harmonySpans" | "chordById" | "slices" | "phraseSegments">,
  subdominant: CadenceSpanFacts,
  measureFor: (tick: number) => ReturnType<typeof measureAtTick>,
) {
  const spans = analysis.harmonySpans;
  const sourceIndex = spans.findIndex(span => span.id === subdominant.span.id);
  const sourceSpan = spans[sourceIndex];
  const hasSilence = (span: HarmonySpan) => span.sliceIndices.some(sliceIndex =>
    Object.keys(analysis.slices[sliceIndex].notes).length === 0);
  if (!sourceSpan || hasSilence(sourceSpan)) return false;

  let following = factsFor(analysis, sourceSpan);
  for (let index = sourceIndex - 1; index >= 0; index--) {
    const span = spans[index];
    if (span.toTick !== following.span.fromTick || hasSilence(span)) return false;
    const preceding = factsFor(analysis, span);
    if (!connectionIsValid(preceding, following)) return false;

    if (isFifthDegreeDominant(preceding) && following.isTonic) {
      if (following.span.toTick === sourceSpan.fromTick) return true;
      const onset = following.span.fromTick;
      const end = following.span.toTick;
      const measure = measureFor(onset);
      const sustainedTonic = measure?.startTick === onset && end >= measure.endTick;
      const closesPhrase = analysis.phraseSegments.some(phrase =>
        phrase.confidence !== "ambiguous" && onset < phrase.toTick && phrase.toTick <= end);
      return (sustainedTonic || closesPhrase) && isRootPosition(following) &&
        Boolean(writtenBassMatches(preceding) && writtenBassMatches(following));
    }
    if (!preceding.isTonic && !(preceding.isSubdominant && preceding.degree === 4)) return false;
    following = preceding;
  }
  return false;
}

function deceptiveRepriseCandidate(phrase: PhraseSegment, earlier: NonNullable<ReturnType<typeof precedingDetachedDeception>>) {
  return candidate(phrase, "deceptive", [earlier.dominant, earlier.vi], [
    earlier.evidence, { code: "dominant-to-alternative", value: "本调原位属和弦到六级" },
  ], { confidenceCap: "probable", observedLandingTick: earlier.vi.span.fromTick });
}

function articulatedInteriorCadences(
  phrase: PhraseSegment,
  facts: readonly CadenceSpanFacts[],
  slices: readonly AnalysisSlice[],
  measureFor: (tick: number) => MeasureInfo | undefined,
) {
  if (phrase.startBoundary?.source === "manual" || phrase.endBoundary?.source === "manual") return [];
  const candidates: CadenceCandidate[] = [];
  for (let index = 1; index < facts.length - 1; index++) {
    const previous = facts[index - 1], ending = facts[index], following = facts[index + 1];
    const deceptive = ending.family === "tonic" && ending.degree === 6;
    if (!(ending.isTonic || deceptive) || !isFifthDegreeDominant(previous) ||
        !connectionIsValid(previous, ending) || !connectionIsValid(ending, following)) continue;
    const evidence = articulatedEndingEvidence(phrase, previous, ending, following, slices, measureFor);
    if (!evidence) continue;
    if (deceptive) {
      candidates.push(candidate(phrase, "deceptive", [previous, ending], [
        evidence,
        { code: "dominant-to-alternative", value: "当前调性 D -> VI" },
      ], { confidenceCap: "probable" }));
    } else {
      candidates.push(authenticCadence(phrase, dominantApproach(facts, index - 1), ending, evidence));
    }
  }
  return candidates;
}

function halfEndingContinuesThroughPivot(
  analysis: Pick<HarmonyAnalysis, "project" | "harmonySpans" | "chordById" | "slices">,
  previous: CadenceSpanFacts | undefined,
  terminal: CadenceSpanFacts,
  writtenBeatAt: (tick: number) => number | undefined,
) {
  if (!previous || !isFifthDegreeDominant(previous) || !isFifthDegreeDominant(terminal) ||
      !connectionIsValid(previous, terminal)) return false;
  const index = analysis.harmonySpans.findIndex(span =>
    span.id === terminal.span.id && span.toTick === terminal.span.toTick,
  );
  if (index < 0) return false;
  const next = analysis.harmonySpans[index + 1], after = analysis.harmonySpans[index + 2];
  if (!next || !after || analysis.project.structure.phraseBoundaries.some(boundary =>
    boundary.source === "manual" && terminal.span.toTick < boundary.tick && boundary.tick <= after.fromTick,
  )) return false;
  const pivot = factsFor(analysis, next), onward = factsFor(analysis, after);
  return pivot.isTonic && isFifthDegreeDominant(onward) &&
    continuesThroughParallelTonic(previous, terminal, pivot, onward, analysis.slices, writtenBeatAt);
}

type CadenceAnalysis = Pick<HarmonyAnalysis, "project" | "harmonySpans" | "chordById" | "slices" | "phraseSegments">;

function sparseRepriseCandidate(
  analysis: CadenceAnalysis, preparation: CadenceSpanFacts, dominant: CadenceSpanFacts,
  arrival: AnalysisSlice, proof: CadenceEvidence, measureFor: (tick: number) => MeasureInfo | undefined,
) {
  const phrases = analysis.phraseSegments;
  const cuts = phrases.slice(1);
  if (phrases[0]?.fromTick !== 0 || phrases.some(segment => segment.confidence === "ambiguous") ||
      cuts.some(({startBoundary}) => startBoundary?.source !== "inferred" || startBoundary.stale)) return;
  const prior = analysis.harmonySpans.filter(span => span.toTick <= preparation.span.fromTick)
    .map(span => factsFor(analysis, span));
  const earlier = precedingDetachedDeception(analysis, 0, prior, { preparation, dominant, arrival, proof },
    measureFor, cuts.map(segment => segment.fromTick));
  if (!earlier) return;
  const owner = phrases.find(segment => segment.fromTick <= earlier.dominant.span.fromTick &&
    earlier.vi.span.toTick <= segment.toTick);
  return owner && deceptiveRepriseCandidate(owner, earlier);
}

export function detectCadences(analysis: CadenceAnalysis): readonly CadenceCandidate[] {
  const allCandidates: CadenceCandidate[] = [];
  const interiorCandidates: CadenceCandidate[] = [];
  const tonicPedalCandidates: CadenceCandidate[] = [];
  let measures: ReturnType<typeof buildMeasures> | undefined;
  const measureFor = (tick: number) => measureAtTick(measures ??= buildMeasures(analysis.project), tick);
  const writtenBeatAt = (tick: number) => {
    const measure = measureFor(tick);
    return measure && ticksPerBeat(analysis.project.ppq, measure.denominator);
  };
  let metricTimeline: ReturnType<typeof buildMetricTimeline> | undefined;
  const metricAt = (tick: number) => metricPositionAt(metricTimeline ??= buildMetricTimeline(analysis.project), tick);
  const gapEvidence = (left: CadenceSpanFacts, right: CadenceSpanFacts) =>
    dominantNeighborEvidence(left, right, analysis.slices, metricAt);
  for (const phrase of analysis.phraseSegments) {
    if (phrase.confidence === "ambiguous") continue;
    const facts = spansForPhrase(analysis, phrase)
      .map((span) => factsFor(analysis, span));
    interiorCandidates.push(...articulatedInteriorCadences(phrase, facts, analysis.slices, measureFor));
    const terminal = facts.at(-1);
    if (!terminal || terminal.interpretationStatus !== "resolved") continue;
    if (phrase.toTick === analysis.project.lengthTicks && terminal.span.toTick < phrase.toTick &&
        isFifthDegreeDominant(terminal)) {
      const preparation = facts.at(-2);
      const index = terminal.span.sliceIndices.at(-1)!;
      const next = analysis.slices[index + 1];
      const detached = next && Object.keys(next.notes).length === 0;
      const landing = detached ? analysis.slices[index + 2] : next;
      const metric = landing && metricAt(landing.tick);
      if (landing && metric?.confidence === "certain") {
        let evidence: CadenceEvidence | undefined;
        if (detached && preparation) {
          evidence = detachedSparseTonicEvidence(preparation, terminal, landing, analysis.slices,
            writtenBeatAt(terminal.span.fromTick), measureFor(landing.tick)?.startTick);
        } else if (!detached && phrase.confidence === "certain" && metric.role === "downbeat" &&
            landing.tick === terminal.span.toTick && landing.endTick - landing.tick >= (writtenBeatAt(landing.tick) ?? Infinity)) {
          const octave = octaveTonicEndingEvidence(terminal, analysis.slices[index], landing);
          if (octave && !analysis.slices.slice(landing.index + 1).some(slice => Object.keys(slice.notes).length)) evidence = octave;
        }
        if (evidence) {
          if (detached && preparation && !allCandidates.length && !interiorCandidates.length && !tonicPedalCandidates.length) {
            const earlier = sparseRepriseCandidate(analysis, preparation, terminal, landing, evidence, measureFor);
            if (earlier) allCandidates.push(earlier);
          }
          const approach = detached ? undefined : dominantApproach(facts, facts.length - 1, gapEvidence);
          const support: CadenceEvidence[] = [evidenceForPhrase(phrase), ...(approach?.evidence ?? []), evidence,
            { code: "bass-formula", value: "低音 5 -> 1" }];
          if (!detached) support.push({ code: "metric-support", value: "小节强拍齐起，区间止于所见音符释放" });
          allCandidates.push(candidate(phrase, "full", approach?.path ?? [terminal], support, {
            form: "authentic", completion: "perfect", confidenceCap: "probable", unharmonizedLanding: landing,
          }));
          continue;
        }
      }
    }
    const terminalRole = terminal.span.semantics?.cadenceRole;
    if ((terminalRole === "pedal64" || terminalRole === "passing64") &&
        terminal.chord && chordIdentityInversion(terminal.chord.identity) === 2) continue;
    if (terminal.span.toTick !== phrase.toTick) {
      if (phrase.toTick !== analysis.project.lengthTicks) continue;
      const lastRelease = analysis.project.satbTracks.reduce((end, track) =>
        track.notes.reduce((latest, note) => Math.max(latest, note.startTick + note.durationTicks), end), 0);
      if (terminal.span.toTick !== lastRelease) continue;
    }
    const previous = facts.at(-2);
    const previousPrevious = facts.at(-3);
    const phraseEvidence = evidenceForPhrase(phrase);
    const pedalDominant = facts.at(-5);
    const pedalArrival = facts.at(-4);
    if (pedalDominant && pedalArrival && previousPrevious && previous &&
        isFifthDegreeDominant(pedalDominant) && connectionIsValid(pedalDominant, pedalArrival)) {
      const bar = measureFor(pedalArrival.span.fromTick);
      if (bar?.startTick === pedalArrival.span.fromTick && terminal.span.toTick <= bar.endTick) {
        const evidence = closingTonicPedalEvidence(
          pedalDominant, pedalArrival, previousPrevious, previous, terminal, analysis.slices,
          ticksPerBeat(analysis.project.ppq, bar.denominator),
        );
        if (evidence) {
          const approach = dominantApproach(facts, facts.length - 5, gapEvidence);
          tonicPedalCandidates.push(authenticCadence(phrase, approach, pedalArrival, phraseEvidence, undefined, {
            path: [previousPrevious, previous, terminal],
            evidence,
          }));
        }
      }
    }
    const arrivalDominant = facts.at(-4);
    if (arrivalDominant && previousPrevious && previous && isFifthDegreeDominant(arrivalDominant) &&
        connectionIsValid(arrivalDominant, previousPrevious)) {
      const beat = writtenBeatAt(previous.span.fromTick);
      const bar = measureFor(previousPrevious.span.fromTick);
      const sourceKeyEvent = arrivalDominant.boundarySlice?.key.id;
      const withinKeyEvent = (item: CadenceSpanFacts) =>
        item.span.sliceIndices.every(index => analysis.slices[index].key.id === sourceKeyEvent);
      const beginsInsideManualCut = (item: CadenceSpanFacts) => phrase.startBoundary?.source === "manual" &&
        item.span.fromTick === phrase.fromTick && !item.boundarySlice?.attackVoiceIds.length;
      if (beat && bar?.startTick === previousPrevious.span.fromTick &&
          compareMetricStrength(metricAt(previous.span.fromTick), metricAt(previousPrevious.span.fromTick)) === "weaker" &&
          withinKeyEvent(arrivalDominant) && !beginsInsideManualCut(arrivalDominant) &&
          followsTonicRevoicingRelease(analysis.slices, terminal, phrase.endBoundary,
            writtenBeatAt(terminal.span.toTick - 1))) {
        const evidence = closingTonicRevoicingEvidence(
          arrivalDominant, previousPrevious, previous, terminal, analysis.slices, beat,
        );
        if (evidence) {
          const approach = dominantApproach(facts, facts.length - 4, gapEvidence,
            item => withinKeyEvent(item) && !beginsInsideManualCut(item));
          tonicPedalCandidates.push(authenticCadence(phrase, approach, previousPrevious, phraseEvidence, undefined, {
            path: [previous, terminal],
            evidence,
          }));
        }
      }
    }
    const landingGap = previous && terminal.isTonic && isFifthDegreeDominant(previous) &&
      previous.interpretationStatus === "resolved" && sameKey(previous.key, terminal.key) &&
      previous.span.toTick < terminal.span.fromTick &&
      (dominantLandingGapEvidence(previous, terminal, analysis.slices, metricAt, analysis.project.ppq) ??
        tonicBassSuspensionEvidence(previous, terminal, analysis.slices, metricAt,
          writtenBeatAt(previous.span.toTick)) ??
        detachedAuthenticEvidence(previousPrevious, previous, terminal, analysis.slices,
          writtenBeatAt(previous.span.fromTick), measureFor(terminal.span.fromTick)?.startTick));
    const connectsToTerminal = previous && (connectionIsValid(previous, terminal) || landingGap);
    // A single applied label can be tonicization. A local V–I needs the
    // bass formula, or an independently established same-key preparation.
    if (!sameKey(terminal.key, keyAtTick(analysis, terminal.span.fromTick))) {
      if (!previous || !isFifthDegreeDominant(previous) || !terminal.isTonic || !connectsToTerminal) continue;
      const rootPositionClosure = isRootPosition(previous) && isRootPosition(terminal) && hasBassFormula(previous, terminal, 5, 1);
      const establishedInvertedClosure = previousPrevious && connectionIsValid(previousPrevious, previous) &&
        (previousPrevious.isSubdominant || (previousPrevious.isTonic && facts.at(-4)?.isDominant &&
          connectionIsValid(facts[facts.length - 4], previousPrevious))) && completionFor(previous, terminal) === "imperfect" &&
        (!isRootPosition(previous) || !isRootPosition(terminal));
      if (!rootPositionClosure && !establishedInvertedClosure) continue;
    }

    if (
      previous &&
      connectsToTerminal &&
      previous.isDominant &&
      terminal.isTonic
    ) {
      const dominantIndex = facts.length - 2;
      const approach = fullApproach(
        facts, dominantIndex, terminal, measureFor(previous.span.fromTick),
        dominantApproach(facts, dominantIndex, gapEvidence),
      );
      if (landingGap && landingGap.code === "detached-dominant-to-tonic" && previousPrevious && terminal.boundarySlice) {
        const earlier = precedingDetachedDeception(analysis, phrase.fromTick, facts.slice(0, -3), {
          preparation: previousPrevious, dominant: previous, arrival: terminal.boundarySlice, tonic: terminal, proof: landingGap,
        }, measureFor);
        if (earlier) allCandidates.push(deceptiveRepriseCandidate(phrase, earlier));
      }
      allCandidates.push(authenticCadence(phrase, approach, terminal, phraseEvidence, landingGap || undefined));
    }

    if (
      previous &&
      connectionIsValid(previous, terminal) &&
      previous.isSubdominant &&
      terminal.isTonic
    ) {
      const dominant = facts.at(-4);
      const firstTonic = previousPrevious;
      if (
        firstTonic?.isTonic &&
        dominant && isFifthDegreeDominant(dominant) &&
        (previous.degree === 4 || (previous.degree === 2 && hasBassFormula(previous, terminal, 4, 1))) &&
        writtenBassMatches(previous) && writtenBassMatches(terminal) &&
        connectionIsValid(dominant, firstTonic) &&
        connectionIsValid(firstTonic, previous) &&
        completionFor(dominant, firstTonic) === "perfect"
      ) {
        const onset = firstTonic.span.fromTick;
        const measure = measureFor(onset);
        const soprano = firstTonic.boundarySlice?.notes.soprano;
        const dominantIndex = facts.length - 4;
        const dominantPath = dominantApproach(facts, dominantIndex, gapEvidence);
        const preparation = dominantPath.path[0];
        const preparedPedal = preparation.isCadential64 && previous.span.semantics?.cadenceRole === "pedal64" &&
          previous.chord && pitchClassEquals(previous.chord.identity.bass, firstTonic.key.tonic);
        if (
          measure?.startTick === onset &&
          soprano?.startTick === onset &&
          (firstTonic.span.toTick >= measure.endTick || preparedPedal ||
            analysis.slices.filter(slice => onset <= slice.tick && slice.tick < terminal.span.toTick)
              .every(slice => slice.notes.soprano?.pitch.octave === soprano.pitch.octave &&
                pitchClassEquals(slice.notes.soprano.pitch, soprano.pitch)))
        ) {
          const approach = fullApproach(
            facts, dominantIndex, firstTonic, measureFor(dominant.span.fromTick), dominantPath,
          );
          allCandidates.push(authenticCadence(phrase, approach, firstTonic, {
            code: "metric-support",
            value: "小节强拍落主，正格收束后紧接句末补充变格",
            refs: [firstTonic.span.id, previous.span.id, terminal.span.id],
          }));
        }
      }
      const lastSourceSlice = analysis.slices[previous.span.sliceIndices.at(-1)!];
      if (isImperfectPlagalClosing(previous, terminal, lastSourceSlice) &&
          !hasAuthenticTailAnchor(analysis, previous, measureFor)) {
        allCandidates.push(candidate(phrase, "full", [previous, terminal], [
          phraseEvidence,
          { code: "predominant-to-tonic", value: "句末独立变格收束 S -> T" },
          { code: "stable-ending", value: "末端主功能稳定" },
        ], { form: "plagal", completion: "imperfect", confidenceCap: "probable" }));
        continue;
      }
      if (firstTonic?.isTonic && previous.degree === 4 && phrase.endBoundary?.source !== "manual" &&
          connectionIsValid(firstTonic, previous) &&
          compareMetricStrength(metricAt(previous.span.fromTick), metricAt(firstTonic.span.fromTick)) === "weaker" &&
          isWrittenAuxiliaryReturn(firstTonic, previous, terminal, analysis.slices) &&
          !hasAuthenticTailAnchor(analysis, previous, measureFor) &&
          ![allCandidates, interiorCandidates, tonicPedalCandidates].some(candidates =>
            candidates.some(item => item.kind === "full" && item.form === "authentic" &&
              item.confidence !== "ambiguous" && item.toTick <= firstTonic.span.fromTick))) continue;
      allCandidates.push(
        candidate(
          phrase,
          "supplementary",
          [previous, terminal],
          [
            phraseEvidence,
            { code: "predominant-to-tonic", value: "当前调性 S -> T" },
            { code: "stable-ending", value: "末端主功能稳定" },
          ],
          { form: "plagal" },
        ),
      );
    }

    if (
      previous &&
      connectionIsValid(previous, terminal) &&
      previous.isDominant &&
      terminal.family === "tonic" &&
      terminal.degree !== 1
    ) {
      allCandidates.push(
        candidate(
          phrase,
          "deceptive",
          [previous, terminal],
          [
            phraseEvidence,
            { code: "dominant-to-alternative", value: "当前调性 D -> 非 I 级主功能" },
          ],
        ),
      );
    }

    if (terminal.isSubdominant && terminal.degree === 4 && previous?.isTonic &&
        connectionIsValid(previous, terminal) && terminal.chord && chordIdentityInversion(terminal.chord.identity) === 0 &&
        writtenBassMatches(terminal) && phrase.toTick < analysis.project.lengthTicks) {
      allCandidates.push(candidate(phrase, "half", [previous, terminal], [
        phraseEvidence,
        { code: "stable-ending", value: "中间乐句停于本调四级下属和弦" },
      ], { form: "plagal", confidenceCap: "probable" }));
    }

    if (
      isDominantHalfEnding(terminal) &&
      terminal.isStable &&
      (!previous || previous.span.toTick === terminal.span.fromTick ||
        (isFifthDegreeDominant(terminal) && writtenBassMatches(terminal) &&
          (isRootPosition(terminal) || phrase.endBoundary?.source === "manual")))
    ) {
      if (phrase.endBoundary?.source === "inferred" && terminal.span.toTick < analysis.project.lengthTicks &&
          halfEndingContinuesThroughPivot(analysis, previous, terminal, writtenBeatAt)) continue;
      const approach = dominantApproach(facts, facts.length - 1, gapEvidence);
      allCandidates.push(
        candidate(
          phrase,
          "half",
          approach.path,
          [phraseEvidence, ...approach.evidence, { code: "ends-on-dominant", value: "乐句末端为属功能" }],
          { form: isFifthDegreeDominant(terminal) ? "authentic" : undefined },
        ),
      );
    }
  }
  // An existing cadence at the same landing still owns its structural evidence.
  const landingKey = (item: CadenceCandidate) => `${item.phraseId}:${item.toTick}`;
  const ordinaryLandings = new Set(allCandidates.map(landingKey));
  const known = [...allCandidates, ...interiorCandidates.filter(item => !ordinaryLandings.has(landingKey(item)))];
  // Keep an independently detected cadence at the same ending, including a supplementary one.
  const knownLandings = new Set(known.map(landingKey));
  return Object.freeze(resolveConflicts([
    ...known,
    ...tonicPedalCandidates.filter(item => !knownLandings.has(landingKey(item))),
  ]));
}
