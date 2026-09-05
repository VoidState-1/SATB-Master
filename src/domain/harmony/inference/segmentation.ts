import type {
  ChordInferenceCandidate,
  ChordInferenceObservation,
  ChordInferenceRegion,
  ChordInferenceWarning,
} from "./types";
import { analyzeChordInferencePaths } from "./sequence";

function sameMeaning(
  left: ChordInferenceCandidate | undefined,
  right: ChordInferenceCandidate | undefined,
) {
  if (!left || !right) return left === right;
  return (
    JSON.stringify(left.identity) === JSON.stringify(right.identity) &&
    JSON.stringify(left.semantics) === JSON.stringify(right.semantics)
  );
}

function aggregateCandidates(
  candidates: readonly ChordInferenceCandidate[],
): ChordInferenceCandidate {
  const first = candidates[0];
  const unique = <T,>(values: readonly T[]) => Object.freeze([...new Set(values)]);
  const sum = (key: Exclude<keyof ChordInferenceCandidate["score"], "functionalTier">) =>
    candidates.reduce((total, candidate) => total + candidate.score[key], 0);
  const pathScores = candidates.flatMap((candidate) =>
    candidate.pathScore === undefined ? [] : [candidate.pathScore],
  );
  return {
    ...first,
    ...(pathScores.length > 0 ? { pathScore: Math.max(...pathScores) } : {}),
    confidence: candidates.some((candidate) => candidate.confidence === "low")
      ? "low"
      : candidates.some((candidate) => candidate.confidence === "medium") ? "medium" : "high",
    score: {
      functionalTier: first.score.functionalTier,
      toneFit: sum("toneFit"),
      bassFit: sum("bassFit"),
      spellingFit: sum("spellingFit"),
      metricFit: sum("metricFit"),
      contextFit: sum("contextFit"),
      nonChordTonePenalty: sum("nonChordTonePenalty"),
      complexityPenalty: sum("complexityPenalty"),
      total: sum("total"),
    },
    fit: {
      matchedNoteIds: unique(candidates.flatMap((candidate) => candidate.fit.matchedNoteIds)),
      chordToneNoteIds: unique(candidates.flatMap((candidate) => candidate.fit.chordToneNoteIds)),
      nonChordToneNoteIds: unique(candidates.flatMap((candidate) => candidate.fit.nonChordToneNoteIds)),
      nonChordToneAssignments: Object.freeze(Object.assign(
        {}, ...candidates.map((candidate) => candidate.fit.nonChordToneAssignments),
      )),
      omittedChordDegrees: unique(candidates.flatMap((candidate) => candidate.fit.omittedChordDegrees)),
      extraPitchClasses: Object.freeze([...new Map(candidates.flatMap((candidate) =>
        candidate.fit.extraPitchClasses.map((pitch) => [`${pitch.step}:${pitch.alter}`, pitch] as const),
      )).values()]),
      bassMatchesInversion: candidates.every((candidate) => candidate.fit.bassMatchesInversion),
      spellingConsistent: candidates.every((candidate) => candidate.fit.spellingConsistent),
    },
    evidence: Object.freeze([...new Map(candidates.flatMap((candidate) =>
      candidate.evidence.map((evidence) => [JSON.stringify(evidence), evidence] as const),
    )).values()]),
  };
}

function comparisonScore(candidate: ChordInferenceCandidate) {
  return candidate.pathScore ?? candidate.score.total;
}

function alternativeCandidates(
  selected: ChordInferenceCandidate | undefined,
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  indices: readonly number[],
) {
  const candidates = new Map<string, ChordInferenceCandidate[]>();
  for (const index of indices) {
    for (const candidate of candidateSets[index]) {
      if (selected && sameMeaning(selected, candidate)) continue;
      const meaningKey = JSON.stringify({
        identity: candidate.identity,
        semantics: candidate.semantics,
      });
      const group = candidates.get(meaningKey) ?? [];
      group.push(candidate);
      candidates.set(meaningKey, group);
    }
  }
  return Object.freeze(
    [...candidates.values()]
      .map(aggregateCandidates)
      .sort(
        (left, right) =>
          comparisonScore(right) - comparisonScore(left) || left.id.localeCompare(right.id),
      )
      .slice(0, 3),
  );
}

function regionStatus(
  selected: ChordInferenceCandidate | undefined,
  alternatives: readonly ChordInferenceCandidate[],
): ChordInferenceRegion["status"] {
  if (!selected) return "unclassified";
  const closest = alternatives[0];
  if (
    selected.confidence === "low" ||
    (closest && comparisonScore(selected) - comparisonScore(closest) < 12)
  )
    return "ambiguous";
  return "resolved";
}

export function buildChordInferenceRegions(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  selectedPath: readonly (ChordInferenceCandidate | undefined)[],
) {
  // Preserve the selectChordInferencePath + raw candidate sets calling pattern.
  if (candidateSets.some((candidates) => candidates.some((candidate) => candidate.pathScore === undefined))) {
    const sequence = analyzeChordInferencePaths(observations, candidateSets);
    candidateSets = sequence.candidateSets;
    selectedPath = selectedPath.map((selected, index) =>
      candidateSets[index].find((candidate) => candidate.id === selected?.id),
    );
  }
  const regions: ChordInferenceRegion[] = [];
  let index = 0;
  while (index < observations.length) {
    const firstSelected = selectedPath[index];
    const indices = [index];
    index += 1;
    while (
      index < observations.length &&
      observations[index - 1].toTick === observations[index].fromTick &&
      observations[index - 1].key.mode === observations[index].key.mode &&
      observations[index - 1].key.tonic.step === observations[index].key.tonic.step &&
      observations[index - 1].key.tonic.alter === observations[index].key.tonic.alter &&
      sameMeaning(firstSelected, selectedPath[index])
    ) {
      indices.push(index);
      index += 1;
    }
    const selected = firstSelected
      ? aggregateCandidates(indices.map((observationIndex) => selectedPath[observationIndex]!))
      : undefined;
    // A competing path at any slice makes the whole merged region uncertain.
    // Do not add complete-run scores together: they share the same context.
    const alternatives = alternativeCandidates(selected, candidateSets, indices);
    const status = regionStatus(selected, alternatives);
    regions.push({
      id: `inferred-region-${regions.length}`,
      fromTick: observations[indices[0]].fromTick,
      toTick: observations[indices.at(-1)!].toTick,
      status,
      ...(selected ? { selected } : {}),
      alternatives,
      observationIndices: Object.freeze(indices),
    });
  }
  return Object.freeze(regions);
}

export function warningsForRegions(
  regions: readonly ChordInferenceRegion[],
) {
  const warnings: ChordInferenceWarning[] = [];
  for (const region of regions) {
    if (region.status === "unclassified")
      warnings.push({
        code: "unclassified",
        fromTick: region.fromTick,
        toTick: region.toTick,
        message: "该时间区间没有满足当前调性约束的和弦候选",
      });
    else if (region.status === "ambiguous")
      warnings.push({
        code: "ambiguous",
        fromTick: region.fromTick,
        toTick: region.toTick,
        message: "该时间区间存在接近的和声解释，未作为默认结果应用",
      });
  }
  return Object.freeze(warnings);
}
