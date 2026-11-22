import { canonicalJson } from "../../canonicalJson";
import { type HarmonyInterpretation, type KeyReference, chordToneSpellings } from "../../chordModel";
import {
  keyEquals,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  writtenInterval,
  type SpelledPitchClass,
} from "../../pitch";
import { VOICE_ORDER, type VoiceId } from "../../project";
import type { AnalysisNote } from "../analysis";

/** Compare the stated function, independently of the annotation's id, source and confidence.
 * A caller that inherits the score key supplies its effective keys explicitly. */
export function sameFunctionalReading(
  left: HarmonyInterpretation,
  right: HarmonyInterpretation,
  leftKey: KeyReference | undefined = left.localKey,
  rightKey: KeyReference | undefined = right.localKey,
) {
  if (leftKey && rightKey) {
    if (!keyEquals(leftKey, rightKey)) return false;
  } else if (leftKey !== rightKey) {
    return false;
  }
  return left.degree === right.degree && left.degreeAlteration === right.degreeAlteration &&
    canonicalJson(left.appliedTarget) === canonicalJson(right.appliedTarget) &&
    canonicalJson(left.designation) === canonicalJson(right.designation);
}

interface Voicing {
  readonly fromTick: number;
  readonly toTick: number;
  readonly activeNotes: Readonly<Partial<Record<VoiceId, AnalysisNote>>>;
}

export function hasExactWrittenStack({ activeNotes }: Voicing, tones: readonly SpelledPitchClass[]) {
  const bass = activeNotes.bass;
  if (!bass) return false;
  const bassMidi = toMidi(bass.pitch);
  return VOICE_ORDER.every(voice => {
    const note = activeNotes[voice];
    return note && !note.nonChordToneRole && toMidi(note.pitch) >= bassMidi &&
      tones.some(tone => pitchClassEquals(note.pitch, tone));
  }) && tones.every(tone => VOICE_ORDER.some(voice => {
    const note = activeNotes[voice];
    return note && pitchClassEquals(note.pitch, tone);
  }));
}

export function diatonicMinorTarget(key: KeyReference, tonic: SpelledPitchClass) {
  const degrees = [2, 3, 4, 6, 7] as const;
  const target = degrees.find(degree => pitchClassEquals(scaleDegreePitchClass(key, degree), tonic));
  const scale = [1, 2, 3, 4, 5, 6, 7].map(degree => scaleDegreePitchClass(key, degree));
  return target && chordToneSpellings(tonic, "minor").every(tone =>
    scale.some(pitch => pitchClassEquals(pitch, tone)),
  ) ? target : undefined;
}

function movesInVoice(
  source: Voicing, arrival: Voicing, voice: VoiceId, destination: SpelledPitchClass, direction: 1 | -1,
) {
  const before = source.activeNotes[voice];
  const after = arrival.activeNotes[voice];
  if (!before || !after || after.startTick !== arrival.fromTick || !pitchClassEquals(after.pitch, destination))
    return false;
  const interval = writtenInterval(before.pitch, after.pitch);
  return interval.diatonicSteps === direction &&
    (direction === 1 ? interval.semitones === 1 : interval.semitones === -1 || interval.semitones === -2);
}

/** Spasobin §§20.2, 20.6, 32.6. Proves the voicings and resolutions only; the caller must establish the target key. */
export function proveLocalMinorDeceptiveDominant(source: Voicing, arrival: Voicing) {
  const sourceBass = source.activeNotes.bass?.pitch;
  const arrivalBass = arrival.activeNotes.bass?.pitch;
  if (!sourceBass || !arrivalBass || source.toTick !== arrival.fromTick) return undefined;

  const [sixth, tonic, minorThird] = chordToneSpellings(arrivalBass, "major");
  const key: KeyReference = { tonic, mode: "minor" };
  const dominant = scaleDegreePitchClass(key, 5);
  const dominantTones = chordToneSpellings(dominant, "dominant7");
  if (!pitchClassEquals(sourceBass, dominant) ||
      !hasExactWrittenStack(source, dominantTones) ||
      !hasExactWrittenStack(arrival, [sixth, tonic, minorThird]) ||
      !movesInVoice(source, arrival, "bass", sixth, 1)) return undefined;

  const leadingVoice = VOICE_ORDER.find(voice => pitchClassEquals(source.activeNotes[voice]!.pitch, dominantTones[1]));
  const fifthVoice = VOICE_ORDER.find(voice => pitchClassEquals(source.activeNotes[voice]!.pitch, dominantTones[2]));
  const seventhVoice = VOICE_ORDER.find(voice => pitchClassEquals(source.activeNotes[voice]!.pitch, dominantTones[3]));
  const tonicCopies = VOICE_ORDER.filter(voice => pitchClassEquals(arrival.activeNotes[voice]!.pitch, tonic)).length;
  if (!leadingVoice || !fifthVoice || !seventhVoice || tonicCopies !== 2 ||
      !movesInVoice(source, arrival, leadingVoice, tonic, 1) ||
      !movesInVoice(source, arrival, fifthVoice, tonic, -1) ||
      !movesInVoice(source, arrival, seventhVoice, minorThird, -1)) return undefined;

  return { key, dominant, sixth };
}
