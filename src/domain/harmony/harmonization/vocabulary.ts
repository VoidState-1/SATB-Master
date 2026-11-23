import {
  chordIdentityInversion,
  chordIdentityKeyWithoutBass,
  chordIdentityToneSpellings,
  chordVoicingPolicy,
  primaryHarmonyInterpretation,
  resolveChordIdentity,
  semanticsFromChordDraft,
  type ChordDraft,
  type ChordIdentity,
  type FunctionalFamily,
  type HarmonySemantics,
} from "../../chordModel";
import {
  applyFunctionalDefinition,
  effectiveFunctionalDesignation,
  functionalDefinition,
  type FunctionalBaseId,
} from "../../functionalHarmonyCatalog";
import {
  leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, serializePitchClass,
  stepIndex, toMidi, type KeyLike, type SpelledPitch, type SpelledPitchClass,
} from "../../pitch";
import type { ChordRegion, VoiceId } from "../../project/types";
import { VOICE_CONFIG, VOICE_ORDER } from "../../project/voice";
import type { HarmonizationGivenVoice, HarmonizationRelaxedLevel, HarmonizationStyle } from "./types";

const priority = { "classic-basic": 0, "textbook-standard": 1, "expressive-secondary": 2 };

export interface HarmonizationChord {
  identity: ChordIdentity;
  semantics?: HarmonySemantics;
  signature: string;
  rootSignature: string;
  degree?: number;
  family?: FunctionalFamily;
  inversion: number;
  role?: HarmonySemantics["cadenceRole"];
  tones: SpelledPitchClass[];
  leadingTone: SpelledPitchClass;
  requiredMask: number;
  weight: number;
  applied: boolean;
  locked?: ChordRegion;
}

export interface WrittenNote {
  pitch: SpelledPitch;
  midi: number;
  diatonic: number;
  tone: number;
  leading: boolean;
}

export type VoicedNotes = readonly [WrittenNote, WrittenNote, WrittenNote, WrittenNote];

export interface Voicing {
  notes: VoicedNotes;
  penalty: number;
  present: number;
  perfectMask: number;
  diminishedFifthMask: number;
}

export const VOICE_PAIRS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] as const;

function describeChord(
  identity: ChordIdentity,
  semantics: HarmonySemantics | undefined,
  key: KeyLike,
  weight: number,
): HarmonizationChord {
  const interpretation = semantics && primaryHarmonyInterpretation(semantics);
  const localKey = interpretation?.localKey ?? key;
  const quality = identity.structure.kind === "tertian" ? identity.structure.quality : undefined;
  const functionFamily = semantics && effectiveFunctionalDesignation(semantics, quality)?.primaryFunction;
  const target = interpretation?.appliedTarget?.degree;
  const tendencyKey = target ? { tonic: scaleDegreePitchClass(localKey, target), mode: "major" as const } : localKey;
  const tones = chordIdentityToneSpellings(identity);
  const rootSignature = chordIdentityKeyWithoutBass(identity);
  const role = semantics?.cadenceRole;
  const toneDegrees = [1, 3, 5, 7, 9, 11, 13];
  const voicingPolicy = chordVoicingPolicy(identity);
  return {
    identity, semantics, rootSignature, role, tones, weight,
    signature: [rootSignature, serializePitchClass(identity.bass), role, target].join("|"),
    degree: interpretation?.degree,
    family: functionFamily,
    inversion: chordIdentityInversion(identity),
    leadingTone: leadingTonePitchClass(tendencyKey),
    requiredMask: voicingPolicy.requiredDegrees.reduce((mask, degree) => mask | (1 << toneDegrees.indexOf(degree)), 0),
    applied: target !== undefined,
  };
}

function catalogChord(
  key: KeyLike, base: FunctionalBaseId, inversion: ChordDraft["inversion"], weight: number,
  form: "triad" | "seventh" = "triad", role?: HarmonySemantics["cadenceRole"],
) {
  const draft = applyFunctionalDefinition({
    degree: 1, degreeAlteration: 0, inversion, quality: form === "triad" ? "major" : "dominant7",
    source: "inferred", confidence: "probable",
  }, functionalDefinition(base), key.mode);
  if (role) draft.cadenceRole = role;
  return describeChord(resolveChordIdentity(draft, key), semanticsFromChordDraft(draft), key, weight);
}

