import { chordIdentityEquals } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { fitProlongedHarmony } from "./candidates";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

function movingNote(
  before: ChordInferenceObservation, middle: ChordInferenceObservation, after: ChordInferenceObservation,
) {
  let movingId: string | undefined;
  for (const voice of VOICE_ORDER) {
    const first = before.activeNotes[voice];
    const note = middle.activeNotes[voice];
    const last = after.activeNotes[voice];
    if (!first || !note || !last) return;
    const into = writtenInterval(first.pitch, note.pitch);
    const onward = writtenInterval(note.pitch, last.pitch);
    if (!into.diatonicSteps && !into.semitones && !onward.diatonicSteps && !onward.semitones) continue;
    if (movingId || voice === "bass" || !isWrittenStep(into) || !isWrittenStep(onward)) return;
    movingId = note.id;
  }
  return movingId;
}

/** Bridge an otherwise unexplained weak note between two statements of the same harmony. */
export function withProlongedHarmony(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  ppq: number,
) {
  if (options.minConfidence === "high") return sets;
  const result = sets.slice();
  for (let i = 1; i + 1 < sets.length; i++) {
    if (sets[i].length || !sets[i - 1].length || !sets[i + 1].length) continue;
    const [before, middle, after] = observations.slice(i - 1, i + 2);
    if (middle.metric?.confidence !== "certain" || after.metric?.confidence !== "certain") continue;
    const duration = middle.toTick - middle.fromTick;
    if (middle.metric.level >= 2 || duration > ppq || duration > before.toTick - before.fromTick) continue;
    if (middle.metric.measureNumber !== after.metric.measureNumber && after.metric.beatPosition !== 0) continue;
    if (![before, after].every(o => middle.key.mode === o.key.mode && pitchClassEquals(middle.key.tonic, o.key.tonic))) continue;
    const movingId = movingNote(before, middle, after);
    if (!movingId) continue;
    const matches = sets[i - 1].flatMap(left => {
      if (!left.semantics || left.fit.nonChordToneNoteIds.length || !left.fit.spellingConsistent ||
          !sets[i + 1].some(right => right.functionalBaseId === left.functionalBaseId &&
            right.semantics?.primaryInterpretationId === left.semantics!.primaryInterpretationId &&
            right.fit.spellingConsistent && !right.fit.nonChordToneNoteIds.length &&
            chordIdentityEquals(left.identity, right.identity))) return [];
      const candidate = fitProlongedHarmony(left, middle, movingId);
      return candidate ? [candidate] : [];
    });
    if (matches.length) result[i] = matches;
  }
  return result;
}

