import {
  chordToneSpellings,
  primaryHarmonyInterpretation,
  type ChordQuality,
} from "../../chordModel";
import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals } from "../../pitch";
import {
  continuesWrittenDominantSeventh,
  dominantSixthInnerVoices as innerVoices,
  dominantSixthLowerVoices as lowerVoices,
  leadingToneDescendsToTonicFifth,
  movesToWrittenTone,
  resolvesDominantInnerVoice,
} from "../dominantSixthMotion";
import { candidateComparator, createFunctionalCandidate, fitDominantSixthSubstitution } from "./candidates";
import { isCanonicalTonicFifthOmission } from "./fit";
import { observationNotes } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, FunctionalChordTemplate } from "./types";

type CandidateSet = readonly ChordInferenceCandidate[];

const rootDominantSeventh: FunctionalChordTemplate = {
  baseId: "D",
  definition: functionalDefinition("D"),
  form: "seventh",
  localKeyPolicy: "current-key",
  expectedInversion: 0,
};

function continuesInKey(source: ChordInferenceObservation, following: ChordInferenceObservation) {
  return source.toTick === following.fromTick && source.key.id === following.key.id &&
    source.key.mode === following.key.mode && pitchClassEquals(source.key.tonic, following.key.tonic);
}

function exactReading(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && !candidate.fit.nonChordToneNoteIds.length &&
    !candidate.fit.omittedChordDegrees.length;
}

function plainQuality(candidate: ChordInferenceCandidate, quality: ChordQuality) {
  const { structure } = candidate.identity;
  return structure.kind === "tertian" && structure.quality === quality &&
    !structure.extensions.length && !structure.alterations.length;
}

function isInPrintedKey(candidate: ChordInferenceCandidate) {
  if (!candidate.semantics) return false;
  const interpretation = primaryHarmonyInterpretation(candidate.semantics);
  return !interpretation.localKey && !interpretation.appliedTarget;
}

function fifthResolution(
  source: ChordInferenceObservation,
  following: ChordInferenceObservation,
  candidates: CandidateSet,
) {
  const root = source.bass?.pitch;
  const sixth = source.activeNotes.soprano?.pitch;
  const arrival = following.activeNotes.soprano?.pitch;
  if (!root || !sixth || !arrival || following.soundingPitchClasses.length !== 4 ||
      !movesToWrittenTone(sixth, arrival, chordToneSpellings(root, "dominant7")[2], -1) ||
      !lowerVoices.every(voice => {
        const before = source.activeNotes[voice];
        const after = following.activeNotes[voice];
        return before && after && spelledPitchEquals(before.pitch, after.pitch);
      })) return undefined;

  return candidates.find(candidate =>
    candidate.functionalBaseId === "D" && isInPrintedKey(candidate) &&
    plainQuality(candidate, "dominant7") && exactReading(candidate) &&
    pitchClassEquals(candidate.identity.root, root) && pitchClassEquals(candidate.identity.bass, root),
  );
}