export function buildVocabulary(key: KeyLike, style: HarmonizationStyle): HarmonizationChord[] {
  const minor = key.mode === "minor";
  const tonic = minor ? "t" : "T";
  const subdominant = minor ? "s" : "S";
  const chords = [
    catalogChord(key, tonic, 0, 2.3), catalogChord(key, tonic, 1, 1.6),
    catalogChord(key, subdominant, 0, 1.7), catalogChord(key, subdominant, 1, 1.3),
    catalogChord(key, "D", 0, 2), catalogChord(key, "D", 1, 1.3),
    catalogChord(key, "SII", 1, 1.25),
    catalogChord(key, "TSVI", 0, 1.1), catalogChord(key, "DVII", 1, 0.7),
    catalogChord(key, "K46", 2, 1.7),
    catalogChord(key, "D", 2, 0.65, "triad", "passing64"),
    catalogChord(key, subdominant, 2, 0.65, "triad", "pedal64"),
    catalogChord(key, "D", 0, 1.55, "seventh"),
  ];
  if (!minor) chords.push(catalogChord(key, "SII", 0, 1.05));
  if (priority[style] >= 1) {
    chords.push(
      catalogChord(key, minor ? "dtIII" : "DTIII", 1, 0.5),
      catalogChord(key, "D", 1, 1, "seventh"), catalogChord(key, "D", 2, 0.8, "seventh"),
      catalogChord(key, "D", 3, 0.8, "seventh"),
      catalogChord(key, "SII", 0, 0.6, "seventh"), catalogChord(key, "SII", 1, 0.7, "seventh"),
    );
  }
  if (priority[style] >= 2) {
    chords.push(catalogChord(key, "DD", 0, 0.7), catalogChord(key, "DD", 0, 0.4, "seventh"));
    if (minor) chords.push(catalogChord(key, "d", 0, 0.3), catalogChord(key, "dtIII", 0, 0.5));
  }
  return chords;
}

export function lockedVocabulary(region: ChordRegion, key: KeyLike): HarmonizationChord {
  return { ...describeChord(region.identity, region.semantics, key, 1.5), locked: region };
}

export function chromaticVocabulary(pitch: SpelledPitch, key: KeyLike): HarmonizationChord {
  const root = { step: pitch.step, alter: pitch.alter };
  return describeChord({
    root, bass: root, structure: { kind: "tertian", quality: "major", extensions: [], alterations: [] },
  }, undefined, key, -5);
}

function noteFact(pitch: SpelledPitch, chord: HarmonizationChord): WrittenNote {
  return {
    pitch, midi: toMidi(pitch), diatonic: pitch.octave * 7 + stepIndex(pitch.step),
    tone: chord.tones.findIndex(tone => pitchClassEquals(tone, pitch)),
    leading: pitchClassEquals(pitch, chord.leadingTone),
  };
}

function allowedPitches(chord: HarmonizationChord, voice: VoiceId) {
  const { min, max } = VOICE_CONFIG[voice];
  const spelled = voice === "bass" ? [chord.identity.bass] : chord.tones;
  return spelled.flatMap(tone => {
    const octaveZero = toMidi({ ...tone, octave: 0 });
    const first = Math.ceil((min - octaveZero) / 12);
    const last = Math.floor((max - octaveZero) / 12);
    return Array.from({ length: last - first + 1 }, (_, index) => noteFact({ ...tone, octave: first + index }, chord));
  });
}

function makeVoicing(notes: VoicedNotes, penalty: number, present: number): Voicing {
  let perfectMask = 0;
  let diminishedFifthMask = 0;
  VOICE_PAIRS.forEach(([upper, lower], index) => {
    const chromatic = Math.abs(notes[upper].midi - notes[lower].midi) % 12;
    const diatonic = Math.abs(notes[upper].diatonic - notes[lower].diatonic) % 7;
    if (diatonic === 0 && chromatic === 0) perfectMask |= 1 << index;
    if (diatonic === 4 && chromatic === 7) perfectMask |= 1 << (index + 6);
    if (diatonic === 4 && chromatic === 6) diminishedFifthMask |= 1 << index;
  });
  return { notes, penalty, present, perfectMask, diminishedFifthMask };
}

