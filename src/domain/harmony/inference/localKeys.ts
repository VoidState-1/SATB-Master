import { chordToneSpellings, type KeyReference } from "../../chordModel";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, type SpelledPitchClass } from "../../pitch";
import { resolvesLeadingSeventhToDoubledThird } from "../facts/tendencyResolution";
import type { ChordInferenceObservation } from "./types";
import { observationNotes, resolvesTone, soundingBass, writtenFrame } from "./observations";
import { harmonicMajorPreparation } from "./dominantFamily";

export interface LocalKeyContext {
  readonly key: KeyReference;
  readonly dominantIndex: number;
  readonly tonicIndex: number;
}

function contains(tones: readonly SpelledPitchClass[], pitch: SpelledPitchClass) {
  return tones.some(tone => pitchClassEquals(tone, pitch));
}

function fits(observation: ChordInferenceObservation, tones: readonly SpelledPitchClass[]) {
  return observation.completeSatb && Object.values(observation.activeNotes).every(note => contains(tones, note.pitch));
}

// A repeated bass pitch can support a fresh harmony. A short hold must
// remain on the tonic throughout; a full measure can include a return.
function tonicDisplacedDuringHold(
  observations: readonly ChordInferenceObservation[], tonic: number, end: number, holdEnd: number, key: KeyReference,
  requireContinuousTonic: boolean,
) {
  const tones = chordToneSpellings(key.tonic, key.mode);
  let displaced = false;
  for (let i = tonic + 1; i <= end && observations[i].fromTick < holdEnd; i++) {
    const item = observations[i];
    if (fits(item, tones)) displaced = false;
    else if (item.attackVoiceIds.length === 4 && soundingBass(item) &&
        item.soundingPitchClasses.filter(pitch => !contains(tones, pitch)).length >= 2) {
      if (requireContinuousTonic) return true;
      displaced = true;
    }
  }
  return displaced;
}

function hasBass(item: ChordInferenceObservation, pitch: SpelledPitchClass) {
  return !!item.bass && pitchClassEquals(item.bass.pitch, pitch);
}

function scale(key: KeyReference) {
  const pitches = Array.from({ length: 7 }, (_, i) => scaleDegreePitchClass(key, i + 1));
  if (key.mode === "minor") pitches.push(leadingTonePitchClass(key));
  return pitches;
}

function withinBeat(a: ChordInferenceObservation, b: ChordInferenceObservation) {
  return a.key === b.key && a.metric && b.metric &&
    a.metric.measureNumber === b.metric.measureNumber &&
    Math.abs(a.metric.beatPosition - b.metric.beatPosition) <= 1;
}

function dominantSupports(item: ChordInferenceObservation, key: KeyReference) {
  const root = scaleDegreePitchClass(key, 5);
  const tones = chordToneSpellings(root, "dominant7");
  // The sixth in place of the fifth over a root-position V7 retains the
  // root, leading tone and seventh that identify its resolution.
  const dominantSixth = hasBass(item, root) && contains(item.soundingPitchClasses, tones[3]) &&
    fits(item, [root, tones[1], tones[3], scaleDegreePitchClass(key, 3)]);
  return (fits(item, tones) || dominantSixth) && contains(item.soundingPitchClasses, root) &&
    contains(item.soundingPitchClasses, tones[1]) &&
    (hasBass(item, root) || contains(item.soundingPitchClasses, tones[3]));
}

function closingKey(tonic: ChordInferenceObservation, dominants: readonly ChordInferenceObservation[]) {
  for (const root of tonic.soundingPitchClasses) {
    if (pitchClassEquals(tonic.key.tonic, root)) continue;
    for (const mode of ["major", "minor"] as const) {
      const key = { tonic: root, mode };
      const triad = chordToneSpellings(root, mode);
      if (!fits(tonic, triad) || !contains(tonic.soundingPitchClasses, triad[1]) ||
          !(hasBass(tonic, root) || hasBass(tonic, triad[1]))) continue;
      const dominant = dominants.find(item => dominantSupports(item, key));
      if (dominant) return { key, dominant };
    }
  }
}

function homeTonicMode(item: ChordInferenceObservation) {
  if (!contains(item.soundingPitchClasses, item.key.tonic)) return;
  return (["major", "minor"] as const).find(mode => {
    const tones = chordToneSpellings(item.key.tonic, mode);
    return contains(item.soundingPitchClasses, tones[1]) && fits(item, tones);
  });
}

