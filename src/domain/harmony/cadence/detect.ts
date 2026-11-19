import {
  chordIdentityInversion,
  chordStructureQuality,
  harmonySemanticsConfidence,
  primaryHarmonyInterpretation,
  type FunctionalFamily,
  type HarmonyInterpretation,
  type KeyReference,
} from "../../chordModel";
import { effectiveFunctionalDesignation } from "../../functionalHarmonyCatalog";
import { pitchClassEquals, pitchClassValue, scaleDegreePitchClass } from "../../pitch";
import { buildMeasures, measureAtTick } from "../../time";
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
  return {
    id: `cadence:${phrase.id}:${kind}:${first.id}:${last.id}`,
    phraseId: phrase.id,
    fromTick: first.fromTick,
    toTick: last.toTick,
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

function dominantApproach(facts: readonly CadenceSpanFacts[], dominantIndex: number) {
  let start = dominantIndex;
  while (start > 0 && isFifthDegreeDominant(facts[start]) && isRootPosition(facts[start - 1]) &&
      isFifthDegreeDominant(facts[start - 1]) &&
      connectionIsValid(facts[start - 1], facts[start])) start--;
  const preparation = facts[start - 1];
  if (preparation?.isCadential64 && connectionIsValid(preparation, facts[start])) start--;
  return facts.slice(start, dominantIndex + 1);
}

function isRootPosition(facts: CadenceSpanFacts) {
  return facts.chord !== undefined && chordIdentityInversion(facts.chord.identity) === 0;
}

function fullApproach(
  facts: readonly CadenceSpanFacts[],
  dominantIndex: number,
  tonic: CadenceSpanFacts,
  measure: ReturnType<typeof measureAtTick>,
) {
  const approach = dominantApproach(facts, dominantIndex);
  const first = approach[0];
  const subdominant = facts[dominantIndex - approach.length];
  if (measure && subdominant?.isSubdominant && subdominant.degree === 4 &&
      isRootPosition(subdominant) && writtenBassMatches(subdominant) &&
      isFifthDegreeDominant(first) && connectionIsValid(subdominant, first) &&
      subdominant.span.fromTick === measure.startTick && tonic.span.fromTick === measure.endTick &&
      subdominant.span.toTick - subdominant.span.fromTick > tonic.span.fromTick - first.span.fromTick) {
    return [subdominant, ...approach];
  }
  return approach;
}

function authenticCadence(
  phrase: PhraseSegment,
  approach: readonly CadenceSpanFacts[],
  tonic: CadenceSpanFacts,
  landingEvidence: CadenceEvidence,
) {
  const dominant = approach[approach.length - 1];
  const completion = completionFor(dominant, tonic);
  const path = [...approach, tonic];
  const bassFormula = hasBassFormula(dominant, tonic, 5, 1);
  const evidence: CadenceEvidence[] = [
    landingEvidence,
    { code: "dominant-to-tonic", value: "当前调性 D -> T" },
  ];
  if (approach[0].isCadential64) evidence.push({ code: "cadential64-chain", value: "K46 -> D -> T" });
  if (approach[0].isSubdominant) evidence.push({ code: "predominant-to-dominant", value: "强拍下属功能准备随后属、主的完全终止" });
  if (bassFormula) evidence.push({ code: "bass-formula", value: "低音 5 -> 1" });
  evidence.push({ code: "stable-ending", value: "末端主功能稳定" });
  return candidate(phrase, "full", path, evidence, {
    form: "authentic",
    completion,
    confidenceCap: completion && bassFormula && tonic.span.toTick === phrase.toTick
      ? undefined
      : "probable",
  });
}

export function detectCadences(
  analysis: Pick<
    HarmonyAnalysis,
    "project" | "harmonySpans" | "chordById" | "slices" | "phraseSegments"
  >,
): readonly CadenceCandidate[] {
  const allCandidates: CadenceCandidate[] = [];
  let measures: ReturnType<typeof buildMeasures> | undefined;
  const measureFor = (tick: number) => measureAtTick(measures ??= buildMeasures(analysis.project), tick);
  for (const phrase of analysis.phraseSegments) {
    if (phrase.confidence === "ambiguous") continue;
    const facts = spansForPhrase(analysis, phrase)
      .map((span) => factsFor(analysis, span));
    const terminal = facts.at(-1);
    if (!terminal || terminal.interpretationStatus !== "resolved") continue;
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
    // A single applied label can be tonicization. A local V–I needs the
    // bass formula, or an independently established same-key preparation.
    if (!sameKey(terminal.key, keyAtTick(analysis, terminal.span.fromTick))) {
      if (!previous || !isFifthDegreeDominant(previous) || !terminal.isTonic || !connectionIsValid(previous, terminal)) continue;
      const rootPositionClosure = isRootPosition(previous) && isRootPosition(terminal) && hasBassFormula(previous, terminal, 5, 1);
      const establishedInvertedClosure = previousPrevious && connectionIsValid(previousPrevious, previous) &&
        (previousPrevious.isSubdominant || (previousPrevious.isTonic && facts.at(-4)?.isDominant &&
          connectionIsValid(facts[facts.length - 4], previousPrevious))) && completionFor(previous, terminal) === "imperfect" &&
        (!isRootPosition(previous) || !isRootPosition(terminal));
      if (!rootPositionClosure && !establishedInvertedClosure) continue;
    }

    if (
      previous &&
      connectionIsValid(previous, terminal) &&
      previous.isDominant &&
      terminal.isTonic
    ) {
      const approach = fullApproach(facts, facts.length - 2, terminal, measureFor(previous.span.fromTick));
      allCandidates.push(authenticCadence(phrase, approach, terminal, phraseEvidence));
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
        const preparation = dominantApproach(facts, facts.length - 4)[0];
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
          const approach = fullApproach(facts, facts.length - 4, firstTonic, measureFor(dominant.span.fromTick));
          allCandidates.push(authenticCadence(phrase, approach, firstTonic, {
            code: "metric-support",
            value: "小节强拍落主，正格收束后紧接句末补充变格",
            refs: [firstTonic.span.id, previous.span.id, terminal.span.id],
          }));
        }
      }
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
      const path = dominantApproach(facts, facts.length - 1);
      allCandidates.push(
        candidate(
          phrase,
          "half",
          path,
          [phraseEvidence, { code: "ends-on-dominant", value: "乐句末端为属功能" }],
          { form: isFifthDegreeDominant(terminal) ? "authentic" : undefined },
        ),
      );
    }
  }
  return Object.freeze(resolveConflicts(allCandidates));
}
