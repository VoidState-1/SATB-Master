import { chordIdentityInversion, chordIdentityToneSpellings } from "../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { AnalysisSlice } from "../analysis";
import { soundsCompleteWrittenChord } from "../writtenNeighbors";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";

/** Spasobin 8–92. The terminal tonic is a written arrival in several
 * registers. The visible attack and release do not establish a work’s end. */
export function octaveTonicEndingEvidence(
  dominant: CadenceSpanFacts,
  before: AnalysisSlice | undefined,
  arrival: AnalysisSlice,
): CadenceEvidence | undefined {
  const source = before?.chord?.identity;
  const structure = source?.structure;
  if (!before?.completeSatb || !arrival.completeSatb || arrival.chord ||
      before.endTick !== arrival.tick || before.key.id !== arrival.key.id ||
      dominant.key.mode !== arrival.key.mode || !pitchClassEquals(dominant.key.tonic, arrival.key.tonic) ||
      !source || structure?.kind !== "tertian" || structure.quality !== "major" ||
      structure.extensions.length || structure.alterations.length || chordIdentityInversion(source) !== 0 ||
      !pitchClassEquals(source.root, scaleDegreePitchClass(arrival.key, 5))) return;

  const bass = before.notes.bass!;
  const soprano = before.notes.soprano!;
  const sourceNotes = VOICE_ORDER.map(voice => before.notes[voice]!);
  if (!soundsCompleteWrittenChord(source, sourceNotes, bass) ||
      sourceNotes.some(note => toMidi(note.pitch) > toMidi(soprano.pitch))) return;

  const notes = VOICE_ORDER.map(voice => arrival.notes[voice]!);
  const floor = toMidi(arrival.notes.bass!.pitch), ceiling = toMidi(arrival.notes.soprano!.pitch);
  if (new Set(notes.map(note => toMidi(note.pitch))).size < 3 || notes.some(note =>
    note.startTick !== arrival.tick || note.startTick + note.durationTicks !== arrival.endTick ||
    note.nonChordToneRole || !pitchClassEquals(note.pitch, arrival.key.tonic) ||
    toMidi(note.pitch) < floor || toMidi(note.pitch) > ceiling)) return;

  const bassMotion = writtenInterval(bass.pitch, arrival.notes.bass!.pitch);
  if (!((bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5) ||
        (bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7))) return;

  const leading = chordIdentityToneSpellings(source)[1];
  if (!pitchClassEquals(soprano.pitch, leading)) return;
  for (const voice of VOICE_ORDER) {
    const prior = before.notes[voice]!;
    if (!pitchClassEquals(prior.pitch, leading)) continue;
    const motion = writtenInterval(prior.pitch, arrival.notes[voice]!.pitch);
    if (motion.diatonicSteps !== 1 || motion.semitones !== 1) return;
  }
  return {
    code: "octave-tonic-ending",
    value: "原位属三和弦后四部同时落到不同八度的主音，齐奏收束",
    refs: [...sourceNotes.map(note => note.id), ...notes.map(note => note.id)],
  };
}
