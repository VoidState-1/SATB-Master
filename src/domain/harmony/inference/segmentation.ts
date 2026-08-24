import type {
  ChordInferenceCandidate,
  ChordInferenceObservation,
  ChordInferenceRegion,
  ChordInferenceWarning,
} from "./types";

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

function alternativeCandidates(
  selected: ChordInferenceCandidate | undefined,
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  indices: readonly number[],
) {
  const candidates = new Map<string, ChordInferenceCandidate>();
  for (const index of indices) {
    for (const candidate of candidateSets[index]) {
      if (selected && sameMeaning(selected, candidate)) continue;
      if (!candidates.has(candidate.id)) candidates.set(candidate.id, candidate);
    }
  }
  return Object.freeze(
    [...candidates.values()]
      .sort(
        (left, right) =>
          right.score.total - left.score.total || left.id.localeCompare(right.id),
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
    (closest && selected.score.total - closest.score.total < 12)
  )
    return "ambiguous";
  return "resolved";
}

export function buildChordInferenceRegions(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  selectedPath: readonly (ChordInferenceCandidate | undefined)[],
) {
  const regions: ChordInferenceRegion[] = [];
  let index = 0;
  while (index < observations.length) {
    const firstSelected = selectedPath[index];
    const indices = [index];
    index += 1;
    while (
      index < observations.length &&
      sameMeaning(firstSelected, selectedPath[index])
    ) {
      indices.push(index);
      index += 1;
    }
    const alternatives = alternativeCandidates(firstSelected, candidateSets, indices);
    const status = regionStatus(firstSelected, alternatives);
    regions.push({
      id: `inferred-region-${regions.length}`,
      fromTick: observations[indices[0]].fromTick,
      toTick: observations[indices.at(-1)!].toTick,
      status,
      ...(firstSelected ? { selected: firstSelected } : {}),
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
