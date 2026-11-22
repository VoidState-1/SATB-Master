import {
  chordIdentityEquals,
  chordIdentityToneSpellingForDegree,
  primaryHarmonyInterpretation,
  chordIdentityInversion,
  chordIdentityToneSpellings,
  chordVoicingPolicy,
} from "../../chordModel";
import {
  keyDeclarationEquals,
  isWrittenStep,
  spelledPitchEquals,
  writtenInterval,
  pitchClassEquals,
  scaleDegreePitchClass,
  stepIndex,
  toMidi,
  pitchClassValue,
  type SpelledPitchClass,
} from "../../pitch";
import type { NonChordToneRole } from "../../project";
import { VOICE_ORDER } from "../../project/voice";
import { compareMetricStrength } from "../../rhythm/metric";
import type { AnalysisNote } from "../analysis";
import {
  fitProlongedHarmony,
  candidateComparator,
  fitAnticipation,
  fitContextualOrnament,
  fitPreparedSuspension,
  fitSimultaneousNeighbors,
} from "./candidates";
import { hasCompleteWrittenTertianChord } from "./scoring";
import type { ChordInferenceCandidate, ChordInferenceObservation, ChordInferenceOptions } from "./types";
import { observationNotes, writtenFrame } from "./observations";
import { verifyPreparedSuspensionVoicing, type PreparationSupport } from "../facts/tendencyResolution";
import {
  supportsPairedNeighborMotion,
  writtenNeighborsOverHeldBass,
  upperPassingMotion,
  writtenLowerNeighborPair,
} from "../facts/prolongation";
import { soundsCompleteWrittenChord } from "../facts/writtenVoicing";

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

function exactFit(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && candidate.fit.bassMatchesInversion &&
    !candidate.fit.omittedChordDegrees.length && !candidate.fit.nonChordToneNoteIds.length;
}

function anchorFit(candidate: ChordInferenceCandidate) {
  return candidate.semantics && candidate.identity.structure.kind === "tertian" &&
    !candidate.identity.structure.extensions.length && exactFit(candidate);
}

/** Spasobin §42.1, 3–5: one voice steps early to the next chord; two
 * may move in parallel thirds/sixths or in contrary motion. */
function anticipatedNotes(
  before: ChordInferenceObservation,
  middle: ChordInferenceObservation,
  after: ChordInferenceObservation,
) {
  const moving = [];
  for (const { voiceId, note } of observationNotes(middle)) {
    const previous = before.activeNotes[voiceId]!;
    const next = after.activeNotes[voiceId]!;
    const entry = writtenInterval(previous.pitch, note.pitch);
    if (!entry.diatonicSteps && !entry.semitones) continue;
    if (!isWrittenStep(entry) || Math.sign(entry.semitones) !== entry.diatonicSteps ||
        note.startTick !== middle.fromTick || next.startTick !== after.fromTick ||
        !spelledPitchEquals(next.pitch, note.pitch) ||
        (note.nonChordToneRole && note.nonChordToneRole !== "anticipation")) return;
    moving.push({ note, previous, next, entry });
  }
  if (!moving.length || moving.length > 2) return;
  if (moving.length === 2) {
    const [upper, lower] = moving;
    const intervalClass = Math.abs(writtenInterval(lower.note.pitch, upper.note.pitch).diatonicSteps) % 7;
    if (upper.entry.diatonicSteps === lower.entry.diatonicSteps && intervalClass !== 2 && intervalClass !== 5) return;
  }
  return moving;
}

function hasAddedSixthReading(
  anchor: ChordInferenceCandidate,
  middle: ChordInferenceObservation,
  motion: { previous: AnalysisNote; note: AnalysisNote },
) {
  const { identity } = anchor;
  if (!middle.bass || !pitchClassEquals(middle.bass.pitch, identity.root)) return false;
  const seventh = chordIdentityToneSpellingForDegree(identity, 7);
  if (!seventh || !pitchClassEquals(motion.previous.pitch, seventh)) return false;
  const sixth = scaleDegreePitchClass({ tonic: identity.root, mode: "major" }, 6);
  // A fully voiced triad with an added sixth is a viable reading of this
  // slice, even when there is no template for it in the current key.
  return middle.soundingPitchClasses.length === 4 && pitchClassEquals(motion.note.pitch, sixth);
}

/** Carry the previous chord through a brief anticipation when both written
 * anchors support it and the intervening slice has no exact reading. */
