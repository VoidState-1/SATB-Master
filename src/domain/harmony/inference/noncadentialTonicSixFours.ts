import { chordIdentityEquals, chordIdentityInversion, primaryHarmonyInterpretation } from "../../chordModel";
import { keyDeclarationEquals, keyEquals, isWrittenStep, spelledPitchEquals, writtenInterval } from "../../pitch";
import { soundsCompleteWrittenChord } from "../writtenVoicing";
import { observationNotes } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation } from "./types";

type Observation = ChordInferenceObservation;
type CandidateSet = readonly ChordInferenceCandidate[];
const evidenceCode = "tonic-six-four-before-stronger-predominant";

export function hasNoncadentialTonicProof(candidate?: ChordInferenceCandidate) {
  return candidate?.evidence.some(item => item.code === evidenceCode) ?? false;
}

function isLocalComplete(candidate: ChordInferenceCandidate, observation: Observation) {
  const { fit, semantics } = candidate;
  if (!semantics || !observation.completeSatb || !observation.bass ||
      !fit.spellingConsistent || !fit.bassMatchesInversion ||
      fit.omittedChordDegrees.length || fit.nonChordToneNoteIds.length) return false;
  const { appliedTarget, localKey } = primaryHarmonyInterpretation(semantics);
  return !appliedTarget && (!localKey || keyEquals(localKey, observation.key)) &&
    soundsCompleteWrittenChord(candidate.identity, observationNotes(observation).map(item => item.note), observation.bass);
}

function isTonic(candidate: ChordInferenceCandidate) {
  return candidate.functionalBaseId === "T" || candidate.functionalBaseId === "t";
}

function startsPredominant(candidate: ChordInferenceCandidate) {
  const base = candidate.functionalBaseId;
  return base === "S" || base === "s" || base === "SII";
}

/** Spasobin §§9.3–4 and 13.1–2. A weak, complete tonic six-four with
 * an immediate bass step out to a stronger, complete predominant has
 * local evidence for the tonic reading. Keep the original K46 fit visible. */
export function chooseNoncadentialTonicSixFours(
  observations: readonly Observation[], candidateSets: readonly CandidateSet[],
  selected: readonly (ChordInferenceCandidate | undefined)[], phraseTicks: readonly number[],
) {
  return selected.map((current, index) => {
    const set = candidateSets[index];
    if (!current || set.length !== 2 || index === 0 || index + 1 >= observations.length) return current;
    const tonic = set.find(isTonic), cadential = set.find(candidate => candidate.functionalBaseId === "K46");
    if (!tonic || !cadential || tonic.confidence === "low" || tonic.semantics?.cadenceRole ||
        chordIdentityInversion(tonic.identity) !== 2 ||
        !chordIdentityEquals(tonic.identity, cadential.identity)) return current;
    const [left, middle, right] = observations.slice(index - 1, index + 2);
    if (!keyDeclarationEquals(left.key, middle.key) || !keyDeclarationEquals(middle.key, right.key) ||
        left.toTick !== middle.fromTick || middle.toTick !== right.fromTick ||
        !left.bass || !middle.bass || !right.bass ||
        phraseTicks.some(tick => left.fromTick < tick && tick < right.toTick) ||
        middle.metric?.confidence !== "certain" || middle.metric.level > 1 ||
        right.metric?.confidence !== "certain" || right.metric.level <= middle.metric.level ||
        !isWrittenStep(writtenInterval(middle.bass.pitch, right.bass.pitch)) ||
        ![tonic, cadential].every(candidate => isLocalComplete(candidate, middle))) return current;
    // Do not reinterpret the last slice of a continuing six-four as a new chord.
    if (candidateSets[index - 1].some(candidate => chordIdentityEquals(candidate.identity, tonic.identity))) return current;
    if (!spelledPitchEquals(left.bass.pitch, middle.bass.pitch) &&
        !isWrittenStep(writtenInterval(left.bass.pitch, middle.bass.pitch))) return current;
    const [before, after] = [candidateSets[index - 1], candidateSets[index + 1]];
    if (before.length !== 1 || !isLocalComplete(before[0], left) || after.length !== 1 ||
        !startsPredominant(after[0]) || !isLocalComplete(after[0], right)) return current;
    return {
      ...tonic,
      evidence: [...tonic.evidence, {
        kind: "sequence-context" as const, code: evidenceCode,
        noteIds: [middle.bass.id, right.bass.id],
        details: { arrivalTick: right.fromTick, predominant: after[0].functionalBaseId! },
      }],
    };
  });
}
