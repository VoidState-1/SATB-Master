import {
  normalizePitchClassNumber, pitchClassEquals, pitchClassValue, stepIndex,
  type SpelledPitchClass,
} from "../pitch";

/** Recognize a complete written triad or seventh, including readings
 * outside the local functional catalogue. */
export function hasCompleteWrittenTertianVoicing(pitches: readonly SpelledPitchClass[]) {
  const bySound = new Map<number, SpelledPitchClass>();
  for (const pitch of pitches) {
    const sound = pitchClassValue(pitch);
    const previous = bySound.get(sound);
    if (previous && !pitchClassEquals(previous, pitch)) return false;
    bySound.set(sound, pitch);
  }
  const distinct = [...bySound.values()];
  if (distinct.length !== 3 && distinct.length !== 4) return false;

  return distinct.some(root => {
    let current = root;
    for (let degree = 1; degree < distinct.length; degree++) {
      const nextStep = (stepIndex(current.step) + 2) % 7;
      const next = distinct.find(pitch => stepIndex(pitch.step) === nextStep);
      if (!next) return false;
      const third = normalizePitchClassNumber(pitchClassValue(next) - pitchClassValue(current));
      if (third !== 3 && third !== 4) return false;
      current = next;
    }
    return true;
  });
}
