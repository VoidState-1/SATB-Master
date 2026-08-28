import {
  chordIdentityToneSpellings,
  chordToneSpellings,
  type ChordIdentity,
  type ChordQuality,
} from "../../chordModel";
import {
  buildFunctionalTemplates,
  functionalTemplateKey,
  functionalTier,
  identityForFunctionalTemplate,
} from "./functionalTemplates";
import {
  fitChordObservation,
  fitRatio,
  isCanonicalTonicFifthOmission,
} from "./fit";
import type {
  ChordInferenceCandidate,
  ChordInferenceEvidence,
  ChordInferenceObservation,
  ChordInferenceOptions,
  ChordInferenceScore,
} from "./types";

const FALLBACK_QUALITIES: readonly ChordQuality[] = [
  "major",
  "minor",
  "diminished",
  "augmented",
  "dominant7",
  "minor7",
];

function confidenceFor(
  score: ChordInferenceScore,
  fit: ReturnType<typeof fitChordObservation>,
) {
  // A fallback is useful as an explicit escape hatch, but it is never a
  // functional conclusion and therefore must not reach the default apply
  // path (which accepts medium confidence and above).
  if (score.functionalTier === 4) return "low" as const;
  if (
    score.functionalTier <= 2 &&
    fit.omittedChordDegrees.length === 0 &&
    fit.nonChordToneNoteIds.length === 0 &&
    fit.bassMatchesInversion &&
    fit.spellingConsistent
  )
    return "high" as const;
  if (fit.hardRejected) return "low" as const;
  if (fit.omittedChordDegrees.length <= 1 && fit.nonChordToneNoteIds.length <= 1)
    return "medium" as const;
  return "low" as const;
}

function scoreFor(
  observation: ChordInferenceObservation,
  identity: ChordIdentity,
  fit: ReturnType<typeof fitChordObservation>,
  functionalTierValue: 0 | 1 | 2 | 4,
): ChordInferenceScore {
  const toneFit = fitRatio(observation, identity, fit);
  const bassFit = fit.bassMatchesInversion ? 1 : 0;
  const spellingFit =
    fit.chordToneNoteIds.length === 0
      ? 0
      : fit.spellingConsistent
        ? 1
        : 0.5;
  const metricFit = observation.metric
    ? observation.metric.role === "downbeat"
      ? 1
      : observation.metric.role === "secondary-accent"
        ? 0.8
        : 0.5
    : 0.5;
  const nonChordTonePenalty = fit.nonChordToneNoteIds.length * 0.3;
  const complexityPenalty =
    fit.omittedChordDegrees.length * 0.2 +
    (identity.structure.kind === "tertian" &&
    identity.structure.extensions.length > 0
      ? 0.05
      : 0);
  const total =
    toneFit * 50 +
    bassFit * 25 +
    spellingFit * 15 +
    metricFit * 5 -
    nonChordTonePenalty * 10 -
    complexityPenalty * 10;
  return {
    functionalTier: functionalTierValue,
    toneFit,
    bassFit,
    spellingFit,
    metricFit,
    contextFit: 0,
    nonChordTonePenalty,
    complexityPenalty,
    total,
  };
}

function evidenceFor(
  fit: ReturnType<typeof fitChordObservation>,
  functional = false,
): readonly ChordInferenceEvidence[] {
  const evidence: ChordInferenceEvidence[] = [];
  if (functional)
    evidence.push({ kind: "functional-template", code: "functional-template" });
  if (fit.chordToneNoteIds.length > 0)
    evidence.push({
      kind: "tone-match",
      code: "chord-tone-match",
      noteIds: fit.chordToneNoteIds,
    });
  if (fit.bassMatchesInversion)
    evidence.push({ kind: "bass-match", code: "inversion-bass-match" });
  if (fit.spellingConsistent)
    evidence.push({ kind: "spelling-match", code: "written-spelling-match" });
  if (fit.omittedChordDegrees.length > 0)
    evidence.push({
      kind: "omitted-tone",
      code: "omitted-chord-tone",
      details: { count: fit.omittedChordDegrees.length },
    });
  if (fit.nonChordToneNoteIds.length > 0) {
    evidence.push({
      kind: "extra-tone",
      code: "extra-pitch-class",
      noteIds: fit.nonChordToneNoteIds,
    });
    for (const noteId of fit.nonChordToneNoteIds) {
      if (fit.nonChordToneAssignments[noteId])
        evidence.push({
          kind: "declared-nonchord-tone",
          code: fit.nonChordToneAssignments[noteId],
          noteIds: [noteId],
        });
    }
  }
  if (fit.hardRejected)
    evidence.push({ kind: "hard-rejection", code: fit.hardRejected });
  return Object.freeze(evidence);
}

