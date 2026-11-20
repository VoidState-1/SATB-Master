import {
  buildChordInferenceCandidates,
  withLoweredSupertonics,
} from "./candidates";
import { withThirdInversionResolutions } from "./supertonicResolution";
import { withAppliedDominants } from "./appliedDominants";
import { withAnticipations } from "./anticipations";
import { buildChordInferenceObservations } from "./observations";
import { withDiatonicSevenths } from "./diatonicSevenths";
import { withDeceptiveDominants } from "./deceptiveDominants";
import { withDominantSixthSubstitutions } from "./dominantSixths";
import { withDoubleAugmentedFourThree } from "./doubleAugmentedFourThree";
import { withNeapolitanPivotDominants } from "./neapolitanPivotDominants";
import { withPassingTonicSevenths } from "./passingTonicSevenths";
import { withLeadingSeventhIntoConfirmedKey } from "./leadingSeventhIntoConfirmedKey";
import { withWholeWrittenTriadRespellings } from "./wholeWrittenTriadRespellings";
import { withWrittenPivotSevenths } from "./pivotSevenths";
import { withAppliedSequences } from "./appliedSequences";
import { buildChordInferenceRegions, warningsForRegions } from "./segmentation";
import { analyzeChordInferencePaths } from "./sequence";
import { chooseNoncadentialTonicSixFours } from "./noncadentialTonicSixFours";
import { classifySixFours } from "./sixFours";
import { withPreparedSuspensions } from "./preparedSuspensions";
import { withUpperPassingTones } from "./upperPassing";
import { withProlongedHarmony } from "./prolongation";
import { withSingleVoiceRevoicings } from "./triadRevoicing";
import { simultaneousNeighborCandidates } from "./simultaneousNeighbors";
import { withWrittenLowerNeighborPairs } from "./lowerNeighborPair";
import { inferLocalKeys } from "./localKeys";
import { inferPhrases, isCurrentPhraseBoundary } from "../phrase";
import type {
  ChordInferenceObservation,
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
  const fullScore = buildChordInferenceObservations(project);
  const minimumConfidence = options.minConfidence ?? "low";
  const meetsMinimumConfidence = (candidate: ReturnType<typeof buildChordInferenceCandidates>[number]) =>
    confidenceRank(candidate.confidence) >= confidenceRank(minimumConfidence);
  // Phrase boundaries are normally written after chord inference. Precompute
  // the note/rhythm-only structure here so an inferred middle-phrase cadence
  // can still unlock the terminal tonic's permitted fifth omission.
  const phraseAnalysis = inferPhrases({
    ...project,
    // Existing chord annotations must not bias a fresh chord inference run.
    chordRegions: [],
  });
  const terminalTicks = new Set(
    phraseAnalysis.boundaries.map((boundary) => boundary.tick),
  );
  const manualPhraseTicks = project.structure.phraseBoundaries
    .filter(boundary => boundary.source === "manual")
    .map(boundary => boundary.tick);
  const localKeys = inferLocalKeys(fullScore, terminalTicks, manualPhraseTicks);
  const observations = fullScore.map(item => {
    const localKey = localKeys.get(item.index)?.key;
    return localKey ? { ...item, key: { ...item.key, ...localKey }, localKey } : item;
  });
  const candidateSets: Array<ReturnType<typeof buildChordInferenceCandidates>> = [];
  observations.forEach((observation, index) => {
    const previousCandidates = candidateSets[index - 1] ?? [];
    const followsDominant = previousCandidates.some(
      (candidate) =>
        candidate.functionalBaseId === "D" &&
        candidate.fit.omittedChordDegrees.length === 0 &&
        candidate.fit.nonChordToneNoteIds.length === 0,
    );
    const candidates = buildChordInferenceCandidates(observation, {
      ...options,
      allowCadentialTonicOmission:
        terminalTicks.has(observation.toTick) && followsDominant,
    }).filter(meetsMinimumConfidence);
    candidateSets.push(candidates);
  });
  const pivots = withWrittenPivotSevenths(observations, candidateSets, options);
  const diatonic = withDiatonicSevenths(observations, pivots, options);
  const predominants = withLoweredSupertonics(observations, diatonic);
  const sequences = withAppliedSequences(observations, predominants, options);
  const applied = withAppliedDominants(observations, sequences, options);
  const phraseBoundaryTicks = project.structure.phraseBoundaries
    .filter(boundary => isCurrentPhraseBoundary(project, boundary))
    .map(boundary => boundary.tick);
  const anticipated = withAnticipations(observations, applied, options, project.ppq, phraseBoundaryTicks);
  const suspended = withPreparedSuspensions(observations, anticipated, options, project.ppq, phraseBoundaryTicks);
  const prolonged = withProlongedHarmony(observations, suspended, options, project.ppq, phraseBoundaryTicks);
  const currentPhraseTicks = [...new Set([...terminalTicks, ...phraseBoundaryTicks])];
  const doubleNeighbors = simultaneousNeighborCandidates(observations, prolonged, options, project.ppq, phraseBoundaryTicks);
  const classified = classifySixFours(observations, prolonged, minimumConfidence !== "high", currentPhraseTicks, doubleNeighbors);
  const recovered = withDeceptiveDominants(observations, classified, options, project.ppq, phraseBoundaryTicks);
  const withSixths = withDominantSixthSubstitutions(observations, recovered, meetsMinimumConfidence, manualPhraseTicks);
  const withPassingSevenths = withPassingTonicSevenths(
    observations, withSixths, options, currentPhraseTicks,
  );
  const withNeapolitanPivots = withNeapolitanPivotDominants(
    observations, withPassingSevenths, options, localKeys, currentPhraseTicks,
  );
  const withAlteredDoubleDominants = withDoubleAugmentedFourThree(
    observations, withNeapolitanPivots, manualPhraseTicks, meetsMinimumConfidence,
  );
  const revoiced = minimumConfidence === "high" ? withAlteredDoubleDominants :
    withSingleVoiceRevoicings(observations, withAlteredDoubleDominants, project.ppq, phraseBoundaryTicks, currentPhraseTicks);
  const thirdInversions = withThirdInversionResolutions(observations, revoiced, options, currentPhraseTicks);
  const leadingSevenths = withLeadingSeventhIntoConfirmedKey(
    observations, thirdInversions, options, localKeys, currentPhraseTicks,
  );
  const writtenTriads = withWholeWrittenTriadRespellings(
    observations, leadingSevenths, currentPhraseTicks,
  );
  const lowerNeighbors = withWrittenLowerNeighborPairs(observations, writtenTriads, options, currentPhraseTicks);
  const upperPassing = withUpperPassingTones(
    observations, lowerNeighbors.candidateSets, options, currentPhraseTicks, project.ppq,
  );
  const sequence = analyzeChordInferencePaths(observations, upperPassing);
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
  const regions = buildChordInferenceRegions(visible, scored, selectedPath, lowerNeighbors.withheldStarts);
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
