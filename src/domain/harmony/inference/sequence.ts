import { primaryHarmonyInterpretation } from "../../chordModel";
import type {
  ChordInferenceCandidate,
  ChordInferenceObservation,
} from "./types";

function samePitchStructure(
  left: ChordInferenceCandidate,
  right: ChordInferenceCandidate,
) {
  return JSON.stringify(left.identity) === JSON.stringify(right.identity);
}

function transitionScore(
  previous: ChordInferenceCandidate,
  current: ChordInferenceCandidate,
  previousObservation: ChordInferenceObservation,
  currentObservation: ChordInferenceObservation,
) {
  let score = 0;
  if (samePitchStructure(previous, current)) score += 8;
  if (
    previous.functionalBaseId &&
    previous.functionalBaseId === current.functionalBaseId
  )
    score += 4;
  if (
    previous.identity.root.step === current.identity.root.step &&
    previous.identity.root.alter === current.identity.root.alter
  )
    score += 3;
  const target = previous.semantics
    ? primaryHarmonyInterpretation(previous.semantics).appliedTarget
    : undefined;
  const currentDegree = current.semantics
    ? primaryHarmonyInterpretation(current.semantics).degree
    : undefined;
  if (target && currentDegree === target.degree) score += 10;
  if (
    (previous.functionalBaseId === "K46" ||
      previous.functionalBaseId === "N6" ||
      previous.functionalBaseId === "It+6" ||
      previous.functionalBaseId === "Fr+6" ||
      previous.functionalBaseId === "Ger+6") &&
    current.functionalBaseId === "D"
  )
    score += 14;
  if (
    currentObservation.metric?.role === "subdivision" &&
    !samePitchStructure(previous, current)
  )
    score -= 2;
  if (previousObservation.key.mode !== currentObservation.key.mode) score -= 8;
  if (
    previousObservation.key.tonic.step !== currentObservation.key.tonic.step ||
    previousObservation.key.tonic.alter !== currentObservation.key.tonic.alter
  )
    score -= 8;
  return score;
}

interface PathState {
  readonly score: number;
  readonly previousIndex?: number;
}

function analyzeRun(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
  fromIndex: number,
  toIndex: number,
) {
  const states: PathState[][] = [];
  for (let index = fromIndex; index < toIndex; index += 1) {
    const currentCandidates = candidateSets[index].slice(0, 32);
    const currentStates: PathState[] = [];
    for (let candidateIndex = 0; candidateIndex < currentCandidates.length; candidateIndex += 1) {
      const candidate = currentCandidates[candidateIndex];
      let best: PathState = {
        score: index === fromIndex ? candidate.score.total : Number.NEGATIVE_INFINITY,
      };
      if (index > fromIndex) {
        const previousCandidates = candidateSets[index - 1].slice(0, 32);
        for (let previousIndex = 0; previousIndex < previousCandidates.length; previousIndex += 1) {
          const previousState = states[index - fromIndex - 1][previousIndex];
          if (!previousState) continue;
          const value =
            previousState.score +
            candidate.score.total +
            transitionScore(
              previousCandidates[previousIndex],
              candidate,
              observations[index - 1],
              observations[index],
            );
          if (
            value > best.score ||
            (value === best.score &&
              previousIndex < (best.previousIndex ?? Number.POSITIVE_INFINITY))
          )
            best = { score: value, previousIndex };
        }
      }
      currentStates.push(best);
    }
    states.push(currentStates);
  }
  const lastStates = states.at(-1) ?? [];

  // Forward + backward scores give every candidate the same complete-run
  // context, including competing continuations rather than the selected path.
  const suffixScores: number[][] = [];
  const scoredCandidates: ChordInferenceCandidate[][] = [];
  for (let offset = states.length - 1; offset >= 0; offset -= 1) {
    const index = fromIndex + offset;
    const candidates = candidateSets[index].slice(0, 32);
    suffixScores[offset] = candidates.map((candidate) => {
      if (index === toIndex - 1) return 0;
      return Math.max(...candidateSets[index + 1].slice(0, 32).map((next, nextIndex) =>
        transitionScore(candidate, next, observations[index], observations[index + 1]) +
        next.score.total + suffixScores[offset + 1][nextIndex],
      ));
    });
    scoredCandidates[offset] = candidates.map((candidate, candidateIndex) => ({
      ...candidate,
      pathScore: states[offset][candidateIndex].score + suffixScores[offset][candidateIndex],
    }));
  }
  let currentIndex = lastStates.reduce(
    (bestIndex, state, index) =>
      state.score > lastStates[bestIndex].score ? index : bestIndex,
    0,
  );
  const selected: ChordInferenceCandidate[] = [];
  for (let stateIndex = states.length - 1; stateIndex >= 0; stateIndex -= 1) {
    selected[stateIndex] = scoredCandidates[stateIndex][currentIndex];
    currentIndex = states[stateIndex][currentIndex].previousIndex ?? 0;
  }
  return { selected, scoredCandidates };
}

/** Scores all retained candidates and selects a deterministic path per run. */
export function analyzeChordInferencePaths(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
) {
  const selected: Array<ChordInferenceCandidate | undefined> = Array.from(
    { length: observations.length },
    () => undefined,
  );
  const scoredCandidateSets: Array<readonly ChordInferenceCandidate[]> = Array.from(
    { length: observations.length },
    () => Object.freeze([]),
  );
  let index = 0;
  while (index < observations.length) {
    while (index < observations.length && candidateSets[index].length === 0)
      index += 1;
    const fromIndex = index;
    while (index < observations.length && candidateSets[index].length > 0)
      index += 1;
    if (index <= fromIndex) continue;
    const run = analyzeRun(observations, candidateSets, fromIndex, index);
    run.selected.forEach((candidate, offset) => {
      selected[fromIndex + offset] = candidate;
      scoredCandidateSets[fromIndex + offset] = Object.freeze(run.scoredCandidates[offset]);
    });
  }
  return {
    selectedPath: Object.freeze(selected),
    candidateSets: Object.freeze(scoredCandidateSets),
  };
}

export function selectChordInferencePath(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
) {
  return analyzeChordInferencePaths(observations, candidateSets).selectedPath;
}
