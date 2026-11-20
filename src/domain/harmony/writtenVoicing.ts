import { chordIdentityToneSpellings, type ChordIdentity } from "../chordModel";
import { pitchClassEquals, toMidi, type SpelledPitchClass } from "../pitch";
import type { AnalysisNote, AnalysisSlice } from "./analysis";

/** Check the actual bass register, every sounding note and every required spelling. */
export function soundsCompleteWrittenTones(
  tones: readonly SpelledPitchClass[], notes: readonly AnalysisNote[], bass: AnalysisNote, passingNoteId?: string,
) {
  const lowest = toMidi(bass.pitch);
  return notes.every(note => (!note.nonChordToneRole || (note.id === passingNoteId && note.nonChordToneRole === "passing")) &&
    toMidi(note.pitch) >= lowest && tones.some(tone => pitchClassEquals(tone, note.pitch))) &&
    tones.every(tone => notes.some(note => pitchClassEquals(tone, note.pitch)));
}

export function soundsCompleteWrittenChord(
  identity: ChordIdentity, notes: readonly AnalysisNote[], bass: AnalysisNote, passingNoteId?: string,
) {
  return pitchClassEquals(bass.pitch, identity.bass) &&
    soundsCompleteWrittenTones(chordIdentityToneSpellings(identity), notes, bass, passingNoteId);
}

export function soundsDeclaredChord(slice: AnalysisSlice) {
  return !!slice.chord && slice.completeSatb && !!slice.notes.bass &&
    soundsCompleteWrittenChord(slice.chord.identity, Object.values(slice.notes), slice.notes.bass);
}
