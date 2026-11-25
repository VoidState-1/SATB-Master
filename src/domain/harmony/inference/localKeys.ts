import { chordIdentityEquals, chordToneSpellings, type KeyReference } from "../../chordModel";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, type SpelledPitchClass } from "../../pitch";
import { resolvesLeadingSeventhToDoubledThird } from "../facts/tendencyResolution";
import type { ChordInferenceObservation } from "./types";
import { observationNotes, observationWithStructuralNotes, resolvesTone, soundingBass, writtenFrame } from "./observations";
import { createWrittenOrnamentReader } from "../facts/ornamentalMotion";
import { createStructuralVoicingReader, readSoundingTertianIdentity } from "../facts/writtenVoicing";
import { harmonicMajorPreparation } from "./dominantFamily";

export interface LocalKeyContext {
  readonly key: KeyReference;
  readonly dominantIndex: number;
  readonly tonicIndex: number;
  readonly evidence?: "structural-cadence" | "repeated-cadence" | "parallel-pivot";
  readonly cadentialLeadIn?: { readonly onsetIndex: number; readonly settledIndex: number; readonly noteId: string };
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

function* closingKeys(tonic: ChordInferenceObservation, dominants: readonly ChordInferenceObservation[], structural = false) {
  for (const root of tonic.soundingPitchClasses) {
    if (pitchClassEquals(tonic.key.tonic, root)) continue;
    for (const mode of ["major", "minor"] as const) {
      const key = { tonic: root, mode };
      const triad = chordToneSpellings(root, mode);
      if (!fits(tonic, triad) || !contains(tonic.soundingPitchClasses, triad[1]) ||
          !(hasBass(tonic, root) || hasBass(tonic, triad[1]))) continue;
      for (const dominant of dominants) {
        const literal = dominantSupports(dominant, key);
        if (literal || structural && expandedDominantSupports(dominant, tonic, key)) yield { key, dominant };
        if (!structural && literal) break;
      }
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
  localKeys: ReadonlyMap<number, LocalKeyContext>,
) {
  for (let j = source.index - 1; j >= 0; j--) {
    const item = observations[j];
    if (item.key !== source.key || localKeys.has(j) || !item.completeSatb) break;
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
function readCadentialWindows(
  observations: readonly ChordInferenceObservation[],
  phraseEnds: ReadonlySet<number>,
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
      let confirmed = false;
      for (const cadence of closingKeys(observations[j], dominants)) {
        const requiredHold = held ? measure : halfMeasureHold;
        if (!closesPhrase && requiredHold && tonicDisplacedDuringHold(
          observations, j, end, arrival.fromTick + requiredHold, cadence.key, !held,
        )) continue;
        const start = preparationStart(observations, j, cadence.dominant.index, cadence.key, keys, settled);
        if (start !== undefined) {
          const context = { key: cadence.key, dominantIndex: cadence.dominant.index, tonicIndex: j };
          for (let k = start; k <= end; k++) keys.set(k, context);
          i = end;
          confirmed = true;
          break;
        }
      }
      if (confirmed) break;
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
    if (pivot.key !== landing.key || ends.some(t => pivot.fromTick < t && t <= landing.fromTick)) continue;
    const key = parallelTonicPivot(source, pivot, destination.key);
    if (key && hasEarlierHomeTonic(observations, source, keys)) {
      const context: LocalKeyContext = { key, dominantIndex: start - 1, tonicIndex: start, evidence: "parallel-pivot" };
      for (let j = start; j <= i; j++) keys.set(j, context);
    }
  }
  return keys;
}

/** Recheck incomplete surface sonorities only against nearby written anchors.
 * A complete competing chord is not treated as an ornament. Keep the
 * original bass attack as the event that can delimit a change of center. */
function reviewStructuralFrames(observations: readonly ChordInferenceObservation[], ppq: number) {
  const frames = observations.map(item => {
    const frame = writtenFrame(item);
    const literal = readSoundingTertianIdentity(frame, true);
    return { ...frame, identities: literal ? [literal] : [] };
  });
  const read = createStructuralVoicingReader(frames, [], 2 * ppq);
  return observations.map((item, index) => {
    if (!item.completeSatb || !item.bass || frames[index].identities.length) return item;
    const anchors = frames.slice(Math.max(0, index - 8), index + 9).flatMap(frame =>
      Math.abs(frame.tick - item.fromTick) <= 2 * ppq ? frame.identities : []);
    const viable = anchors.filter((identity, i) => pitchClassEquals(identity.bass, item.bass!.pitch) &&
      !anchors.slice(0, i).some(other => chordIdentityEquals(other, identity))).flatMap(identity => {
      const voicing = read(index, identity);
      if (!voicing?.bass || voicing.bass.ornament || voicing.unresolved.length || voicing.missing.length) return [];
      if (!voicing.voices.some(voice => voice.ornament)) return [];
      return [voicing];
    });
    if (viable.length !== 1) return item;
    return observationWithStructuralNotes(item, Object.fromEntries(viable[0].voices.map(voice => [
      voice.voice, { ...voice.structural, nonChordToneRole: undefined },
    ])));
  });
}

/** A V with an augmented fifth or written inversion is diagnostic when
 * its structural leading tone actually moves to the new tonic. */
function expandedDominantSupports(
  item: ChordInferenceObservation, arrival: ChordInferenceObservation, key: KeyReference,
) {
  const root = scaleDegreePitchClass(key, 5);
  const seventh = chordToneSpellings(root, "dominant7");
  // A chromatically lowered fifth can move in the bass while the written
  // root, third and seventh continue to identify this dominant.
  const altered = [seventh[0], seventh[1], scaleDegreePitchClass(key, 2, -1), seventh[3]];
  return (altered.every(tone => contains(item.soundingPitchClasses, tone)) && fits(item, altered) &&
    resolvesTone(item, arrival, seventh[1], key.tonic, 1)) ||
    (["major", "augmented"] as const).some(quality => {
      const tones = chordToneSpellings(root, quality);
      return tones.every(tone => contains(item.soundingPitchClasses, tone)) && fits(item, tones) &&
        resolvesTone(item, arrival, tones[1], key.tonic, 1);
    });
}

interface WrittenClosure {
  readonly key: KeyReference;
  readonly dominant: number;
  readonly tonic: number;
  readonly strongDominant: boolean;
  readonly rootArrival: boolean;
  readonly end: number;
}

function tonicSupports(item: ChordInferenceObservation, key: KeyReference) {
  const tones = chordToneSpellings(key.tonic, key.mode);
  return (hasBass(item, tones[0]) || hasBass(item, tones[1])) &&
    contains(item.soundingPitchClasses, tones[1]) && fits(item, tones);
}

/** Enumerate written V-I alternatives at bass arrivals. A skipped surface
 * frame must still belong to one of the two bass events, within one pulse. */
function writtenClosures(observations: readonly ChordInferenceObservation[]) {
  const closures: WrittenClosure[] = [];
  for (let i = 1; i < observations.length; i++) {
    const arrival = observations[i], before = observations[i - 1];
    if (!arrival.bass || !before.bass || hasBass(before, arrival.bass.pitch)) continue;
    const beat = arrival.measureBeatTicks ?? Infinity;
    const dominants = [before];
    for (let j = i - 2; j >= 0 && before.fromTick - observations[j].fromTick < beat; j--) {
      const frame = observations[j], next = observations[j + 1];
      if (!hasBass(frame, before.bass.pitch) &&
          (readSoundingTertianIdentity(writtenFrame(next)) ||
           next.soundingPitchClasses.filter(pitch => contains(frame.soundingPitchClasses, pitch)).length < 2)) break;
      dominants.push(frame);
    }
    const seen: KeyReference[] = [];
    for (let j = i; j < observations.length && observations[j].fromTick - arrival.fromTick < beat &&
         hasBass(observations[j], arrival.bass.pitch); j++) {
      const item = observations[j];
      for (const { key, dominant } of closingKeys(item, dominants, true)) {
        if (seen.some(other => keyEquals(other, key)) ||
            !soundingBass(item) || !soundingBass(dominant) ||
            !(hasBass(dominant, scaleDegreePitchClass(key, 5)) && hasBass(item, key.tonic) ||
              resolvesTone(dominant, item, leadingTonePitchClass(key), key.tonic, 1) ||
              resolvesTone(dominant, item, scaleDegreePitchClass(key, 4), scaleDegreePitchClass(key, 3), -1))) continue;
        seen.push(key);
        let end = j;
        while (observations[end + 1] && tonicSupports(observations[end + 1], key) &&
               hasBass(observations[end + 1], item.bass!.pitch)) end++;
        let rootArrival = hasBass(item, key.tonic);
        if (!rootArrival) {
          const tones = chordToneSpellings(key.tonic, key.mode);
          for (let k = end + 1; k < observations.length && observations[k].fromTick - item.fromTick <= beat; k++) {
            const next = observations[k];
            const upper = observationNotes(next).filter(({ voiceId }) => voiceId !== "bass");
            if (hasBass(next, key.tonic) && tonicSupports(next, key)) {
              rootArrival = true;
              end = k;
              break;
            }
            if (upper.filter(({ note }) => contains(tones, note.pitch)).length < 2 ||
                !upper.some(({ note, voiceId }) => note.id === item.activeNotes[voiceId]?.id)) break;
          }
        }
        const seventh = chordToneSpellings(scaleDegreePitchClass(key, 5), "dominant7")[3];
        closures.push({ key, dominant: dominant.index, tonic: j, end, rootArrival,
          strongDominant: contains(dominant.soundingPitchClasses, seventh) ||
            contains(dominant.soundingPitchClasses, chordToneSpellings(scaleDegreePitchClass(key, 5), "augmented")[2]) });
      }
    }
  }
  return closures;
}

function isCompatible(item: ChordInferenceObservation, key: KeyReference) {
  return fits(item, scale(key)) || dominantSupports(item, key) ||
    fits(item, chordToneSpellings(leadingTonePitchClass(key), "diminished7"));
}

function distinctiveDominantStart(
  observations: readonly ChordInferenceObservation[], closure: WrittenClosure, floor: number,
) {
  const { key } = closure;
  const home = observations[closure.dominant].key;
  let start = closure.dominant;
  while (start > floor && dominantSupports(observations[start - 1], key) &&
    !homeTonicMode(observations[start - 1])) start--;
  if (start > floor) {
    const prep = observations[start - 1];
    const leading = leadingTonePitchClass(key);
    if (prep.soundingPitchClasses.length === 4 && fits(prep, chordToneSpellings(leading, "diminished7")) &&
        resolvesTone(prep, observations[start], leading, key.tonic, 1)) start--;
  }
  const dom = scaleDegreePitchClass(key, 5);
  const augmented = contains(observations[closure.dominant].soundingPitchClasses, chordToneSpellings(dom, "augmented")[2]);
  const lead = leadingTonePitchClass(key);
  const fifth = chordToneSpellings(dom, "major")[2];
  const limit = observations[closure.dominant].fromTick - (observations[closure.dominant].measureDurationTicks ?? 0);
  // A moving inversion on a dominant pedal can obscure the leading tone
  // without starting a new harmonic event.
  let cursor = start - 1;
  while (cursor >= floor && observations[cursor].fromTick >= limit) {
    const frame = observations[cursor];
    const pitches = frame.soundingPitchClasses;
    if (homeTonicMode(frame) || !contains(pitches, dom) ||
        (!contains(pitches, lead) && !contains(pitches, fifth))) break;
    const literal = readSoundingTertianIdentity(writtenFrame(frame));
    if (literal && !pitchClassEquals(literal.root, dom)) break;
    if (contains(pitches, lead)) start = cursor;
    cursor--;
  }
  if (start > floor && distinctivePredominant(observations[start - 1], key)) start--;
  if (start > floor && augmented) {
    const prep = observations[start - 1];
    if (dominantSupports(prep, { tonic: scaleDegreePitchClass(key, 5), mode: "major" })) start--;
  }
  return start;
}

function distinctivePredominant(item: ChordInferenceObservation, key: KeyReference) {
  const tones = chordToneSpellings(scaleDegreePitchClass(key, 2), "halfDiminished7");
  return item.soundingPitchClasses.length === 4 && fits(item, tones) &&
    tones.some(tone => !contains(scale(item.key), tone));
}

function supportedContinuation(
  observations: readonly ChordInferenceObservation[], left: WrittenClosure, right: WrittenClosure, ppq: number,
) {
  if (right.dominant <= left.end || right.tonic === left.tonic ||
      observations[right.tonic].fromTick - observations[left.dominant].fromTick > 16 * ppq) return false;
  const home = observations[left.tonic].key;
  let preparation = false, homeDominant = false, unfamiliar = 0, pending = 0;
  for (let j = left.end + 1; j < right.dominant; j++) {
    const item = observations[j];
    if (!item.soundingPitchClasses.length || (homeTonicMode(item) === home.mode &&
        j > 0 && dominantSupports(observations[j - 1], home))) return false;
    homeDominant ||= dominantSupports(item, home) && !fits(item, scale(left.key));
    if (isCompatible(item, left.key)) {
      const supertonic = scaleDegreePitchClass(left.key, 2);
      const subdominant = scaleDegreePitchClass(left.key, 4);
      preparation ||= item.soundingPitchClasses.length >= 3 &&
        (fits(item, chordToneSpellings(supertonic, "minor7")) || fits(item, chordToneSpellings(subdominant, "major")) ||
          fits(item, chordToneSpellings(subdominant, "minor")));
      pending = 0;
    } else {
      const ticks = item.toTick - item.fromTick;
      unfamiliar += ticks;
      pending += ticks;
      if (pending > (item.measureBeatTicks ?? ppq) || unfamiliar > 2 * ppq) return false;
    }
  }
  const between = observations[right.dominant].fromTick - observations[left.tonic].fromTick;
  return (left.strongDominant || right.strongDominant) &&
    (left.rootArrival || right.rootArrival) &&
    (preparation || !homeDominant && between >= 2 * ppq || left.strongDominant && right.strongDominant && !homeDominant);

}

function confirmRepeatedCadences(
  observations: readonly ChordInferenceObservation[], closures: readonly WrittenClosure[],
  windows: Map<number, LocalKeyContext>, ppq: number,
) {
  for (const [i, left] of closures.entries()) {
    if (!contains(scale(observations[left.tonic].key), left.key.tonic)) continue;
    // Nested close relatives may share most chords. Compare destinations by
    // their spelled tonic and require two independent arrivals in this key.
    const start = distinctiveDominantStart(observations, left, 0);
    if (!left.strongDominant && !distinctivePredominant(observations[start], left.key)) continue;
    const established = windows.get(left.tonic);
    if (established && !keyEquals(established.key, left.key)) continue;
    const contested = (end: number) => observations.slice(start, end + 1).some(item => {
      const context = windows.get(item.index);
      return context && context.tonicIndex <= end && !keyEquals(context.key, left.key);
    });
    const inverted = !hasBass(observations[left.tonic], left.key.tonic);
    let right: WrittenClosure | undefined;
    for (let j = i + 1; j < closures.length; j++) {
      const other = closures[j];
      const distance = observations[other.tonic].fromTick - observations[left.dominant].fromTick;
      if (distance > 16 * ppq) break;
      // A nearby V2-I6 can be a passing prolongation rather than a second tonic.
      const needsLongerWindow = inverted && (!hasBass(observations[other.tonic], other.key.tonic) ||
        hasBass(observations[left.dominant], scaleDegreePitchClass(left.key, 4)));
      if (needsLongerWindow && distance < (observations[left.dominant].measureDurationTicks ?? 4 * ppq)) continue;
      if (keyEquals(left.key, other.key) && !contested(other.end) &&
          supportedContinuation(observations, left, other, ppq)) right = other;
    }
    if (!right) continue;
    const context: LocalKeyContext = {
      key: left.key, dominantIndex: left.dominant, tonicIndex: left.tonic, evidence: "repeated-cadence",
    };
    let end = right.end;
    while (observations[end + 1] && tonicSupports(observations[end + 1], left.key) && !contested(end + 1)) end++;
    for (let j = start; j <= end; j++) {
      const prior = windows.get(j);
      if (!prior || (!keyEquals(prior.key, left.key) && prior.tonicIndex > end))
        windows.set(j, context);
    }
  }
}

/** A brief chromatic interlude need not erase an independently established
 * center. Require its written dominant to reappear and reach a root tonic. */
function confirmReentries(
  observations: readonly ChordInferenceObservation[], closures: readonly WrittenClosure[],
  windows: Map<number, LocalKeyContext>, ppq: number,
) {
  for (const closure of closures) {
    if (!closure.strongDominant || !closure.rootArrival ||
        keyEquals(windows.get(closure.tonic)?.key ?? observations[closure.tonic].key, closure.key)) continue;
    const start = distinctiveDominantStart(observations, closure, 0);
    if (start === closure.dominant || !contains(observations[start].soundingPitchClasses, leadingTonePitchClass(closure.key)))
      continue;
    let established = false;
    for (let j = start - 1; j >= 0 && observations[start].fromTick - observations[j].fromTick <= 4 * ppq; j--) {
      if (!observations[j].soundingPitchClasses.length) break;
      const previous = windows.get(j);
      if (previous?.evidence === "repeated-cadence" && keyEquals(previous.key, closure.key)) {
        established = true;
        break;
      }
    }
    if (!established) continue;
    const context: LocalKeyContext = {
      key: closure.key, dominantIndex: closure.dominant, tonicIndex: closure.tonic, evidence: "repeated-cadence",
    };
    for (let j = start; j <= closure.end; j++) windows.set(j, context);
  }
}

function recoverCadentialLeadIns(
  observations: readonly ChordInferenceObservation[], windows: Map<number, LocalKeyContext>, ppq: number,
) {
  const frames = observations.map(item => {
    const frame = writtenFrame(item), literal = readSoundingTertianIdentity(frame, true);
    return { ...frame, identities: literal ? [literal] : [] };
  });
  const read = createWrittenOrnamentReader(frames, [], ppq);
  for (let i = 1; i + 2 < frames.length; i++) {
    const proof = windows.get(i + 1);
    if (!proof || proof.evidence !== "structural-cadence" || proof.dominantIndex !== i + 2 || windows.has(i)) continue;
    const [entry, settled, dominant] = observations.slice(i, i + 3);
    const identity = frames[i + 1].identities[0], bass = settled.bass?.pitch;
    if (!identity || !bass || !pitchClassEquals(identity.root, proof.key.tonic) ||
        identity.structure.kind !== "tertian" || identity.structure.quality !== proof.key.mode ||
        !pitchClassEquals(bass, scaleDegreePitchClass(proof.key, 5)) ||
        !hasBass(entry, bass) || !hasBass(dominant, bass) || entry.attackVoiceIds.length !== 3 ||
        settled.attackVoiceIds.length !== 1 || settled.fromTick - entry.fromTick > (entry.measureBeatTicks ?? ppq)) continue;
    const voice = settled.attackVoiceIds[0];
    if (entry.attackVoiceIds.includes(voice) || voice === "bass" ||
        observationNotes(entry).some(part => part.voiceId !== voice && settled.activeNotes[part.voiceId]?.id !== part.note.id))
      continue;
    const motion = read(i, voice, identity);
    if (motion?.role !== "suspension" || motion.arrival.tick !== settled.fromTick) continue;
    const note = entry.activeNotes[voice];
    if (note) windows.set(i, {
      ...proof, cadentialLeadIn: { onsetIndex: i, settledIndex: i + 1, noteId: note.id },
    });
  }
}

function inferKeySection(
  observations: readonly ChordInferenceObservation[], phraseEnds: ReadonlySet<number>, ppq: number,
) {
  const literal = readCadentialWindows(observations, phraseEnds);
  const reviewed = reviewStructuralFrames(observations, ppq);
  const translated = new Map<LocalKeyContext, LocalKeyContext>();
  for (const [index, proof] of readCadentialWindows(reviewed, phraseEnds)) {
    if (literal.has(index)) continue;
    // A competing literal close takes priority over a projected reading.
    if (literal.has(proof.tonicIndex) && !keyEquals(literal.get(proof.tonicIndex)!.key, proof.key)) continue;
    // Do not pull common preparations into a destination solely because
    // an ornament was restored at its later cadence.
    if (index < proof.dominantIndex && !(fits(reviewed[index], chordToneSpellings(proof.key.tonic, proof.key.mode)) &&
      contains(reviewed[index].soundingPitchClasses, scaleDegreePitchClass(proof.key, 3)))) continue;
    if (!translated.has(proof)) translated.set(proof, { ...proof, evidence: proof.evidence ?? "structural-cadence" });
    literal.set(index, translated.get(proof)!);
  }
  const closures = writtenClosures(reviewed);
  confirmRepeatedCadences(reviewed, closures, literal, ppq);
  confirmReentries(reviewed, closures, literal, ppq);
  if ([...literal.values()].some(proof => proof.evidence === "structural-cadence"))
    recoverCadentialLeadIns(observations, literal, ppq);
  return literal;
}

/** Track established destination keys within independent written sections.
 * Isolated applied dominants and enharmonic pivots are left to their own
 * functional candidate passes; they do not by themselves move the center. */
export function inferLocalKeys(
  observations: readonly ChordInferenceObservation[],
  phraseEnds: ReadonlySet<number>,
  manualPhraseTicks: readonly number[] = [],
  ppq = 480,
) {
  const windows = new Map<number, LocalKeyContext>();
  const cutInside = (from: number, to: number) => manualPhraseTicks.some(tick => from < tick && tick < to);
  for (let start = 0; start < observations.length;) {
    if (cutInside(observations[start].fromTick, observations[start].toTick)) { start++; continue; }
    let end = start + 1;
    while (end < observations.length && observations[end].key === observations[start].key &&
      !manualPhraseTicks.some(tick => observations[end - 1].fromTick < tick && tick < observations[end].toTick) &&
      observations[end - 1].toTick === observations[end].fromTick) end++;
    const section = observations.slice(start, end).map((item, index) => ({ ...item, index }));
    const translated = new Map<LocalKeyContext, LocalKeyContext>();
    for (const [index, proof] of inferKeySection(section, phraseEnds, ppq)) {
      let context = translated.get(proof);
      if (!context) {
        context = { ...proof, dominantIndex: proof.dominantIndex + start, tonicIndex: proof.tonicIndex + start,
          ...(proof.cadentialLeadIn && { cadentialLeadIn: {
            ...proof.cadentialLeadIn,
            onsetIndex: proof.cadentialLeadIn.onsetIndex + start, settledIndex: proof.cadentialLeadIn.settledIndex + start,
          } }),
        };
        translated.set(proof, context);
      }
      windows.set(observations[start + index].index, context);
    }
    start = end;
  }
  return windows;
}
