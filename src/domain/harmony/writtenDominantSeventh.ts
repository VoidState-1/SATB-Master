import { chordToneSpellings } from "../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval } from "../pitch";
import type { VoiceId } from "../project/types";
import { VOICE_ORDER } from "../project/voice";
import type { AnalysisSlice } from "./analysis";
import { movesToWrittenTone } from "./dominantSixthMotion";
import { hasWrittenVoicing, resolvesInVoice } from "./writtenResolution";
import { soundsCompleteWrittenMembers } from "./writtenVoicing";

type WrittenFrame = Pick<AnalysisSlice, "tick" | "notes" | "completeSatb">;
const endOf = (note: { startTick: number; durationTicks: number }) => note.startTick + note.durationTicks;

function hasSoundingBass(frame: WrittenFrame) {
  const bass = frame.notes.bass;
  return !!bass && frame.completeSatb && VOICE_ORDER.every(voice => toMidi(frame.notes[voice]!.pitch) >= toMidi(bass.pitch));
}

function invertedDominantSource(departure: WrittenFrame, onset: WrittenFrame) {
  if (!hasSoundingBass(departure) || !hasSoundingBass(onset) || departure.tick >= onset.tick) return;
  const notes = VOICE_ORDER.map(voice => departure.notes[voice]!);
  if (notes.some(note => note.nonChordToneRole || endOf(note) < onset.tick)) return;
  const chord = readWrittenDominantSeventh(departure.notes);
  if (!chord || chord.inversion === 0) return;
  const [, leading, fifth, seventh] = chordToneSpellings(chord.root, "dominant7");
  const voiceOf = (tone: typeof leading) => VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, tone))!;
  return { ...chord, leadingVoice: voiceOf(leading), fifthVoice: voiceOf(fifth), seventhVoice: voiceOf(seventh) };
}

function reattackResolution(
  departure: WrittenFrame,
  onset: WrittenFrame,
  voice: VoiceId,
  frameAt: (tick: number) => WrittenFrame | undefined,
) {
  const before = departure.notes[voice]!, repeated = onset.notes[voice]!;
  if (endOf(before) !== onset.tick || repeated.startTick !== onset.tick ||
      repeated.id === before.id || !spelledPitchEquals(before.pitch, repeated.pitch) ||
      (repeated.nonChordToneRole && repeated.nonChordToneRole !== "suspension")) return;
  const settled = frameAt(endOf(repeated));
  if (!settled || settled.tick !== endOf(repeated) || !hasSoundingBass(settled)) return;
  const landing = settled.notes[voice]!;
  if (landing.startTick !== settled.tick || VOICE_ORDER.some(voice => settled.notes[voice]!.nonChordToneRole)) return;
  if (VOICE_ORDER.some(other => other !== voice && onset.notes[other]!.id !== settled.notes[other]!.id)) return;
  return { repeated, settled, landing };
}

function retainsDominantRoot(departure: WrittenFrame, onset: WrittenFrame, voice: VoiceId) {
  const before = departure.notes[voice]!, current = onset.notes[voice]!;
  return spelledPitchEquals(before.pitch, current.pitch) &&
    (before.id === current.id || current.startTick === onset.tick && endOf(before) === onset.tick);
}

/** Spasobin §§15.2, 36.2–3, 44.1. Read a complete inverted V7 whose
 * seventh is reattacked over the tonic arrival and resolves one event later.
 * The other voices establish the same tonic throughout the delay. */
export function readReattackedDominantSeventh(
  departure: WrittenFrame,
  onset: WrittenFrame,
  frameAt: (tick: number) => WrittenFrame | undefined,
) {
  const source = invertedDominantSource(departure, onset);
  if (!source) return;
  const { root, target: tonic, leadingVoice, fifthVoice, seventhVoice } = source;
  const delay = reattackResolution(departure, onset, seventhVoice, frameAt);
  if (!delay) return;
  const { repeated, settled, landing } = delay;
  const mode = (["major", "minor"] as const).find(quality =>
    movesToWrittenTone(repeated.pitch, landing.pitch, chordToneSpellings(tonic, quality)[1], -1, quality === "major" ? -1 : -2),
  );
  if (!mode) return;

  const rootVoice = VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, root))!;
  if (!retainsDominantRoot(departure, onset, rootVoice) ||
      !resolvesInVoice(departure, onset, leadingVoice, tonic, 1) ||
      !resolvesInVoice(departure, onset, fifthVoice, tonic, -1) ||
      writtenInterval(departure.notes[fifthVoice]!.pitch, onset.notes[fifthVoice]!.pitch).semitones !== -2) return;

  return { root, key: { tonic, mode }, leadingVoice, seventhVoice, repeated, settledTick: settled.tick };
}

/** A V65 can resolve its leading tone and seventh while the written fifth
 * reattacks as a ninth. Confirm the tonic when that voice reaches the octave. */
export function readReattackedTonicNinth(
  departure: WrittenFrame,
  onset: WrittenFrame,
  frameAt: (tick: number) => WrittenFrame | undefined,
) {
  const source = invertedDominantSource(departure, onset);
  if (source?.inversion !== 1) return;
  const { root, target: tonic, leadingVoice, fifthVoice, seventhVoice } = source;
  const delay = reattackResolution(departure, onset, fifthVoice, frameAt);
  if (!delay) return;
  const { repeated, settled, landing } = delay;
  const bass = onset.notes.bass!;
  const ninth = writtenInterval(bass.pitch, repeated.pitch).diatonicSteps;
  if (ninth < 8 || ninth % 7 !== 1 ||
      !movesToWrittenTone(repeated.pitch, landing.pitch, tonic, -1, -2) ||
      !resolvesInVoice(departure, onset, leadingVoice, tonic, 1) ||
      VOICE_ORDER.some(voice => voice !== fifthVoice && onset.notes[voice]!.nonChordToneRole)) return;

  const rootVoice = VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, root))!;
  if (!retainsDominantRoot(departure, onset, rootVoice)) return;
  const mode = (["major", "minor"] as const).find(quality => {
    const tones = chordToneSpellings(tonic, quality);
    return hasWrittenVoicing(settled, tones) && resolvesInVoice(departure, onset, seventhVoice, tones[1], -1);
  });
  if (!mode) return;

  return { root, key: { tonic, mode }, repeated, settledTick: settled.tick };
}

/** A written dominant seventh can omit its fifth in root position when
 * the root is doubled and the third and seventh both sound. */
export function readWrittenDominantSeventh(voicing: AnalysisSlice["notes"]) {
  const bass = voicing.bass;
  const notes = Object.values(voicing).filter(note => note !== undefined);
  if (!bass || notes.length !== 4) return;

  for (const { pitch: { step, alter } } of notes) {
    const root = { step, alter };
    const tones = chordToneSpellings(root, "dominant7");
    const [, third, , seventh] = tones;
    const inversion = ([0, 1, 2, 3] as const).find(index => pitchClassEquals(tones[index], bass.pitch));
    if (inversion === undefined) continue;
    const complete = soundsCompleteWrittenMembers(tones, notes);
    const omitsOnlyFifth = inversion === 0 &&
      soundsCompleteWrittenMembers([root, third, seventh], notes) &&
      notes.filter(note => pitchClassEquals(note.pitch, root)).length === 2;
    if (complete || omitsOnlyFifth) {
      return { root, inversion, third, seventh, target: scaleDegreePitchClass({ tonic: root, mode: "major" }, 4) };
    }
  }
}
