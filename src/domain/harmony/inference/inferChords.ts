import {
  buildChordInferenceCandidates,
} from "./candidates";
import { buildChordInferenceObservations } from "./observations";
import { buildChordInferenceRegions, warningsForRegions } from "./segmentation";
import { selectChordInferencePath } from "./sequence";
import type {
  ChordInferenceOptions,
  ChordInferenceResult,
} from "./types";

function normalizedRange(
  lengthTicks: number,
  options: ChordInferenceOptions,
) {
  const fromTick = Math.max(
    0,
    Math.min(lengthTicks, Math.floor(options.fromTick ?? 0)),
  );
  const toTick = Math.max(
    fromTick,
    Math.min(lengthTicks, Math.floor(options.toTick ?? lengthTicks)),
  );
  return { fromTick, toTick };
}

function confidenceRank(value: "high" | "medium" | "low") {
  return value === "high" ? 2 : value === "medium" ? 1 : 0;
}

export function inferChords(
  project: Parameters<typeof buildChordInferenceObservations>[0],
  options: ChordInferenceOptions = {},
): ChordInferenceResult {
  const range = normalizedRange(project.lengthTicks, options);
  if (range.toTick <= range.fromTick) {
    return {
      sourceRevision: 0,
      range,
      regions: [],
      unresolvedObservationIndices: [],
      warnings: [
        {
          code: "invalid-range",
          fromTick: range.fromTick,
          toTick: range.toTick,
          message: "推导范围必须包含至少一个有效的时间区间",
        },
      ],
    };
  }
  const observations = buildChordInferenceObservations(project, range);
  const minimumConfidence = options.minConfidence ?? "low";
  const candidateSets = observations.map((observation) =>
    buildChordInferenceCandidates(observation, options).filter(
      (candidate) =>
        confidenceRank(candidate.confidence) >= confidenceRank(minimumConfidence),
    ),
  );
  const selectedPath = selectChordInferencePath(observations, candidateSets);
  const regions = buildChordInferenceRegions(
    observations,
    candidateSets,
    selectedPath,
  );
  return {
    sourceRevision: 0,
    range,
    regions,
    unresolvedObservationIndices: Object.freeze(
      selectedPath.flatMap((candidate, index) => (candidate ? [] : [index])),
    ),
    warnings: warningsForRegions(regions),
  };
}
