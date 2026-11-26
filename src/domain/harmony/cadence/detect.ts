import {
  chordIdentityInversion,
  chordIdentityToneSpellings,
  chordStructureQuality,
  type FunctionalFamily,
  type KeyReference,
} from "../../chordModel";
import { effectiveFunctionalDesignation } from "../../functionalHarmonyCatalog";
import {
  keyEquals,
  leadingTonePitchClass,
  pitchClassEquals,
  pitchClassValue,
  scaleDegreePitchClass,
} from "../../pitch";
import { buildMeasures, measureAtTick, ticksPerBeat, type MeasureInfo } from "../../time";
import { buildMetricTimeline, compareMetricStrength, metricPositionAt } from "../../rhythm/metric";
import { crossesTonalBoundary, tonalReading } from "../facts/localTonality";
import { resolvesInVoice } from "../facts/tendencyResolution";
import { VOICE_ORDER } from "../../project/voice";
import { authenticBassFormula } from "./bassFormula";
import { createSliceStructuralVoicingReader } from "../facts/writtenVoicing";
import {
  closingTonicDecorationEvidence,
  structuralCadentialArrival,
  structuralCadentialBass,
  structuralCadentialEvidence,
  dominantNeighborEvidence,
  detachedAuthenticEvidence,
  detachedSparseTonicEvidence,
  dominantLandingGapEvidence,
  tonicBassSuspensionEvidence,
  stagedTonicArrivalEvidence,
  closingTonicPedalEvidence,
  closingTonicRevoicingEvidence,
  octaveTonicEndingEvidence,
} from "./authenticEndings";
import {
  continuesThroughParallelTonic,
  isWrittenAuxiliaryReturn,
  precedingDetachedDeception,
  articulatedEndingEvidence,
  dorianPlagalEnding,
  writtenDeceptiveClausula,
} from "./phraseEndings";
import type { AnalysisChord, AnalysisSlice, HarmonyAnalysis, HarmonySpan } from "../analysis";
import { isCadential64Span } from "../rules/connector";
import type { PhraseSegment } from "../phrase";
import {
  clipHarmonySpan,
  sliceWithinSpan,
  type CadenceCandidate,
  type CadenceConfidence,
  type CadenceCompletion,
  type CadenceEvidence,
  type CadenceForm,
  type CadenceKind,
  type CadenceSpanFacts,
} from "./model";

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
  return Boolean(left && right && keyEquals(left, right));
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

