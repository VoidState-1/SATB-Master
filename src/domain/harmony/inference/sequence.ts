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

function chooseRun(
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
      let best: PathState = { score: candidate.score.total };
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
  if (lastStates.length === 0) return [] as readonly ChordInferenceCandidate[];
  let currentIndex = lastStates.reduce(
    (bestIndex, state, index) =>
      state.score > lastStates[bestIndex].score ? index : bestIndex,
    0,
  );
  const selected: ChordInferenceCandidate[] = [];
  for (let stateIndex = states.length - 1; stateIndex >= 0; stateIndex -= 1) {
    selected[stateIndex] = candidateSets[fromIndex + stateIndex].slice(0, 32)[currentIndex];
    currentIndex = states[stateIndex][currentIndex].previousIndex ?? 0;
  }
  return selected;
}

function addPathContextScores(
  path: readonly ChordInferenceCandidate[],
  observations: readonly ChordInferenceObservation[],
  fromIndex: number,
) {
  return path.map((candidate, offset) => {
    if (offset >= path.length - 1) return candidate;
    const contextFit = transitionScore(
      candidate,
      path[offset + 1],
      observations[fromIndex + offset],
      observations[fromIndex + offset + 1],
    );
    if (contextFit === 0) return candidate;
    return {
      ...candidate,
      score: {
        ...candidate.score,
        contextFit,
        total: candidate.score.total + contextFit,
      },
    };
  });
}

/** Selects one deterministic candidate path for each contiguous candidate run. */
export function selectChordInferencePath(
  observations: readonly ChordInferenceObservation[],
  candidateSets: readonly (readonly ChordInferenceCandidate[])[],
) {
  const selected: Array<ChordInferenceCandidate | undefined> = Array.from(
    { length: observations.length },
    () => undefined,
  );
  let index = 0;
  while (index < observations.length) {
    while (index < observations.length && candidateSets[index].length === 0)
      index += 1;
    const fromIndex = index;
    while (index < observations.length && candidateSets[index].length > 0)
      index += 1;
    if (index <= fromIndex) continue;
    const run = addPathContextScores(
      chooseRun(observations, candidateSets, fromIndex, index),
      observations,
      fromIndex,
    );
    run.forEach((candidate, offset) => {
      selected[fromIndex + offset] = candidate;
    });
  }
  return Object.freeze(selected);
}
