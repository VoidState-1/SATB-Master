import { chordToneSpellings } from "../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi } from "../pitch";
import { VOICE_ORDER } from "../project/voice";
import type { AnalysisSlice } from "./analysis";
import { movesToWrittenTone } from "./dominantSixthMotion";

type WrittenFrame = Pick<AnalysisSlice, "tick" | "notes" | "completeSatb">;
const endOf = (note: { startTick: number; durationTicks: number }) => note.startTick + note.durationTicks;

function hasSoundingBass(frame: WrittenFrame) {
  const bass = frame.notes.bass;
  return !!bass && frame.completeSatb && VOICE_ORDER.every(voice => toMidi(frame.notes[voice]!.pitch) >= toMidi(bass.pitch));
}

/** Spasobin §§15.2, 36.2–3, 44.1. Read a complete inverted V7 whose
 * seventh is reattacked over the tonic arrival and resolves one event later.
 * The other voices establish the same tonic throughout the delay. */
export function readReattackedDominantSeventh(
  departure: WrittenFrame,
  onset: WrittenFrame,
  frameAt: (tick: number) => WrittenFrame | undefined,
) {
  if (!hasSoundingBass(departure) || !hasSoundingBass(onset) || departure.tick >= onset.tick) return;
  const notes = VOICE_ORDER.map(voice => departure.notes[voice]!);
  if (notes.some(note => note.nonChordToneRole || endOf(note) < onset.tick)) return;

  const root = notes.map(note => note.pitch).find(candidate =>
    chordToneSpellings(candidate, "dominant7").every(tone => notes.some(note => pitchClassEquals(note.pitch, tone))),
  );
  if (!root || pitchClassEquals(root, departure.notes.bass!.pitch)) return;
  const [, leading, fifth, seventh] = chordToneSpellings(root, "dominant7");
  const tonic = scaleDegreePitchClass({ tonic: root, mode: "major" }, 4);
  const leadingVoice = VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, leading))!;
  const seventhVoice = VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, seventh))!;
  const oldSeventh = departure.notes[seventhVoice]!;
  const repeated = onset.notes[seventhVoice]!;
  if (endOf(oldSeventh) !== onset.tick || repeated.startTick !== onset.tick ||
      repeated.id === oldSeventh.id || !spelledPitchEquals(oldSeventh.pitch, repeated.pitch) ||
      (repeated.nonChordToneRole && repeated.nonChordToneRole !== "suspension")) return;

  const settled = frameAt(endOf(repeated));
  if (!settled || settled.tick !== endOf(repeated) || !hasSoundingBass(settled)) return;
  const landing = settled.notes[seventhVoice]!;
  if (landing.startTick !== settled.tick || VOICE_ORDER.some(voice => settled.notes[voice]!.nonChordToneRole)) return;
  const mode = (["major", "minor"] as const).find(quality =>
    movesToWrittenTone(repeated.pitch, landing.pitch, chordToneSpellings(tonic, quality)[1], -1, quality === "major" ? -1 : -2),
  );
  if (!mode) return;

  for (const voice of VOICE_ORDER) {
    if (voice === seventhVoice) continue;
    const before = departure.notes[voice]!, current = onset.notes[voice]!;
    if (current.id !== settled.notes[voice]!.id) return;
    if (pitchClassEquals(before.pitch, root)) {
      if (!spelledPitchEquals(before.pitch, current.pitch) ||
          (before.id !== current.id && (current.startTick !== onset.tick || endOf(before) !== onset.tick))) return;
    } else {
      if (current.startTick !== onset.tick || endOf(before) !== onset.tick) return;
      const semitones = voice === leadingVoice ? 1 : -2;
      if (!(voice === leadingVoice || pitchClassEquals(before.pitch, fifth)) ||
          !movesToWrittenTone(before.pitch, current.pitch, tonic, voice === leadingVoice ? 1 : -1, semitones)) return;
    }
  }

  return { root, key: { tonic, mode }, leadingVoice, seventhVoice, repeated, settledTick: settled.tick };
}