function factsFor(
  analysis: Pick<HarmonyAnalysis, "project" | "chordById" | "slices">,
  span: HarmonySpan,
  readStructural?: ReturnType<typeof createSliceStructuralVoicingReader>,
): CadenceSpanFacts {
  const chord = representativeChord(analysis, span);
  const slice = boundarySlice(analysis, span);
  const writtenKey = keyAtTick(analysis, span.fromTick);
  const { interpretation, confidence: semanticConfidence, key: localKey } = tonalReading(span.semantics, writtenKey);
  const unavailable = !span.semantics || !chord || !interpretation;
  const ambiguous =
    span.status !== "complete" ||
    semanticConfidence === "ambiguous" ||
    semanticConfidence === "unknown" ||
    Boolean(interpretation?.appliedTarget);
  const family = ambiguous ? undefined : familyOf(span, chord);
  const degree = ambiguous ? undefined : interpretation?.degree;
  let releaseTick: number | undefined;
  for (let index = span.sliceIndices.length - 1; index >= 0; index--) {
    const slice = analysis.slices[span.sliceIndices[index]];
    if (Object.keys(slice.notes).length) {
      releaseTick = Math.min(span.toTick, slice.endTick);
      break;
    }
  }
  return {
    span,
    releaseTick,
    key: localKey,
    writtenKey,
    hardBoundaryBefore: crossesTonalBoundary(analysis.project, span.fromTick - 1, span.fromTick),
    chord,
    boundarySlice: slice,
    structuralArrival: slice?.chord && readStructural?.(slice.index, slice.chord.identity),
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
    sameKey(previous.writtenKey, current.writtenKey) &&
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
  const sourceBass = structuralCadentialBass(source);
  const targetBass = structuralCadentialBass(target);
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
  const bass = structuralCadentialBass(facts);
  return bass && facts.chord && pitchClassEquals(bass.pitch, facts.chord.identity.bass);
}

function completionFor(
  source: CadenceSpanFacts,
  target: CadenceSpanFacts,
): CadenceCompletion | undefined {
  if (!isFifthDegreeDominant(source) || !target.isTonic) return undefined;
  const formula = authenticBassFormula(target.key, source.chord?.identity, target.chord?.identity,
    structuralCadentialBass(source)?.pitch, structuralCadentialBass(target)?.pitch);
  if (!formula || formula === "inverted") return formula ? "imperfect" : undefined;
  const soprano = structuralCadentialArrival(target)?.voices.find(item => item.voice === "soprano")?.structural ??
    target.boundarySlice?.notes.soprano;
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
    readonly landingTick?: number;
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
    landingTick: options.landingTick ?? observedLandingTick ?? last.fromTick,
    toTick: options.unharmonizedLanding?.endTick ?? path.at(-1)!.releaseTick ?? last.toTick,
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

function cadenceLandingKey(item: CadenceCandidate) {
  return `${item.phraseId}:${item.toTick}`;
}

function resolveConflicts(candidates: readonly CadenceCandidate[]) {
  const byLanding = new Map<string, CadenceCandidate[]>();
  candidates.forEach((item) => {
    const key = cadenceLandingKey(item);
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
    if (canInclude?.(left) === false || (!isRootPosition(left) &&
        !(writtenBassMatches(left) && writtenBassMatches(right) && !isRootPosition(right))) ||
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

function beginsInsideManualCut(phrase: PhraseSegment, item: CadenceSpanFacts) {
  return phrase.startBoundary?.source === "manual" && item.span.fromTick === phrase.fromTick &&
    !item.boundarySlice?.attackVoiceIds.length;
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

function predominant(fact: CadenceSpanFacts | undefined): boolean {
  return Boolean(fact?.isSubdominant && !fact.span.semantics?.cadenceRole &&
    fact.degree !== undefined && [2, 4, 6].includes(fact.degree) && writtenBassMatches(fact));
}

function predominantRun(facts: readonly CadenceSpanFacts[], start: number, floor: number) {
  let index = start;
  while (index > 0 && predominant(facts[index - 1]) &&
      facts[index - 1].degree === facts[index].degree &&
      facts[index - 1].span.fromTick >= floor && connectionIsValid(facts[index - 1], facts[index])) index--;
  return facts.slice(index, start + 1);
}

function halfApproach(
  facts: readonly CadenceSpanFacts[], index: number,
  { analysis, gapEvidence, writtenBeatAt, measureFor }: CadenceDetectionContext, phrase: PhraseSegment,
): DominantApproach {
  const validStart = (item: CadenceSpanFacts) => !beginsInsideManualCut(phrase, item);
  const approach = dominantApproach(facts, index, gapEvidence, validStart);
  const first = approach.path[0];
  const previousIndex = index - approach.path.length;
  const previous = facts[previousIndex];
  const terminal = facts[index];
  const beat = writtenBeatAt(first.span.fromTick);
  if (!previous || !beat || first.isCadential64 || !isFifthDegreeDominant(first) || !validStart(previous)) return approach;
  const applied = tonalReading(previous.span.semantics, previous.writtenKey).interpretation;
  const lastApplied = analysis.slices[previous.span.sliceIndices.at(-1)!];
  if (applied?.appliedTarget?.degree === 5 && applied.degree === 5 && previous.span.status === "complete" &&
      sameKey(previous.writtenKey, first.writtenKey) && !first.hardBoundaryBefore &&
      previous.span.toTick === first.span.fromTick && sameKey(first.key, previous.key) &&
      previous.chord && first.chord && first.boundarySlice && isRootPosition(first) &&
      pitchClassEquals(previous.chord.identity.root, scaleDegreePitchClass(first.key, 2)) &&
      resolvesLeadingTone(lastApplied, first.boundarySlice, first.chord.identity.root)) {
    const diatonic = facts[previousIndex - 1];
    const preparation = diatonic && validStart(diatonic) && predominant(diatonic) && diatonic.chord &&
      diatonic.span.toTick === previous.span.fromTick && sameKey(diatonic.key, previous.key) &&
      pitchClassEquals(diatonic.chord.identity.root, previous.chord.identity.root) ? [diatonic, previous] : [previous];
    return { path: [...preparation, ...approach.path], evidence: approach.evidence };
  }
  if (!connectionIsValid(previous, first)) return approach;
  const bar = measureFor(first.span.fromTick);
  const arrivalLength = terminal.span.toTick - first.span.fromTick;
  if (previous.span.semantics?.cadenceRole === "pedal64") {
    const anchor = facts[previousIndex - 1];
    const heldBass = anchor?.boundarySlice?.notes.bass;
    const middleBass = previous.boundarySlice?.notes.bass;
    const returnBass = first.boundarySlice?.notes.bass;
    if (anchor && validStart(anchor) && isFifthDegreeDominant(anchor) && isRootPosition(anchor) &&
        connectionIsValid(anchor, previous) && heldBass && middleBass && returnBass &&
        pitchClassEquals(heldBass.pitch, middleBass.pitch) && pitchClassEquals(middleBass.pitch, returnBass.pitch) &&
        heldBass.pitch.octave === middleBass.pitch.octave && middleBass.pitch.octave === returnBass.pitch.octave) {
      return { ...approach, path: [anchor, previous, ...approach.path] };
    }
  }
  if (arrivalLength < beat || !isRootPosition(first) || !writtenBassMatches(first)) return approach;
  const floor = Math.max(phrase.fromTick, (bar?.startTick ?? first.span.fromTick) -
    (bar ? bar.endTick - bar.startTick : beat * 2));
  if (predominant(previous) && previous.span.fromTick >= floor &&
      (previous.degree !== 2 || isRootPosition(terminal) || arrivalLength <= 2 * beat))
    return { ...approach, path: [...predominantRun(facts, previousIndex, floor).filter(validStart), ...approach.path] };
  const startsRevoicedTonic = previous.isTonic && writtenBassMatches(previous) &&
    (previousIndex > 0 && facts[previousIndex - 1].isTonic ||
      previous.span.fromTick === measureFor(previous.span.fromTick)?.startTick);
  if (startsRevoicedTonic && previous.span.toTick - previous.span.fromTick <= beat &&
      arrivalLength >= 2 * beat && isRootPosition(terminal))
    return { ...approach, path: [previous, ...approach.path] };
  return approach;
}

function halfLandingTick(approach: DominantApproach) {
  const arrival = approach.path.find(fact => isFifthDegreeDominant(fact) &&
    isRootPosition(fact) && writtenBassMatches(fact)) ?? approach.path.at(-1)!;
  return arrival.span.fromTick;
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
  const preparationIndex = dominantIndex - approach.path.length;
  const subdominant = facts[preparationIndex];
  if (measure && subdominant && predominant(subdominant) && isFifthDegreeDominant(first) &&
      connectionIsValid(subdominant, first) && connectionIsValid(facts[dominantIndex], tonic)) {
    const approachLength = tonic.span.fromTick - first.span.fromTick;
    const prepLength = subdominant.span.toTick - subdominant.span.fromTick;
    const withinCadentialBar = subdominant.span.fromTick >= measure.startTick &&
      tonic.span.fromTick === measure.endTick && prepLength > approachLength;
    const acrossCadentialBar = first.span.fromTick === measure.startTick &&
      tonic.span.fromTick <= measure.endTick && prepLength > approachLength &&
      prepLength <= (measure.endTick - measure.startTick) && isRootPosition(first) &&
      subdominant.degree === 2;
    if (withinCadentialBar || acrossCadentialBar) {
      const floor = withinCadentialBar ? measure.startTick : subdominant.span.fromTick;
      return { ...approach, path: [...predominantRun(facts, preparationIndex, floor), ...approach.path] };
    }
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
  const structural = [dominant, tonic].flatMap(facts => structuralCadentialEvidence(facts) ?? []);
  const evidence: CadenceEvidence[] = [
    landingEvidence,
    ...approach.evidence,
    ...structural,
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
    landingTick: tonic.span.fromTick,
    observedLandingTick: extension || landingGap?.code === "detached-dominant-to-tonic" ||
      landingGap?.code === "staged-tonic-arrival"
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

function isAuthenticTailDominant(
  dominant: CadenceSpanFacts, slices: readonly AnalysisSlice[], localPlagalKey?: KeyReference,
) {
  if (!isFifthDegreeDominant(dominant)) return false;
  if (!localPlagalKey) return true;
  const frame = slices[dominant.span.sliceIndices.at(-1)!];
  const leading = leadingTonePitchClass(localPlagalKey);
  return frame && Object.values(frame.notes).some(note =>
    !note.nonChordToneRole && pitchClassEquals(note.pitch, leading));
}

function hasAuthenticTailAnchor(
  analysis: Pick<HarmonyAnalysis, "project" | "harmonySpans" | "chordById" | "slices" | "phraseSegments">,
  subdominant: CadenceSpanFacts,
  measureFor: (tick: number) => ReturnType<typeof measureAtTick>,
  localPlagalKey?: KeyReference,
) {
  const spans = analysis.harmonySpans;
  const sourceIndex = spans.findIndex(span => span.id === subdominant.span.id);
  const sourceSpan = spans[sourceIndex];
  const hasSilence = (span: HarmonySpan) => span.sliceIndices.some(sliceIndex =>
    Object.keys(analysis.slices[sliceIndex].notes).length === 0);
  if (!sourceSpan || hasSilence(sourceSpan)) return false;

  let following = localPlagalKey ? { ...subdominant, key: localPlagalKey } : factsFor(analysis, sourceSpan);
  for (let index = sourceIndex - 1; index >= 0; index--) {
    const span = spans[index];
    if (span.toTick !== following.span.fromTick || hasSilence(span)) return false;
    const preceding = factsFor(analysis, span);
    if (!connectionIsValid(preceding, following) ||
        (!sameKey(subdominant.key, subdominant.writtenKey) &&
          crossesTonalBoundary(analysis.project, preceding.span.fromTick, following.span.fromTick))) return false;

    if (isAuthenticTailDominant(preceding, analysis.slices, localPlagalKey) && following.isTonic) {
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
  ], {
    form: isFifthDegreeDominant(earlier.dominant) ? "authentic" : undefined,
    confidenceCap: "probable",
    observedLandingTick: earlier.vi.span.fromTick,
  });
}

function isSubmediant(fact: CadenceSpanFacts) {
  return fact.family === "tonic" && fact.degree === 6;
}

function continuesSubmediant(left: CadenceSpanFacts, right: CadenceSpanFacts) {
  return isSubmediant(left) && isSubmediant(right) && connectionIsValid(left, right) &&
    left.chord && right.chord && pitchClassEquals(left.chord.identity.root, right.chord.identity.root);
}

function deceptiveCadence(
  phrase: PhraseSegment,
  approach: DominantApproach,
  ending: readonly CadenceSpanFacts[],
  landingEvidence: CadenceEvidence,
  confidenceCap?: CadenceConfidence,
) {
  const evidence: CadenceEvidence[] = [
    landingEvidence,
    ...approach.evidence,
    { code: "dominant-to-alternative", value: "当前调性 D -> 非 I 级主功能" },
  ];
  if (approach.path[0].isCadential64) {
    evidence.push({ code: "cadential64-chain", value: "K46 -> D -> VI" });
  }
  return candidate(phrase, "deceptive", [...approach.path, ...ending], evidence, {
    form: isFifthDegreeDominant(approach.path.at(-1)!) ? "authentic" : undefined,
    confidenceCap,
    landingTick: ending[0].span.fromTick,
    observedLandingTick: ending.length > 1 ? ending[0].span.fromTick : undefined,
  });
}

function interiorDeceptiveEvidence(
  phrase: PhraseSegment,
  approach: DominantApproach,
  dominant: CadenceSpanFacts,
  ending: CadenceSpanFacts,
  metricAt: (tick: number) => ReturnType<typeof metricPositionAt>,
  writtenBeatAt: (tick: number) => number | undefined,
): CadenceEvidence | undefined {
  const onset = ending.span.fromTick;
  const metric = metricAt(onset);
  const beat = writtenBeatAt(onset);
  if (!beat || !metric || metric.confidence !== "certain" || metric.level < 2 ||
      ending.span.toTick - onset < beat * 2) return;
  const preparation = approach.path[0];
  if (preparation.isCadential64) {
    return {
      code: "metric-support",
      value: "终止四六准备后，六级在强拍或次强拍持续至少两拍",
      refs: [preparation.span.id, ending.span.id],
    };
  }

  const dominantOnset = dominant.span.fromTick;
  const dominantBeat = writtenBeatAt(dominantOnset);
  if (metric.role === "downbeat" && onset >= phrase.fromTick + (phrase.toTick - phrase.fromTick) * 0.4 &&
      (metricAt(dominantOnset)?.measureNumber ?? 0) >= 2 && dominantBeat &&
      dominant.span.toTick - dominantOnset >= dominantBeat * 2 &&
      isRootPosition(dominant) && writtenBassMatches(dominant)) {
    return {
      code: "metric-support",
      value: "乐句中后段原位属与原位六级各持续至少两拍，六级落在小节强拍",
      refs: [dominant.span.id, ending.span.id],
    };
  }
}

function articulatedInteriorCadences(
  phrase: PhraseSegment,
  facts: readonly CadenceSpanFacts[],
  context: CadenceDetectionContext,
) {
  const { analysis: { slices }, measureFor, metricAt, writtenBeatAt, gapEvidence } = context;
  const candidates: CadenceCandidate[] = [];
  for (let index = 1; index < facts.length; index++) {
    const previous = facts[index - 1], ending = facts[index], following = facts[index + 1];
    const clausula = !beginsInsideManualCut(phrase, previous) && writtenDeceptiveClausula(
      facts[index - 2], previous, ending, slices, metricAt(ending.span.fromTick), writtenBeatAt(ending.span.fromTick));
    if (clausula) {
      const approach = dominantApproach(facts, index - 1, gapEvidence, item => !beginsInsideManualCut(phrase, item));
      candidates.push(candidate(phrase, "deceptive", [...approach.path, ending], [clausula, ...approach.evidence],
        { form: "authentic", confidenceCap: "probable" }));
    }
    if (!following) continue;
    const breath = writtenEndingRest(slices, ending, following.span.fromTick, writtenBeatAt);
    if (breath && isFifthDegreeDominant(ending) && isRootPosition(ending) && writtenBassMatches(ending) &&
        !isFifthDegreeDominant(following) && !following.isTonic && !isSubmediant(following) &&
        connectionIsValid(previous, ending)) {
      const approach = halfApproach(facts, index, context, phrase);
      if (approach.path[0] !== ending) candidates.push(candidate(phrase, "half", approach.path,
        [breath, ...approach.evidence, { code: "ends-on-dominant", value: "属和声在实际齐休前收束" }],
        { form: "authentic", landingTick: halfLandingTick(approach), confidenceCap: "probable" }));
    }
    const deceptive = isSubmediant(ending);
    if (!(deceptive || ending.isTonic) || !isFifthDegreeDominant(previous) ||
        !connectionIsValid(previous, ending) || beginsInsideManualCut(phrase, previous)) continue;
    const evidence = connectionIsValid(ending, following)
      ? articulatedEndingEvidence(phrase, previous, ending, following, slices, measureFor)
      : undefined;
    const approach = dominantApproach(facts, index - 1, gapEvidence, item => !beginsInsideManualCut(phrase, item));
    if (!deceptive) {
      // Ordinary tonic motion needs a rhythmic clause ending. A written K46
      // can also establish one, but only with a sustained structural tonic.
      const metric = metricAt(ending.span.fromTick);
      const beat = writtenBeatAt(ending.span.fromTick);
      const completion = completionFor(previous, ending);
      const prepared = approach.path[0].isCadential64 && completion === "perfect" && beat &&
        metric?.confidence === "certain" && metric.level >= 2 &&
        ending.span.toTick - ending.span.fromTick >= beat && !isFifthDegreeDominant(following) &&
        ending.boundarySlice?.attackVoiceIds.length === 4;
      const detachedImperfect = completion === "imperfect" && approach.path[0].isCadential64 &&
        metric?.role === "downbeat" && writtenBassMatches(ending);
      const support = evidence ?? (completion === "perfect" || detachedImperfect ? breath : undefined) ?? (prepared ? {
        code: "metric-support" as const, value: "终止四六准备后，四声在强位明确落主并持续",
      } : undefined);
      if (!support || !completion) continue;
      const path = evidence ? approach : fullApproach(facts, index - 1, ending, measureFor(previous.span.fromTick), approach);
      const afterRevoicing = facts[index + 2];
      const revoicing = prepared && following.isTonic && !isRootPosition(following) &&
        following.chord && chordIdentityInversion(following.chord.identity) === 1 &&
        writtenBassMatches(following) && !following.span.semantics?.cadenceRole &&
        connectionIsValid(ending, following) &&
        compareMetricStrength(metricAt(following.span.fromTick), metric) === "weaker" &&
        afterRevoicing && predominant(afterRevoicing) && connectionIsValid(following, afterRevoicing);
      candidates.push(authenticCadence(phrase, path, ending, support, undefined, revoicing ? {
        path: [following], evidence: { code: "closing-tonic-revoicing", value: "主功能转位后才进入后续下属材料" },
      } : undefined));
      continue;
    }

    if (!isRootPosition(ending) || !writtenBassMatches(ending) ||
        continuesSubmediant(ending, following)) continue;
    const supportedRest = approach.path[0].isCadential64 && isRootPosition(previous) &&
      hasBassFormula(previous, ending, 5, 6) ? breath : undefined;
    const support = evidence ?? supportedRest ??
      interiorDeceptiveEvidence(phrase, approach, previous, ending, metricAt, writtenBeatAt);
    if (support) {
      candidates.push(deceptiveCadence(phrase, approach, [ending], support, "probable"));
    }
  }
  return candidates;
}

function writtenEndingRest(
  slices: readonly AnalysisSlice[], ending: CadenceSpanFacts, restart: number,
  writtenBeatAt: CadenceDetectionContext["writtenBeatAt"],
): CadenceEvidence | undefined {
  const release = ending.span.toTick;
  const beat = writtenBeatAt(release - 1);
  const frame = slices[ending.span.sliceIndices.at(-1)!];
  if (!beat || !frame || restart - release < beat / 2 ||
      release - ending.span.fromTick < beat) return;
  const notes = Object.values(frame.notes);
  if (notes.length < 3 || notes.some(note => note.startTick + note.durationTicks !== release)) return;
  let through = release;
  for (let i = frame.index + 1; through < restart && i < slices.length; i++) {
    const next = slices[i];
    if (next.tick !== through || Object.keys(next.notes).length) return;
    through = next.endTick;
  }
  if (through < restart) return;
  return { code: "articulated-interior-ending", value: "三个以上声部在实际休止前同时释放",
    refs: notes.map(note => note.id) };
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

interface CadenceDetectionContext {
  readonly analysis: CadenceAnalysis;
  readonly measureFor: (tick: number) => MeasureInfo | undefined;
  readonly writtenBeatAt: (tick: number) => number | undefined;
  readonly metricAt: (tick: number) => ReturnType<typeof metricPositionAt>;
  readonly gapEvidence: (left: CadenceSpanFacts, right: CadenceSpanFacts) => CadenceEvidence | undefined;
}

function createDetectionContext(analysis: CadenceAnalysis): CadenceDetectionContext {
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
  return { analysis, measureFor, writtenBeatAt, metricAt, gapEvidence };
}

interface PhraseEnding {
  readonly phrase: PhraseSegment;
  readonly facts: readonly CadenceSpanFacts[];
  readonly terminal: CadenceSpanFacts;
  readonly previous: CadenceSpanFacts | undefined;
  readonly previousPrevious: CadenceSpanFacts | undefined;
  readonly phraseEvidence: CadenceEvidence;
}

interface CadenceCandidates {
  readonly ordinary: CadenceCandidate[];
  readonly interior: CadenceCandidate[];
  readonly tonicTails: CadenceCandidate[];
}

function sparseRepriseCandidate(
  { analysis, measureFor }: CadenceDetectionContext, preparation: CadenceSpanFacts, dominant: CadenceSpanFacts,
  arrival: AnalysisSlice, proof: CadenceEvidence,
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

function detectDetachedTonicEnding(
  context: CadenceDetectionContext, phrase: PhraseSegment, facts: readonly CadenceSpanFacts[],
  terminal: CadenceSpanFacts, candidates: CadenceCandidates,
) {
  const { analysis, measureFor, metricAt, writtenBeatAt, gapEvidence } = context;
  if (phrase.toTick !== analysis.project.lengthTicks || !(terminal.span.toTick < phrase.toTick) ||
      !isFifthDegreeDominant(terminal)) return false;

  const preparation = facts.at(-2);
  const index = terminal.span.sliceIndices.at(-1)!;
  const next = analysis.slices[index + 1];
  const detached = next && Object.keys(next.notes).length === 0;
  const landing = detached ? analysis.slices[index + 2] : next;
  const metric = landing && metricAt(landing.tick);
  if (!landing || metric?.confidence !== "certain") return false;

  let evidence: CadenceEvidence | undefined;
  if (detached && preparation) {
    evidence = detachedSparseTonicEvidence(preparation, terminal, landing, analysis.slices,
      writtenBeatAt(terminal.span.fromTick), measureFor(landing.tick)?.startTick);
  } else if (!detached && phrase.confidence === "certain" && metric.role === "downbeat" &&
      landing.tick === terminal.span.toTick && landing.endTick - landing.tick >= (writtenBeatAt(landing.tick) ?? Infinity)) {
    const octave = octaveTonicEndingEvidence(terminal, analysis.slices[index], landing);
    if (octave && !analysis.slices.slice(landing.index + 1).some(slice => Object.keys(slice.notes).length)) evidence = octave;
  }
  if (!evidence) return false;

  const { ordinary, interior, tonicTails } = candidates;
  if (detached && preparation && !ordinary.length && !interior.length && !tonicTails.length) {
    const earlier = sparseRepriseCandidate(context, preparation, terminal, landing, evidence);
    if (earlier) ordinary.push(earlier);
  }
  const approach = detached ? undefined : dominantApproach(facts, facts.length - 1, gapEvidence);
  const support: CadenceEvidence[] = [evidenceForPhrase(phrase), ...(approach?.evidence ?? []), evidence,
    { code: "bass-formula", value: "低音 5 -> 1" }];
  if (!detached) support.push({ code: "metric-support", value: "小节强拍齐起，区间止于所见音符释放" });
  ordinary.push(candidate(phrase, "full", approach?.path ?? [terminal], support, {
    form: "authentic", completion: "perfect", confidenceCap: "probable", unharmonizedLanding: landing,
  }));
  return true;
}

function hasHarmonizedPhraseEnd({ analysis, writtenBeatAt }: CadenceDetectionContext,
  phrase: PhraseSegment, terminal: CadenceSpanFacts) {
  const terminalRole = terminal.span.semantics?.cadenceRole;
  if ((terminalRole === "pedal64" || terminalRole === "passing64") &&
      terminal.chord && chordIdentityInversion(terminal.chord.identity) === 2) return false;
  if (terminal.span.toTick === phrase.toTick) return true;
  if (phrase.toTick !== analysis.project.lengthTicks) {
    return Boolean(writtenEndingRest(analysis.slices, terminal, phrase.toTick, writtenBeatAt));
  }
  const lastRelease = analysis.project.satbTracks.reduce((end, track) =>
    track.notes.reduce((latest, note) => Math.max(latest, note.startTick + note.durationTicks), end), 0);
  return terminal.span.toTick === lastRelease;
}

function detectClosingTonicPedal(
  { analysis, measureFor, gapEvidence }: CadenceDetectionContext,
  { phrase, facts, terminal, previous, previousPrevious, phraseEvidence }: PhraseEnding,
  tonicTails: CadenceCandidate[],
) {
  const dominant = facts.at(-5);
  const arrival = facts.at(-4);
  if (!dominant || !arrival || !previousPrevious || !previous ||
      !isFifthDegreeDominant(dominant) || !connectionIsValid(dominant, arrival)) return;

  const bar = measureFor(arrival.span.fromTick);
  if (bar?.startTick !== arrival.span.fromTick || !(terminal.span.toTick <= bar.endTick)) return;
  const evidence = closingTonicPedalEvidence(
    dominant, arrival, previousPrevious, previous, terminal, analysis.slices,
    ticksPerBeat(analysis.project.ppq, bar.denominator),
  );
  if (!evidence) return;

  const approach = dominantApproach(facts, facts.length - 5, gapEvidence);
  tonicTails.push(authenticCadence(phrase, approach, arrival, phraseEvidence, undefined, {
    path: [previousPrevious, previous, terminal],
    evidence,
  }));
}

function detectClosingTonicRevoicing(
  { analysis, measureFor, metricAt, writtenBeatAt, gapEvidence }: CadenceDetectionContext,
  { phrase, facts, terminal, previous, previousPrevious: arrival, phraseEvidence }: PhraseEnding,
  tonicTails: CadenceCandidate[],
) {
  const dominant = facts.at(-4);
  if (!dominant || !arrival || !previous || !isFifthDegreeDominant(dominant) ||
      !connectionIsValid(dominant, arrival)) return;

  const beat = writtenBeatAt(previous.span.fromTick);
  const bar = measureFor(arrival.span.fromTick);
  const sourceKeyEvent = dominant.boundarySlice?.key.id;
  const withinKeyEvent = (item: CadenceSpanFacts) =>
    item.span.sliceIndices.every(index => analysis.slices[index].key.id === sourceKeyEvent);
  if (!beat || bar?.startTick !== arrival.span.fromTick ||
      compareMetricStrength(metricAt(previous.span.fromTick), metricAt(arrival.span.fromTick)) !== "weaker" ||
      !withinKeyEvent(dominant) || beginsInsideManualCut(phrase, dominant) ||
      !followsTonicRevoicingRelease(analysis.slices, terminal, phrase.endBoundary,
        writtenBeatAt(terminal.span.toTick - 1))) return;

  const evidence = closingTonicRevoicingEvidence(dominant, arrival, previous, terminal, analysis.slices, beat);
  if (!evidence) return;

  const approach = dominantApproach(facts, facts.length - 4, gapEvidence,
    item => withinKeyEvent(item) && !beginsInsideManualCut(phrase, item));
  tonicTails.push(authenticCadence(phrase, approach, arrival, phraseEvidence, undefined, {
    path: [previous, terminal],
    evidence,
  }));
}

function detectClosingTonicDecoration(
  { analysis, measureFor, metricAt, gapEvidence }: CadenceDetectionContext,
  { phrase, facts, terminal, previous: arrival, previousPrevious: dominant, phraseEvidence }: PhraseEnding,
  tonicTails: CadenceCandidate[],
) {
  if (!dominant || !arrival || !isFifthDegreeDominant(dominant) ||
      !connectionIsValid(dominant, arrival) || !(arrival.span.toTick < terminal.span.fromTick) ||
      beginsInsideManualCut(phrase, dominant) || !sameKey(arrival.key, keyAtTick(analysis, arrival.span.fromTick))) return;

  const bar = measureFor(arrival.span.fromTick);
  if (bar?.startTick !== arrival.span.fromTick || !(terminal.span.toTick <= bar.endTick) ||
      !followsTonicRevoicingRelease(analysis.slices, terminal, phrase.endBoundary,
        ticksPerBeat(analysis.project.ppq, bar.denominator))) return;

  const evidence = closingTonicDecorationEvidence(dominant, arrival, terminal, analysis.slices,
    metricAt, ticksPerBeat(analysis.project.ppq, bar.denominator));
  if (!evidence) return;

  const approach = dominantApproach(facts, facts.length - 3, gapEvidence,
    item => !beginsInsideManualCut(phrase, item) &&
      item.span.sliceIndices.every(index => sameKey(analysis.slices[index].key, arrival.boundarySlice?.key)));
  tonicTails.push(authenticCadence(phrase, approach, arrival, phraseEvidence, undefined, {
    path: [terminal], evidence,
  }));
}

function tonicLandingGapEvidence(
  { analysis, metricAt, measureFor, writtenBeatAt }: CadenceDetectionContext,
  { previousPrevious, previous, terminal }: PhraseEnding,
) {
  if (!previous || !terminal.isTonic || !isFifthDegreeDominant(previous) ||
      previous.interpretationStatus !== "resolved" || !sameKey(previous.key, terminal.key) ||
      !(previous.span.toTick < terminal.span.fromTick) ||
      crossesTonalBoundary(analysis.project, previous.span.fromTick, terminal.span.fromTick)) return;

  return dominantLandingGapEvidence(previous, terminal, analysis.slices, metricAt, analysis.project.ppq) ??
    tonicBassSuspensionEvidence(previous, terminal, analysis.slices, metricAt,
      writtenBeatAt(previous.span.toTick)) ??
    stagedTonicArrivalEvidence(previous, terminal, analysis.slices, metricAt,
      writtenBeatAt(previous.span.toTick)) ??
    detachedAuthenticEvidence(previousPrevious, previous, terminal, analysis.slices,
      writtenBeatAt(previous.span.fromTick), measureFor(terminal.span.fromTick)?.startTick);
}

function resolvesLeadingTone(before: AnalysisSlice, after: AnalysisSlice, tonic: KeyReference["tonic"]) {
  const leading = leadingTonePitchClass({ tonic, mode: "major" });
  return VOICE_ORDER.some(voice => before.notes[voice] && pitchClassEquals(before.notes[voice]!.pitch, leading) &&
    resolvesInVoice(before, after, voice, tonic, 1));
}

function allowsPhraseEndingInKey(
  { facts, terminal, previous, previousPrevious }: PhraseEnding,
  connectsToTerminal: boolean | CadenceEvidence | undefined,
  slices: readonly AnalysisSlice[],
) {
  if (sameKey(terminal.key, terminal.writtenKey)) return true;
  const localLink = (left: CadenceSpanFacts, right: CadenceSpanFacts) =>
    connectionIsValid(left, right) && !right.hardBoundaryBefore;

  // A single applied label can be tonicization. A local V–I needs the
  // bass formula, or an independently established same-key preparation.
  if (isFifthDegreeDominant(terminal)) {
    const established = facts.slice(0, -1).reduceRight<{ next: CadenceSpanFacts; found: boolean; stopped: boolean }>(
      (state, fact) => state.found || state.stopped ? state :
        !localLink(fact, state.next) ? { ...state, stopped: true } :
          { next: fact, found: fact.isTonic === true || predominant(fact) || fact.isCadential64, stopped: false },
      { next: terminal, found: false, stopped: false });
    return established.found && Boolean(writtenBassMatches(terminal));
  }
  if (!previous || !terminal.isTonic || terminal.hardBoundaryBefore || !connectsToTerminal) return false;
  if (previous.isSubdominant && !previous.span.semantics?.cadenceRole && hasBassFormula(previous, terminal, 4, 1)) {
    // An S-I tail can close a local phrase after a proven authentic anchor.
    // A borrowed subdominant or a mere applied label does not establish it.
    return !!previousPrevious?.isTonic && !!facts.at(-4) &&
      isFifthDegreeDominant(facts[facts.length - 4]) &&
      localLink(facts[facts.length - 4], previousPrevious) &&
      localLink(previousPrevious, previous) &&
      hasBassFormula(facts[facts.length - 4], previousPrevious, 5, 1) &&
      !!writtenBassMatches(previous) && !!writtenBassMatches(terminal);
  }
  if (!isFifthDegreeDominant(previous)) return false;
  // A root-position local V can retain its function through an inversion.
  // The written leading-tone resolution on I/I6 confirms the local center.
  if (previousPrevious && isFifthDegreeDominant(previousPrevious) && isRootPosition(previousPrevious) &&
      localLink(previousPrevious, previous) && writtenBassMatches(previousPrevious) &&
      completionFor(previous, terminal) === "imperfect" && terminal.boundarySlice &&
      resolvesLeadingTone(slices[previous.span.sliceIndices.at(-1)!], terminal.boundarySlice, terminal.key.tonic)) return true;
  const rootPositionClosure = isRootPosition(previous) && isRootPosition(terminal) && hasBassFormula(previous, terminal, 5, 1);
  const establishedInvertedClosure = previousPrevious && localLink(previousPrevious, previous) &&
    (previousPrevious.isSubdominant || (previousPrevious.isTonic && facts.at(-4)?.isDominant &&
      localLink(facts[facts.length - 4], previousPrevious))) && completionFor(previous, terminal) === "imperfect" &&
    (!isRootPosition(previous) || !isRootPosition(terminal));
  return rootPositionClosure || establishedInvertedClosure;
}

function detectTonicRearticulation(
  { analysis, measureFor, metricAt, gapEvidence }: CadenceDetectionContext,
  { phrase, facts, terminal, phraseEvidence }: PhraseEnding,
  tails: CadenceCandidate[],
) {
  if (!terminal.isTonic || !isRootPosition(terminal) || !writtenBassMatches(terminal)) return;
  let index = facts.length - 1;
  while (index > 0 && facts[index - 1].isTonic && connectionIsValid(facts[index - 1], facts[index]) &&
      writtenBassMatches(facts[index - 1]) && !facts[index - 1].span.semantics?.cadenceRole &&
      compareMetricStrength(metricAt(facts[index].span.fromTick), metricAt(facts[index - 1].span.fromTick)) === "weaker") index--;
  if (index >= facts.length - 1 || index === 0) return;
  const dominant = facts[index - 1], arrival = facts[index];
  if (isRootPosition(arrival) || !completionFor(dominant, arrival) || !connectionIsValid(dominant, arrival) ||
      beginsInsideManualCut(phrase, dominant) ||
      measureFor(arrival.span.fromTick)?.startTick !== arrival.span.fromTick ||
      !arrival.boundarySlice?.attackVoiceIds.includes("bass") ||
      !arrival.boundarySlice.attackVoiceIds.includes("soprano")) return;
  const approach = dominantApproach(facts, index - 1, gapEvidence, item => !beginsInsideManualCut(phrase, item));
  tails.push(authenticCadence(phrase, approach, arrival, phraseEvidence, undefined, {
    path: facts.slice(index + 1), evidence: {
      code: "closing-tonic-revoicing", value: "保留首次结构落主，较弱拍主和弦重配至实际释放",
    },
  }));
}

function detectAuthenticPhraseEnd(
  { analysis, measureFor, gapEvidence }: CadenceDetectionContext,
  { phrase, facts, terminal, previous, previousPrevious, phraseEvidence }: PhraseEnding,
  landingGap: CadenceEvidence | undefined, connectsToTerminal: boolean | CadenceEvidence | undefined,
  ordinary: CadenceCandidate[],
) {
  if (!previous || !connectsToTerminal || !previous.isDominant || !terminal.isTonic) return;
  const dominantIndex = facts.length - 2;
  const approach = fullApproach(
    facts, dominantIndex, terminal, measureFor(previous.span.fromTick),
    dominantApproach(facts, dominantIndex, gapEvidence),
  );
  if (landingGap?.code === "detached-dominant-to-tonic" && previousPrevious && terminal.boundarySlice) {
    const earlier = precedingDetachedDeception(analysis, phrase.fromTick, facts.slice(0, -3), {
      preparation: previousPrevious, dominant: previous, arrival: terminal.boundarySlice, tonic: terminal, proof: landingGap,
    }, measureFor);
    if (earlier) ordinary.push(deceptiveRepriseCandidate(phrase, earlier));
  }
  ordinary.push(authenticCadence(phrase, approach, terminal, phraseEvidence, landingGap));
}

function authenticCadenceBeforePlagalTail(
  { analysis, measureFor, gapEvidence }: CadenceDetectionContext,
  { phrase, facts, terminal, previousPrevious: firstTonic }: PhraseEnding,
  previous: CadenceSpanFacts, localPlagalKey: KeyReference | undefined,
) {
  const dominant = facts.at(-4);
  const plagalSource = localPlagalKey ? { ...previous, key: localPlagalKey } : previous;
  if (!firstTonic?.isTonic || !dominant || !isAuthenticTailDominant(dominant, analysis.slices, localPlagalKey) ||
      !(previous.degree === 4 || (previous.degree === 2 && hasBassFormula(previous, terminal, 4, 1))) ||
      !writtenBassMatches(previous) || !writtenBassMatches(terminal) ||
      !connectionIsValid(dominant, firstTonic) || !connectionIsValid(firstTonic, plagalSource) ||
      completionFor(dominant, firstTonic) !== "perfect") return;

  const onset = firstTonic.span.fromTick;
  const measure = measureFor(onset);
  const soprano = firstTonic.boundarySlice?.notes.soprano;
  const dominantIndex = facts.length - 4;
  const dominantPath = dominantApproach(facts, dominantIndex, gapEvidence);
  const preparation = dominantPath.path[0];
  const preparedPedal = preparation.isCadential64 && previous.span.semantics?.cadenceRole === "pedal64" &&
    previous.chord && pitchClassEquals(previous.chord.identity.bass, firstTonic.key.tonic);
  if (measure?.startTick !== onset || soprano?.startTick !== onset ||
      !(firstTonic.span.toTick >= measure.endTick || preparedPedal ||
        analysis.slices.filter(slice => onset <= slice.tick && slice.tick < terminal.span.toTick)
          .every(slice => slice.notes.soprano?.pitch.octave === soprano.pitch.octave &&
            pitchClassEquals(slice.notes.soprano.pitch, soprano.pitch)))) return;

  const approach = fullApproach(
    facts, dominantIndex, firstTonic, measureFor(dominant.span.fromTick), dominantPath,
  );
  return authenticCadence(phrase, approach, firstTonic, {
    code: "metric-support",
    value: "小节强拍落主，正格收束后紧接句末补充变格",
    refs: [firstTonic.span.id, previous.span.id, terminal.span.id],
  });
}

function detectPlagalPhraseEnd(
  context: CadenceDetectionContext,
  ending: PhraseEnding,
  dorianPlagal: ReturnType<typeof dorianPlagalEnding>,
  { ordinary, interior, tonicTails }: CadenceCandidates,
) {
  const { analysis, measureFor, metricAt } = context;
  const { phrase, terminal, previous, previousPrevious: firstTonic, phraseEvidence } = ending;
  if (!previous || !(dorianPlagal || (connectionIsValid(previous, terminal) && previous.isSubdominant && terminal.isTonic)))
    return false;

  // A borrowed IV can keep its parallel-major label while serving the minor tonic.
  const localPlagalKey = dorianPlagal?.center === "local" ? terminal.key : undefined;
  const authentic = authenticCadenceBeforePlagalTail(context, ending, previous, localPlagalKey);
  if (authentic) ordinary.push(authentic);

  const lastSourceSlice = analysis.slices[previous.span.sliceIndices.at(-1)!];
  const independent = dorianPlagal || isImperfectPlagalClosing(previous, terminal, lastSourceSlice);
  if (independent && !hasAuthenticTailAnchor(analysis, previous, measureFor, localPlagalKey)) {
    const evidence: CadenceEvidence[] = [
      phraseEvidence,
      { code: "predominant-to-tonic", value: "句末独立变格收束 S -> T" },
      { code: "stable-ending", value: "末端主功能稳定" },
    ];
    if (dorianPlagal) evidence.push({
      code: "dorian-plagal-ending", value: dorianPlagal.center === "local"
        ? "已确立的小调中心内，大下属原位落实小主"
        : "独立的小属至小主实奏确立多利亚中心，末端原位 IV–i",
    }, { code: "bass-formula", value: "低音 4 -> 1" });
    ordinary.push(candidate(phrase, "full", [previous, terminal], evidence, {
      form: "plagal", completion: dorianPlagal ? dorianPlagal.completion : "imperfect", confidenceCap: "probable",
    }));
    return true;
  }
  if (firstTonic?.isTonic && previous.degree === 4 && phrase.endBoundary?.source !== "manual" &&
      connectionIsValid(firstTonic, previous) &&
      compareMetricStrength(metricAt(previous.span.fromTick), metricAt(firstTonic.span.fromTick)) === "weaker" &&
      isWrittenAuxiliaryReturn(firstTonic, previous, terminal, analysis.slices) &&
      !hasAuthenticTailAnchor(analysis, previous, measureFor) &&
      ![ordinary, interior, tonicTails].some(candidates =>
        candidates.some(item => item.kind === "full" && item.form === "authentic" &&
          item.confidence !== "ambiguous" && item.toTick <= firstTonic.span.fromTick))) return true;
  ordinary.push(candidate(phrase, "supplementary", [previous, terminal], [
    phraseEvidence,
    { code: "predominant-to-tonic", value: "当前调性 S -> T" },
    { code: "stable-ending", value: "末端主功能稳定" },
  ], { form: "plagal" }));
  return false;
}

function detectDeceptivePhraseEnd(
  { gapEvidence }: CadenceDetectionContext,
  { phrase, facts, terminal, phraseEvidence }: PhraseEnding,
  ordinary: CadenceCandidate[],
) {
  if (terminal.family !== "tonic" || terminal.degree === 1) return;

  let landingIndex = facts.length - 1;
  while (landingIndex > 0 && continuesSubmediant(facts[landingIndex - 1], facts[landingIndex])) landingIndex--;
  const ending = facts[landingIndex];
  const dominantIndex = landingIndex - 1;
  const dominant = facts[dominantIndex];
  if (dominant?.isDominant && connectionIsValid(dominant, ending) &&
      (ending === terminal || (isRootPosition(ending) && writtenBassMatches(ending)))) {
    const approach = dominantApproach(facts, dominantIndex, gapEvidence);
    ordinary.push(deceptiveCadence(phrase, approach, facts.slice(landingIndex), phraseEvidence));
  }
}

function detectHalfPhraseEndings(
  context: CadenceDetectionContext,
  { phrase, facts, terminal, previous, phraseEvidence }: PhraseEnding,
  ordinary: CadenceCandidate[],
) {
  const { analysis, writtenBeatAt } = context;
  if (terminal.isSubdominant && terminal.degree === 4 && previous?.isTonic &&
      connectionIsValid(previous, terminal) && terminal.chord && chordIdentityInversion(terminal.chord.identity) === 0 &&
      writtenBassMatches(terminal) && phrase.toTick < analysis.project.lengthTicks) {
    ordinary.push(candidate(phrase, "half", [previous, terminal], [
      phraseEvidence,
      { code: "stable-ending", value: "中间乐句停于本调四级下属和弦" },
    ], { form: "plagal", confidenceCap: "probable" }));
  }

  if (isDominantHalfEnding(terminal) && terminal.isStable &&
      (!previous || previous.span.toTick === terminal.span.fromTick ||
        (isFifthDegreeDominant(terminal) && writtenBassMatches(terminal) &&
          (isRootPosition(terminal) || phrase.endBoundary?.source === "manual")))) {
    if (phrase.endBoundary?.source === "inferred" && terminal.span.toTick < analysis.project.lengthTicks &&
        halfEndingContinuesThroughPivot(analysis, previous, terminal, writtenBeatAt)) return;
    const approach = halfApproach(facts, facts.length - 1, context, phrase);
    const preparation: CadenceEvidence[] = approach.path[0].isSubdominant ? [
      { code: "predominant-to-dominant", value: "下属功能准备进入终止属和声" },
    ] : [];
    ordinary.push(candidate(phrase, "half", approach.path,
      [phraseEvidence, ...approach.evidence, ...preparation, { code: "ends-on-dominant", value: "乐句末端为属功能" }],
      { form: isFifthDegreeDominant(terminal) ? "authentic" : undefined, landingTick: halfLandingTick(approach) },
    ));
  }
}

function detectStandardPhraseEnding(
  context: CadenceDetectionContext, ending: PhraseEnding, candidates: CadenceCandidates,
) {
  const { analysis, metricAt, writtenBeatAt } = context;
  const { facts, previous, terminal } = ending;
  const landingGap = tonicLandingGapEvidence(context, ending);
  const connectsToTerminal = previous && (connectionIsValid(previous, terminal) || landingGap);
  const dorianPlagal = dorianPlagalEnding(facts, analysis.slices, metricAt, writtenBeatAt);
  if (!dorianPlagal && !allowsPhraseEndingInKey(ending, connectsToTerminal, analysis.slices)) return;

  detectAuthenticPhraseEnd(context, ending, landingGap, connectsToTerminal, candidates.ordinary);
  // An independent plagal ending or a written auxiliary return completes the phrase.
  if (detectPlagalPhraseEnd(context, ending, dorianPlagal, candidates)) return;
  detectDeceptivePhraseEnd(context, ending, candidates.ordinary);
  detectHalfPhraseEndings(context, ending, candidates.ordinary);
}

function mergeCadenceCandidates({ ordinary, interior, tonicTails }: CadenceCandidates) {
  // An existing cadence at the same landing still owns its structural evidence.
  const ordinaryLandings = new Set(ordinary.map(cadenceLandingKey));
  const known = [...ordinary, ...interior.filter(item => !ordinaryLandings.has(cadenceLandingKey(item)))];
  // Keep an independently detected cadence at the same ending, including a supplementary one.
  const knownLandings = new Set(known.map(cadenceLandingKey));
  return Object.freeze(resolveConflicts([
    ...known,
    ...tonicTails.filter(item => !knownLandings.has(cadenceLandingKey(item))),
  ]));
}

export function detectCadences(analysis: CadenceAnalysis): readonly CadenceCandidate[] {
  const context = createDetectionContext(analysis);
  let structuralReader: ReturnType<typeof createSliceStructuralVoicingReader> | undefined;
  const readStructural: ReturnType<typeof createSliceStructuralVoicingReader> = (index, identity) =>
    (structuralReader ??= createSliceStructuralVoicingReader(analysis.slices, analysis.project, context.metricAt))(index, identity);
  const candidates: CadenceCandidates = { ordinary: [], interior: [], tonicTails: [] };
  for (const phrase of analysis.phraseSegments) {
    if (phrase.confidence === "ambiguous") continue;
    const facts = spansForPhrase(analysis, phrase).map(span => factsFor(analysis, span, readStructural));
    candidates.interior.push(...articulatedInteriorCadences(phrase, facts, context));

    const terminal = facts.at(-1);
    if (!terminal || terminal.interpretationStatus !== "resolved") continue;
    if (detectDetachedTonicEnding(context, phrase, facts, terminal, candidates)) continue;
    if (!hasHarmonizedPhraseEnd(context, phrase, terminal)) continue;

    const ending: PhraseEnding = {
      phrase, facts, terminal, previous: facts.at(-2), previousPrevious: facts.at(-3),
      phraseEvidence: evidenceForPhrase(phrase),
    };
    detectClosingTonicPedal(context, ending, candidates.tonicTails);
    detectClosingTonicRevoicing(context, ending, candidates.tonicTails);
    detectClosingTonicDecoration(context, ending, candidates.tonicTails);
    detectTonicRearticulation(context, ending, candidates.tonicTails);
    detectStandardPhraseEnding(context, ending, candidates);
  }
  return mergeCadenceCandidates(candidates);
}