export function withAnticipations(
  observations: readonly ChordInferenceObservation[],
  sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions,
  ppq: number,
  phraseBoundaryTicks: readonly number[],
) {
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) return sets;
  return sets.map((existing, index) => {
    const before = observations[index - 1];
    const middle = observations[index];
    const after = observations[index + 1];
    if (!before?.completeSatb || !middle.completeSatb || !after?.completeSatb ||
        existing.some(exactFit) || !keyDeclarationEquals(before.key, middle.key) || !keyDeclarationEquals(middle.key, after.key) ||
        phraseBoundaryTicks.some(tick => before.fromTick < tick && tick <= after.fromTick) ||
        compareMetricStrength(middle.metric, before.metric) !== "weaker" ||
        compareMetricStrength(middle.metric, after.metric) !== "weaker") return existing;

    const duration = middle.toTick - middle.fromTick;
    if (duration > ppq / 2 || duration > before.toTick - before.fromTick ||
        duration > after.toTick - after.fromTick) return existing;
    const moving = anticipatedNotes(before, middle, after);
    if (!moving || !sets[index + 1].some(candidate => anchorFit(candidate) &&
      moving.every(({ next }) => candidate.fit.chordToneNoteIds.includes(next.id)))) return existing;

    const noteIds = moving.map(({ note }) => note.id);
    const contextual = sets[index - 1].flatMap(anchor => {
      if (!anchorFit(anchor) || (moving.length === 1 && hasAddedSixthReading(anchor, middle, moving[0]))) return [];
      const candidate = fitAnticipation(anchor, middle, noteIds);
      return candidate ? [candidate] : [];
    });
    // A complete written chord can compete even when the key's functional
    // templates offer no candidate. In that case leave the existing decision
    // in place instead of automatically turning its notes into anticipations.
    if (!contextual.length || hasCompleteWrittenTertianChord(middle)) return existing;
    return [...existing, ...contextual].sort(candidateComparator);
  });
}

type PreparedSuspensionsCandidateSet = readonly ChordInferenceCandidate[];

function isExact(candidate: ChordInferenceCandidate) {
  return candidate.fit.bassMatchesInversion && candidate.fit.spellingConsistent &&
    !candidate.fit.omittedChordDegrees.length && !candidate.fit.nonChordToneNoteIds.length;
}

function dominantPreparation(sets: PreparedSuspensionsCandidateSet, observation: ChordInferenceObservation): PreparationSupport {
  const exact = sets.filter(isExact);
  if (!exact.length) return "surface";
  const dominant = scaleDegreePitchClass(observation.key, 5);
  return exact.some(candidate =>
    candidate.functionalBaseId === "D" && candidate.semantics &&
    !primaryHarmonyInterpretation(candidate.semantics).appliedTarget &&
    pitchClassEquals(candidate.identity.root, dominant),
  ) ? "confirmed" : "blocked";
}

/** Spasobin §36.2–4, §37.1–2. Restore a root-position tonic obscured by a
 * prepared 4–3, or extend the actual resolution triad across a single 9–8. */
export function withPreparedSuspensions(
  observations: readonly ChordInferenceObservation[],
  sets: readonly PreparedSuspensionsCandidateSet[],
  options: ChordInferenceOptions,
  ppq: number,
  phraseBoundaryTicks: readonly number[],
) {
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) return sets;
  const slices = observations.map(({ fromTick, toTick, activeNotes }) => ({ fromTick, toTick, notes: activeNotes }));
  const metrics = new Map(observations.map(({ fromTick, metric }) => [fromTick, metric]));
  return sets.map((existing, index) => {
    const middle = observations[index];
    const bass = middle.bass;
    if (existing.length || !bass) return existing;

    const voicing = verifyPreparedSuspensionVoicing({
      slices, onsetIndex: index, key: middle.key, beatTicks: ppq,
      metricAt: tick => metrics.get(tick),
      preparationAt: (previousIndex, singleNinth) => {
        const previous = observations[previousIndex];
        if (!keyDeclarationEquals(previous.key, middle.key) ||
            phraseBoundaryTicks.some(tick => previous.fromTick < tick && tick <= middle.fromTick)) return "blocked";
        if (singleNinth) return sets[previousIndex].some(isExact) &&
          !Object.values(previous.activeNotes).some(note => note?.nonChordToneRole) ? "confirmed" : "blocked";
        return dominantPreparation(sets[previousIndex], previous);
      },
    });
    if (!voicing ||
        phraseBoundaryTicks.some(tick => voicing.fromTick < tick && tick <= voicing.toTick) ||
        observations.slice(index + 1, voicing.resolutionIndex + 1).some(part =>
          !keyDeclarationEquals(part.key, middle.key))) return existing;

    const resolution = observations[voicing.resolutionIndex];
    const markedVoice = [middle, resolution].some(part => voicing.singleNinth
      ? Object.values(part.activeNotes).some(note => note?.nonChordToneRole)
      : voicing.motions.some(({ voiceId }) => part.activeNotes[voiceId]?.nonChordToneRole));
    if (markedVoice) return existing;
    const exactRootPosition = sets[voicing.resolutionIndex].filter(candidate =>
      isExact(candidate) && pitchClassEquals(candidate.identity.root, bass.pitch) &&
      pitchClassEquals(candidate.identity.bass, bass.pitch),
    );
    if (!voicing.singleNinth) {
      const tonic = exactRootPosition.find(candidate => candidate.functionalBaseId === "T" || candidate.functionalBaseId === "t");
      const fitted = tonic && fitPreparedSuspension(tonic, middle, voicing.motions);
      return fitted ? [fitted] : existing;
    }
    const anchors = exactRootPosition.filter(({ identity: { structure } }) =>
      structure.kind === "tertian" && (structure.quality === "major" || structure.quality === "minor") &&
      !structure.extensions.length && !structure.alterations.length,
    );
    return anchors.flatMap(anchor => {
      const candidate = fitPreparedSuspension(anchor, middle, voicing.motions);
      return candidate ? [candidate] : [];
    });
  });
}

