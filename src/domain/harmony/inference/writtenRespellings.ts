import {
  chordIdentityEquals, chordIdentityEqualsWithoutBass, chordIdentityInversion,
  chordIdentityToneSpellings, primaryHarmonyInterpretation,
  type ChordIdentity,
} from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, pitchClassValue, scaleDegreePitchClass } from "../../pitch";
import { readWrittenProlongation } from "../writtenProlongation";
import { writtenDoubleDominantResolution } from "../writtenResolution";
import { readSoundingTertianIdentity } from "../writtenVoicing";
import { createAbsoluteCandidate, createFunctionalCandidate } from "./candidates";
import { observationNotes, resolvesTone, writtenFrame } from "./observations";
import type {
  ChordInferenceCandidate as Candidate, ChordInferenceEvidence as Evidence,
  ChordInferenceObservation as Observation, ChordInferenceOptions,
} from "./types";

type CandidateSet = readonly Candidate[];

function fullFit(candidate: Candidate) {
  return candidate.fit.bassMatchesInversion &&
    !candidate.fit.omittedChordDegrees.length && !candidate.fit.nonChordToneNoteIds.length;
}

function sameSound(left: ChordIdentity, right: ChordIdentity) {
  const first = new Set(chordIdentityToneSpellings(left).map(pitchClassValue));
  const second = new Set(chordIdentityToneSpellings(right).map(pitchClassValue));
  return first.size === second.size && [...first].every(tone => second.has(tone));
}

function writtenIdentity(frame: Observation) {
  return readSoundingTertianIdentity({ completeSatb: frame.completeSatb, notes: frame.activeNotes });
}

function connected(left: Observation, right: Observation, boundaries: readonly number[]) {
  return left.toTick === right.fromTick && left.key.id === right.key.id &&
    !boundaries.some(tick => left.fromTick < tick && tick <= right.fromTick);
}

function supportedDoubleDominant(reading: Candidate, source: Observation, target: Observation) {
  const { identity, semantics } = reading;
  if (!semantics || identity.structure.kind !== "tertian" || identity.structure.quality !== "diminished7" ||
      !source.bass || !pitchClassEquals(source.bass.pitch, identity.bass)) return;
  const { appliedTarget, designation, localKey } = primaryHarmonyInterpretation(semantics);
  const kind = designation?.kind;
  if ((kind !== "double-dominant-leading-tone" && kind !== "applied-leading-tone") ||
      (appliedTarget?.degree ?? (kind === "double-dominant-leading-tone" ? 5 : undefined)) !== 5) return;
  const key = localKey ?? source.key;
  if (!keyEquals(key, target.key) || !pitchClassEquals(identity.root, scaleDegreePitchClass(key, 4, 1))) return;
  const resolution = writtenDoubleDominantResolution(writtenFrame(source), writtenFrame(target), key);
  if (!resolution) return;
  const note = source.activeNotes[resolution.voiceId];
  if (note && pitchClassEquals(note.pitch, resolution.previous)) return note.id;
}

/** Independently confirmed prior key, followed by the same three upper
 * events and a written bass revoicing of its dominant. */
function continuedDominant(
  literal: Candidate, frames: readonly Observation[], sets: readonly CandidateSet[],
  i: number, boundaries: readonly number[],
) {
  const source = frames[i];
  if (literal.identity.structure.kind !== "tertian" || literal.identity.structure.quality !== "major" ||
      source.attackVoiceIds.length !== 1 || source.attackVoiceIds[0] !== "bass") return;
  const upper = observationNotes(source).filter(({ voiceId }) => voiceId !== "bass");
  let start = i;
  let revoiced = false;
  while (start > 0 && connected(frames[start - 1], frames[start], boundaries) &&
    upper.every(({ voiceId, note }) => frames[start - 1].activeNotes[voiceId]?.id === note.id)) {
    start--;
    const previous = writtenIdentity(frames[start]);
    revoiced ||= !!previous && chordIdentityEqualsWithoutBass(previous, literal.identity) &&
      !pitchClassEquals(previous.bass, literal.identity.bass);
  }
  const prior = frames[start - 1];
  const localKey = prior?.localKey;
  if (!revoiced || !localKey || !connected(prior, frames[start], boundaries) ||
      !sets[start - 1].some(candidate => candidate.semantics && fullFit(candidate) && candidate.fit.spellingConsistent &&
        (candidate.functionalBaseId === "T" || candidate.functionalBaseId === "t") &&
        pitchClassEquals(candidate.identity.root, localKey.tonic))) return;
  const reading = createFunctionalCandidate({ ...source, key: { ...source.key, ...localKey }, localKey }, {
    baseId: "D", definition: functionalDefinition("D"), form: "triad", localKeyPolicy: "current-key",
    expectedInversion: chordIdentityInversion(literal.identity),
  }, {});
  if (reading && chordIdentityEquals(reading.identity, literal.identity)) return reading;
}

/** Keep a heard diminished-seventh-to-seventh exit as evidence. The two
 * written chords have distinct roots, so this does not assert an old target
 * or treat the surface as the next key's leading-tone seventh. */
