import {
  chordIdentityEquals,
  chordIdentityInversion,
  primaryHarmonyInterpretation,
  chordIdentityToneSpellingForDegree,
  type HarmonySemantics,
  chordIdentityToneSpellings,
} from "../../chordModel";
import {
  keyDeclarationEquals,
  isWrittenStep,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  writtenInterval,
  type SpelledPitch,
  keyEquals,
  toMidi,
} from "../../pitch";
import { soundingBass, observationNotes } from "./observations";
import type {
  ChordInferenceCandidate as Candidate,
  ChordInferenceObservation,
  ChordInferenceCandidate,
} from "./types";
import { decoratedPassingSixFourMotion } from "../facts/prolongation";
import { fitProlongedHarmony, fitCadentialRevoicing, fitFifthOmissionRevoicing } from "./candidates";
import { isCanonicalTonicFifthOmission, hasCompleteWrittenTertianChord } from "./scoring";
import { soundsCompleteWrittenChord } from "../facts/writtenVoicing";
import { VOICE_ORDER } from "../../project/voice";
import { compareMetricStrength } from "../../rhythm/metric";

type AppliedPassingSixFourCandidateSet = readonly Candidate[];

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
function hasPassingVoices(left: ChordInferenceObservation, mid: ChordInferenceObservation, right: ChordInferenceObservation, anchor: Candidate) {
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

function weakPassingPosition(left: ChordInferenceObservation, middle: ChordInferenceObservation, right: ChordInferenceObservation) {
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
  frames: readonly ChordInferenceObservation[], sets: readonly AppliedPassingSixFourCandidateSet[], boundaries: readonly number[],
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

type SixFoursCandidateSet = readonly ChordInferenceCandidate[];
type SixFourRole = Extract<HarmonySemantics["cadenceRole"], "passing64" | "pedal64">;

function primaryTriad(candidates: SixFoursCandidateSet) {
  return candidates.find(c =>
    c.semantics && !primaryHarmonyInterpretation(c.semantics).appliedTarget &&
    (c.functionalBaseId === "T" || c.functionalBaseId === "t" ||
     c.functionalBaseId === "S" || c.functionalBaseId === "s" ||
     c.functionalBaseId === "D" || c.functionalBaseId === "d") &&
    c.identity.structure.kind === "tertian" &&
    (c.identity.structure.quality === "major" || c.identity.structure.quality === "minor") &&
    c.fit.spellingConsistent && !c.fit.omittedChordDegrees.length && !c.fit.nonChordToneNoteIds.length,
  );
}

function rootDominant(c: ChordInferenceCandidate) {
  return c.functionalBaseId === "D" && c.semantics && !primaryHarmonyInterpretation(c.semantics).appliedTarget &&
    chordIdentityInversion(c.identity) === 0 && c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length;
}

function resolvesToDominant(
  first: ChordInferenceObservation, last: ChordInferenceObservation, next: ChordInferenceObservation,
  candidates: SixFoursCandidateSet, fullClose: boolean,
) {
  if (!first.metric || !next.metric || first.metric.confidence !== "certain" || next.metric.confidence !== "certain" ||
      first.metric.level <= next.metric.level || !last.bass || !next.bass ||
      !keyEquals(first.key, next.key) || !pitchClassEquals(last.bass.pitch, next.bass.pitch)) return false;
  const dominant = candidates.find(rootDominant);
  if (!dominant) return false;
  // In a closing cadence the upper parts may redistribute or leap in the
  // resolution, and the dominant bass may move by an octave (Spasobin §9.3).
  if (fullClose) return true;
  const leading = chordIdentityToneSpellingForDegree(dominant.identity, 3);
  const fifth = chordIdentityToneSpellingForDegree(dominant.identity, 5);
  return (["soprano","alto","tenor"] as const).some(voice => {
    const a = last.activeNotes[voice]?.pitch, b = next.activeNotes[voice]?.pitch;
    if (!a || !b || !leading || !fifth) return false;
    const step = writtenInterval(a, b);
    return step.diatonicSteps === -1 && isWrittenStep(step) &&
      (pitchClassEquals(b, leading) || pitchClassEquals(b, fifth));
  });
}

function dominantContinuesToTonic(
  observations: readonly ChordInferenceObservation[], sets: readonly SixFoursCandidateSet[], start: number,
  phraseEnd?: number,
) {
  const key = observations[start].key;
  for (let i = start; i < sets.length; i++) {
    const observation = observations[i];
    const inScope = phraseEnd === undefined
      ? keyEquals(key, observation.key)
      : keyDeclarationEquals(key, observation.key) && observation.toTick <= phraseEnd;
    if (!inScope) break;
    if (sets[i].some(rootDominant)) continue;
    return i > start && sets[i].some(c => (c.functionalBaseId === "T" || c.functionalBaseId === "t") &&
      chordIdentityInversion(c.identity) !== 2 && c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length);
  }
  return false;
}

function roleBetween(
  left: ChordInferenceCandidate, middle: ChordInferenceCandidate, right: ChordInferenceCandidate,
  before: ChordInferenceObservation, during: ChordInferenceObservation, after: ChordInferenceObservation,
): SixFourRole | undefined {
  if (!before.bass || !during.bass || !after.bass || !keyEquals(before.key, during.key) || !keyEquals(during.key, after.key)) return;
  if (left.functionalBaseId !== right.functionalBaseId || left.functionalBaseId === middle.functionalBaseId) return;
  if (!during.metric || during.metric.confidence !== "certain" || during.metric.role === "downbeat") return;
  const into = writtenInterval(before.bass.pitch, during.bass.pitch);
  const out = writtenInterval(during.bass.pitch, after.bass.pitch);
  // The same primary triad returns over its original bass or over its third.
  if (into.semitones === 0 && out.semitones === 0 && into.diatonicSteps === 0 && out.diatonicSteps === 0 &&
      chordIdentityEquals(left.identity, right.identity) && chordIdentityInversion(left.identity) === 0 &&
      before.metric && before.metric.level > during.metric.level) return "pedal64";
  const inversions = [chordIdentityInversion(left.identity), chordIdentityInversion(right.identity)];
  if (inversions.includes(0) && inversions.includes(1) && isWrittenStep(into) && isWrittenStep(out) &&
      Math.sign(into.diatonicSteps) === Math.sign(out.diatonicSteps)) return "passing64";
}

function exactReading(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && candidate.fit.omittedChordDegrees.length === 0 &&
    candidate.fit.nonChordToneNoteIds.length === 0;
}

function completeWithActualBass(observation: ChordInferenceObservation) {
  const bass = observation.bass;
  return observation.completeSatb && bass && observationNotes(observation).every(
    ({ note }) => toMidi(note.pitch) >= toMidi(bass.pitch),
  );
}

function tonicSixFourPair(candidates: SixFoursCandidateSet) {
  const tonic = candidates.find(c => (c.functionalBaseId === "T" || c.functionalBaseId === "t") &&
    chordIdentityInversion(c.identity) === 2);
  const cadential = tonic && candidates.find(c => c.functionalBaseId === "K46" &&
    chordIdentityEquals(c.identity, tonic.identity));
  if (!tonic || !cadential) return;
  if (exactReading(tonic) && exactReading(cadential)) return { tonic, cadential, neighbor: false, doubleNeighbor: false };
  if ([tonic, cadential].every(c => c.fit.spellingConsistent && c.fit.nonChordToneNoteIds.length === 1 &&
      c.evidence.some(e => e.kind === "inferred-nonchord-tone" && e.code === "neighbor"))) {
    return { tonic, cadential, neighbor: true, doubleNeighbor: false };
  }
  if ([tonic, cadential].every(c => c.fit.spellingConsistent && c.fit.nonChordToneNoteIds.length === 2 &&
      c.evidence.some(e => e.kind === "sequence-context" && e.code === "written-double-neighbor"))) {
    return { tonic, cadential, neighbor: true, doubleNeighbor: true };
  }
}

function confirmContinuedCadentialSixFours(
  observations: readonly ChordInferenceObservation[], sets: readonly SixFoursCandidateSet[],
  classified: SixFoursCandidateSet[], phraseBoundaries: readonly number[], doubleBridgesOnly = false,
) {
  const pairs = sets.map(tonicSixFourPair);
  for (let start = 0; start + 1 < pairs.length; start++) {
    const opening = pairs[start], first = observations[start];
    if (!opening || opening.neighbor || !completeWithActualBass(first)) continue;
    let end = start;
    let bridgedNeighbor = false;
    let bridgedDoubleNeighbor = false;
    while (end + 1 < pairs.length) {
      const next = pairs[end + 1], after = observations[end + 1], before = observations[end];
      if (!next || !chordIdentityEquals(opening.tonic.identity, next.tonic.identity) ||
          !keyDeclarationEquals(after.key, first.key) ||
          before.toTick !== after.fromTick || !completeWithActualBass(after) ||
          Math.abs(toMidi(before.bass!.pitch) - toMidi(after.bass!.pitch)) > 12) break;
      end++;
      bridgedNeighbor ||= next.neighbor;
      bridgedDoubleNeighbor ||= next.doubleNeighbor;
    }
    const last = observations[end], arrival = observations[end + 1], arrivals = sets[end + 1];
    const phraseEnd = phraseBoundaries.reduce((endTick, tick) =>
      tick > first.fromTick ? Math.min(endTick, tick) : endTick, Number.POSITIVE_INFINITY);
    if (doubleBridgesOnly && (!bridgedDoubleNeighbor ||
        ![start, end].every(index => classified[index].some(candidate => candidate.functionalBaseId === "K46" &&
          chordIdentityEquals(candidate.identity, opening.cadential.identity))))) {
      start = end;
      continue;
    }
    if (end > start && !pairs[end]!.neighbor && arrival && completeWithActualBass(arrival) &&
        keyDeclarationEquals(first.key, arrival.key) &&
        last.toTick === arrival.fromTick && arrival.toTick <= phraseEnd &&
        Math.abs(toMidi(last.bass!.pitch) - toMidi(arrival.bass!.pitch)) <= 12) {
      const dominant = arrivals.find(c => exactReading(c) && rootDominant(c));
      const fullClose = dominant && dominantContinuesToTonic(observations, sets, end + 1, phraseEnd);
      const confirmed = dominant && (fullClose || !bridgedNeighbor &&
        realizesWrittenSixFourResolution(opening.tonic, dominant, last, arrival)) &&
        resolvesToDominant(first, last, arrival, [dominant], !!fullClose);
      for (let index = start; confirmed && index <= end; index++) {
        const pair = pairs[index]!;
        if (pair.doubleNeighbor && !classified[index].length) {
          classified[index] = [{ ...pair.cadential, evidence: [...pair.cadential.evidence,
            { kind: "sequence-context", code: "cadential64-resolution" }] }];
          continue;
        }
        if (!classified[index].includes(pair.tonic) || !classified[index].includes(pair.cadential)) continue;
        classified[index] = classified[index].filter(c => c !== pair.tonic).map(c => c === pair.cadential
          ? { ...c, evidence: [...c.evidence, { kind: "sequence-context", code: "cadential64-resolution" }] }
          : c);
      }
    }
    start = end;
  }
}

function realizesWrittenSixFourResolution(
  tonic: ChordInferenceCandidate, dominant: ChordInferenceCandidate,
  before: ChordInferenceObservation, after: ChordInferenceObservation,
) {
  return ([[1, 3], [3, 5]] as const).every(([fromDegree, toDegree]) => {
    const from = chordIdentityToneSpellingForDegree(tonic.identity, fromDegree);
    const to = chordIdentityToneSpellingForDegree(dominant.identity, toDegree);
    return from && to && observationNotes(before).some(({ voiceId, note }) => {
      const next = after.activeNotes[voiceId];
      if (voiceId === "bass" || !next || !pitchClassEquals(note.pitch, from) || !pitchClassEquals(next.pitch, to)) return false;
      const interval = writtenInterval(note.pitch, next.pitch);
      return interval.diatonicSteps === -1 && isWrittenStep(interval);
    });
  });
}

// A tripled-root tonic can establish the pedal before a complete IV64–I return.
function omittedPedalAnchor(
  observations: readonly ChordInferenceObservation[], sets: readonly SixFoursCandidateSet[],
  start: number, end: number, middle: ChordInferenceCandidate, right: ChordInferenceCandidate | undefined,
  boundaries: readonly number[],
) {
  if (!right || !(right.functionalBaseId === "T" || right.functionalBaseId === "t") ||
      !(middle.functionalBaseId === "S" || middle.functionalBaseId === "s") ||
      chordIdentityInversion(right.identity) !== 0 || start === 0) return;
  const before = observations[start - 1], after = observations[end + 1];
  if (boundaries.some(tick => before.fromTick < tick && tick <= after.fromTick)) return;
  const pedal = before.bass;
  if (!pedal || !observations.slice(start - 1, end + 2).every(item =>
      completeWithActualBass(item) && item.bass?.id === pedal.id &&
      keyDeclarationEquals(item.key, before.key))) return;
  // Spasobin §13.6: from the incomplete tonic one voice descends a third
  // into IV64. Another upper tonic supplies its doubled pedal.
  const middleThird = chordIdentityToneSpellingForDegree(middle.identity, 3);
  const during = observations[start];
  const descendsThird = middleThird && observationNotes(before).some(({ voiceId, note }) => {
    const next = during.activeNotes[voiceId];
    return next && pitchClassEquals(note.pitch, right.identity.root) &&
      pitchClassEquals(next.pitch, middleThird) && writtenInterval(note.pitch, next.pitch).diatonicSteps === -2;
  });
  if (!descendsThird || !observations.slice(start, end + 1).every(item =>
      observationNotes(item).filter(({ note }) => pitchClassEquals(note.pitch, pedal.pitch)).length === 2 &&
      item.metric?.confidence === "certain" && before.metric && item.metric.level < before.metric.level)) return;
  return sets[start - 1].find(candidate => candidate.functionalBaseId === right.functionalBaseId &&
    chordIdentityEquals(candidate.identity, right.identity) && candidate.fit.spellingConsistent &&
    isCanonicalTonicFifthOmission(before, candidate.identity));
}

function classifyCadentialSixFourRun(
  observations: readonly ChordInferenceObservation[],
  sets: readonly SixFoursCandidateSet[],
  triads: readonly (ChordInferenceCandidate | undefined)[],
  classified: SixFoursCandidateSet[],
  start: number,
  end: number,
  acceptMedium: boolean,
) {
  const cadential = sets[start].find(c => c.functionalBaseId === "K46");
  if (!cadential || end + 1 >= sets.length) {
    return end;
  }
  const revoiced = acceptMedium && !sets[end + 1].length && end + 2 < sets.length &&
    keyEquals(observations[start].key, observations[end + 1].key) && observations[end + 1].metric?.confidence === "certain" &&
    observations[end + 1].metric!.level < (observations[start].metric?.level ?? 0)
    ? fitCadentialRevoicing(cadential, observations[end + 1]) : undefined;
  const target = end + (revoiced ? 2 : 1);
  const prepared = revoiced && sets[start - 1]?.some(c => ["S", "s", "SII", "N6", "It+6", "Fr+6", "Ger+6"].includes(c.functionalBaseId ?? "") &&
    c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length) && keyEquals(observations[start - 1].key, observations[start].key);
  if (!resolvesToDominant(observations[start], observations[target - 1], observations[target], sets[target],
      !!prepared || dominantContinuesToTonic(observations, sets, target))) {
    return end;
  }
  for (let i = start; i <= end; i++) {
    classified[i] = sets[i].filter(c => c !== triads[i]).map(c => c.functionalBaseId === "K46"
      ? { ...c, evidence: [...c.evidence, { kind: "sequence-context", code: "cadential64-resolution" }] }
      : c);
  }
  if (revoiced) {
    classified[end + 1] = [revoiced];
    return end + 1;
  }
  return end;
}

/** Recognize a complete weak six-four between two presentations of the same harmony. */
export function classifySixFours(
  observations: readonly ChordInferenceObservation[], sets: readonly SixFoursCandidateSet[], acceptMedium = true,
  phraseBoundaries: readonly number[] = [],
  doubleNeighbors: readonly SixFoursCandidateSet[] = [],
  passingOrnamentPpq?: number,
) {
  const triads = sets.map(primaryTriad);
  const classified = sets.slice();
  for (let start = 0; start + 1 < sets.length; start++) {
    const middle = triads[start];
    if (!middle || chordIdentityInversion(middle.identity) !== 2) continue;
    let end = start;
    while (end + 1 < sets.length && triads[end + 1] && keyEquals(observations[end].key, observations[end + 1].key) &&
           chordIdentityEquals(middle.identity, triads[end + 1]!.identity) &&
           observations[end].bass?.pitch.octave === observations[end + 1].bass?.pitch.octave) end++;
    const right = triads[end + 1];
    const left = triads[start - 1] ?? omittedPedalAnchor(observations, sets, start, end, middle, right, phraseBoundaries);
    const before = observations[start - 1], after = observations[end + 1];
    const role = left && right && before && after && before.key.id === after.key.id &&
      !phraseBoundaries.some(tick => before.fromTick < tick && tick <= after.fromTick) &&
      roleBetween(left, middle, right, before, observations[start], after);
    const anchor = observations[start - 2], anchorTriad = triads[start - 2];
    const ornament = !role && passingOrnamentPpq && start === end && anchor && anchorTriad && before &&
      right && after && !sets[start - 1].length &&
      !phraseBoundaries.some(tick => anchor.fromTick < tick && tick <= after.fromTick)
      ? decoratedPassingSixFour(anchorTriad, middle, right, anchor, before, observations[start], after, passingOrnamentPpq)
      : undefined;
    const nonCadentialRole = role || (ornament && "passing64");
    if (nonCadentialRole) {
      if (ornament) classified[start - 1] = [ornament];
      for (let i = start; i <= end; i++) {
        classified[i] = sets[i].filter(c => c.functionalBaseId !== "K46").map(c =>
          c === triads[i] && c.semantics
            ? { ...c, semantics: { ...c.semantics, cadenceRole: nonCadentialRole },
                evidence: [...c.evidence, { kind: "sequence-context", code: nonCadentialRole }] }
            : c);
      }
    } else {
      end = classifyCadentialSixFourRun(observations, sets, triads, classified, start, end, acceptMedium);
    }
    start = end;
  }
  confirmContinuedCadentialSixFours(observations, sets, classified, phraseBoundaries);
  if (doubleNeighbors.some(candidates => candidates.some(c => c.functionalBaseId === "K46"))) {
    const bridges = sets.map((set, index) => doubleNeighbors[index]?.some(c => c.functionalBaseId === "K46")
      ? doubleNeighbors[index] : set);
    confirmContinuedCadentialSixFours(observations, bridges, classified, phraseBoundaries, true);
  }
  const result = classified.map((set, index) =>
    set.length || !doubleNeighbors[index] ? set : doubleNeighbors[index].filter(c => c.functionalBaseId === "D"));
  return withAppliedPassingSixFours(observations, result, phraseBoundaries);
}

type Observation = ChordInferenceObservation;
type NoncadentialTonicSixFoursCandidateSet = readonly ChordInferenceCandidate[];
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
  observations: readonly Observation[], candidateSets: readonly NoncadentialTonicSixFoursCandidateSet[],
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

function completeRevoicingSide(
  middle: ChordInferenceObservation,
  side: ChordInferenceObservation | undefined,
  boundaries: readonly number[],
) {
  if (!side?.completeSatb || !side.bass || side.soundingPitchClasses.length !== middle.soundingPitchClasses.length + 1 ||
      !keyDeclarationEquals(side.key, middle.key) ||
      Boolean(side.localKey) !== Boolean(middle.localKey)) return undefined;
  const [before, after] = side.fromTick < middle.fromTick ? [side, middle] : [middle, side];
  const seam = after.fromTick;
  if (before.toTick !== seam ||
      boundaries.some(tick => before.fromTick < tick && tick < after.toTick)) return undefined;

  const moving = VOICE_ORDER.filter(voice => side.activeNotes[voice]?.id !== middle.activeNotes[voice]?.id);
  if (moving.length !== 1 || moving[0] === "bass") return undefined;
  const voice = moving[0];
  const earlier = before.activeNotes[voice];
  const later = after.activeNotes[voice];
  if (!earlier || !later || earlier.startTick + earlier.durationTicks !== seam || later.startTick !== seam)
    return undefined;
  const steps = Math.abs(writtenInterval(earlier.pitch, later.pitch).diatonicSteps);
  if (steps < 2 || steps > 5) return undefined;

  const notes = observationNotes(side);
  const bass = toMidi(side.bass.pitch);
  if (notes.some(({ note, voiceId }) => {
    const sustained = middle.activeNotes[voiceId];
    return note.nonChordToneRole || toMidi(note.pitch) < bass ||
      (voiceId !== voice && (!sustained || !spelledPitchEquals(note.pitch, sustained.pitch)));
  }) || !hasCompleteWrittenTertianChord(side)) return undefined;
  return side === before ? { notes, fifth: earlier, replacement: later } :
    { notes, fifth: later, replacement: earlier };
}

/** Use the written fifth in one adjacent voicing. Keep the omission in the fit. */
export function withSingleVoiceRevoicings(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  ppq: number,
  phraseBoundaryTicks: readonly number[],
  seventhBoundaryTicks: readonly number[],
) {
  return sets.map((existing, index) => {
    const middle = observations[index];
    const seventh = middle.soundingPitchClasses.length === 3;
    if (existing.length || !middle.completeSatb || !middle.bass ||
        (!seventh && middle.soundingPitchClasses.length !== 2) ||
        (seventh && hasCompleteWrittenTertianChord(middle)) || middle.toTick - middle.fromTick > ppq)
      return existing;
    const bass = toMidi(middle.bass.pitch);
    if (observationNotes(middle).some(({ note }) => note.nonChordToneRole || toMidi(note.pitch) < bass))
      return existing;

    const sides = [index - 1, index + 1].flatMap(neighbor => {
      const evidence = completeRevoicingSide(middle, observations[neighbor],
        seventh ? seventhBoundaryTicks : phraseBoundaryTicks);
      return evidence ? [{ ...evidence, neighbor, candidates: sets[neighbor] }] : [];
    });
    const recovered = new Map<string, ChordInferenceCandidate>();
    for (const { candidates, fifth, replacement, neighbor } of sides) {
      // A partial seventh can continue an established chord on a weaker attack.
      // A following full statement may contradict that reading, but cannot establish it retroactively.
      if (seventh && (neighbor >= index ||
          compareMetricStrength(observations[neighbor].metric, middle.metric) !== "stronger")) continue;
      for (const anchor of candidates) {
        const { root, structure } = anchor.identity;
        if (!anchor.semantics || anchor.confidence !== "high" ||
            structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length)
          continue;
        if (seventh) {
          const kind = primaryHarmonyInterpretation(anchor.semantics).designation?.kind;
          if ((kind !== "primary" && kind !== "side-degree") || anchor.semantics.alternatives?.length ||
              (structure.quality !== "dominant7" && structure.quality !== "minor7" && structure.quality !== "major7") ||
              anchor.fit.omittedChordDegrees.length || anchor.fit.nonChordToneNoteIds.length ||
              !anchor.fit.spellingConsistent || !pitchClassEquals(anchor.identity.bass, middle.bass.pitch) ||
              !pitchClassEquals(root, replacement.pitch)) continue;
        } else if ((structure.quality !== "major" && structure.quality !== "minor") ||
            !pitchClassEquals(root, anchor.identity.bass) || !pitchClassEquals(root, middle.bass.pitch)) continue;
        const tones = chordIdentityToneSpellings(anchor.identity);
        if (!pitchClassEquals(fifth.pitch, tones[2]) ||
            !sides.every(({ notes }) => notes.every(({ note }) =>
              tones.some(tone => pitchClassEquals(tone, note.pitch))))) continue;
        const candidate = fitFifthOmissionRevoicing(anchor, middle, [fifth.id, replacement.id],
          seventh ? "seventh" : "triad");
        if (candidate) recovered.set(JSON.stringify(candidate.semantics), candidate);
      }
    }
    return recovered.size ? [...recovered.values()] : existing;
  });
}
