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
import { pitchClassEquals, scaleDegreePitchClass } from "../../pitch";
import { buildMeasures, measureAtTick } from "../../time";
import type {
  AnalysisChord,
  AnalysisSlice,
  HarmonyAnalysis,
  HarmonySpan,
} from "../analysis";
import { isCadential64Span } from "../rules/connector";
import type { PhraseSegment } from "../phrase";
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
  return span.sliceIndices
    .map((index) => analysis.slices[index])
    .find(Boolean);
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

function authenticCadence(
  phrase: PhraseSegment,
  preparation: CadenceSpanFacts | undefined,
  dominant: CadenceSpanFacts,
  tonic: CadenceSpanFacts,
  landingEvidence: CadenceEvidence,
  completion = completionFor(dominant, tonic),
) {
  const cadential64 = preparation?.isCadential64 && connectionIsValid(preparation, dominant);
  const path = cadential64 ? [preparation, dominant, tonic] : [dominant, tonic];
  const bassFormula = hasBassFormula(dominant, tonic, 5, 1);
  const evidence: CadenceEvidence[] = [
    landingEvidence,
    { code: "dominant-to-tonic", value: "当前调性 D -> T" },
  ];
  if (cadential64) evidence.push({ code: "cadential64-chain", value: "K46 -> D -> T" });
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
  for (const phrase of analysis.phraseSegments) {
    if (phrase.confidence === "ambiguous") continue;
    const facts = analysis.harmonySpans
      .filter(
        (span) =>
          span.fromTick >= phrase.fromTick && span.toTick <= phrase.toTick,
      )
      .map((span) => factsFor(analysis, span));
    const terminal = facts.at(-1);
    if (!terminal || terminal.span.toTick !== phrase.toTick || terminal.interpretationStatus !== "resolved") continue;
    const previous = facts.at(-2);
    const previousPrevious = facts.at(-3);
    const phraseEvidence = evidenceForPhrase(phrase);
    // A local label alone can denote tonicization. Require a closing V–I and
    // the written bass formula before recognizing a cadence in a different key.
    if (!sameKey(terminal.key, keyAtTick(analysis, terminal.span.fromTick))) {
      if (!previous?.chord || !terminal.chord || previous.degree !== 5 || !previous.isDominant || !terminal.isTonic ||
          chordIdentityInversion(previous.chord.identity) !== 0 || chordIdentityInversion(terminal.chord.identity) !== 0 ||
          !connectionIsValid(previous, terminal) || !hasBassFormula(previous, terminal, 5, 1)) continue;
    }

    if (
      previous &&
      connectionIsValid(previous, terminal) &&
      previous.isDominant &&
      terminal.isTonic
    ) {
      allCandidates.push(authenticCadence(phrase, previousPrevious, previous, terminal, phraseEvidence));
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
        previous.degree === 4 &&
        writtenBassMatches(previous) && writtenBassMatches(terminal) &&
        connectionIsValid(dominant, firstTonic) &&
        connectionIsValid(firstTonic, previous) &&
        completionFor(dominant, firstTonic) === "perfect"
      ) {
        measures ??= buildMeasures(analysis.project);
        const onset = firstTonic.span.fromTick;
        const measure = measureAtTick(measures, onset);
        const soprano = firstTonic.boundarySlice?.notes.soprano;
        // 强拍上的 V–I 也可以只是句内连接。主和弦占满小节，或女高主音
        // 从落点保持到补充段结束时，才另记此前的正格收束。
        if (
          measure?.startTick === onset &&
          soprano?.startTick === onset &&
          (firstTonic.span.toTick >= measure.endTick || soprano.startTick + soprano.durationTicks >= phrase.toTick)
        ) {
          allCandidates.push(authenticCadence(phrase, facts.at(-5), dominant, firstTonic, {
            code: "metric-support",
            value: "小节强拍落主，正格收束后紧接句末补充变格",
            refs: [firstTonic.span.id, previous.span.id, terminal.span.id],
          }, "perfect"));
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

    if (
      terminal.isDominant &&
      terminal.isStable &&
      (!previous || previous.span.toTick === terminal.span.fromTick)
    ) {
      const path =
        previous && previous.isCadential64 && connectionIsValid(previous, terminal)
          ? [previous, terminal]
          : [terminal];
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
