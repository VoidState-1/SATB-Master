import type { ProjectDocument } from "../../project";
import { buildContextualChordCandidates } from "./contextualCandidates";
import { chooseNoncadentialTonicSixFours } from "./noncadentialTonicSixFours";
import { buildChordInferenceRegions, warningsForRegions } from "./segmentation";
import { analyzeChordInferencePaths } from "./sequence";
import type { ChordInferenceObservation, ChordInferenceOptions, ChordInferenceResult } from "./types";

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

export function inferChords(
  project: ProjectDocument,
  options: ChordInferenceOptions = {},
): ChordInferenceResult {
  const range = normalizedRange(project.lengthTicks, options);
  if (!(range.toTick > range.fromTick)) {
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
  const { observations, candidates, currentPhraseTicks, withheldStarts } = buildContextualChordCandidates(project, options);
  const sequence = analyzeChordInferencePaths(observations, candidates);
  // Solve in musical context, but aggregate evidence and write regions only
  // for the requested half-open range. A selection can split a held note.
  let visible: readonly ChordInferenceObservation[] = observations;
  let scored = sequence.candidateSets;
  let selectedPath = chooseNoncadentialTonicSixFours(observations, scored, sequence.selectedPath, currentPhraseTicks);
  if (range.fromTick !== 0 || range.toTick !== project.lengthTicks) {
    const first = observations.findIndex(item => item.toTick > range.fromTick);
    let end = first;
    while (end < observations.length && observations[end].fromTick < range.toTick) end++;
    visible = observations.slice(first, end).map((item, index) => ({
      ...item, index, fromTick: Math.max(item.fromTick, range.fromTick),
      toTick: Math.min(item.toTick, range.toTick),
    }));
    scored = scored.slice(first, end).map((set, index) =>
      set.map(candidate => ({ ...candidate, observationIndex: index })));
    selectedPath = selectedPath.slice(first, end).map((selected, index) =>
      selected && { ...selected, observationIndex: index });
  }
  const regions = buildChordInferenceRegions(visible, scored, selectedPath, withheldStarts);
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
