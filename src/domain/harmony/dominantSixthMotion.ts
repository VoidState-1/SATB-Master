import { chordToneSpellings, primaryHarmonyInterpretation, type ChordIdentity, type HarmonySemantics } from "../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval, type KeyLike, type SpelledPitch, type SpelledPitchClass } from "../pitch";
import type { VoiceId } from "../project/types";
import type { AnalysisNote } from "./analysis";
import { VOICE_ORDER } from "../project/voice";

export const dominantSixthInnerVoices = ["alto", "tenor"] as const;
export const dominantSixthLowerVoices = ["alto", "tenor", "bass"] as const;

type Voicing = Readonly<Partial<Record<VoiceId, AnalysisNote>>>;

export function continuesWrittenDominantSeventh(previous: Voicing, source: Voicing, root: SpelledPitchClass) {
  const { soprano, alto, tenor, bass } = previous;
  if (!soprano || !alto || !tenor || !bass || bass.id !== source.bass?.id ||
      [soprano, alto, tenor, bass].some(note => note.nonChordToneRole) ||
      !pitchClassEquals(bass.pitch, root)) return false;
  const [, third, fifth, seventh] = chordToneSpellings(root, "dominant7");
  return (pitchClassEquals(soprano.pitch, root) || pitchClassEquals(soprano.pitch, fifth)) &&
    ((pitchClassEquals(alto.pitch, third) && pitchClassEquals(tenor.pitch, seventh)) ||
     (pitchClassEquals(alto.pitch, seventh) && pitchClassEquals(tenor.pitch, third))) &&
    Boolean(source.alto && source.tenor &&
      spelledPitchEquals(alto.pitch, source.alto.pitch) && spelledPitchEquals(tenor.pitch, source.tenor.pitch));
}

export function movesToWrittenTone(
  from: SpelledPitch,
  to: SpelledPitch,
  target: SpelledPitchClass,
  diatonicSteps: number,
  semitones?: number,
) {
  if (!pitchClassEquals(to, target)) return false;
  const motion = writtenInterval(from, to);
  return motion.diatonicSteps === diatonicSteps && (semitones === undefined || motion.semitones === semitones);
}

export function resolvesDominantInnerVoice(
  from: SpelledPitch | undefined,
  to: SpelledPitch | undefined,
  leadingTone: SpelledPitchClass,
  seventh: SpelledPitchClass,
  tonic: SpelledPitchClass,
  third: SpelledPitchClass,
  tonicFifth?: SpelledPitchClass,
) {
  if (!from || !to) return false;
  if (pitchClassEquals(from, leadingTone)) {
    return movesToWrittenTone(from, to, tonic, 1, 1) ||
      leadingToneDescendsToTonicFifth(from, to, leadingTone, tonicFifth);
  }
  return pitchClassEquals(from, seventh) && movesToWrittenTone(from, to, third, -1);
}

export function leadingToneDescendsToTonicFifth(
  from: SpelledPitch | undefined,
  to: SpelledPitch | undefined,
  leadingTone: SpelledPitchClass,
  tonicFifth: SpelledPitchClass | undefined,
) {
  return Boolean(from && to && tonicFifth && pitchClassEquals(from, leadingTone) &&
    movesToWrittenTone(from, to, tonicFifth, -2, -4));
}

type ContextualDominant = { identity: ChordIdentity; semantics?: HarmonySemantics };

export function contextualMinorDominantTonic(chord: ContextualDominant, key: KeyLike) {
  const { identity, semantics } = chord;
  const { root, bass, structure } = identity;
  if (structure.kind !== "tertian" || structure.quality !== "dominant7" || structure.extensions.length ||
      structure.alterations.length || !pitchClassEquals(root, bass) || !semantics ||
      semantics.interpretations.length !== 1 || semantics.alternatives?.length || semantics.cadenceRole ||
      semantics.mixture || semantics.pedalContext) return;
  const meaning = primaryHarmonyInterpretation(semantics);
  if (meaning.degree !== 5 || meaning.degreeAlteration !== 0 ||
      meaning.confidence === "ambiguous" || meaning.confidence === "unknown") return;
  const target = meaning.appliedTarget;
  const local = meaning.localKey;
  // Retain the anchor's interpretation. A brief applied V7/vi does not establish a local cadence.
  const applied = key.mode === "major" && target?.degree === 6 && !local &&
    meaning.designation?.kind === "applied-dominant";
  const tonic = applied ? scaleDegreePitchClass(key, 6)
    : !target && local?.mode === "minor" && meaning.designation?.kind === "primary" &&
      meaning.designation.primaryFunction === "dominant" ? local.tonic : undefined;
  if (!tonic || !pitchClassEquals(root, scaleDegreePitchClass({ tonic, mode: "minor" }, 5))) return;
  return { tonic, applied };
}

