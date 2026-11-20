import { functionalDefinition } from "../../functionalHarmonyCatalog";
import { keyDeclarationEquals, pitchClassEquals, scaleDegreePitchClass } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import { isMajorTonicSixFour, resolvesDoubleAugmentedFourThree } from "../doubleAugmentedFourThree";
import { candidateComparator, createFunctionalCandidate } from "./candidates";
import { soundingBass } from "./observations";
import type { ChordInferenceCandidate, ChordInferenceObservation, FunctionalChordTemplate } from "./types";

type Frame = ChordInferenceObservation;
type CandidateSet = readonly ChordInferenceCandidate[];

const doubleAugmentedFourThree: FunctionalChordTemplate = {
  baseId: "DD++43",
  definition: functionalDefinition("DD++43"),
  form: "triad",
  localKeyPolicy: "current-key",
  expectedInversion: 0,
};

function exact(candidate: ChordInferenceCandidate) {
  return candidate.fit.spellingConsistent && candidate.fit.bassMatchesInversion &&
    !candidate.fit.omittedChordDegrees.length && !candidate.fit.nonChordToneNoteIds.length &&
    !candidate.fit.extraPitchClasses.length;
}

function connects(left: Frame, right: Frame, boundaries: readonly number[]) {
  return left.toTick === right.fromTick && keyDeclarationEquals(left.key, right.key) &&
    !boundaries.some(tick => left.fromTick < tick && tick <= right.fromTick);
}

function hasDominantBassAnchor(frame: Frame, set: CandidateSet) {
  const bass = soundingBass(frame);
  if (!bass || !pitchClassEquals(bass, scaleDegreePitchClass(frame.key, 5))) return false;
  return set.some(candidate => exact(candidate) &&
    (isMajorTonicSixFour(candidate.identity, frame.key) ||
      (candidate.functionalBaseId === "D" && pitchClassEquals(candidate.identity.root, bass))));
}

function hasRootTonic(frame: Frame, set: CandidateSet) {
  const bass = soundingBass(frame);
  return !!bass && pitchClassEquals(bass, frame.key.tonic) &&
    set.some(candidate => candidate.functionalBaseId === "T" && exact(candidate) &&
      pitchClassEquals(candidate.identity.root, bass));
}

/** The written ♯2 distinguishes DD++43 from Ger+6 (Spasobin 30-451).
 * An independently sounded tonic or dominant frame establishes the key,
 * while the resolution rule remains responsible for individual motions. */
export function withDoubleAugmentedFourThree(
  observations: readonly Frame[],
  sets: readonly CandidateSet[],
  manualPhraseTicks: readonly number[],
  meetsMinimumConfidence: (candidate: ChordInferenceCandidate) => boolean,
) {
  return sets.map((existing, index) => {
    const before = observations[index];
    const after = observations[index + 1];
    const bass = soundingBass(before);
    if (before.key.mode !== "major" || before.soundingPitchClasses.length !== 4 ||
        !bass || !pitchClassEquals(bass, scaleDegreePitchClass(before.key, 6, -1)) ||
        !after || !connects(before, after, manualPhraseTicks)) return existing;

    const candidate = createFunctionalCandidate(before, doubleAugmentedFourThree, {});
    if (!candidate || !exact(candidate) || !meetsMinimumConfidence(candidate)) return existing;
    if (!resolvesDoubleAugmentedFourThree(before.activeNotes, after.activeNotes, before.key)) {
      // Retain other exact readings when the near context is inconclusive.
      if (existing.some(exact)) return existing;
      const previous = observations[index - 1];
      const settled = observations[index + 2];
      const metric = after.metric;
      const hasNearAnchor = settled && metric && after.bass && !sets[index + 1].some(exact) &&
        after.bass.id === settled.bass?.id && connects(after, settled, manualPhraseTicks) &&
        settled.metric?.measureNumber === metric.measureNumber &&
        settled.metric.beatPosition - metric.beatPosition <= 1 &&
        hasDominantBassAnchor(settled, sets[index + 2]);
      const returnsToTonic = previous && connects(previous, before, manualPhraseTicks) &&
        hasRootTonic(previous, sets[index - 1]) && hasRootTonic(after, sets[index + 1]) &&
        VOICE_ORDER.some(voice => {
          const note = before.activeNotes[voice];
          return note && pitchClassEquals(note.pitch, before.key.tonic) &&
            previous.activeNotes[voice]?.id === note.id && after.activeNotes[voice]?.id === note.id;
        });
      if (!hasDominantBassAnchor(after, sets[index + 1]) && !hasNearAnchor && !returnsToTonic) return existing;
    }
    return [...existing.filter(item => item.functionalBaseId !== "Ger+6"), candidate].sort(candidateComparator);
  });
}
