import {
  chordIdentityEquals,
  chordIdentityEqualsWithoutBass,
  chordIdentityInversion,
  chordIdentityToneSpellings,
  chordToneSpellings,
  primaryHarmonyInterpretation,
  type ChordIdentity,
  type KeyReference,
  semanticsFromChordDraft,
} from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import {
  keyEquals,
  leadingTonePitchClass,
  pitchClassEquals,
  pitchClassValue,
  scaleDegreePitchClass,
  spelledPitchEquals,
  toMidi,
  isWrittenStep,
  stepIndex,
  writtenInterval,
  serializePitchClass,
} from "../../pitch";
import { readWrittenProlongation } from "../facts/prolongation";
import {
  hasWrittenVoicing,
  resolvesLeadingSeventhToDoubledThird,
  writtenCadentialSixFourExit,
  writtenDoubleDominantWindow,
  resolvesRaisedFifthToDoubledThird,
} from "../facts/tendencyResolution";
import { readSoundingTertianIdentity } from "../facts/writtenVoicing";
import { createAbsoluteCandidate, createFunctionalCandidate, candidateComparator } from "./candidates";
import { observationNotes, resolvesTone, writtenFrame } from "./observations";
import { continuesInKey } from "./passContext";
import type {
  ChordInferenceCandidate as Candidate,
  ChordInferenceEvidence as Evidence,
  ChordInferenceObservation,
  ChordInferenceOptions,
  ChordInferenceCandidate,
  FunctionalChordTemplate,
} from "./types";
import { readResolvedRootSeventhWithoutFifth } from "../facts/dominantMotion";

type WrittenRespellingsCandidateSet = readonly Candidate[];

function fullFit(candidate: Candidate) {
  return candidate.fit.bassMatchesInversion &&
    !candidate.fit.omittedChordDegrees.length && !candidate.fit.nonChordToneNoteIds.length;
}

function sameSound(left: ChordIdentity, right: ChordIdentity) {
  const first = new Set(chordIdentityToneSpellings(left).map(pitchClassValue));
  const second = new Set(chordIdentityToneSpellings(right).map(pitchClassValue));
  return first.size === second.size && [...first].every(tone => second.has(tone));
}

function writtenIdentity(frame: ChordInferenceObservation) {
  return readSoundingTertianIdentity({ completeSatb: frame.completeSatb, notes: frame.activeNotes });
}

function connected(left: ChordInferenceObservation, right: ChordInferenceObservation, boundaries: readonly number[]) {
  return left.toTick === right.fromTick && left.key.id === right.key.id &&
    !boundaries.some(tick => left.fromTick < tick && tick <= right.fromTick);
}

function* followingWrittenFrames(frames: readonly ChordInferenceObservation[], index: number) {
  for (let i = index + 1; i < frames.length; i++) yield { ...writtenFrame(frames[i]), index: i };
}

function supportedDoubleDominant(
  reading: Candidate, frames: readonly ChordInferenceObservation[], sets: readonly WrittenRespellingsCandidateSet[], i: number,
  boundaries: readonly number[], manualBoundaries: readonly number[],
): Evidence | undefined {
  const source = frames[i];
  const { identity, semantics } = reading;
  if (!semantics || identity.structure.kind !== "tertian" || identity.structure.quality !== "diminished7" ||
      !source.bass || !pitchClassEquals(source.bass.pitch, identity.bass)) return;
  const { appliedTarget, designation, localKey } = primaryHarmonyInterpretation(semantics);
  const kind = designation?.kind;
  if ((kind !== "double-dominant-leading-tone" && kind !== "applied-leading-tone") ||
      (appliedTarget?.degree ?? (kind === "double-dominant-leading-tone" ? 5 : undefined)) !== 5) return;
  const key = localKey ?? source.key;
  if (!keyEquals(key, source.key) || !pitchClassEquals(identity.root, scaleDegreePitchClass(key, 4, 1))) return;
  const resolution = writtenDoubleDominantWindow({ ...writtenFrame(source), index: i },
    followingWrittenFrames(frames, i), key, manualBoundaries);
  if (!resolution) return;
  const note = source.activeNotes[resolution.voiceId];
  if (!note || !pitchClassEquals(note.pitch, resolution.previous)) return;
  const { landing } = resolution;
  if (landing.index === i + 1) {
    if (!connected(source, frames[landing.index], boundaries)) return;
  } else {
    if (sets[landing.index].some(c => c.semantics?.cadenceRole === "passing64" || c.semantics?.cadenceRole === "pedal64") ||
        !writtenCadentialSixFourExit(landing, followingWrittenFrames(frames, landing.index), key, manualBoundaries)) return;
  }
  return {
    kind: "sequence-context", code: "written-double-dominant-into-six-four", noteIds: [note.id],
    details: { firstArrivalTick: Math.min(...resolution.arrivalTicks.values()), landingTick: landing.tick },
  };
}

