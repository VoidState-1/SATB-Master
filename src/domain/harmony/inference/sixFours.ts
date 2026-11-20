import { chordIdentityEquals, chordIdentityInversion, chordIdentityToneSpellingForDegree, primaryHarmonyInterpretation, type HarmonySemantics } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, toMidi, writtenInterval } from "../../pitch";
import { withAppliedPassingSixFours } from "./appliedPassingSixFour";
import { fitCadentialRevoicing } from "./candidates";
import { decoratedPassingSixFour } from "./decoratedPassingSixFour";
import { isCanonicalTonicFifthOmission } from "./fit";
import { observationNotes } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];
type SixFourRole = Extract<HarmonySemantics["cadenceRole"], "passing64" | "pedal64">;

function primaryTriad(candidates: CandidateSet) {
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

function sameKey(a: ChordInferenceObservation, b: ChordInferenceObservation) {
  return a.key.mode === b.key.mode && pitchClassEquals(a.key.tonic, b.key.tonic);
}

function rootDominant(c: ChordInferenceCandidate) {
  return c.functionalBaseId === "D" && c.semantics && !primaryHarmonyInterpretation(c.semantics).appliedTarget &&
    chordIdentityInversion(c.identity) === 0 && c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length;
}

function resolvesToDominant(
  first: ChordInferenceObservation, last: ChordInferenceObservation, next: ChordInferenceObservation,
  candidates: CandidateSet, fullClose: boolean,
) {
  if (!first.metric || !next.metric || first.metric.confidence !== "certain" || next.metric.confidence !== "certain" ||
      first.metric.level <= next.metric.level || !last.bass || !next.bass ||
      !sameKey(first, next) || !pitchClassEquals(last.bass.pitch, next.bass.pitch)) return false;
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
  observations: readonly ChordInferenceObservation[], sets: readonly CandidateSet[], start: number,
  phraseEnd?: number,
) {
  const key = observations[start];
  for (let i = start; i < sets.length && sameKey(key, observations[i]) &&
      (phraseEnd === undefined || observations[i].key.id === key.key.id && observations[i].toTick <= phraseEnd); i++) {
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
  if (!before.bass || !during.bass || !after.bass || !sameKey(before, during) || !sameKey(during, after)) return;
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

function tonicSixFourPair(candidates: CandidateSet) {
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
  observations: readonly ChordInferenceObservation[], sets: readonly CandidateSet[],
  classified: CandidateSet[], phraseBoundaries: readonly number[], doubleBridgesOnly = false,
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
          after.key.id !== first.key.id || !sameKey(first, after) ||
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
        first.key.id === arrival.key.id && sameKey(first, arrival) &&
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
  observations: readonly ChordInferenceObservation[], sets: readonly CandidateSet[],
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
      item.key.id === before.key.id && sameKey(item, before))) return;
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

/** Recognize a complete weak six-four between two presentations of the same harmony. */
export function classifySixFours(
  observations: readonly ChordInferenceObservation[], sets: readonly CandidateSet[], acceptMedium = true,
  phraseBoundaries: readonly number[] = [],
  doubleNeighbors: readonly CandidateSet[] = [],
  passingOrnamentPpq?: number,
) {
  const triads = sets.map(primaryTriad);
  const classified = sets.slice();
  for (let start = 0; start + 1 < sets.length; start++) {
    const middle = triads[start];
    if (!middle || chordIdentityInversion(middle.identity) !== 2) continue;
    let end = start;
    while (end + 1 < sets.length && triads[end + 1] && sameKey(observations[end], observations[end + 1]) &&
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
      const cadential = sets[start].find(c => c.functionalBaseId === "K46");
      if (!cadential || end + 1 >= sets.length) {
        start = end;
        continue;
      }
      const revoiced = acceptMedium && !sets[end + 1].length && end + 2 < sets.length &&
        sameKey(observations[start], observations[end + 1]) && observations[end + 1].metric?.confidence === "certain" &&
        observations[end + 1].metric!.level < (observations[start].metric?.level ?? 0)
        ? fitCadentialRevoicing(cadential, observations[end + 1]) : undefined;
      const target = end + (revoiced ? 2 : 1);
      const prepared = revoiced && sets[start - 1]?.some(c => ["S", "s", "SII", "N6", "It+6", "Fr+6", "Ger+6"].includes(c.functionalBaseId ?? "") &&
        c.fit.spellingConsistent && !c.fit.nonChordToneNoteIds.length) && sameKey(observations[start - 1], observations[start]);
      if (!resolvesToDominant(observations[start], observations[target - 1], observations[target], sets[target],
          !!prepared || dominantContinuesToTonic(observations, sets, target))) {
        start = end;
        continue;
      }
      for (let i = start; i <= end; i++) {
        classified[i] = sets[i].filter(c => c !== triads[i]).map(c => c.functionalBaseId === "K46"
          ? { ...c, evidence: [...c.evidence, { kind: "sequence-context", code: "cadential64-resolution" }] }
          : c);
      }
      if (revoiced) {
        end++;
        classified[end] = [revoiced];
      }
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

