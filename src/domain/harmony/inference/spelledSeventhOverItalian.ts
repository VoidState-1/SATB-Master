import { chordIdentityEquals, chordToneSpellings, semanticsFromChordDraft } from "../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, serializePitchClass } from "../../pitch";
import { readResolvedRootSeventhWithoutFifth } from "../writtenDominantSeventh";
import { createAbsoluteCandidate } from "./candidates";
import { observationNotes, writtenFrame } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];

function sameContext(a: ChordInferenceObservation, b: ChordInferenceObservation) {
  return a.toTick === b.fromTick && a.key.id === b.key.id && a.key.mode === b.key.mode &&
    pitchClassEquals(a.key.tonic, b.key.tonic);
}

/** A written minor seventh and independently resolved voices can replace an
 * Italian reading that requires respelling. The target is an arrival, not a key change. */
export function withSpelledSeventhsOverItalian(
  observations: readonly ChordInferenceObservation[],
  sets: readonly CandidateSet[],
  phraseBoundaries: readonly number[],
  ppq: number,
  options: ChordInferenceOptions,
) {
  if (options.minConfidence === "high") return sets;
  return sets.map((existing, i) => {
    const isRespeltItalian = (candidate: ChordInferenceCandidate) =>
      candidate.functionalBaseId === "It+6" && !candidate.fit.spellingConsistent;
    if (!existing.some(isRespeltItalian)) return existing;
    const before = observations[i - 1], source = observations[i], arrival = observations[i + 1];
    if (!before || !arrival || !source.bass || before.bass?.id !== source.bass.id ||
        !sameContext(before, source) || !sameContext(source, arrival)) return existing;
    const fifth = chordToneSpellings(source.bass.pitch, "dominant7")[2];
    if (!observationNotes(before).some(({ voiceId, note }) => voiceId !== "bass" && !note.nonChordToneRole &&
        pitchClassEquals(note.pitch, fifth) && note.startTick + note.durationTicks === source.fromTick)) return existing;

    const later = observations[i + 2];
    const delayed = later && sameContext(arrival, later) && arrival.toTick - arrival.fromTick <= ppq &&
      later.fromTick - source.fromTick <= ppq ? writtenFrame(later) : undefined;
    const proof = readResolvedRootSeventhWithoutFifth(writtenFrame(source), writtenFrame(arrival), delayed);
    if (!proof || !pitchClassEquals(proof.root, scaleDegreePitchClass(source.key, 6, -1)) ||
        phraseBoundaries.some(tick => before.fromTick < tick && tick <= proof.settledTick)) return existing;
    const candidate = createAbsoluteCandidate(source, proof.root, "dominant7", options);
    if (!candidate || !candidate.fit.spellingConsistent || candidate.fit.nonChordToneNoteIds.length ||
        candidate.fit.omittedChordDegrees.length) return existing;
    // General absolute fallback may already have found this same written chord.
    // Preserve any competing independent interpretation.
    if (existing.some(other => !isRespeltItalian(other) &&
        (other.semantics || !chordIdentityEquals(other.identity, candidate.identity)))) return existing;
    return [{
      ...candidate,
      // The written root is flat VI of the established key. The brief
      // arrival proves its resolution, without establishing another key.
      semantics: semanticsFromChordDraft({
        degree: 6, degreeAlteration: -1, quality: "dominant7", inversion: 0, extensions: [], alterations: [],
        localKey: source.localKey, interpretationId: "inferred:written-lowered-sixth-seventh",
        source: "inferred", confidence: "probable",
      }),
      confidence: "medium" as const,
      evidence: [...candidate.evidence, {
        kind: "sequence-context" as const,
        code: "written-seventh-over-enharmonic-italian",
        noteIds: proof.noteIds,
        details: {
          targetRoot: serializePitchClass(proof.target), targetQuality: proof.mode, omittedDegree: 5,
          bassArrivalTick: arrival.fromTick, upperResolutionTick: proof.settledTick,
        },
      }],
    }];
  });
}