type SimultaneousNeighborsCandidateSet = readonly ChordInferenceCandidate[];
type Observation = ChordInferenceObservation;

function literal(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && candidate.fit.omittedChordDegrees.length === 0 &&
    candidate.fit.nonChordToneNoteIds.length === 0;
}

function supportedAnchor(candidate: ChordInferenceCandidate) {
  const { identity, functionalBaseId, semantics } = candidate;
  if (!semantics || primaryHarmonyInterpretation(semantics).appliedTarget || identity.structure.kind !== "tertian" || identity.structure.extensions.length ||
      identity.structure.alterations.length || !literal(candidate)) return false;
  if (functionalBaseId === "D") return chordIdentityInversion(identity) === 0 &&
    (identity.structure.quality === "major" || identity.structure.quality === "dominant7");
  return (functionalBaseId === "K46" || functionalBaseId === "T" || functionalBaseId === "t") &&
    chordIdentityInversion(identity) === 2;
}

function orderedVoicing(observation: Observation) {
  const pitches = observationNotes(observation).map(({ note }) => toMidi(note.pitch));
  return pitches.every((pitch, i) => i === 0 || pitches[i - 1] > pitch);
}

function supportsPairedMotion(left: Observation, middle: Observation, ids: readonly string[]) {
  const [higher, lower] = observationNotes(middle).filter(({ note }) => ids.includes(note.id));
  if (!higher || !lower) return false;
  const previousHigher = left.activeNotes[higher.voiceId], previousLower = left.activeNotes[lower.voiceId];
  if (!previousHigher || !previousLower) return false;
  return supportsPairedNeighborMotion(previousLower.pitch, previousHigher.pitch, lower.note.pitch, higher.note.pitch);
}

/** Spasobin §§40.1, 40.4–5: two upper neighbors may decorate one held
 * harmony. A six-four still needs independent cadential confirmation. */
export function simultaneousNeighborCandidates(
  observations: readonly Observation[],
  sets: readonly SimultaneousNeighborsCandidateSet[],
  options: ChordInferenceOptions,
  ppq: number,
  boundaries: readonly number[],
): readonly SimultaneousNeighborsCandidateSet[] {
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) return [];
  return sets.map((existing, index) => {
    if (existing.length || index === 0 || index + 1 === observations.length) return [];
    const [left, middle, right] = observations.slice(index - 1, index + 2);
    if (middle.metric?.confidence !== "certain" || middle.metric.level >= 2 ||
        middle.toTick - middle.fromTick > ppq ||
        left.toTick !== middle.fromTick || middle.toTick !== right.fromTick ||
        boundaries.some(tick => left.fromTick < tick && tick <= right.fromTick) ||
        ![left, middle, right].every(item => item.completeSatb && orderedVoicing(item) &&
          keyDeclarationEquals(item.key, left.key))) return [];

    return sets[index - 1].flatMap(anchor => {
      if (!supportedAnchor(anchor) || !sets[index + 1].some(next => literal(next) &&
          next.functionalBaseId === anchor.functionalBaseId &&
          JSON.stringify(next.semantics) === JSON.stringify(anchor.semantics) &&
          chordIdentityEquals(next.identity, anchor.identity))) return [];
      const notes = writtenNeighborsOverHeldBass(anchor.identity, writtenFrame(left), writtenFrame(middle), writtenFrame(right));
      if (notes?.length !== 2 || !supportsPairedMotion(left, middle, notes)) return [];
      const candidate = fitSimultaneousNeighbors(anchor, middle, notes);
      return candidate ? [candidate] : [];
    });
  });
}

function exactUpperPassingFit(candidate: ChordInferenceCandidate) {
  return candidate.fit.bassMatchesInversion && candidate.fit.spellingConsistent &&
    !candidate.fit.nonChordToneNoteIds.length && !candidate.fit.omittedChordDegrees.length;
}