function diminishedSeventhPivot(
  literal: Candidate, frames: readonly Observation[], i: number, boundaries: readonly number[],
): Evidence | undefined {
  const [source, exit, arrival] = frames.slice(i, i + 3);
  const key = arrival?.localKey;
  if (!key || keyEquals(source.key, key) || !connected(source, exit, boundaries) ||
      !connected(exit, arrival, boundaries)) return;
  const next = writtenIdentity(exit), goal = writtenIdentity(arrival);
  const lead = leadingTonePitchClass(key);
  if (next?.structure.kind !== "tertian" || next.structure.quality !== "dominant7" ||
      !pitchClassEquals(lead, next.root) || !pitchClassEquals(lead, next.bass) ||
      goal?.structure.kind !== "tertian" || goal.structure.quality !== key.mode ||
      !pitchClassEquals(goal.root, key.tonic) || !pitchClassEquals(goal.bass, key.tonic)) return;
  const seventh = chordIdentityToneSpellings(literal.identity)[3];
  if (!pitchClassEquals(seventh, literal.identity.bass) ||
      !resolvesTone(source, exit, seventh, lead, -1) ||
      !resolvesTone(exit, arrival, lead, key.tonic, 1) ||
      !resolvesTone(exit, arrival, literal.identity.root, scaleDegreePitchClass(key, 3), 1) ||
      observationNotes(source).some(({ voiceId, note }) => voiceId !== "bass" &&
        exit.activeNotes[voiceId]?.id !== note.id)) return;
  return {
    kind: "sequence-context", code: "written-diminished-pivot-to-seventh",
    details: { seventhTick: exit.fromTick, tonicTick: arrival.fromTick },
  };
}

function contextForDiminished(
  literal: Candidate, frames: readonly Observation[], i: number, boundaries: readonly number[],
): Evidence | undefined {
  const before = frames[i - 1], source = frames[i], after = frames[i + 1];
  const auxiliary = readWrittenProlongation(before && writtenFrame(before), writtenFrame(source),
    after && writtenFrame(after), boundaries);
  if (auxiliary) return {
    kind: "sequence-context", code: "written-auxiliary-diminished-seventh",
    noteIds: auxiliary.voices.map(voice => voice.middle.id),
    details: { departureTick: auxiliary.departureTick, returnTick: auxiliary.returnTick },
  };
  return diminishedSeventhPivot(literal, frames, i, boundaries);
}

/** Equal sound can establish a candidate, but it cannot establish a spelling.
 * If the whole voicing has a literal tertian identity, write that identity.
 * Competing function belongs to the spelling from which it was derived. */
export function withContextualWrittenRespellings(
  frames: readonly Observation[], sets: readonly CandidateSet[],
  options: ChordInferenceOptions, boundaries: readonly number[],
) {
  if (options.minConfidence === "high") return sets;
  return sets.map((existing, i) => {
    const mismatches = existing.filter(candidate => candidate.semantics && fullFit(candidate) &&
      !candidate.fit.spellingConsistent);
    if (!mismatches.length) return existing;
    const source = frames[i];
    const identity = writtenIdentity(source);
    if (identity?.structure.kind !== "tertian") return existing;
    const readings = mismatches.filter(candidate => sameSound(identity, candidate.identity));
    if (!readings.length) return existing;

    const proof: Evidence = {
      kind: "spelling-match", code: "written-enharmonic-identity",
      enharmonicReadings: readings.map(({ identity, semantics }) => ({ identity, semantics: semantics!, key: {
        tonic: source.key.tonic, mode: source.key.mode,
      } })),
    };
    const exact = existing.filter(candidate => candidate.semantics && fullFit(candidate) &&
      candidate.fit.spellingConsistent && chordIdentityEquals(candidate.identity, identity));
    if (exact.length) return exact.map(candidate => ({ ...candidate, evidence: [...candidate.evidence, proof] }));

    // The complete spelling can describe the surface while the four voices
    // establish the textbook reading of the written ♯II as the seventh of DDvii°7.
    const target = frames[i + 1];
    if (target && connected(source, target, boundaries)) {
      const supported = readings.flatMap(reading => {
        const noteId = supportedDoubleDominant(reading, source, target);
        return noteId ? [{ ...reading, evidence: [...reading.evidence, {
          kind: "sequence-context" as const, code: "written-double-dominant-into-six-four", noteIds: [noteId],
        }] }] : [];
      });
      if (supported.length) return supported;
    }

    const literal = createAbsoluteCandidate(source, identity.root, identity.structure.quality, {});
    if (!literal || !fullFit(literal) || !literal.fit.spellingConsistent) return existing;
    const functional = continuedDominant(literal, frames, sets, i, boundaries);
    if (functional) return [{ ...functional, confidence: "medium" as const, evidence: [...functional.evidence, proof, {
      kind: "sequence-context" as const, code: "written-dominant-bass-revoicing",
    }] }];
    const context = identity.structure.quality === "diminished7" &&
      contextForDiminished(literal, frames, i, boundaries);
    return [{
      ...literal,
      confidence: "medium" as const,
      score: { ...literal.score, functionalTier: 3 as const },
      evidence: [...literal.evidence, proof, ...(context ? [context] : [])],
    }];
  });
}
