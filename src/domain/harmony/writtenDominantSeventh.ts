import { chordToneSpellings } from "../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval, type SpelledPitchClass } from "../pitch";
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

function dominantSource(departure: WrittenFrame, onset: WrittenFrame) {
  if (!hasSoundingBass(departure) || !hasSoundingBass(onset) || departure.tick >= onset.tick) return;
  const notes = VOICE_ORDER.map(voice => departure.notes[voice]!);
  if (notes.some(note => note.nonChordToneRole || endOf(note) < onset.tick)) return;
  const chord = readWrittenDominantSeventh(departure.notes);
  if (!chord) return;
  const [, , fifth] = chordToneSpellings(chord.root, "dominant7");
  const voiceOf = (tone: typeof fifth) => VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, tone));
  return {
    ...chord,
    leadingVoice: voiceOf(chord.third)!,
    fifthVoice: voiceOf(fifth),
    seventhVoice: voiceOf(chord.seventh)!,
  };
}

function invertedDominantSource(departure: WrittenFrame, onset: WrittenFrame) {
  const source = dominantSource(departure, onset);
  if (!source || source.inversion === 0 || !source.fifthVoice) return;
  return { ...source, fifthVoice: source.fifthVoice };
}

function settleSingleVoice(onset: WrittenFrame, voice: VoiceId, settled: WrittenFrame | undefined) {
  if (!settled || settled.tick !== endOf(onset.notes[voice]!) || !hasSoundingBass(settled)) return;
  const landing = settled.notes[voice]!;
  if (landing.startTick !== settled.tick || VOICE_ORDER.some(voice => settled.notes[voice]!.nonChordToneRole)) return;
  if (VOICE_ORDER.some(other => other !== voice && onset.notes[other]!.id !== settled.notes[other]!.id)) return;
  return { settled, landing };
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
  const resolution = settleSingleVoice(onset, voice, frameAt(endOf(repeated)));
  return resolution && { repeated, ...resolution };
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
    const omitsOnlyFifth = canOmitDominantFifth(root, bass.pitch, notes.map(note => note.pitch)) &&
      soundsCompleteWrittenMembers([root, third, seventh], notes);
    if (complete || omitsOnlyFifth) {
      return { root, inversion, third, seventh, target: scaleDegreePitchClass({ tonic: root, mode: "major" }, 4) };
    }
  }
}

/** In a four-part root-position V7 the doubled root can replace the fifth.
 * Callers still have to establish the third and the seventh. */
export function canOmitDominantFifth(root: SpelledPitchClass, bass: SpelledPitchClass, pitches: readonly SpelledPitchClass[]) {
  return pitches.length === 4 && pitchClassEquals(root, bass) &&
    pitches.filter(pitch => pitchClassEquals(pitch, root)).length === 2;
}

/** In a sequence of dominant sevenths, the old seventh descends to the third of the next chord.
 * This is independent evidence for the other voice changing from third to seventh. */
export function readDominantSeventhExchange(
  before: WrittenFrame, after: WrittenFrame, inspectedVoice: VoiceId, root: SpelledPitchClass,
) {
  const [, third, , seventh] = chordToneSpellings(root, "dominant7");
  const nextRoot = scaleDegreePitchClass({ tonic: root, mode: "major" }, 4);
  const [, nextThird, , nextSeventh] = chordToneSpellings(nextRoot, "dominant7");
  for (const voice of VOICE_ORDER) {
    const departure = before.notes[voice], arrival = after.notes[voice];
    if (voice !== inspectedVoice && departure && arrival && pitchClassEquals(departure.pitch, seventh) &&
        resolvesInVoice(before, after, voice, nextThird, -1)) {
      return { third, nextRoot, nextSeventh, resolvingSeventh: departure, resolvedThird: arrival };
    }
  }
}

/** The doubled-root V7 can omit its fifth. Confirm its actual root-position
 * destination and the separate third, seventh and retained root lines.
 * A tied leading tone may settle one written frame after the bass. */
export function readResolvedRootSeventhWithoutFifth(
  source: WrittenFrame,
  arrival: WrittenFrame,
  later?: WrittenFrame,
) {
  const chord = dominantSource(source, arrival);
  if (chord?.inversion !== 0 || chord.fifthVoice) return;
  const { root, target, leadingVoice, seventhVoice } = chord;
  const sourceBass = source.notes.bass!, arrivalBass = arrival.notes.bass!;
  const bassMotion = writtenInterval(sourceBass.pitch, arrivalBass.pitch);
  if (!pitchClassEquals(arrivalBass.pitch, target) || endOf(sourceBass) !== arrival.tick || arrivalBass.startTick !== arrival.tick ||
      !((bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5) ||
        (bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7))) return;

  const rootVoice = VOICE_ORDER.find(voice =>
    voice !== "bass" && pitchClassEquals(source.notes[voice]!.pitch, root),
  )!;
  if (!retainsDominantRoot(source, arrival, rootVoice)) return;

  const held = arrival.notes[leadingVoice]?.id === source.notes[leadingVoice]!.id;
  const settled = held ? settleSingleVoice(arrival, leadingVoice, later)?.settled : arrival;
  if (!settled || !resolvesInVoice(source, settled, leadingVoice, target, 1)) return;

  const mode = (["major", "minor"] as const).find(quality => {
    const tones = chordToneSpellings(target, quality);
    return hasWrittenVoicing(settled, tones) && resolvesInVoice(source, arrival, seventhVoice, tones[1], -1);
  });
  if (!mode) return;
  const noteIds = [source, arrival, settled].flatMap(frame =>
    VOICE_ORDER.map(voice => frame.notes[voice]!.id),
  );
  return {
    root, target, mode, settledTick: settled.tick,
    noteIds: [...new Set(noteIds)],
  };
}