function doubleLeadingPreparation(
  item: ChordInferenceObservation, next: ChordInferenceObservation,
  tones: readonly SpelledPitchClass[], dominantTriad: readonly SpelledPitchClass[],
) {
  if (!fits(item, tones)) return false;
  // Preserve the written-motion check for the complete diminished seventh
  // resolving directly to V with a doubled third.
  const doublesThird = item.soundingPitchClasses.length === 4 && next.soundingPitchClasses.length === 3 &&
    fits(next, dominantTriad) &&
    observationNotes(next).filter(({ note }) => pitchClassEquals(note.pitch, dominantTriad[1])).length === 2;
  return !doublesThird || resolvesLeadingSeventhToDoubledThird(writtenFrame(item), writtenFrame(next), tones, dominantTriad);
}

function preparationHarmonies(tonic: ChordInferenceObservation, key: KeyReference) {
  const targetScale = scale(key), homeScale = scale(tonic.key);
  const tonicTriad = chordToneSpellings(key.tonic, key.mode);
  const dominantRoot = scaleDegreePitchClass(key, 5);
  const dominantSeventh = chordToneSpellings(dominantRoot, "dominant7");
  const dominantTriad = dominantSeventh.slice(0, 3);
  const sharpFourth = scaleDegreePitchClass(key, 4, 1);
  const doubleDominant = chordToneSpellings(scaleDegreePitchClass(key, 2), "dominant7");
  const doubleLeadingSeventh = chordToneSpellings(sharpFourth, "diminished7");
  const neapolitan = chordToneSpellings(scaleDegreePitchClass(key, 2, -1), "major");
  const leadingSeventh = chordToneSpellings(leadingTonePitchClass(key), "diminished7");
  const relativeMajor = tonic.key.mode === "minor" && key.mode === "major" &&
    pitchClassEquals(key.tonic, scaleDegreePitchClass(tonic.key, 3));
  const homeLeadingTone = leadingTonePitchClass(tonic.key);
  const subdominant = chordToneSpellings(scaleDegreePitchClass(key, 4), "major");
  const supertonicSeventh = chordToneSpellings(scaleDegreePitchClass(key, 2), "minor7");
  const relativeApplied = (relativeMajor ? [2, 4] : []).map(degree => {
    const target = { tonic: scaleDegreePitchClass(key, degree), mode: "major" as const };
    return {
      dominant: chordToneSpellings(scaleDegreePitchClass(target, 5), "dominant7"),
      leading: chordToneSpellings(leadingTonePitchClass(target), "diminished7"),
    };
  });
  return {
    targetScale, homeScale, tonicTriad, dominantRoot, dominantSeventh, dominantTriad, sharpFourth,
    doubleDominant, doubleLeadingSeventh, neapolitan, leadingSeventh, relativeMajor, homeLeadingTone,
    subdominant, supertonicSeventh, relativeApplied,
  };
}

function dominantPreparationRun(
  observations: readonly ChordInferenceObservation[], dominant: number, tonic: ChordInferenceObservation,
  key: KeyReference, existing: ReadonlyMap<number, LocalKeyContext>, dominantSeventh: readonly SpelledPitchClass[],
) {
  let hasSeventh = contains(observations[dominant].soundingPitchClasses, dominantSeventh[3]);
  let hasTriad = !hasSeventh;
  while (dominant > 0 && observations[dominant - 1].key === tonic.key && !existing.has(dominant - 1) &&
    dominantSupports(observations[dominant - 1], key)) {
    dominant--;
    const seventh = contains(observations[dominant].soundingPitchClasses, dominantSeventh[3]);
    hasSeventh ||= seventh;
    hasTriad ||= !seventh;
  }
  return { start: dominant, hasSeventh, hasTriad };
}

