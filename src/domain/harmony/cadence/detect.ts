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
  const sameProjectKey = sameKey(localKey, projectKey);
  const unavailable = !span.semantics || !chord || !interpretation;
  const ambiguous =
    span.status !== "complete" ||
    semanticConfidence === "ambiguous" ||
    semanticConfidence === "unknown" ||
    !sameProjectKey ||
    Boolean(interpretation?.appliedTarget);
  const family = ambiguous ? undefined : familyOf(span, chord);
  const degree = ambiguous ? undefined : interpretation?.degree;
  return {
    span,
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

function degreePitch(
  analysis: Pick<HarmonyAnalysis, "project">,
  tick: number,
  degree: 1 | 4 | 5 | 6,
) {
  return scaleDegreePitchClass(keyAtTick(analysis, tick), degree);
}

function hasBassFormula(
  analysis: Pick<HarmonyAnalysis, "project">,
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
      degreePitch(analysis, source.span.fromTick, sourceDegree),
    ) &&
    pitchClassEquals(
      targetBass.pitch,
      degreePitch(analysis, target.span.fromTick, targetDegree),
    )
  );
}

function completionFor(
  analysis: Pick<HarmonyAnalysis, "project">,
  source: CadenceSpanFacts,
  target: CadenceSpanFacts,
): CadenceCompletion | undefined {
  if (!source.chord || !target.chord) return undefined;
  if (
    chordIdentityInversion(source.chord.identity) !== 0 ||
    chordIdentityInversion(target.chord.identity) !== 0
  )
    return undefined;
  if (!hasBassFormula(analysis, source, target, 5, 1)) return undefined;
  const soprano = target.boundarySlice?.notes.soprano;
  if (!soprano) return "imperfect";
  return pitchClassEquals(
    soprano.pitch,
    degreePitch(analysis, target.span.fromTick, 1),
  )
    ? "perfect"
    : "imperfect";
}

function candidate(
  phrase: PhraseSegment,
  kind: CadenceKind,
  path: readonly CadenceSpanFacts[],
  evidence: readonly CadenceEvidence[],
  options: { readonly form?: CadenceForm; readonly completion?: CadenceCompletion } = {},
): CadenceCandidate {
  const score = scoreFor(kind, phrase, evidence);
  const first = path[0].span;
  const last = path.at(-1)!.span;
  return {
    id: `cadence:${phrase.id}:${kind}:${first.id}:${last.id}`,
    phraseId: phrase.id,
    fromTick: first.fromTick,
    toTick: last.toTick,
    kind,
    form: options.form,
    completion: options.completion,
    confidence: confidenceFor(score, phrase),
    score,
    spanIds: path.map((item) => item.span.id),
    chordIds: path.flatMap((item) => item.span.regionIds),
    evidence,
  };
}

function resolveConflicts(candidates: readonly CadenceCandidate[]) {
  const byPhrase = new Map<string, CadenceCandidate[]>();
  candidates.forEach((item) => {
    const group = byPhrase.get(item.phraseId) ?? [];
    group.push(item);
    byPhrase.set(item.phraseId, group);
  });
  const resolved: CadenceCandidate[] = [];
  for (const group of byPhrase.values()) {
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

function terminalSpans(
  analysis: Pick<HarmonyAnalysis, "harmonySpans" | "project" | "chordById" | "slices">,
  phrase: PhraseSegment,
) {
  return analysis.harmonySpans
    .filter(
      (span) =>
        span.fromTick >= phrase.fromTick && span.toTick <= phrase.toTick,
    )
    .map((span) => factsFor(analysis, span))
    .filter((facts) => facts.span.toTick === phrase.toTick);
}

export function detectCadences(
  analysis: Pick<
    HarmonyAnalysis,
    "project" | "harmonySpans" | "chordById" | "slices" | "phraseSegments"
  >,
): readonly CadenceCandidate[] {
  const allCandidates: CadenceCandidate[] = [];
  for (const phrase of analysis.phraseSegments) {
    if (phrase.confidence === "ambiguous") continue;
    const facts = analysis.harmonySpans
      .filter(
        (span) =>
          span.fromTick >= phrase.fromTick && span.toTick <= phrase.toTick,
      )
      .map((span) => factsFor(analysis, span));
    const terminal = terminalSpans(analysis, phrase).at(-1);
    if (!terminal || terminal.interpretationStatus !== "resolved") continue;
    const terminalIndex = facts.findIndex((item) => item.span.id === terminal.span.id);
    if (terminalIndex < 0) continue;
    const previous = facts[terminalIndex - 1];
    const previousPrevious = facts[terminalIndex - 2];
    const phraseEvidence = evidenceForPhrase(phrase);

    if (
      previous &&
      connectionIsValid(previous, terminal) &&
      previous.isDominant &&
      terminal.isTonic
    ) {
      const path =
        previousPrevious &&
        previousPrevious.isCadential64 &&
        connectionIsValid(previousPrevious, previous)
          ? [previousPrevious, previous, terminal]
          : [previous, terminal];
      const bassFormula = hasBassFormula(analysis, previous, terminal, 5, 1);
      const evidence: CadenceEvidence[] = [
        phraseEvidence,
        { code: "dominant-to-tonic", value: "当前调性 D -> T" },
        ...(path.length === 3
          ? ([
              { code: "cadential64-chain", value: "K46 -> D -> T" },
            ] satisfies CadenceEvidence[])
          : []),
        ...(bassFormula
          ? ([
              { code: "bass-formula", value: "低音 5 -> 1" },
            ] satisfies CadenceEvidence[])
          : []),
        { code: "stable-ending", value: "末端主功能稳定" },
      ];
      allCandidates.push(
        candidate(phrase, "full", path, evidence, {
          form: "authentic",
          completion: completionFor(analysis, previous, terminal),
        }),
      );
    }

    if (
      previous &&
      connectionIsValid(previous, terminal) &&
      previous.isSubdominant &&
      terminal.isTonic
    ) {
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
        ),
      );
    }
  }
  return Object.freeze(resolveConflicts(allCandidates));
}
