import { chordToneSpellings, type KeyReference } from "../../chordModel";
import { leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, type SpelledPitchClass } from "../../pitch";
import type { ChordInferenceObservation } from "./types";
import { harmonicMajorPreparation } from "./appliedSequences";

function contains(tones: readonly SpelledPitchClass[], pitch: SpelledPitchClass) {
  return tones.some(tone => pitchClassEquals(tone, pitch));
}

function fits(observation: ChordInferenceObservation, tones: readonly SpelledPitchClass[]) {
  return observation.completeSatb && Object.values(observation.activeNotes).every(note => contains(tones, note.pitch));
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

/** Find the first independently supported preparation for the closing key.
 * Stop at the home tonic (including a parallel-mode pivot), silence, or an
 * already identified cadence. Common diatonic chords alone do not choose a key. */
function preparationStart(
  observations: readonly ChordInferenceObservation[], landing: number, dominant: number,
  key: KeyReference, existing: ReadonlyMap<number, KeyReference>,
) {
  const tonic = observations[landing];
  const targetScale = scale(key), homeScale = scale(tonic.key);
  const tonicTriad = chordToneSpellings(key.tonic, key.mode);
  const dominantRoot = scaleDegreePitchClass(key, 5);
  const neapolitan = chordToneSpellings(scaleDegreePitchClass(key, 2, -1), "major");
  const leadingSeventh = chordToneSpellings(leadingTonePitchClass(key), "diminished7");
  while (dominant > 0 && observations[dominant - 1].key === tonic.key &&
    dominantSupports(observations[dominant - 1], key)) dominant--;
  const preparationBass = observations[dominant - 1]?.bass;
  let samePreparationBass = !!preparationBass;
  let start: number | undefined;
  for (let j = dominant - 1; j >= 0; j--) {
    const item = observations[j];
    if (!item.completeSatb || item.key !== tonic.key || existing.has(j) ||
        (tonic.metric?.measureNumber ?? 0) - (item.metric?.measureNumber ?? 0) > 4) break;
    samePreparationBass = samePreparationBass && !!preparationBass && hasBass(item, preparationBass.pitch);
    const homeMode = homeTonicMode(item);
    if (homeMode === item.key.mode) break;
    if (homeMode) {
      const prev = observations[j - 1];
      let k = j - 1;
      while (k >= 0 && withinBeat(prev, observations[k]) && !dominantSupports(observations[k], item.key)) k--;
      if (k >= 0 && withinBeat(prev, observations[k])) break;
      continue;
    }
    const cadential64 = j === dominant - 1 && hasBass(item, dominantRoot) &&
      fits(item, tonicTriad) && contains(item.soundingPitchClasses, key.tonic);
    const distinctive = item.soundingPitchClasses.some(p => contains(targetScale, p) && !contains(homeScale, p));
    const chromaticPreparation = samePreparationBass && item.soundingPitchClasses.length >= 3 &&
      (fits(item, neapolitan) && contains(item.soundingPitchClasses, neapolitan[0]) ||
       fits(item, leadingSeventh) && contains(item.soundingPitchClasses, leadingSeventh[0]));
    if (cadential64 || chromaticPreparation || distinctive && fits(item, targetScale) ||
        harmonicMajorPreparation(item, observations[j + 1], key)) start = j;
  }
  return start;
}

/** A written V(7)–I can tonicize a scale degree without a change of key.
 * Require a phrase close and independent preparation in the destination.
 * Keep printed key changes as hard boundaries. */
export function inferLocalKeys(
  observations: readonly ChordInferenceObservation[],
  phraseEnds: ReadonlySet<number>,
) {
  const keys = new Map<number, KeyReference>();
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
    const held = arrival.measureDurationTicks &&
      (arrival.metric?.role === "downbeat" || arrival.metric?.role === "secondary-accent") &&
      observations[end].toTick - arrival.fromTick >= arrival.measureDurationTicks;
    if (!phraseEnds.has(observations[end].toTick) && !rest && !held) continue;

    // A surface note can precede the stable sonority at the same bass. Find
    // a written dominant and tonic within one beat of the actual bass change.
    const dominants = [prev];
    for (let j = i - 2; j >= 0 && withinBeat(prev, observations[j]) &&
         hasBass(observations[j], prev.bass.pitch); j--) dominants.push(observations[j]);
    for (let j = i; j <= end && (j === i || withinBeat(arrival, observations[j])); j++) {
      const cadence = closingKey(observations[j], dominants);
      if (!cadence) continue;
      const start = preparationStart(observations, i, cadence.dominant.index, cadence.key, keys);
      if (start !== undefined) {
        for (let k = start; k <= end; k++) keys.set(k, cadence.key);
        i = end;
      }
      break;
    }
  }
  return keys;
}