function preparationEvidence(
  item: ChordInferenceObservation, next: ChordInferenceObservation, key: KeyReference,
  harmonies: ReturnType<typeof preparationHarmonies>, directlyBeforeDominant: boolean, canUseDoubleDominant: boolean,
) {
  const {
    dominantRoot, tonicTriad, targetScale, homeScale, leadingSeventh, sharpFourth,
    doubleDominant, doubleLeadingSeventh, dominantTriad, relativeApplied,
  } = harmonies;
  const cadential64 = directlyBeforeDominant && hasBass(item, dominantRoot) &&
    fits(item, tonicTriad) && contains(item.soundingPitchClasses, key.tonic);
  const pitches = item.soundingPitchClasses;
  const fitsTargetScale = fits(item, targetScale);
  const distinctive = fitsTargetScale && pitches.some(p => !contains(homeScale, p));
  const leadingPreparation = pitches.length >= 3 && contains(pitches, leadingSeventh[0]) && fits(item, leadingSeventh);
  const doubleDominantPreparation = canUseDoubleDominant && pitches.length >= 3 && contains(pitches, sharpFourth) &&
    (fits(item, doubleDominant) || doubleLeadingPreparation(item, next, doubleLeadingSeventh, dominantTriad));
  const appliedPreparation = relativeApplied.some(({ dominant, leading }) =>
    pitches.length >= 3 && (contains(pitches, leading[0]) && fits(item, leading) ||
      contains(pitches, dominant[1]) && contains(pitches, dominant[3]) && fits(item, dominant)));
  return { cadential64, pitches, fitsTargetScale, distinctive, leadingPreparation, doubleDominantPreparation, appliedPreparation };
}

function homeTonicFollowsDominant(observations: readonly ChordInferenceObservation[], index: number, key: KeyReference) {
  const prev = observations[index - 1];
  let k = index - 1;
  while (k >= 0 && withinBeat(prev, observations[k]) && !dominantSupports(observations[k], key)) k--;
  return k >= 0 && withinBeat(prev, observations[k]);
}

interface UnsettledPreparationEvidence {
  firstPitches?: readonly SpelledPitchClass[];
  independent: boolean;
  chromaticBeforeDominant: boolean;
}

function recordUnsettledPreparation(
  evidence: UnsettledPreparationEvidence, pitches: readonly SpelledPitchClass[],
  chromaticAtDominant: boolean, homeScale: readonly SpelledPitchClass[], dominantThird: SpelledPitchClass,
) {
  // Reattacks and inversions of the same pitch collection supply one
  // piece of evidence, regardless of how many slices they occupy.
  const previous = evidence.firstPitches ??= pitches;
  evidence.independent ||= pitches.length !== previous.length || pitches.some(p => !contains(previous, p));
  evidence.chromaticBeforeDominant ||= chromaticAtDominant &&
    pitches.some(p => !contains(homeScale, p) && !pitchClassEquals(p, dominantThird));
}

/** Find preparation for the closing key within the current written key. */
function preparationStart(
  observations: readonly ChordInferenceObservation[], landing: number, dominant: number,
  key: KeyReference, existing: ReadonlyMap<number, LocalKeyContext>,
  settled: boolean,
) {
  const tonic = observations[landing];
  const harmonies = preparationHarmonies(tonic, key);
  const { targetScale, homeScale, dominantSeventh, sharpFourth, neapolitan, relativeMajor,
    homeLeadingTone, subdominant, supertonicSeventh } = harmonies;
  const { start: dominantStart, hasSeventh, hasTriad } =
    dominantPreparationRun(observations, dominant, tonic, key, existing, dominantSeventh);
  const chromaticDominant = !contains(homeScale, dominantSeventh[1]);
  const canUseDoubleDominant = !contains(homeScale, sharpFourth);
  const preparationBass = observations[dominantStart - 1]?.bass;
  let samePreparationBass = !!preparationBass;
  let start: number | undefined;
  let relativeDiatonicStart: number | undefined;
  let relativeCadenceSupport = hasSeventh;
  let relativeBridgeFits = true;
  let earlierCadenceEnd: number | undefined;
  const unsettledEvidence: UnsettledPreparationEvidence = { independent: false, chromaticBeforeDominant: false };
  for (let j = dominantStart - 1; j >= 0; j--) {
    const item = observations[j];
    if (!item.completeSatb || item.key !== tonic.key ||
        (tonic.metric?.measureNumber ?? 0) - (item.metric?.measureNumber ?? 0) > 4) break;
    const previousContext = existing.get(j);
    if (previousContext) {
      if (relativeMajor && relativeBridgeFits && keyEquals(previousContext.key, key)) earlierCadenceEnd = j;
      break;
    }
    samePreparationBass = samePreparationBass && !!preparationBass && hasBass(item, preparationBass.pitch);
    const homeMode = homeTonicMode(item);
    if (homeMode === item.key.mode) {
      // A common home tonic can lead into an expanded V–V7. An isolated
      // applied dominant after the home tonic is still ambiguous.
      if (start === undefined && j === dominantStart - 1 && settled && chromaticDominant &&
          hasTriad && hasSeventh && hasBass(tonic, key.tonic) && fits(item, targetScale)) start = dominantStart;
      break;
    }
    if (relativeMajor && contains(item.soundingPitchClasses, homeLeadingTone)) break;
    if (homeMode) {
      relativeBridgeFits = false;
      if (homeTonicFollowsDominant(observations, j, item.key)) break;
      continue;
    }
    const { cadential64, pitches, fitsTargetScale, distinctive, leadingPreparation, doubleDominantPreparation, appliedPreparation } =
      preparationEvidence(item, observations[j + 1], key, harmonies, j === dominantStart - 1, canUseDoubleDominant);
    if (relativeMajor) {
      relativeBridgeFits &&= fitsTargetScale || doubleDominantPreparation || appliedPreparation;
      relativeCadenceSupport ||= cadential64 || doubleDominantPreparation || appliedPreparation;
      if (settled && pitches.length >= 3 && fitsTargetScale &&
          (fits(item, subdominant) || contains(pitches, supertonicSeventh[0]) &&
           contains(pitches, supertonicSeventh[1]) && fits(item, supertonicSeventh))) relativeDiatonicStart = j;
    }
    const chromaticPreparation = samePreparationBass && pitches.length >= 3 &&
      (fits(item, neapolitan) && contains(pitches, neapolitan[0]) || leadingPreparation);
    if (cadential64 || chromaticPreparation || distinctive || doubleDominantPreparation || appliedPreparation ||
        harmonicMajorPreparation(item, observations[j + 1], key)) start = j;
    if (!settled && (cadential64 || distinctive || doubleDominantPreparation || leadingPreparation || appliedPreparation)) {
      recordUnsettledPreparation(unsettledEvidence, pitches,
        j === dominantStart - 1 && (distinctive || doubleDominantPreparation), homeScale, dominantSeventh[1]);
      if (leadingPreparation) start = j;
    }
  }
  if (relativeCadenceSupport && relativeDiatonicStart !== undefined)
    start = Math.min(start ?? relativeDiatonicStart, relativeDiatonicStart);
  if (!settled && !unsettledEvidence.independent && !(chromaticDominant && unsettledEvidence.chromaticBeforeDominant)) return;
  if (start !== undefined && earlierCadenceEnd !== undefined) return earlierCadenceEnd + 1;
  return start;
}