/** Level 2 ranks unavoidable conflicts while keeping the input pitches as written. */
export function enumerateVoicings(
  chord: HarmonizationChord,
  givenVoice: HarmonizationGivenVoice,
  givenPitch: SpelledPitch,
  lockedVoicePitches: Partial<Record<VoiceId, SpelledPitch>>,
  relaxedLevel: HarmonizationRelaxedLevel,
  context: { allowOmittedTonicFifth?: boolean; ornament?: boolean } = {},
): Voicing[] {
  const fixed = { ...lockedVoicePitches, [givenVoice]: givenPitch };
  const givenIndex = givenVoice === "soprano" ? 0 : 3;
  const pools = VOICE_ORDER.map(voice => {
    const pitch = fixed[voice];
    if (!pitch) return allowedPitches(chord, voice);
    const note = noteFact(pitch, chord);
    const { min, max } = VOICE_CONFIG[voice];
    const ornament = voice === givenVoice && context.ornament && note.tone < 0;
    const compatible = (note.tone >= 0 || ornament) &&
      (voice !== "bass" || ornament || pitchClassEquals(pitch, chord.identity.bass));
    return relaxedLevel === 2 || (compatible && note.midi >= min && note.midi <= max) ? [note] : [];
  });
  if (pools.some(pool => pool.length === 0)) return [];

  const result: Voicing[] = [];
  const spacingLimit = relaxedLevel === 0 ? 12 : 16;
  const permitConflict = relaxedLevel === 2;
  const triad = chord.tones.length === 3;
  const required = chord.requiredMask &
    (context.allowOmittedTonicFifth && chord.degree === 1 && chord.inversion === 0 ? ~4 : -1);
  const preferDoubledThird = chord.degree === 2 ||
    (chord.identity.structure.kind === "tertian" && chord.identity.structure.quality === "diminished");
  const doublingMask = chord.inversion === 2 ? 4 : chord.inversion === 0 ? 1 : preferDoubledThird ? 2 : 5;
  const pairPenalty = (gap: number, upper: boolean) =>
    (gap < 0 ? 170 - gap : 0) + (upper && gap > 12 ? (gap - 12) * 2 : 0);
  const validPair = (gap: number, upper: boolean) =>
    permitConflict || (gap >= 0 && (!upper || gap <= spacingLimit));

  for (const bass of pools[3]) {
    for (const tenor of pools[2]) {
      const tenorGap = tenor.midi - bass.midi;
      if (!validPair(tenorGap, false)) continue;
      for (const alto of pools[1]) {
        const altoGap = alto.midi - tenor.midi;
        if (!validPair(altoGap, true)) continue;
        for (const soprano of pools[0]) {
          const sopranoGap = soprano.midi - alto.midi;
          if (!validPair(sopranoGap, true)) continue;
          const notes: VoicedNotes = [soprano, alto, tenor, bass];
          let present = 0;
          let doubled = 0;
          let leadingCount = 0;
          let penalty = pairPenalty(tenorGap, false) + pairPenalty(altoGap, true) + pairPenalty(sopranoGap, true);
          for (let index = 0; index < 4; index++) {
            const note = notes[index];
            if (note.tone >= 0) {
              const bit = 1 << note.tone;
              doubled |= present & bit;
              present |= bit;
            } else if (!context.ornament || index !== givenIndex) {
              penalty += 22;
            }
            if (note.leading) leadingCount++;
            const { min, max } = VOICE_CONFIG[VOICE_ORDER[index]];
            if (note.midi < min || note.midi > max) penalty += 13;
            penalty += Math.abs(note.midi - (min + max) / 2) * 0.065;
          }
          const missing = (present & required) !== required;
          const ornament = context.ornament && notes[givenIndex].tone < 0;
          const wrongBass = !pitchClassEquals(bass.pitch, chord.identity.bass) && !(ornament && givenIndex === 3);
          const tendencyDoubling = leadingCount > 1 || (chord.tones.length === 4 && Boolean(doubled & 8));
          const incompleteTonic = (present & 7) === 3;
          const wrongDoubling = triad && (incompleteTonic ? doubled !== 1 : (doubled & doublingMask) === 0);
          if (!permitConflict && (tendencyDoubling || wrongBass ||
            (missing && !ornament) || (relaxedLevel === 0 && wrongDoubling && !ornament))) continue;
          if (missing && !ornament) penalty += 32;
          if (wrongBass) penalty += 180;
          if (tendencyDoubling) penalty += 180;
          if (wrongDoubling && !ornament) penalty += 3;
          if (!(present & 4) && !ornament) penalty += 1;
          if (tenorGap > 19) penalty += (tenorGap - 19) * 0.18;
          if (altoGap === 0 || sopranoGap === 0) penalty += 0.95;
          result.push(makeVoicing(notes, penalty, present));
        }
      }
    }
  }
  return result;
}
