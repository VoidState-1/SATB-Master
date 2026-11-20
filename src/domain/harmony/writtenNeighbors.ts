import { chordIdentityToneSpellings, type ChordIdentity } from "../chordModel";
import { isWrittenStep, pitchClassEquals, spelledPitchEquals, toMidi, writtenInterval, type SpelledPitch } from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import type { AnalysisNote, AnalysisSlice } from "./analysis";
import { soundsCompleteWrittenChord } from "./writtenVoicing";
import { hasCompleteWrittenTertianVoicing } from "./writtenTertian";

export { soundsCompleteWrittenChord };

export function returnsByWrittenStep(first: AnalysisNote, middle: AnalysisNote, last: AnalysisNote) {
  if (first.nonChordToneRole || last.nonChordToneRole ||
      (middle.nonChordToneRole && middle.nonChordToneRole !== "neighbor") ||
      !spelledPitchEquals(first.pitch, last.pitch) ||
      first.startTick + first.durationTicks !== middle.startTick ||
      middle.startTick + middle.durationTicks !== last.startTick ||
      middle.durationTicks > Math.min(first.durationTicks, last.durationTicks)) return false;
  const step = writtenInterval(first.pitch, middle.pitch);
  return isWrittenStep(step) && Math.sign(step.semitones) === step.diatonicSteps;
}

function formsThirdOrSixth(lower: SpelledPitch, upper: SpelledPitch) {
  const interval = writtenInterval(lower, upper);
  const steps = interval.diatonicSteps % 7;
  const semitones = interval.semitones % 12;
  return (steps === 2 && (semitones === 3 || semitones === 4)) ||
    (steps === 5 && (semitones === 8 || semitones === 9));
}

/** Once both voices have a written step and return, parallel neighbors require
 * a major or minor third or sixth (possibly compound) at both positions. */
export function supportsPairedNeighborMotion(
  lowerBefore: SpelledPitch, upperBefore: SpelledPitch,
  lowerNeighbor: SpelledPitch, upperNeighbor: SpelledPitch,
) {
  const lowerMotion = writtenInterval(lowerBefore, lowerNeighbor);
  const upperMotion = writtenInterval(upperBefore, upperNeighbor);
  return lowerMotion.diatonicSteps !== upperMotion.diatonicSteps ||
    (formsThirdOrSixth(lowerBefore, upperBefore) && formsThirdOrSixth(lowerNeighbor, upperNeighbor));
}

type NeighborFrame = Pick<AnalysisSlice, "tick" | "notes" | "completeSatb">;

/** Return the upper neighbor notes supported by the same sounding harmony on both sides. */
export function writtenNeighborsOverHeldBass(
  identity: ChordIdentity, before: NeighborFrame, middle: NeighborFrame, after: NeighborFrame,
) {
  if (!before.completeSatb || !middle.completeSatb || !after.completeSatb) return;
  const bass = before.notes.bass!;
  if (!soundsCompleteWrittenChord(identity, VOICE_ORDER.map(voice => before.notes[voice]!), bass)) return;
  const tones = chordIdentityToneSpellings(identity);
  const neighbors: string[] = [];
  for (const voice of VOICE_ORDER) {
    const first = before.notes[voice]!, note = middle.notes[voice]!, last = after.notes[voice]!;
    if (last.nonChordToneRole || !spelledPitchEquals(first.pitch, last.pitch) || toMidi(note.pitch) < toMidi(bass.pitch)) return;
    if (first.id === note.id && note.id === last.id) continue;
    if (voice === "bass" || note.startTick !== middle.tick || last.startTick !== after.tick ||
        tones.some(tone => pitchClassEquals(tone, note.pitch)) || !returnsByWrittenStep(first, note, last)) return;
    neighbors.push(note.id);
  }
  if (!neighbors.length || hasCompleteWrittenTertianVoicing(VOICE_ORDER.map(voice => middle.notes[voice]!.pitch))) return;
  return neighbors;
}