function candidateComparator(
  left: ChordInferenceCandidate,
  right: ChordInferenceCandidate,
) {
  return (
    left.score.functionalTier - right.score.functionalTier ||
    right.score.total - left.score.total ||
    left.id.localeCompare(right.id)
  );
}

function createFunctionalCandidate(
  observation: ChordInferenceObservation,
  template: ReturnType<typeof buildFunctionalTemplates>[number],
  options: ChordInferenceOptions,
): ChordInferenceCandidate | undefined {
  const { identity, semantics } = identityForFunctionalTemplate(
    template,
    observation.key,
  );
  const canonicalTonicOmission =
    (template.baseId === "T" || template.baseId === "t") &&
    isCanonicalTonicFifthOmission(observation, identity);
  const fit = fitChordObservation(
    observation,
    identity,
    template.baseId === "T" || template.baseId === "t"
      ? {
          ...options,
          allowedOmittedChordDegrees:
            options.allowCadentialTonicOmission || canonicalTonicOmission
            ? [5]
            : undefined,
        }
      : options,
  );
  if (fit.hardRejected) return undefined;
  const score = scoreFor(observation, identity, fit, functionalTier(template.baseId));
  return {
    id: `${observation.index}:${functionalTemplateKey(template, observation.key)}`,
    observationIndex: observation.index,
    identity,
    semantics,
    functionalBaseId: template.baseId,
    fit,
    score,
    confidence: confidenceFor(score, fit),
    evidence: evidenceFor(fit, true),
  } satisfies ChordInferenceCandidate;
}

function createFallbackCandidate(
  observation: ChordInferenceObservation,
  root: (typeof observation.soundingPitchClasses)[number],
  quality: ChordQuality,
  options: ChordInferenceOptions,
) {
  const tones = chordToneSpellings(root, quality);
  const bass = observation.bass &&
    tones.some((tone) =>
      tone.step === observation.bass?.pitch.step &&
      tone.alter === observation.bass?.pitch.alter,
    )
    ? { step: observation.bass.pitch.step, alter: observation.bass.pitch.alter }
    : root;
  const identity: ChordIdentity = {
    root,
    bass,
    structure: {
      kind: "tertian",
      quality,
      extensions: [],
      alterations: [],
    },
  };
  const fit = fitChordObservation(observation, identity, options);
  if (fit.hardRejected) return undefined;
  const score = scoreFor(observation, identity, fit, 4);
  return {
    id: `${observation.index}:absolute:${root.step}:${root.alter}:${quality}`,
    observationIndex: observation.index,
    identity,
    fit,
    score,
    confidence: confidenceFor(score, fit),
    evidence: evidenceFor(fit),
  } satisfies ChordInferenceCandidate;
}

export function buildChordInferenceCandidates(
  observation: ChordInferenceObservation,
  options: ChordInferenceOptions = {},
) {
  const functionalCandidates: ChordInferenceCandidate[] = buildFunctionalTemplates(observation.key)
    .map((template) => createFunctionalCandidate(observation, template, options))
    .filter((candidate): candidate is ChordInferenceCandidate => !!candidate);

  // This exact four-part texture is a canonical tonic reading. Keep it
  // deterministic even when incomplete-voicing or absolute fallback options
  // would otherwise introduce equally-scored alternatives.
  const canonicalTonicCandidates = functionalCandidates.filter(
    (candidate) =>
      (candidate.functionalBaseId === "T" || candidate.functionalBaseId === "t") &&
      isCanonicalTonicFifthOmission(observation, candidate.identity),
  );
  if (canonicalTonicCandidates.length > 0)
    return Object.freeze(canonicalTonicCandidates.sort(candidateComparator));

  const candidates: ChordInferenceCandidate[] = [...functionalCandidates];

  if (options.allowAbsoluteFallback) {
    for (const root of observation.soundingPitchClasses) {
      for (const quality of FALLBACK_QUALITIES) {
        const candidate = createFallbackCandidate(observation, root, quality, options);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  return Object.freeze(candidates.sort(candidateComparator));
}

export function candidateDescription(candidate: ChordInferenceCandidate) {
  const noteCount = candidate.fit.matchedNoteIds.length;
  return candidate.functionalBaseId
    ? `${candidate.functionalBaseId} · ${noteCount} 个观察音`
    : `绝对结构 · ${noteCount} 个观察音`;
}

export function candidateHasNonChordToneAssignments(
  candidate: ChordInferenceCandidate,
) {
  return Object.keys(candidate.fit.nonChordToneAssignments).length > 0;
}
