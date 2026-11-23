import { keyDeclarationEquals } from "../../pitch";
import type { LocalKeyContext } from "./localKeys";
import type {
  ChordInferenceCandidate,
  ChordInferenceConfidence,
  ChordInferenceObservation,
  ChordInferenceOptions,
} from "./types";

export interface InferencePassContext {
  readonly observations: readonly ChordInferenceObservation[];
  readonly options: ChordInferenceOptions;
  readonly ppq: number;
  readonly localKeys: ReadonlyMap<number, LocalKeyContext>;
  readonly terminalTicks: ReadonlySet<number>;
  readonly phraseBoundaryTicks: readonly number[];
  readonly currentPhraseTicks: readonly number[];
  readonly manualPhraseTicks: readonly number[];
  readonly minimumConfidence: ChordInferenceConfidence;
  readonly meetsMinimumConfidence: (candidate: ChordInferenceCandidate) => boolean;
}

export function continuesInKey(left: ChordInferenceObservation, right: ChordInferenceObservation) {
  return left.toTick === right.fromTick && keyDeclarationEquals(left.key, right.key);
}