function soundsComplete(candidate: ChordInferenceCandidate, observation: ChordInferenceObservation) {
  return !!observation.bass && soundsCompleteWrittenChord(
    candidate.identity, observationNotes(observation).map(({ note }) => note), observation.bass,
  );
}

export function withUpperPassingTones(
  observations: readonly ChordInferenceObservation[], sets: readonly (readonly ChordInferenceCandidate[])[],
  options: ChordInferenceOptions, phraseTicks: readonly number[], ppq: number,
) {
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) return sets;
  return sets.map((existing, i) => {
    const left = observations[i - 1], mid = observations[i], right = observations[i + 1];
    if (existing.length || !left || !right || mid.attackVoiceIds.length !== 1 ||
        phraseTicks.some(t => left.fromTick < t && t <= right.fromTick) ||
        [left, mid, right].some(o => observationNotes(o).some(({ note }) => note.nonChordToneRole))) return existing;
    const motion = upperPassingMotion(left, mid, right, ppq);
    if (!motion) return existing;
    const arrivals = sets[i + 1].filter(exactUpperPassingFit);
    if (!arrivals.length || arrivals.some(candidate =>
      chordIdentityToneSpellings(candidate.identity).some(t => pitchClassEquals(t, motion.note.pitch)))) return existing;
    const recovered = sets[i - 1].flatMap(anchor => {
      const { structure } = anchor.identity;
      if (!exactUpperPassingFit(anchor) || !anchor.semantics || structure.kind !== "tertian" ||
          (structure.quality !== "major" && structure.quality !== "minor") ||
          structure.extensions.length || structure.alterations.length ||
          !chordIdentityToneSpellings(anchor.identity).some(t => pitchClassEquals(t, motion.after.pitch))) return [];
      const id = motion.note.id;
      const fit = fitProlongedHarmony(anchor, mid, id);
      if (!fit) return [];
      const omitted = fit.fit.omittedChordDegrees;
      if (omitted.length) {
        // §38.5: the passing voice can temporarily take away the written root or fifth.
        // A competing endpoint may change the interpretation of the entire span.
        const [degree] = omitted;
        if (omitted.length !== 1 || (degree !== 1 && degree !== 5) ||
            sets[i - 1].length !== 1 || sets[i + 1].length !== 1 ||
            !soundsComplete(anchor, left) || !soundsComplete(arrivals[0], right)) return [];
        const departure = left.activeNotes[mid.attackVoiceIds[0]];
        const displaced = chordIdentityToneSpellingForDegree(anchor.identity, degree);
        if (!departure || !displaced || !pitchClassEquals(displaced, departure.pitch)) return [];
      }
      return [{
        ...fit, fit: { ...fit.fit, nonChordToneAssignments: { [id]: "passing" as const } },
        evidence: [...fit.evidence, { kind: "inferred-nonchord-tone" as const, code: "passing", noteIds: [id] }],
      }];
    });
    return recovered.length ? recovered : existing;
  });
}

type LowerNeighborPairCandidateSet = readonly ChordInferenceCandidate[];

function exactLowerNeighborFit(candidate: ChordInferenceCandidate) {
  const { fit } = candidate;
  return fit.spellingConsistent && !fit.nonChordToneNoteIds.length && !fit.omittedChordDegrees.length;
}

export function withWrittenLowerNeighborPairs(
  observations: readonly ChordInferenceObservation[], sets: readonly LowerNeighborPairCandidateSet[],
  options: ChordInferenceOptions, boundaries: readonly number[],
) {
  const withheldStarts = new Set<number>();
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) {
    return { candidateSets: sets, withheldStarts };
  }
  const candidateSets = sets.map((existing, index) => {
    if (index < 3 || index + 1 >= sets.length || existing.length !== 1) return existing;
    const [rival] = existing;
    const { identity, fit } = rival;
    if (fit.spellingConsistent || fit.omittedChordDegrees.length || fit.nonChordToneNoteIds.length ||
        identity.structure.kind !== "tertian" || identity.structure.quality !== "minor7" ||
        identity.structure.extensions.length || identity.structure.alterations.length) return existing;
    const [preparation, departure, upper, lower, arrival] = observations.slice(index - 3, index + 2);
    const [dominants, departures, , , arrivals] = sets.slice(index - 3, index + 2).map(set => set.filter(exactLowerNeighborFit));
    if (dominants.length !== 1 || departures.length !== 1 || arrivals.length !== 1) return existing;
    const [dominant] = dominants, [anchor] = departures, [returning] = arrivals;
    if (dominant.functionalBaseId !== "DD" || anchor.functionalBaseId !== "DDVII" ||
        returning.functionalBaseId !== anchor.functionalBaseId ||
        !chordIdentityEquals(anchor.identity, returning.identity) ||
        JSON.stringify(anchor.semantics) !== JSON.stringify(returning.semantics)) return existing;
    const noteIds = writtenLowerNeighborPair(dominant.identity, anchor.identity,
      [writtenFrame(preparation), writtenFrame(departure), writtenFrame(upper), writtenFrame(lower), writtenFrame(arrival)], boundaries);
    if (!noteIds) return existing;
    const tones = chordIdentityToneSpellings(identity);
    if (!pitchClassEquals(identity.bass, lower.activeNotes.bass!.pitch) ||
        !VOICE_ORDER.every(voice => {
          const note = lower.activeNotes[voice]!;
          const matching = tones.find(tone => pitchClassValue(tone) === pitchClassValue(note.pitch));
          return matching && pitchClassEquals(matching, note.pitch) !== noteIds.includes(note.id);
        })) return existing;
    // Withdraw only the unsupported respelling and retain its own region boundary.
    withheldStarts.add(lower.fromTick);
    return [];
  });
  return { candidateSets, withheldStarts };
}

