import {
  chordIdentityToneSpellings,
  chordToneSpellings,
  QUALITY_INTERVALS,
  type ChordIdentity,
  type ChordQuality,
} from "../../chordModel";
import {
  pitchClassEquals,
  toMidi,
  type SpelledPitchClass,
  normalizePitchClassNumber,
  pitchClassValue,
  stepIndex,
} from "../../pitch";
import type { AnalysisNote, AnalysisSlice } from "../analysis";

type WrittenVoicingNote = Pick<AnalysisNote, "pitch" | "nonChordToneRole"> & Partial<Pick<AnalysisNote, "id">>;

/** Check sounding members and explicit roles independently of register. */
export function soundsCompleteWrittenMembers(
  tones: readonly SpelledPitchClass[], notes: readonly WrittenVoicingNote[], passingNoteId?: string,
) {
  return notes.every(note => (!note.nonChordToneRole || (passingNoteId !== undefined &&
    note.id === passingNoteId && note.nonChordToneRole === "passing")) &&
    tones.some(tone => pitchClassEquals(tone, note.pitch))) &&
    tones.every(tone => notes.some(note => pitchClassEquals(note.pitch, tone)));
}

/** Check the actual bass register, every sounding note and every required spelling. */
export function soundsCompleteWrittenTones(
  tones: readonly SpelledPitchClass[], notes: readonly WrittenVoicingNote[], bass: Pick<WrittenVoicingNote, "pitch">, passingNoteId?: string,
) {
  const lowest = toMidi(bass.pitch);
  return notes.every(note => toMidi(note.pitch) >= lowest) &&
    soundsCompleteWrittenMembers(tones, notes, passingNoteId);
}

export function soundsCompleteWrittenChord(
  identity: ChordIdentity, notes: readonly WrittenVoicingNote[], bass: Pick<WrittenVoicingNote, "pitch">, passingNoteId?: string,
) {
  return pitchClassEquals(bass.pitch, identity.bass) &&
    soundsCompleteWrittenTones(chordIdentityToneSpellings(identity), notes, bass, passingNoteId);
}

export function soundsDeclaredChord(slice: Pick<AnalysisSlice, "chord" | "completeSatb" | "notes">) {
  return !!slice.chord && slice.completeSatb && !!slice.notes.bass &&
    soundsCompleteWrittenChord(slice.chord.identity, Object.values(slice.notes), slice.notes.bass);
}

const writtenQualities = Object.keys(QUALITY_INTERVALS) as ChordQuality[];

export function readCompleteWrittenChord(slice: AnalysisSlice): ChordIdentity | undefined {
  if (slice.chord) return soundsDeclaredChord(slice) ? slice.chord.identity : undefined;
  return readSoundingTertianIdentity(slice);
}

/** Recover a complete triad or seventh from the written pitches, even if a label disagrees. */
export function readSoundingTertianIdentity(slice: Pick<AnalysisSlice, "completeSatb" | "notes">): ChordIdentity | undefined {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass) return;
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