function hasEarlierHomeTonic(
  observations: readonly ChordInferenceObservation[], source: ChordInferenceObservation,
  localKeys: ReadonlyMap<number, LocalKeyContext>, manualPhraseTicks: readonly number[],
) {
  for (let j = source.index - 1; j >= 0; j--) {
    const item = observations[j];
    if (item.key !== source.key || localKeys.has(j) || !item.completeSatb ||
        manualPhraseTicks.some(t => item.fromTick < t && t <= observations[j + 1].fromTick)) break;
    const mode = homeTonicMode(item);
    if (mode && item.soundingPitchClasses.length === 3 && soundingBass(item) &&
        (hasBass(item, item.key.tonic) || hasBass(item, chordToneSpellings(item.key.tonic, mode)[1])))
      return mode === item.key.mode;
  }
  return false;
}

function sameWrittenVoicing(previous: ChordInferenceObservation, current: ChordInferenceObservation) {
  return previous.key === current.key && previous.toTick === current.fromTick && !!soundingBass(previous) &&
    observationNotes(current).every(({ voiceId, note }) => {
      const other = previous.activeNotes[voiceId];
      return other && spelledPitchEquals(note.pitch, other.pitch);
    });
}

// Spasobin §54.2. The opposite-mode tonic can be a common chord with a
// separately established destination. The home V7 alone also admits mixture.
function parallelTonicPivot(
  dominant: ChordInferenceObservation, pivot: ChordInferenceObservation, destination: KeyReference,
): KeyReference | undefined {
  if (dominant.key !== pivot.key || dominant.toTick !== pivot.fromTick ||
      pivot.metric?.role !== "downbeat" || !soundingBass(dominant) || !soundingBass(pivot)) return;
  const home = pivot.key;
  const parallel: KeyReference = { tonic: home.tonic, mode: home.mode === "major" ? "minor" : "major" };
  const triad = chordToneSpellings(home.tonic, parallel.mode);
  if (pivot.soundingPitchClasses.length !== 3 || !fits(pivot, triad) ||
      !(hasBass(pivot, triad[0]) || hasBass(pivot, triad[1]))) return;
  const seventh = chordToneSpellings(scaleDegreePitchClass(home, 5), "dominant7");
  if (dominant.soundingPitchClasses.length !== 4 || !fits(dominant, seventh) ||
      !resolvesTone(dominant, pivot, seventh[1], triad[0], 1) ||
      !resolvesTone(dominant, pivot, seventh[3], triad[1], -1)) return;
  const destinationScale = scale(destination), parallelScale = scale(parallel), homeScale = scale(home);
  const destinationTriad = chordToneSpellings(destination.tonic, destination.mode);
  if (triad.every(p => contains(destinationScale, p)) &&
      destinationTriad.every(p => contains(parallelScale, p)) &&
      !destinationTriad.every(p => contains(homeScale, p))) return parallel;
}