type CandidateSet = readonly ChordInferenceCandidate[];
type OrnamentAssignments = Record<string, NonChordToneRole>;
type OrnamentTriplet = readonly [Observation, Observation, Observation];

function isStructuralAnchor(candidate: ChordInferenceCandidate) {
  return !!candidate.semantics && candidate.identity.structure.kind === "tertian" &&
    candidate.fit.spellingConsistent && candidate.fit.bassMatchesInversion &&
    candidate.fit.nonChordToneNoteIds.length === 0;
}

function validOrnamentWindow(window: readonly Observation[], boundaries: readonly number[]) {
  const first = window[0], last = window[window.length - 1];
  return !boundaries.some(tick => first.fromTick < tick && tick <= last.fromTick) &&
    window.every((part, index) =>
      part.completeSatb && part.key.tick === first.key.tick && keyDeclarationEquals(part.key, first.key) &&
      (index === 0 || window[index - 1].toTick === part.fromTick));
}

function isWrittenMember(tones: readonly SpelledPitchClass[], note: AnalysisNote) {
  return tones.some(tone => pitchClassEquals(tone, note.pitch));
}

function touches(from: AnalysisNote, to: AnalysisNote) {
  return from.startTick + from.durationTicks === to.startTick;
}

function ornamentStepDirection(from: AnalysisNote, to: AnalysisNote, chromatic = true): 1 | -1 | 0 {
  if (!touches(from, to)) return 0;
  const interval = writtenInterval(from.pitch, to.pitch);
  const direction = interval.semitones > 0 ? 1 : -1;
  if (isWrittenStep(interval) && interval.diatonicSteps === direction) return direction;
  if (chromatic && interval.diatonicSteps === 0 && Math.abs(interval.semitones) === 1) return direction;
  return 0;
}

function sameWrittenContinuation(from: AnalysisNote, to: AnalysisNote) {
  return spelledPitchEquals(from.pitch, to.pitch) && (from.id === to.id || touches(from, to));
}

function recoverContextualSuspensions(
  [preparation, middle, resolution]: OrnamentTriplet,
  preparations: CandidateSet,
  resolutions: CandidateSet,
  ppq: number,
) {
  if (middle.metric?.confidence !== "certain" || middle.metric.level < 2 ||
      resolution.metric?.confidence !== "certain" ||
      compareMetricStrength(middle.metric, resolution.metric) !== "stronger") return [];

  const duration = middle.toTick - middle.fromTick;
  const completeSurface = hasCompleteWrittenTertianChord(middle);
  return resolutions.flatMap(anchor => {
    const tones = chordIdentityToneSpellings(anchor.identity);
    const assignments: OrnamentAssignments = Object.create(null);
    const restored: AnalysisNote[] = [];
    for (const voice of VOICE_ORDER) {
      const note = middle.activeNotes[voice]!;
      if (isWrittenMember(tones, note)) {
        restored.push(note);
        continue;
      }
      const previous = preparation.activeNotes[voice]!, next = resolution.activeNotes[voice]!;
      const preparationLength = preparation.toTick - Math.max(previous.startTick, preparation.fromTick);
      const requiredLength = previous.id === note.id ? duration : Math.min(duration, ppq);
      const direction = ornamentStepDirection(note, next, false);
      if (!sameWrittenContinuation(previous, note) || preparationLength < requiredLength ||
          !preparations.some(candidate => isWrittenMember(chordIdentityToneSpellings(candidate.identity), previous)) ||
          !direction || !isWrittenMember(tones, next)) return [];
      assignments[note.id] = direction < 0 ? "suspension" : "retardation";
      restored.push(next);
    }

    const size = Object.keys(assignments).length;
    const bass = middle.activeNotes.bass!, settledBass = resolution.activeNotes.bass!;
    if (!size || size > 3 ||
        (completeSurface && !pitchClassEquals(bass.pitch, settledBass.pitch) && !assignments[bass.id]) ||
        !chordVoicingPolicy(anchor.identity).requiredDegrees.every(degree => {
          const tone = chordIdentityToneSpellingForDegree(anchor.identity, degree);
          return tone && restored.some(note => pitchClassEquals(tone, note.pitch));
        })) return [];
    const candidate = fitContextualOrnament(anchor, middle, assignments, "contextual-suspension");
    return candidate ? [candidate] : [];
  });
}

