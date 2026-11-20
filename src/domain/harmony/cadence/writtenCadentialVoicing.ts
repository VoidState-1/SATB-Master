import { chordIdentityToneSpellings, type ChordIdentity } from "../../chordModel";
import { pitchClassEquals, toMidi } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { AnalysisSlice } from "../analysis";
import { soundsCompleteWrittenChord } from "../writtenNeighbors";

export function hasCadentialWrittenVoicing(slice: AnalysisSlice, identity: ChordIdentity, allowOmittedFifth: boolean) {
  if (!slice.completeSatb) return false;
  const notes = VOICE_ORDER.map(voice => slice.notes[voice]!);
  const bass = slice.notes.bass!, soprano = slice.notes.soprano!;
  const floor = toMidi(bass.pitch), ceiling = toMidi(soprano.pitch);
  if (notes.some(note => toMidi(note.pitch) < floor || toMidi(note.pitch) > ceiling)) return false;
  if (soundsCompleteWrittenChord(identity, notes, bass)) return true;
  if (!allowOmittedFifth) return false;
  const [root, third, , seventh] = chordIdentityToneSpellings(identity);
  return pitchClassEquals(bass.pitch, identity.bass) && notes.every(note => !note.nonChordToneRole &&
    [root, third, seventh].some(tone => tone && pitchClassEquals(note.pitch, tone))) &&
    notes.filter(note => pitchClassEquals(note.pitch, root)).length === (seventh ? 2 : 3) &&
    notes.some(note => pitchClassEquals(note.pitch, third)) &&
    (!seventh || notes.some(note => pitchClassEquals(note.pitch, seventh)));
}
