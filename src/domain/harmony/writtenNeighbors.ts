import { chordIdentityToneSpellings, type ChordIdentity } from "../chordModel";
import { isWrittenStep, pitchClassEquals, spelledPitchEquals, toMidi, writtenInterval } from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import type { AnalysisNote, AnalysisSlice } from "./analysis";
import { hasCompleteWrittenTertianVoicing } from "./writtenTertian";

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

export function soundsCompleteWrittenChord(identity: ChordIdentity, notes: readonly AnalysisNote[], bass: AnalysisNote) {
  const tones = chordIdentityToneSpellings(identity);
  const lowest = toMidi(bass.pitch);
  return pitchClassEquals(bass.pitch, identity.bass) &&
    notes.every(note => !note.nonChordToneRole && toMidi(note.pitch) >= lowest &&
      tones.some(tone => pitchClassEquals(tone, note.pitch))) &&
    tones.every(tone => notes.some(note => pitchClassEquals(tone, note.pitch)));
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
