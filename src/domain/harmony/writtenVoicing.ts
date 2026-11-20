import {
  chordIdentityToneSpellings, chordToneSpellings, QUALITY_INTERVALS, type ChordIdentity, type ChordQuality,
} from "../chordModel";
import { pitchClassEquals, toMidi, type SpelledPitchClass } from "../pitch";
import type { AnalysisNote, AnalysisSlice } from "./analysis";

/** Check sounding members and explicit roles independently of register. */
export function soundsCompleteWrittenMembers(
  tones: readonly SpelledPitchClass[], notes: readonly AnalysisNote[], passingNoteId?: string,
) {
  return notes.every(note => (!note.nonChordToneRole || (note.id === passingNoteId && note.nonChordToneRole === "passing")) &&
    tones.some(tone => pitchClassEquals(tone, note.pitch))) &&
    tones.every(tone => notes.some(note => pitchClassEquals(note.pitch, tone)));
}

/** Check the actual bass register, every sounding note and every required spelling. */
export function soundsCompleteWrittenTones(
  tones: readonly SpelledPitchClass[], notes: readonly AnalysisNote[], bass: AnalysisNote, passingNoteId?: string,
) {
  const lowest = toMidi(bass.pitch);
  return notes.every(note => toMidi(note.pitch) >= lowest) &&
    soundsCompleteWrittenMembers(tones, notes, passingNoteId);
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

const writtenQualities = Object.keys(QUALITY_INTERVALS) as ChordQuality[];

/** A bare slice can supply a literal triad or seventh without a functional label. */
export function readCompleteWrittenChord(slice: AnalysisSlice): ChordIdentity | undefined {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass) return;
  if (slice.chord) return soundsDeclaredChord(slice) ? slice.chord.identity : undefined;

  const notes = Object.values(slice.notes);
  for (const { pitch: root } of notes) {
    for (const quality of writtenQualities) {
      if (soundsCompleteWrittenTones(chordToneSpellings(root, quality), notes, bass)) {
        return {
          root: { step: root.step, alter: root.alter },
          bass: { step: bass.pitch.step, alter: bass.pitch.alter },
          structure: { kind: "tertian", quality, extensions: [], alterations: [] },
        };
      }
    }
  }
}
