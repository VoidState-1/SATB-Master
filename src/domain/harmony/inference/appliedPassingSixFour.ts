import { chordIdentityEquals, chordIdentityInversion, primaryHarmonyInterpretation } from "../../chordModel";
import { keyDeclarationEquals, isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval, type SpelledPitch } from "../../pitch";
import { soundingBass } from "./observations";
import type { ChordInferenceCandidate as Candidate, ChordInferenceObservation as Observation } from "./types";

type CandidateSet = readonly Candidate[];

function exactTriad(candidate: Candidate) {
  const { structure } = candidate.identity;
  return candidate.fit.spellingConsistent && candidate.fit.bassMatchesInversion &&
    !candidate.fit.nonChordToneNoteIds.length && !candidate.fit.omittedChordDegrees.length &&
    structure.kind === "tertian" && (structure.quality === "major" || structure.quality === "minor") &&
    !structure.extensions.length && !structure.alterations.length;
}

function step(from: SpelledPitch, to: SpelledPitch, direction: number) {
  const movement = writtenInterval(from, to);
  return isWrittenStep(movement) && movement.diatonicSteps === direction && Math.sign(movement.semitones) === direction;
}

/** Spasobin §13.2–3, ex. 13-168 and 170. The bass exchanges the local tonic
 * and third with an upper part while the fifth stays. In ex. 13-172 the
 * first-inversion triad doubles its fifth, a third below the leading tone. */
function hasPassingVoices(left: Observation, mid: Observation, right: Observation, anchor: Candidate) {
  const a = soundingBass(left), b = soundingBass(mid), c = soundingBass(right);
  if (!a || !b || !c) return false;
  const direction = writtenInterval(a, b).diatonicSteps;
  if (!step(a, b, direction) || !step(b, c, direction)) return false;
  const tonic = anchor.identity.root;
  const fifth = scaleDegreePitchClass({ tonic, mode: "major" }, 5);
  let exchange = false, common = false, leadingLine = false;
  for (const voice of ["soprano", "alto", "tenor"] as const) {
    const from = left.activeNotes[voice]!.pitch, via = mid.activeNotes[voice]!.pitch, to = right.activeNotes[voice]!.pitch;
    if (pitchClassEquals(from, c) && pitchClassEquals(via, b) && pitchClassEquals(to, a) &&
        step(from, via, -direction) && step(via, to, -direction)) exchange = true;
    if (pitchClassEquals(from, fifth) && spelledPitchEquals(from, via) && spelledPitchEquals(from, to)) common = true;
    const rootPositionTone = direction > 0 ? from : to;
    const firstInversionTone = direction > 0 ? to : from;
    const semitone = writtenInterval(rootPositionTone, via);
    if (pitchClassEquals(rootPositionTone, tonic) && semitone.diatonicSteps === -1 && semitone.semitones === -1) {
      const third = writtenInterval(firstInversionTone, via);
      if (spelledPitchEquals(firstInversionTone, rootPositionTone) ||
          (pitchClassEquals(firstInversionTone, fifth) && third.diatonicSteps === 2 && third.semitones === 4)) leadingLine = true;
    }
  }
  return exchange && common && leadingLine;
}

function weakPassingPosition(left: Observation, middle: Observation, right: Observation) {
  const start = middle.metric, end = right.metric;
  if (!start || !end || start.confidence !== "certain" || end.confidence !== "certain" ||
      (start.role !== "weak-beat" && start.role !== "subdivision")) return false;
  if (start.measureNumber === end.measureNumber) return end.beatPosition - start.beatPosition <= 1;
  const previous = left.metric;
  if (end.role !== "downbeat" || end.measureNumber !== start.measureNumber + 1 ||
      previous?.measureNumber !== start.measureNumber || previous.confidence !== "certain") return false;
  const beats = start.beatPosition - previous.beatPosition;
  return beats > 0 && (end.tick - start.tick) * beats <= start.tick - previous.tick;
}

export function withAppliedPassingSixFours(
  frames: readonly Observation[], sets: readonly CandidateSet[], boundaries: readonly number[],
) {
  return sets.map((set, index) => {
    const left = frames[index - 1], middle = frames[index], right = frames[index + 1];
    if (!left || !right || left.toTick !== middle.fromTick || middle.toTick !== right.fromTick ||
        !weakPassingPosition(left, middle, right) ||
        [left, right].some(frame => !keyDeclarationEquals(frame.key, middle.key)) ||
        boundaries.some(tick => left.fromTick < tick && tick <= right.fromTick)) return set;
    return set.map(candidate => {
      if (!candidate.semantics || candidate.semantics.cadenceRole || !exactTriad(candidate) ||
          candidate.identity.structure.kind !== "tertian" || candidate.identity.structure.quality !== "major" ||
          chordIdentityInversion(candidate.identity) !== 2) return candidate;
      const reading = primaryHarmonyInterpretation(candidate.semantics);
      const target = reading.appliedTarget;
      if (!target || target.secondaryFunction || reading.degree !== 5 || reading.degreeAlteration !== 0 ||
          reading.designation?.primaryFunction !== "dominant") return candidate;
      const anchor = (c: Candidate) => {
        if (!c.semantics || c.semantics.cadenceRole || !exactTriad(c)) return false;
        const value = primaryHarmonyInterpretation(c.semantics);
        return !value.appliedTarget && value.degree === target.degree && value.degreeAlteration === 0 &&
          value.designation?.primaryFunction === target.primaryFunction &&
          pitchClassEquals(candidate.identity.root, scaleDegreePitchClass({ tonic: c.identity.root, mode: "major" }, 5));
      };
      const before = sets[index - 1].find(anchor), after = sets[index + 1].find(anchor);
      if (!before || !after || before.functionalBaseId !== after.functionalBaseId ||
          !chordIdentityEquals({ ...before.identity, bass: after.identity.bass }, after.identity)) return candidate;
      const inversions = [chordIdentityInversion(before.identity), chordIdentityInversion(after.identity)];
      if (!inversions.includes(0) || !inversions.includes(1) || !hasPassingVoices(left, middle, right, before)) return candidate;
      return { ...candidate, semantics: { ...candidate.semantics, cadenceRole: "passing64" as const },
        evidence: [...candidate.evidence, { kind: "sequence-context" as const, code: "passing64" }] };
    });
  });
}