function recoverContextualAnticipations(
  [left, middle, right]: OrnamentTriplet,
  departures: CandidateSet,
  arrivals: CandidateSet,
  ppq: number,
) {
  const duration = middle.toTick - middle.fromTick;
  if ([left, middle, right].some(part => part.metric?.confidence !== "certain") ||
      compareMetricStrength(middle.metric, left.metric) !== "weaker" ||
      compareMetricStrength(middle.metric, right.metric) !== "weaker" ||
      duration > Math.min(ppq / 2, left.toTick - left.fromTick, right.toTick - right.fromTick) ||
      hasCompleteWrittenTertianChord(middle)) return [];

  return departures.flatMap(anchor => {
    const tones = chordIdentityToneSpellings(anchor.identity);
    const moving = observationNotes(middle).filter(({ note }) => !isWrittenMember(tones, note));
    if (!moving.length || moving.some(({ voiceId, note }) => {
      const next = right.activeNotes[voiceId]!;
      return note.startTick !== middle.fromTick || !sameWrittenContinuation(note, next) ||
        (note.id !== next.id && next.startTick !== right.fromTick) ||
        hasAddedSixthReading(anchor, middle, { previous: left.activeNotes[voiceId]!, note });
    }) || !arrivals.some(arrival => {
      const arrivalTones = chordIdentityToneSpellings(arrival.identity);
      return moving.every(({ voiceId }) => isWrittenMember(arrivalTones, right.activeNotes[voiceId]!));
    })) return [];

    const assignments = Object.fromEntries(moving.map(({ note }) => [note.id, "anticipation"] as const));
    const candidate = fitContextualOrnament(anchor, middle, assignments, "contextual-anticipation");
    return candidate ? [candidate] : [];
  });
}

function formsPerfectFifth(first: AnalysisNote, second: AnalysisNote) {
  const interval = writtenInterval(first.pitch, second.pitch);
  return Math.abs(interval.diatonicSteps) % 7 === 4 && Math.abs(interval.semitones) % 12 === 7;
}

function hasParallelNeighborFifths(left: Observation, middle: Observation, assignments: OrnamentAssignments) {
  const neighbors = observationNotes(middle).filter(({ note }) => assignments[note.id] === "neighbor");
  return neighbors.some(({ voiceId, note }, index) => {
    const first = left.activeNotes[voiceId]!;
    return neighbors.slice(index + 1).some(({ voiceId: otherVoice, note: other }) => {
      const second = left.activeNotes[otherVoice]!;
      return ornamentStepDirection(first, note) === ornamentStepDirection(second, other) &&
        formsPerfectFifth(first, second) && formsPerfectFifth(note, other);
    });
  });
}

/** One run of consecutive non-members, bracketed by its departure and arrival tones. */
function horizontalOrnament(notes: readonly AnalysisNote[], singleSlice: boolean, allowEscape: boolean) {
  const first = notes[0], middle = notes[1], last = notes[notes.length - 1];
  const direction = ornamentStepDirection(first, middle);
  if (!direction) return;
  if (notes.slice(2).every((note, index) => ornamentStepDirection(notes[index + 1], note) === direction)) {
    return "passing";
  }
  if (!singleSlice) return;
  if (spelledPitchEquals(first.pitch, last.pitch) && ornamentStepDirection(middle, last) === -direction) {
    return "neighbor";
  }
  if (allowEscape && touches(middle, last)) {
    const leap = writtenInterval(middle.pitch, last.pitch);
    // An octave displacement of a step or repeated tone does not establish an escape.
    const steps = Math.abs(leap.diatonicSteps);
    const semitones = Math.abs(leap.semitones) % 12;
    const displaced =
      (steps % 7 === 0 && (semitones === 0 || semitones === 11)) ||
      (steps % 7 === 6 && semitones >= 10);
    if (steps > 1 && !displaced &&
        Math.sign(leap.semitones) === -direction &&
        Math.sign(leap.diatonicSteps) === -direction) return "escape";
  }
}

