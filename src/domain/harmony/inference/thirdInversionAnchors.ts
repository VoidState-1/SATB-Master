import { chordToneSpellings, type KeyReference } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval, type SpelledPitchClass } from "../../pitch";
import { observationNotes, resolvesTone, soundingBass } from "./observations";
import type { ChordInferenceObservation as Observation } from "./types";

function exact(item: Observation, tones: readonly SpelledPitchClass[], bass: SpelledPitchClass) {
  const lowest = soundingBass(item);
  return !!lowest && pitchClassEquals(lowest, bass) && item.soundingPitchClasses.length === tones.length &&
    observationNotes(item).every(({ note }) => tones.some(t => pitchClassEquals(note.pitch, t)));
}

/** §15.2. Work backwards from the actual seventh in the bass. No key
 * label, including the printed degree of the destination, enters this proof. */
export function writtenThirdInversion(source: Observation, arrival: Observation) {
  const bass = soundingBass(source);
  if (!bass || source.soundingPitchClasses.length !== 4 || arrival.soundingPitchClasses.length !== 3) return;
  const tonic = scaleDegreePitchClass({ tonic: bass, mode: "major" }, 5);
  const dominant = scaleDegreePitchClass({ tonic, mode: "major" }, 5);
  const [root, third, fifth, seventh] = chordToneSpellings(dominant, "dominant7");
  if (!pitchClassEquals(bass, seventh) || !resolvesTone(source, arrival, root, root, 0) ||
      !resolvesTone(source, arrival, third, tonic, 1) || !resolvesTone(source, arrival, fifth, tonic, -1)) return;
  for (const mode of ["major", "minor"] as const) {
    const triad = chordToneSpellings(tonic, mode);
    if (exact(arrival, triad, triad[1]) && resolvesTone(source, arrival, seventh, triad[1], -1))
      return { tonic, mode };
  }
}

function descendingBassStep(left: Observation, right: Observation) {
  const a = left.bass, b = right.bass;
  if (!a || !b || b.startTick !== right.fromTick) return false;
  const motion = writtenInterval(a.pitch, b.pitch);
  return isWrittenStep(motion) && motion.diatonicSteps === -1 && motion.semitones < 0;
}

function rootedDominant(middle: Observation, end: Observation, key: KeyReference) {
  const tonic = chordToneSpellings(key.tonic, key.mode);
  const seventh = middle.soundingPitchClasses.length === 4;
  const tones = chordToneSpellings(scaleDegreePitchClass(key, 5), seventh ? "dominant7" : "major");
  if (!exact(middle, tones, tones[2]) || !exact(end, tonic, tonic[0]) || !descendingBassStep(middle, end) ||
      !resolvesTone(middle, end, tones[0], tones[0], 0) || !resolvesTone(middle, end, tones[1], tonic[0], 1))
    return;
  if (seventh && !resolvesTone(middle, end, tones[3], tonic[1], -1)) return;
  return { tones, seventh };
}

function ascendingStep(left: Observation, right: Observation, from: SpelledPitchClass, to: SpelledPitchClass) {
  return observationNotes(left).some(({ voiceId, note }) => {
    const next = right.activeNotes[voiceId];
    if (!next || next.startTick !== right.fromTick || !pitchClassEquals(note.pitch, from) ||
        !pitchClassEquals(next.pitch, to)) return false;
    const motion = writtenInterval(note.pitch, next.pitch);
    return motion.diatonicSteps === 1 && motion.semitones > 0 && isWrittenStep(motion);
  });
}

/** §13.2–3 and §15.2. A second complete dominant inversion and root-position
 * tonic supply evidence independent of the initial third-inversion chord. */
export function adjacentTonicAnchor(frames: readonly Observation[], i: number, key: KeyReference,
  connected: (first: number, last: number) => boolean,
) {
  const tonic = chordToneSpellings(key.tonic, key.mode);
  const arrival = frames[i + 1];
  const arrivalBass = soundingBass(arrival);
  if (!arrivalBass) return;
  let j = i + 2;
  for (; j < frames.length; j++) {
    const frame = frames[j];
    if (!frame.bass || !spelledPitchEquals(arrivalBass, frame.bass.pitch) || !exact(frame, tonic, tonic[1])) break;
  }
  if (frames[j + 1] && connected(i, j + 1) && descendingBassStep(frames[j - 1], frames[j])) {
    const anchor = rootedDominant(frames[j], frames[j + 1], key);
    if (anchor?.seventh && frames[j + 1].metric?.role === "downbeat")
      return { kind: "root-position-close", dominant: j, tonic: j + 1 };
    if (anchor && !anchor.seventh) {
      const { tones } = anchor;
      const left = frames[j - 1], middle = frames[j], end = frames[j + 1];
      if ((middle.metric?.role === "weak-beat" || middle.metric?.role === "subdivision") &&
          resolvesTone(left, middle, tones[0], tones[0], 0) &&
          resolvesTone(left, middle, tonic[0], tones[1], -1) &&
          ascendingStep(left, middle, tonic[0], tones[2]) && ascendingStep(middle, end, tones[2], tonic[1]))
        return { kind: "passing-six-four", dominant: j, tonic: j + 1 };
    }
  }
  // A new ii6–V2–I6 can continue the same goal after a distinct V43–I.
  if (i >= 3 && connected(i - 3, i + 1) && frames[i - 2].metric?.role === "downbeat") {
    const ii = chordToneSpellings(scaleDegreePitchClass(key, 2), key.mode === "major" ? "minor" : "diminished");
    if (exact(frames[i - 1], ii, ii[1]) && rootedDominant(frames[i - 3], frames[i - 2], key)?.seventh)
      return { kind: "preceding-close-and-ii6", dominant: i - 3, tonic: i - 2 };
  }
}