/** The already established V of a local key can receive its own vii°7.
 * The arrival's label and all four original voices must agree. */
function leadingSeventhIntoLocalDominant(
  literal: Candidate, source: ChordInferenceObservation, arrival: ChordInferenceObservation, arrivals: WrittenRespellingsCandidateSet,
) {
  const key = arrival.localKey;
  if (!key || (source.localKey && !keyEquals(source.localKey, key)) ||
      literal.identity.structure.kind !== "tertian" || literal.identity.structure.quality !== "diminished7") return;
  const exact = arrivals.filter(candidate => candidate.semantics && candidate.fit.spellingConsistent && fullFit(candidate));
  if (exact.length !== 1) return;
  const [dominant] = exact;
  const target = dominant.identity;
  const tonic = scaleDegreePitchClass(key, 5);
  if (dominant.functionalBaseId !== "D" || !pitchClassEquals(target.root, tonic) ||
      target.structure.kind !== "tertian" || target.structure.quality !== "major" ||
      target.structure.extensions.length || target.structure.alterations.length ||
      chordIdentityInversion(target) > 1 || !arrival.bass || !pitchClassEquals(target.bass, arrival.bass.pitch)) return;
  const meaning = primaryHarmonyInterpretation(dominant.semantics!);
  if (!meaning.localKey || !keyEquals(meaning.localKey, key) || meaning.appliedTarget ||
      dominant.semantics?.cadenceRole || dominant.semantics?.pedalContext) return;

  const lead = leadingTonePitchClass({ tonic, mode: "major" });
  const targetTones = chordToneSpellings(tonic, "major");
  if (!pitchClassEquals(lead, literal.identity.root) || !hasWrittenVoicing(writtenFrame(arrival), targetTones) ||
      !resolvesLeadingSeventhToDoubledThird(writtenFrame(source), writtenFrame(arrival),
        chordIdentityToneSpellings(literal.identity), targetTones)) return;
  const candidate = createFunctionalCandidate({ ...source, key: { ...source.key, ...key }, localKey: key }, {
    baseId: "DDVII", definition: functionalDefinition("DDVII"), form: "seventh", localKeyPolicy: "current-key",
    expectedInversion: chordIdentityInversion(literal.identity),
  }, {});
  if (!candidate || !chordIdentityEquals(candidate.identity, literal.identity)) return;
  return { ...candidate, confidence: "medium" as const, evidence: [...candidate.evidence, {
    kind: "sequence-context" as const, code: "written-leading-seventh-into-local-dominant",
    noteIds: observationNotes(source).map(({ note }) => note.id),
    details: { arrivalTick: arrival.fromTick },
  }] };
}

/** Independently confirmed prior key, followed by the same three upper
 * events and a written bass revoicing of its dominant. */
function priorDominantReading(
  literal: Candidate, frames: readonly ChordInferenceObservation[], sets: readonly WrittenRespellingsCandidateSet[],
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
  if (reading?.semantics && chordIdentityEquals(reading.identity, literal.identity)) return { reading, localKey };
}

function returnsToPriorKey(source: ChordInferenceObservation, arrival: ChordInferenceObservation, oldKey: KeyReference) {
  const tones = chordToneSpellings(oldKey.tonic, oldKey.mode);
  const bass = arrival.bass;
  return !!bass && (!arrival.localKey || keyEquals(arrival.localKey, oldKey)) &&
    [tones[0], tones[1]].some(tone => pitchClassEquals(tone, bass.pitch)) &&
    hasWrittenVoicing(writtenFrame(arrival), tones) &&
    resolvesTone(source, arrival, leadingTonePitchClass(oldKey), oldKey.tonic, 1);
}

/** The equal-sounding N6 reading has its own forward evidence: one written
 * respelling into the German sixth, then contrary resolution to tonic 64. */
