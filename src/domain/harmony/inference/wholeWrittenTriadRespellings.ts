import { chordIdentityToneSpellings } from "../../chordModel";
import { isWrittenStep, pitchClassValue, spelledPitchEquals, stepIndex, toMidi, writtenInterval } from "../../pitch";
import { observationNotes } from "./observations";
import type {
  ChordInferenceCandidate,
  ChordInferenceObservation,
} from "./types";

type Observation = ChordInferenceObservation;

function exactVoicing(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.omittedChordDegrees.length &&
    !candidate.fit.nonChordToneNoteIds.length;
}

function uniformRespelling(reading: ChordInferenceCandidate, source: Observation) {
  const original = chordIdentityToneSpellings(reading.identity);
  // Match by sound, then compare the written names of all three members.
  const shifts = original.map(tone => {
    const written = source.soundingPitchClasses.find(p => pitchClassValue(p) === pitchClassValue(tone));
    return written && (stepIndex(written.step) - stepIndex(tone.step) + 7) % 7;
  });
  return (shifts[0] === 1 || shifts[0] === 6) && shifts.every(shift => shift === shifts[0]);
}

function connectedInVoice(left: Observation, right: Observation, allowCommonTone: boolean) {
  if (!left.completeSatb || !right.completeSatb || left.toTick !== right.fromTick ||
      left.key.id !== right.key.id) return false;
  return observationNotes(left).some(({ voiceId, note }) => {
    const next = right.activeNotes[voiceId];
    if (!next || note.nonChordToneRole || next.nonChordToneRole) return false;
    if (allowCommonTone && spelledPitchEquals(note.pitch, next.pitch)) return true;
    if (note.startTick + note.durationTicks !== right.fromTick || next.startTick !== right.fromTick) return false;
    const interval = writtenInterval(note.pitch, next.pitch);
    return isWrittenStep(interval) && interval.diatonicSteps === Math.sign(interval.semitones);
  });
}

/** A complete, uniformly respelled triad establishes the written identity,
 * but an equally sounding functional template cannot establish its function. */
export function withWholeWrittenTriadRespellings(
  observations: readonly Observation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  phraseBoundaries: readonly number[],
) {
  return sets.map((existing, index) => {
    const functional = existing.filter(candidate => candidate.semantics);
    if (functional.length !== 1 || exactVoicing(functional[0])) return existing;
    const [reading] = functional;
    if (reading.identity.structure.kind !== "tertian" ||
        reading.identity.structure.quality !== "major" ||
        reading.identity.structure.extensions.length || reading.identity.structure.alterations.length ||
        reading.fit.omittedChordDegrees.length || reading.fit.nonChordToneNoteIds.length) return existing;

    const source = observations[index], before = observations[index - 1], after = observations[index + 1];
    const bass = source.bass;
    if (!before || !after || !bass || source.attackVoiceIds.length < 3 ||
        source.soundingPitchClasses.length !== 3 ||
        observationNotes(source).some(({ note }) => note.nonChordToneRole || toMidi(note.pitch) < toMidi(bass.pitch)) ||
        !connectedInVoice(before, source, false) || !connectedInVoice(source, after, true) ||
        phraseBoundaries.some(tick => before.fromTick < tick && tick <= after.fromTick)) return existing;

    if (!uniformRespelling(reading, source)) return existing;
    // Fallback and confidence options have already filtered the candidate set.
    return existing.filter(candidate => !candidate.semantics && exactVoicing(candidate)).map(candidate => ({
      ...candidate, evidence: [...candidate.evidence, {
        kind: "sequence-context" as const, code: "whole-written-triad-respelling",
      }],
    }));
  });
}