function tonicResolution(
  source: ChordInferenceObservation,
  following: ChordInferenceObservation,
  candidates: CandidateSet,
  heldDominant: boolean,
) {
  const key = following.key;
  const root = source.bass?.pitch;
  const sixth = source.activeNotes.soprano?.pitch;
  const arrival = following.activeNotes.soprano?.pitch;
  if (!root || !sixth || !arrival || !movesToWrittenTone(sixth, arrival, key.tonic, -2)) return undefined;
  const tonicCandidates = candidates.filter(candidate =>
    candidate.functionalBaseId === (key.mode === "major" ? "T" : "t") && isInPrintedKey(candidate) &&
    plainQuality(candidate, key.mode) && pitchClassEquals(candidate.identity.root, key.tonic) &&
    pitchClassEquals(candidate.identity.bass, key.tonic));
  const completeTonic = tonicCandidates.some(exactReading);
  const newBass = source.bass?.startTick === source.fromTick;
  if ((!newBass && (!heldDominant || !completeTonic)) ||
      (!completeTonic && !tonicCandidates.some(candidate => isCanonicalTonicFifthOmission(following, candidate.identity)))) {
    return undefined;
  }

  const [, leadingTone, , seventh] = chordToneSpellings(root, "dominant7");
  const tonicFifth = completeTonic ? scaleDegreePitchClass(key, 5) : undefined;
  if (!newBass && !innerVoices.some(voice => leadingToneDescendsToTonicFifth(
    source.activeNotes[voice]?.pitch, following.activeNotes[voice]?.pitch, leadingTone, tonicFifth,
  ))) return undefined;
  const resolves = innerVoices.every(voice => resolvesDominantInnerVoice(
    source.activeNotes[voice]?.pitch,
    following.activeNotes[voice]?.pitch,
    leadingTone,
    seventh,
    key.tonic,
    sixth,
    tonicFifth,
  ));
  if (!resolves) return undefined;
  return createFunctionalCandidate(source, rootDominantSeventh, { allowNonChordToneCandidates: true });
}

function continuesHeldDominant(
  previous: ChordInferenceObservation | undefined,
  source: ChordInferenceObservation,
  previousCandidates: CandidateSet | undefined,
  manualPhraseTicks: readonly number[],
) {
  const bass = source.bass;
  return Boolean(previous && bass && !previous.localKey && continuesInKey(previous, source) &&
    !manualPhraseTicks.some(tick => previous.fromTick < tick && tick <= source.fromTick) &&
    continuesWrittenDominantSeventh(previous.activeNotes, source.activeNotes, bass.pitch) &&
    previousCandidates?.some(candidate =>
      candidate.functionalBaseId === "D" && isInPrintedKey(candidate) &&
      plainQuality(candidate, "dominant7") && exactReading(candidate) &&
      pitchClassEquals(candidate.identity.root, bass.pitch) && pitchClassEquals(candidate.identity.bass, bass.pitch),
    ));
}

export function withDominantSixthSubstitutions(
  observations: readonly ChordInferenceObservation[],
  sets: readonly CandidateSet[],
  meetsMinimumConfidence: (candidate: ChordInferenceCandidate) => boolean,
  manualPhraseTicks: readonly number[] = [],
) {
  return sets.map((existing, observationIndex) => {
    const source = observations[observationIndex];
    const following = observations[observationIndex + 1];
    const soprano = source.activeNotes.soprano;
    const bass = source.bass;
    if (!source.completeSatb || source.soundingPitchClasses.length !== 4 ||
        soprano?.startTick !== source.fromTick || !bass ||
        source.localKey || !following?.completeSatb || following.localKey ||
        !continuesInKey(source, following) ||
        manualPhraseTicks.some(tick => source.fromTick < tick && tick <= following.fromTick) ||
        !pitchClassEquals(bass.pitch, scaleDegreePitchClass(source.key, 5)) ||
        !pitchClassEquals(soprano.pitch, scaleDegreePitchClass(source.key, 3)) ||
        existing.some(candidate => candidate.confidence !== "low" && exactReading(candidate)) ||
        [source, following].some(item => observationNotes(item).some(({ note }) => note.nonChordToneRole))) return existing;

    const followingCandidates = sets[following.index];
    const newBass = bass.startTick === source.fromTick;
    const anchor = newBass ? fifthResolution(source, following, followingCandidates) : undefined;
    const reading = anchor ?? tonicResolution(source, following, followingCandidates,
      !newBass && continuesHeldDominant(observations[observationIndex - 1], source, sets[observationIndex - 1], manualPhraseTicks));
    const candidate = reading && fitDominantSixthSubstitution(source, reading, anchor ? "fifth" : "tonic");
    return candidate && meetsMinimumConfidence(candidate)
      ? [...existing, candidate].sort(candidateComparator)
      : existing;
  });
}