function neapolitanPivotExit(
  reading: Candidate, source: ChordInferenceObservation, sixth: ChordInferenceObservation, landing: ChordInferenceObservation,
) {
  const key = source.key;
  if (reading.functionalBaseId !== "N6" || key.mode !== "minor" ||
      !keyEquals(key, sixth.key) || !keyEquals(key, landing.key) ||
      !source.bass || !sixth.bass || !landing.bass) return;
  const tonic = chordToneSpellings(key.tonic, key.mode);
  const flatSixth = scaleDegreePitchClass(key, 6);
  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const dominant = scaleDegreePitchClass(key, 5);
  if (!pitchClassEquals(sixth.bass.pitch, raisedFourth) || !pitchClassEquals(landing.bass.pitch, dominant) ||
      !hasWrittenVoicing(writtenFrame(sixth), [flatSixth, tonic[0], tonic[1], raisedFourth]) ||
      !hasWrittenVoicing(writtenFrame(landing), tonic) ||
      !resolvesTone(source, sixth, source.bass.pitch, raisedFourth, 1) ||
      !resolvesTone(sixth, landing, raisedFourth, dominant, 1) ||
      !resolvesTone(sixth, landing, flatSixth, dominant, -1) ||
      !resolvesTone(sixth, landing, tonic[0], tonic[0], 0) ||
      !resolvesTone(sixth, landing, tonic[1], tonic[1], 0)) return;
  const respelt = observationNotes(source).find(({ voiceId, note }) => {
    const next = sixth.activeNotes[voiceId];
    return next && pitchClassEquals(next.pitch, flatSixth) &&
      toMidi(note.pitch) === toMidi(next.pitch) && !spelledPitchEquals(note.pitch, next.pitch);
  });
  if (respelt) return {
    kind: "sequence-context" as const, code: "written-neapolitan-pivot-to-german-sixth",
    noteIds: [respelt.note.id], details: { sixthTick: sixth.fromTick, tonicSixFourTick: landing.fromTick },
  };
}

function dominantRevoicing(
  literal: Candidate, readings: WrittenRespellingsCandidateSet, frames: readonly ChordInferenceObservation[],
  sets: readonly WrittenRespellingsCandidateSet[], i: number, boundaries: readonly number[],
): Candidate | undefined {
  const [source, next, landing] = frames.slice(i, i + 3);
  if (!next || !connected(source, next, boundaries)) return;
  const prior = priorDominantReading(literal, frames, sets, i, boundaries);
  if (!prior) return;
  const { reading, localKey } = prior;
  const semantics = reading.semantics;
  if (!semantics) return;
  if (returnsToPriorKey(source, next, localKey)) return { ...reading, confidence: "medium", evidence: [
    ...reading.evidence, { kind: "sequence-context", code: "written-dominant-bass-revoicing",
      details: { arrivalTick: next.fromTick } },
  ] };
  if (!landing || !connected(next, landing, boundaries)) return;
  const neapolitan = readings.find(candidate => candidate.functionalBaseId === "N6");
  const pivot = neapolitan && neapolitanPivotExit(neapolitan, source, next, landing);
  if (!pivot) return;
  return {
    ...literal,
    confidence: "medium",
    score: { ...literal.score, functionalTier: 3 },
    semantics: {
      ...semantics,
      interpretations: [{ ...primaryHarmonyInterpretation(semantics), confidence: "ambiguous" }],
    },
    evidence: [...literal.evidence, ...reading.evidence.filter(item => item.code === "local-key-cadence"), pivot],
  };
}

/** Keep a heard diminished-seventh-to-seventh exit as evidence. The two
 * written chords have distinct roots, so this does not assert an old target
 * or treat the surface as the next key's leading-tone seventh. */