/** A written V(7)–I can tonicize a scale degree without a change of key.
 * Require consolidation and independent preparation in the destination.
 * Keep printed key changes as hard boundaries. */
export function inferLocalKeys(
  observations: readonly ChordInferenceObservation[],
  phraseEnds: ReadonlySet<number>,
  manualPhraseTicks: readonly number[] = [],
) {
  const keys = new Map<number, LocalKeyContext>();
  for (let i = 1; i < observations.length; i++) {
    const arrival = observations[i], prev = observations[i - 1];
    if (!arrival.bass || !prev.bass || arrival.key !== prev.key ||
        hasBass(prev, arrival.bass.pitch) || arrival.metric?.role === "subdivision") continue;
    let end = i;
    while (end + 1 < observations.length && observations[end + 1].key === arrival.key &&
      hasBass(observations[end + 1], arrival.bass.pitch)) end++;
    const next = observations[end + 1];
    const rest = next && next.soundingPitchClasses.length === 0;
    // Compare written duration in ticks. Beat numbers on the opposite sides
    // of a meter change need not describe the same pulse length.
    const accented = arrival.metric?.role === "downbeat" || arrival.metric?.role === "secondary-accent";
    const duration = observations[end].toTick - arrival.fromTick;
    const measure = arrival.measureDurationTicks;
    const held = !!measure && accented && duration >= measure;
    const closesPhrase = phraseEnds.has(observations[end].toTick) || rest;
    const settled = !!closesPhrase || held;
    const halfMeasureHold = measure && arrival.measureBeatTicks && accented
      ? Math.max(measure / 2, arrival.measureBeatTicks * 2) : undefined;
    if (!settled && (!halfMeasureHold || duration < halfMeasureHold)) continue;

    // A surface note can precede the stable sonority at the same bass. Find
    // a written dominant and tonic within one beat of the actual bass change.
    const dominants = [prev];
    for (let j = i - 2; j >= 0 && withinBeat(prev, observations[j]) &&
         hasBass(observations[j], prev.bass.pitch); j--) dominants.push(observations[j]);
    for (let j = i; j <= end && (j === i || withinBeat(arrival, observations[j])); j++) {
      const cadence = closingKey(observations[j], dominants);
      if (!cadence) continue;
      const requiredHold = held ? measure : halfMeasureHold;
      if (!closesPhrase && requiredHold && tonicDisplacedDuringHold(
        observations, j, end, arrival.fromTick + requiredHold, cadence.key, !held,
      )) continue;
      const start = preparationStart(observations, j, cadence.dominant.index, cadence.key, keys, settled);
      if (start !== undefined) {
        const context = { key: cadence.key, dominantIndex: cadence.dominant.index, tonicIndex: j };
        for (let k = start; k <= end; k++) keys.set(k, context);
        i = end;
      }
      break;
    }
  }
  const ends = [...phraseEnds];
  for (let i = 1; i < observations.length - 1; i++) {
    const destination = keys.get(i + 1);
    if (!destination || keys.has(i) || destination.dominantIndex <= i || !soundingBass(observations[i])) continue;
    let start = i;
    while (start > 0 && !keys.has(start - 1) && sameWrittenVoicing(observations[start - 1], observations[start])) start--;
    if (!start || keys.has(start - 1)) continue;
    const source = observations[start - 1], pivot = observations[start], landing = observations[destination.tonicIndex];
    if (pivot.key !== landing.key || manualPhraseTicks.some(t => source.fromTick < t && t <= landing.fromTick) ||
        ends.some(t => pivot.fromTick < t && t <= landing.fromTick)) continue;
    const key = parallelTonicPivot(source, pivot, destination.key);
    if (key && hasEarlierHomeTonic(observations, source, keys, manualPhraseTicks)) {
      const context = { key, dominantIndex: start - 1, tonicIndex: start };
      for (let j = start; j <= i; j++) keys.set(j, context);
    }
  }
  return keys;
}