type WrittenFrame = { tick: number; notes: Voicing };

function orderedActualVoicing({ notes }: WrittenFrame) {
  const { bass, soprano } = notes;
  return bass && soprano && VOICE_ORDER.every(voice => {
    const note = notes[voice];
    return note && !note.nonChordToneRole &&
      toMidi(note.pitch) >= toMidi(bass.pitch) && toMidi(note.pitch) <= toMidi(soprano.pitch);
  });
}

/** A new minor-key dominant bass, soprano 6–5, and the same written inner
 * leading tone and seventh through the complete V7 (Spasobin §24.7). */
export function contextualMinorSixthResolvesToFifth(
  onset: WrittenFrame,
  fifth: WrittenFrame,
  landing: WrittenFrame,
  tonic: SpelledPitchClass,
  applied: boolean,
) {
  if (![onset, fifth, landing].every(orderedActualVoicing)) return false;
  const { soprano, bass } = onset.notes;
  const resolved = fifth.notes.soprano!, finalSoprano = landing.notes.soprano!;
  const finalBass = landing.notes.bass!;
  const key = { tonic, mode: "minor" } as const;
  const [root, leading, chordFifth, seventh] = chordToneSpellings(scaleDegreePitchClass(key, 5), "dominant7");
  const third = scaleDegreePitchClass(key, 3);
  if (!bass || !soprano || bass.startTick !== onset.tick || soprano.startTick !== onset.tick ||
      soprano.startTick + soprano.durationTicks !== fifth.tick || resolved.startTick !== fifth.tick ||
      resolved.startTick + resolved.durationTicks !== landing.tick ||
      !pitchClassEquals(bass.pitch, root) || !pitchClassEquals(soprano.pitch, third) ||
      !movesToWrittenTone(soprano.pitch, resolved.pitch, chordFifth, -1, -1) ||
      !dominantSixthLowerVoices.every(voice => onset.notes[voice]!.id === fifth.notes[voice]!.id) ||
      !VOICE_ORDER.every(voice => landing.notes[voice]!.startTick === landing.tick) ||
      !movesToWrittenTone(resolved.pitch, finalSoprano.pitch, tonic, -1, -2)) return false;

  const tones = chordToneSpellings(applied ? scaleDegreePitchClass(key, 6) : tonic, applied ? "major" : "minor");
  const pitches = VOICE_ORDER.map(voice => landing.notes[voice]!.pitch);
  if (!pitchClassEquals(finalBass.pitch, tones[0]) ||
      !pitches.every(note => tones.some(tone => pitchClassEquals(note, tone)))) return false;
  const bassMotion = writtenInterval(bass.pitch, finalBass.pitch);
  if (applied
    ? bassMotion.diatonicSteps !== 1 || bassMotion.semitones !== 1 ||
      pitches.filter(note => pitchClassEquals(note, tones[1])).length !== 2 ||
      !tones.every(tone => pitches.some(note => pitchClassEquals(note, tone)))
    : !((bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7) ||
        (bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5)) ||
      !pitches.some(note => pitchClassEquals(note, tones[2])) &&
        pitches.filter(note => pitchClassEquals(note, tonic)).length !== 3) return false;

  return dominantSixthInnerVoices.some(leadingVoice => {
    const seventhVoice = leadingVoice === "alto" ? "tenor" : "alto";
    const lead = onset.notes[leadingVoice]!.pitch, seventhNote = onset.notes[seventhVoice]!.pitch;
    return pitchClassEquals(lead, leading) && pitchClassEquals(seventhNote, seventh) &&
      movesToWrittenTone(lead, landing.notes[leadingVoice]!.pitch, tonic, 1, 1) &&
      movesToWrittenTone(seventhNote, landing.notes[seventhVoice]!.pitch, third, -1, -2);
  });
}
