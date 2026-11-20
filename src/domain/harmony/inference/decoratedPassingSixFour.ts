import { decoratedPassingSixFourMotion } from "../decoratedPassingSixFourMotion";
import { fitProlongedHarmony } from "./candidates";
import type { ChordInferenceCandidate, ChordInferenceObservation } from "./types";

export function decoratedPassingSixFour(
  left: ChordInferenceCandidate, middle: ChordInferenceCandidate, right: ChordInferenceCandidate,
  before: ChordInferenceObservation, ornament: ChordInferenceObservation,
  sixFour: ChordInferenceObservation, after: ChordInferenceObservation, ppq: number,
) {
  const motion = decoratedPassingSixFourMotion(
    { ...before, identity: left.identity }, ornament, { ...sixFour, identity: middle.identity },
    { ...after, identity: right.identity }, ppq,
  );
  if (!motion) return;
  const id = motion.note.id;
  const fit = fitProlongedHarmony(left, ornament, id);
  if (!fit) return;
  return {
    ...fit,
    fit: { ...fit.fit, nonChordToneAssignments: { [id]: "passing" as const } },
    evidence: [...fit.evidence, { kind: "inferred-nonchord-tone" as const, code: "passing", noteIds: [id] }],
  };
}
