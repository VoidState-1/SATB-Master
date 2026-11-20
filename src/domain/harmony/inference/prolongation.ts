import { chordIdentityEquals } from "../../chordModel";
import { keyDeclarationEquals, isWrittenStep, spelledPitchEquals, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { compareMetricStrength } from "../../rhythm/metric";
import { fitProlongedHarmony } from "./candidates";
import { hasCompleteWrittenTertianChord } from "./fit";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

function movingNote(
  before: ChordInferenceObservation, middle: ChordInferenceObservation, after: ChordInferenceObservation,
) {
  let motion: { id: string; returnsByStep: boolean } | undefined;
  let companionsHeld = true;
  for (const voice of VOICE_ORDER) {
    const first = before.activeNotes[voice];
    const note = middle.activeNotes[voice];
    const last = after.activeNotes[voice];
    if (!first || !note || !last) return;
    const into = writtenInterval(first.pitch, note.pitch);
    const onward = writtenInterval(note.pitch, last.pitch);
    if (!into.diatonicSteps && !into.semitones && !onward.diatonicSteps && !onward.semitones) {
      if (first.id !== note.id || note.id !== last.id) companionsHeld = false;
      continue;
    }
    if (motion || voice === "bass" || !isWrittenStep(into) || !isWrittenStep(onward)) return;
    motion = {
      id: note.id,
      returnsByStep: !first.nonChordToneRole && !note.nonChordToneRole && !last.nonChordToneRole &&
        spelledPitchEquals(first.pitch, last.pitch) &&
        Math.sign(into.semitones) === into.diatonicSteps &&
        first.startTick + first.durationTicks === note.startTick &&
        note.startTick === middle.fromTick && note.startTick + note.durationTicks === last.startTick &&
        last.startTick === after.fromTick &&
        note.durationTicks <= first.durationTicks && note.durationTicks <= last.durationTicks,
    };
  }
  return motion && { id: motion.id, isNeighbor: motion.returnsByStep && companionsHeld };
}

/** Bridge an otherwise unexplained weak note between two statements of the same harmony. */
export function withProlongedHarmony(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  ppq: number,
  phraseBoundaryTicks: readonly number[],
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
    if (before.toTick !== middle.fromTick || middle.toTick !== after.fromTick ||
        phraseBoundaryTicks.some(tick => before.fromTick < tick && tick <= after.fromTick) ||
        ![before, after].every(o => keyDeclarationEquals(middle.key, o.key))) continue;
    const motion = movingNote(before, middle, after);
    if (!motion) continue;
    // Spasobin §40.1, ex. 40-600. Assign the role only when the other
    // voices sustain the harmony throughout the departure and return.
    const inferNeighbor = motion.isNeighbor && options.allowNonChordToneCandidates !== false &&
      (compareMetricStrength(middle.metric, before.metric) === "weaker" ||
        compareMetricStrength(middle.metric, after.metric) === "weaker") &&
      !hasCompleteWrittenTertianChord(middle);
    const matches = sets[i - 1].flatMap(left => {
      if (!left.semantics || left.fit.nonChordToneNoteIds.length || !left.fit.spellingConsistent ||
          !sets[i + 1].some(right => right.functionalBaseId === left.functionalBaseId &&
            right.semantics?.primaryInterpretationId === left.semantics!.primaryInterpretationId &&
            right.fit.spellingConsistent && !right.fit.nonChordToneNoteIds.length &&
            chordIdentityEquals(left.identity, right.identity))) return [];
      const candidate = fitProlongedHarmony(left, middle, motion.id);
      if (!candidate) return [];
      if (!inferNeighbor) return [candidate];
      return [{
        ...candidate,
        fit: { ...candidate.fit, nonChordToneAssignments: { [motion.id]: "neighbor" as const } },
        evidence: [...candidate.evidence, {
          kind: "inferred-nonchord-tone" as const, code: "neighbor", noteIds: [motion.id],
        }],
      }];
    });
    if (matches.length) result[i] = matches;
  }
  return result;
}