function horizontalAssignments(
  window: readonly Observation[],
  leftAnchor: ChordInferenceCandidate,
  rightAnchor: ChordInferenceCandidate,
  sameHarmony: boolean,
) {
  const left = window[0], right = window[window.length - 1];
  const middle = window.slice(1, -1);
  const tones = chordIdentityToneSpellings(leftAnchor.identity);
  const arrivalTones = chordIdentityToneSpellings(rightAnchor.identity);
  const assignments: OrnamentAssignments[] = middle.map(() => Object.create(null));
  const allowEscape = !sameHarmony && middle.length === 1 &&
    compareMetricStrength(middle[0].metric, left.metric) === "weaker" &&
    compareMetricStrength(middle[0].metric, right.metric) === "weaker";
  let hasChordVoice = false;

  for (const voice of VOICE_ORDER) {
    const notes = window.map(part => part.activeNotes[voice]!);
    const last = notes.length - 1;
    if (!isWrittenMember(tones, notes[0]) || !isWrittenMember(arrivalTones, notes[last])) return;
    let leavesChord = false;
    for (let start = 1; start < last;) {
      if (isWrittenMember(tones, notes[start])) {
        start++;
        continue;
      }
      leavesChord = true;
      let end = start + 1;
      while (end < last && !isWrittenMember(tones, notes[end])) end++;
      if (notes[end - 1].id === notes[end].id) return;
      const span = sameHarmony ? notes.slice(start - 1, end + 1) : notes;
      const run = span.filter((note, index, parts) =>
        index === 0 || note.id !== parts[index - 1].id);
      const role = horizontalOrnament(run, middle.length === 1, allowEscape);
      if (!role) return;
      for (let index = start; index < end; index++) assignments[index - 1][notes[index].id] = role;
      start = end;
    }
    hasChordVoice ||= !leavesChord;
  }
  if (sameHarmony && !hasChordVoice) return;
  if (middle.length === 1 && hasParallelNeighborFifths(left, middle[0], assignments[0])) return;
  if (assignments.some((roles, index) => {
    const count = Object.keys(roles).length;
    if (!count || count === VOICE_ORDER.length) return true;
    if (sameHarmony || count !== 3 || roles[middle[index].bass!.id] ||
        (leftAnchor.functionalBaseId !== "D" && leftAnchor.functionalBaseId !== "DD")) return false;
    // A lone retained bass cannot prolong a dominant whose leading tone
    // departs downwards with the other upper parts.
    const third = chordIdentityToneSpellingForDegree(leftAnchor.identity, 3);
    return !!third && observationNotes(left).some(({ voiceId, note }) => {
      const next = middle[index].activeNotes[voiceId]!;
      return pitchClassEquals(note.pitch, third) && roles[next.id] &&
        writtenInterval(note.pitch, next.pitch).semitones < 0;
    });
  })) return;
  return assignments;
}

function supportsLoneUpperPassing(
  left: Observation, middle: Observation, right: Observation, candidate: ChordInferenceCandidate,
) {
  const { structure } = candidate.identity;
  if (structure.kind !== "tertian" || (structure.quality !== "major" && structure.quality !== "minor") ||
      structure.extensions.length || candidate.fit.nonChordToneNoteIds.length !== 1) return true;
  const ornament = observationNotes(middle).find(({ note }) =>
    candidate.fit.nonChordToneAssignments[note.id] === "passing");
  if (!ornament || ornament.voiceId === "bass") return true;

  // A lone upper passing tone between different triads still needs a
  // recognizable third and independent evidence of any chromatic departure.
  const { note, voiceId } = ornament;
  if (candidate.fit.omittedChordDegrees.includes(3) ||
      observationNotes(middle).some(({ voiceId: companion, note: other }) => {
        const previous = left.activeNotes[companion]!;
        return companion !== voiceId && previous.id !== other.id && spelledPitchEquals(previous.pitch, other.pitch);
      })) return false;
  const degree = (stepIndex(note.pitch.step) - stepIndex(middle.key.tonic.step) + 7) % 7 + 1;
  return pitchClassEquals(note.pitch, scaleDegreePitchClass(middle.key, degree)) ||
    note.pitch.step === left.activeNotes[voiceId]!.pitch.step ||
    note.pitch.step === right.activeNotes[voiceId]!.pitch.step;
}

function recoverAccentedPassing(
  [left, middle, right]: OrnamentTriplet,
  departure: ChordInferenceCandidate,
  arrival: ChordInferenceCandidate,
) {
  if (middle.metric?.confidence !== "certain" || middle.metric.level === 0) return;
  const tones = chordIdentityToneSpellings(arrival.identity);
  const moving = observationNotes(middle).filter(({ note }) => !isWrittenMember(tones, note));
  if (moving.length !== 1 || moving[0].voiceId === "bass") return;
  const { voiceId, note } = moving[0];
  const first = left.activeNotes[voiceId]!, last = right.activeNotes[voiceId]!;
  const direction = ornamentStepDirection(first, note);
  if (!direction || ornamentStepDirection(note, last) !== direction ||
      !isWrittenMember(chordIdentityToneSpellings(departure.identity), first) ||
      !isWrittenMember(tones, last)) return;
  return fitContextualOrnament(arrival, middle, { [note.id]: "passing" }, "contextual-passing");
}

