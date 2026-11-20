import type { ProjectDocument } from "../../project";
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
import { withNeapolitanPivotSixths } from "./neapolitanPivotSixths";
import { withNeapolitanPivotDominants } from "./neapolitanPivotDominants";
import { withPassingTonicSevenths } from "./passingTonicSevenths";
import { withLeadingSeventhIntoConfirmedKey } from "./leadingSeventhIntoConfirmedKey";
import { withWholeWrittenTriadRespellings } from "./wholeWrittenTriadRespellings";
import { withWrittenPivotSevenths } from "./pivotSevenths";
import { withAppliedSequences } from "./appliedSequences";
import { withRaisedFifthResolutions } from "./raisedFifthResolutions";
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
  ChordInferenceCandidate,
} from "./types";

function confidenceRank(value: "high" | "medium" | "low") {
  return value === "high" ? 2 : value === "medium" ? 1 : 0;
}

function initialCandidates(
  observations: readonly ChordInferenceObservation[], options: ChordInferenceOptions,
  terminalTicks: ReadonlySet<number>, meetsMinimumConfidence: (candidate: ChordInferenceCandidate) => boolean,
) {
  const candidateSets: ChordInferenceCandidate[][] = [];
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
  return candidateSets;
}

/** Each pass reads its predecessor's candidates. Score the path only after
 * both the harmonic and the voice-leading evidence are available. */
export function buildContextualChordCandidates(project: ProjectDocument, options: ChordInferenceOptions) {
  const fullScore = buildChordInferenceObservations(project);
  const minimumConfidence = options.minConfidence ?? "low";
  const meetsMinimumConfidence = (candidate: ChordInferenceCandidate) =>
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
  const phraseBoundaryTicks = project.structure.phraseBoundaries
    .filter(boundary => isCurrentPhraseBoundary(project, boundary))
    .map(boundary => boundary.tick);
  const currentPhraseTicks = [...new Set([...terminalTicks, ...phraseBoundaryTicks])];

  let candidates: readonly (readonly ChordInferenceCandidate[])[] =
    initialCandidates(observations, options, terminalTicks, meetsMinimumConfidence);
  // Establish candidate harmonies before resolving ornamental notes against them.
  candidates = withWrittenPivotSevenths(observations, candidates, options);
  candidates = withDiatonicSevenths(observations, candidates, options);
  candidates = withLoweredSupertonics(observations, candidates);
  candidates = withAppliedSequences(observations, candidates, options);
  candidates = withAppliedDominants(observations, candidates, options);

  candidates = withAnticipations(observations, candidates, options, project.ppq, phraseBoundaryTicks);
  candidates = withPreparedSuspensions(observations, candidates, options, project.ppq, phraseBoundaryTicks);
  candidates = withProlongedHarmony(observations, candidates, options, project.ppq, phraseBoundaryTicks);
  const doubleNeighbors = simultaneousNeighborCandidates(observations, candidates, options, project.ppq, phraseBoundaryTicks);
  candidates = classifySixFours(
    observations, candidates, minimumConfidence !== "high", currentPhraseTicks, doubleNeighbors,
    minimumConfidence !== "high" && options.allowNonChordToneCandidates !== false ? project.ppq : undefined,
  );

  candidates = withDeceptiveDominants(observations, candidates, options, project.ppq, phraseBoundaryTicks);
  candidates = withDominantSixthSubstitutions(observations, candidates, meetsMinimumConfidence, manualPhraseTicks);
  candidates = withPassingTonicSevenths(observations, candidates, options, currentPhraseTicks);
  candidates = withNeapolitanPivotDominants(
    observations, candidates, options, localKeys, currentPhraseTicks,
  );
  candidates = withDoubleAugmentedFourThree(
    observations, candidates, manualPhraseTicks, meetsMinimumConfidence,
  );
  if (minimumConfidence !== "high") {
    candidates = withSingleVoiceRevoicings(observations, candidates, project.ppq, phraseBoundaryTicks, currentPhraseTicks);
  }
  candidates = withThirdInversionResolutions(observations, candidates, options, currentPhraseTicks);
  candidates = withLeadingSeventhIntoConfirmedKey(
    observations, candidates, options, localKeys, currentPhraseTicks,
  );
  candidates = withWholeWrittenTriadRespellings(observations, candidates, currentPhraseTicks);

  const lowerNeighbors = withWrittenLowerNeighborPairs(observations, candidates, options, currentPhraseTicks);
  candidates = withUpperPassingTones(
    observations, lowerNeighbors.candidateSets, options, currentPhraseTicks, project.ppq,
  );
  candidates = withNeapolitanPivotSixths(observations, candidates, localKeys, currentPhraseTicks);
  candidates = withRaisedFifthResolutions(observations, candidates, manualPhraseTicks, meetsMinimumConfidence);
  return { observations, candidates, currentPhraseTicks, withheldStarts: lowerNeighbors.withheldStarts };
}