function diminishedSeventhPivot(
  literal: Candidate, frames: readonly ChordInferenceObservation[], i: number, boundaries: readonly number[],
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
  literal: Candidate, frames: readonly ChordInferenceObservation[], i: number, boundaries: readonly number[],
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
  frames: readonly ChordInferenceObservation[], sets: readonly WrittenRespellingsCandidateSet[],
  options: ChordInferenceOptions, boundaries: readonly number[], manualBoundaries: readonly number[],
) {
  if (options.minConfidence === "high") return sets;
  return sets.map((existing, i) => {
    // The local-key pass can already supply an exact D reading. Still
    // retain the independent written bass-revoicing witness on that reading.
    const source = frames[i];
    if (source.localKey && source.attackVoiceIds.length === 1 && source.attackVoiceIds[0] === "bass") {
      const exactDominant = existing.find(c => c.functionalBaseId === "D" && fullFit(c) && c.fit.spellingConsistent);
      const prior = exactDominant && priorDominantReading(exactDominant, frames, sets, i, boundaries);
      const following = frames[i + 1];
      if (prior && following && connected(source, following, boundaries) &&
          returnsToPriorKey(source, following, prior.localKey)) {
        return existing.map(c => c !== exactDominant ? c : { ...c, evidence: [...c.evidence, {
          kind: "sequence-context" as const, code: "written-dominant-bass-revoicing", details: { arrivalTick: following.fromTick },
        }] });
      }
    }
    const mismatches = existing.filter(candidate => candidate.semantics && fullFit(candidate) &&
      !candidate.fit.spellingConsistent);
    if (!mismatches.length) return existing;
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
    const supported = readings.flatMap(reading => {
      const resolution = supportedDoubleDominant(reading, frames, sets, i, boundaries, manualBoundaries);
      return resolution ? [{ ...reading, evidence: [...reading.evidence, resolution] }] : [];
    });
    if (supported.length) return supported;

    const literal = createAbsoluteCandidate(source, identity.root, identity.structure.quality, {});
    if (!literal || !fullFit(literal) || !literal.fit.spellingConsistent) return existing;
    const leadingSeventh = target && connected(source, target, boundaries)
      ? leadingSeventhIntoLocalDominant(literal, source, target, sets[i + 1])
      : undefined;
    const contextual = leadingSeventh ?? dominantRevoicing(literal, readings, frames, sets, i, boundaries);
    if (contextual) return [{ ...contextual, evidence: [...contextual.evidence, proof] }];
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

type SpelledSeventhOverItalianCandidateSet = readonly ChordInferenceCandidate[];

function spelledSeventhOverItalian(
  candidate: NonNullable<ReturnType<typeof createAbsoluteCandidate>>,
  source: ChordInferenceObservation,
  arrival: ChordInferenceObservation,
  proof: NonNullable<ReturnType<typeof readResolvedRootSeventhWithoutFifth>>,
) {
  return {
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
  };
}

/** A written minor seventh and independently resolved voices can replace an
 * Italian reading that requires respelling. The target is an arrival, not a key change. */
export function withSpelledSeventhsOverItalian(
  observations: readonly ChordInferenceObservation[],
  sets: readonly SpelledSeventhOverItalianCandidateSet[],
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
        !continuesInKey(before, source) || !continuesInKey(source, arrival)) return existing;
    const fifth = chordToneSpellings(source.bass.pitch, "dominant7")[2];
    if (!observationNotes(before).some(({ voiceId, note }) => voiceId !== "bass" && !note.nonChordToneRole &&
        pitchClassEquals(note.pitch, fifth) && note.startTick + note.durationTicks === source.fromTick)) return existing;

    const later = observations[i + 2];
    const delayed = later && continuesInKey(arrival, later) && arrival.toTick - arrival.fromTick <= ppq &&
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
    return [spelledSeventhOverItalian(candidate, source, arrival, proof)];
  });
}

const raisedDominant: FunctionalChordTemplate = {
  baseId: "D",
  definition: functionalDefinition("D"),
  form: "seventh",
  localKeyPolicy: "current-key",
  expectedInversion: 0,
  alterations: [{ degree: 5, alter: 1, tendency: "up" }],
};
const rootTonic: FunctionalChordTemplate = {
  baseId: "T",
  definition: functionalDefinition("T"),
  form: "triad",
  localKeyPolicy: "current-key",
  expectedInversion: 0,
};

function withResolutionEvidence(set: readonly ChordInferenceCandidate[], candidate: ChordInferenceCandidate) {
  return [...set.filter(existing => existing.id !== candidate.id), {
    ...candidate,
    evidence: [...candidate.evidence, { kind: "sequence-context" as const, code: "raised-fifth-to-doubled-third" }],
  }].sort(candidateComparator);
}

/** Spasobin §46.4 proves the altered dominant and its incomplete tonic together. */
export function withRaisedFifthResolutions(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  manualPhraseTicks: readonly number[],
  meetsMinimumConfidence: (candidate: ChordInferenceCandidate) => boolean,
) {
  const result = sets.slice();
  for (let index = 0; index + 1 < observations.length; index++) {
    const source = observations[index], landing = observations[index + 1];
    if (source.key.mode !== "major" || !keyEquals(source.key, landing.key) ||
        manualPhraseTicks.some(tick => source.fromTick < tick && tick <= landing.fromTick) ||
        !resolvesRaisedFifthToDoubledThird(writtenFrame(source), writtenFrame(landing), source.key.tonic)) continue;

    const dominant = createFunctionalCandidate(source, raisedDominant, {});
    const tonic = createFunctionalCandidate(landing, rootTonic, { allowedOmittedChordDegrees: [5] });
    if (!dominant || !tonic || !meetsMinimumConfidence(dominant) || !meetsMinimumConfidence(tonic)) continue;
    result[index] = withResolutionEvidence(result[index], dominant);
    result[index + 1] = withResolutionEvidence(result[index + 1], tonic);
  }
  return result;
}