function recoverContextualPassingAndNeighbors(
  window: readonly Observation[],
  departures: CandidateSet,
  arrivals: CandidateSet,
  ppq: number,
) {
  const left = window[0], right = window[window.length - 1];
  const middle = window.slice(1, -1);
  const result = middle.map(() => new Map<string, ChordInferenceCandidate>());
  if (middle.some(part => part.toTick - part.fromTick > ppq)) return result;

  const weak = middle.every(part => part.metric?.confidence === "certain" &&
    (part.metric.level < 2 || compareMetricStrength(part.metric, left.metric) === "weaker"));
  const completeSurface = middle.some(hasCompleteWrittenTertianChord);
  const anchors = [...departures, ...arrivals];
  for (const departure of departures) {
    for (const arrival of arrivals) {
      const sameIdentity = chordIdentityEquals(departure.identity, arrival.identity);
      // The six-four pass decides whether a literal tonic six-four is
      // cadential. Two undecided readings do not prove a prolongation.
      if (sameIdentity && anchors.some(candidate =>
        candidate.functionalBaseId === "K46" && chordIdentityEquals(candidate.identity, departure.identity)) &&
        anchors.some(candidate =>
          (candidate.functionalBaseId === "T" || candidate.functionalBaseId === "t") &&
          chordIdentityEquals(candidate.identity, departure.identity))) continue;
      const sameHarmony = sameIdentity &&
        JSON.stringify(departure.semantics) === JSON.stringify(arrival.semantics);
      if (weak && (sameHarmony || !completeSurface)) {
        const assignments = horizontalAssignments(window, departure, arrival, sameHarmony);
        if (assignments) {
          const code = sameHarmony ? "contextual-prolongation" : "contextual-passing";
          const candidates = middle.map((part, index) =>
            fitContextualOrnament(departure, part, assignments[index], code));
          if (candidates.every(candidate => candidate !== undefined) &&
              (sameHarmony || middle.length !== 1 || supportsLoneUpperPassing(left, middle[0], right, candidates[0]))) {
            candidates.forEach((candidate, index) => result[index].set(candidate.id, candidate));
          }
        }
      }
      if (!sameHarmony && !completeSurface && middle.length === 1) {
        const candidate = recoverAccentedPassing([left, middle[0], right], departure, arrival);
        if (candidate) result[0].set(candidate.id, candidate);
      }
    }
  }
  return result;
}

/** Restore only unresolved slices, using written structural readings at the window edges. */
export function withContextualOrnaments(
  observations: readonly Observation[],
  sets: readonly CandidateSet[],
  options: ChordInferenceOptions,
  ppq: number,
  phraseBoundaryTicks: readonly number[],
  withheldStarts: ReadonlySet<number>,
): readonly CandidateSet[] {
  if (options.minConfidence === "high" || options.allowNonChordToneCandidates === false) return sets;

  const anchors = sets.map((set, index) =>
    withheldStarts.has(observations[index].fromTick) ? [] : set.filter(isStructuralAnchor));
  const result = sets.slice();
  const blank = (index: number) => !result[index].length && !withheldStarts.has(observations[index].fromTick);
  for (const recover of [recoverContextualSuspensions, recoverContextualAnticipations]) {
    for (let i = 1; i + 1 < observations.length; i++) {
      if (!blank(i) || !anchors[i - 1].length || !anchors[i + 1].length) continue;
      const window = [observations[i - 1], observations[i], observations[i + 1]] as const;
      if (!validOrnamentWindow(window, phraseBoundaryTicks)) continue;
      const candidates = recover(window, anchors[i - 1], anchors[i + 1], ppq);
      if (candidates.length) result[i] = candidates.sort(candidateComparator);
    }
  }

  for (let start = 1; start + 1 < observations.length;) {
    if (!blank(start)) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < observations.length && blank(end)) end++;
    if (end < observations.length && end - start <= 3 && anchors[start - 1].length && anchors[end].length) {
      const window = observations.slice(start - 1, end + 1);
      if (validOrnamentWindow(window, phraseBoundaryTicks)) {
        const recovered = recoverContextualPassingAndNeighbors(window, anchors[start - 1], anchors[end], ppq);
        recovered.forEach((candidates, offset) => {
          if (candidates.size) result[start + offset] = [...candidates.values()].sort(candidateComparator);
        });
      }
    }
    start = end;
  }
  return result;
}
