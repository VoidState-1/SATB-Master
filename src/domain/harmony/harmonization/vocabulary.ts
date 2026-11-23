import {
  chordIdentityInversion,
  chordIdentityKeyWithoutBass,
  chordIdentityToneSpellings,
  functionalTargetForDegree,
  chordVoicingPolicy,
  primaryHarmonyInterpretation,
  resolveChordIdentity,
  semanticsFromChordDraft,
  type ChordDraft,
  type ChordIdentity,
  type FunctionalFamily,
  type HarmonySemantics,
  type ScaleDegree,
} from "../../chordModel";
import {
  applyFunctionalDefinition,
  applyFunctionalTarget,
  effectiveFunctionalDesignation,
  functionalDefinition,
  type FunctionalBaseId,
} from "../../functionalHarmonyCatalog";
import {
  leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, serializePitchClass,
  spelledPitchEquals, stepIndex, toMidi, type KeyLike, type SpelledPitch, type SpelledPitchClass,
} from "../../pitch";
import type { ChordRegion, VoiceId } from "../../project/types";
import { VOICE_CONFIG, VOICE_ORDER } from "../../project/voice";
import type { HarmonizationGivenVoice, HarmonizationRelaxedLevel, HarmonizationStyle } from "./types";

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
  targetDegree?: ScaleDegree;
  targetRoot: SpelledPitchClass;
  hasLeadingToneObligation: boolean;
  chromaticTones: SpelledPitchClass[];
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
    targetDegree: target,
    targetRoot: tendencyKey.tonic,
    hasLeadingToneObligation: target !== undefined ||
      (functionFamily === "dominant" && (interpretation?.degree === 5 || interpretation?.degree === 7) &&
        quality !== "minor" && quality !== "major7" && !(interpretation?.degree === 7 && quality === "major")),
    chromaticTones: tones.filter(tone => !isDiatonicPitch(key, tone)),
    requiredMask: voicingPolicy.requiredDegrees.reduce((mask, degree) => mask | (1 << toneDegrees.indexOf(degree)), 0),
    applied: target !== undefined,
  };
}

function isDiatonicPitch(key: KeyLike, pitch: SpelledPitchClass) {
  const degree = (stepIndex(pitch.step) - stepIndex(key.tonic.step) + 7) % 7 + 1;
  return pitchClassEquals(scaleDegreePitchClass(key, degree as ScaleDegree), pitch) ||
    (key.mode === "minor" && degree === 7 && pitchClassEquals(leadingTonePitchClass(key), pitch));
}

function catalogChord(
  key: KeyLike, base: FunctionalBaseId, inversion: ChordDraft["inversion"], weight: number,
  form: "triad" | "seventh" = "triad", role?: HarmonySemantics["cadenceRole"],
  target?: ScaleDegree, fullyDiminished = false,
) {
  let draft = applyFunctionalDefinition({
    degree: 1, degreeAlteration: 0, inversion, quality: form === "triad" ? "major" : "dominant7",
    source: "inferred", confidence: "probable",
  }, functionalDefinition(base), key.mode);
  if (role) draft.cadenceRole = role;
  if (target) draft = applyFunctionalTarget(draft, functionalTargetForDegree(target), key.mode);
  if (fullyDiminished) draft.quality = "diminished7";
  return describeChord(resolveChordIdentity(draft, key), semanticsFromChordDraft(draft), key, weight);
}

export function buildVocabulary(
  key: KeyLike, style: HarmonizationStyle, melody: readonly SpelledPitchClass[] = [],
): HarmonizationChord[] {
  const minor = key.mode === "minor";
  const tonic = minor ? "t" : "T";
  const subdominant = minor ? "s" : "S";
  const mediant = minor ? "dtIII" : "DTIII";
  const chords = [
    catalogChord(key, tonic, 0, 2.3), catalogChord(key, tonic, 1, 1.6),
    catalogChord(key, subdominant, 0, 1.7), catalogChord(key, subdominant, 1, 0.9),
    catalogChord(key, "D", 0, 2), catalogChord(key, "D", 1, 0.95),
    catalogChord(key, "SII", 1, 0.45), catalogChord(key, "TSVI", 0, 0.35),
    catalogChord(key, "K46", 2, 1.7), catalogChord(key, "D", 0, 1.55, "seventh"),
  ];
  if (style === "classic-basic") return chords;
  const expressive = style === "expressive-secondary";
  chords.push(
    catalogChord(key, "SII", 0, 1.15), catalogChord(key, "TSVI", 1, 1.05),
    catalogChord(key, mediant, 0, 0.75), catalogChord(key, mediant, 1, 0.7),
    catalogChord(key, "DVII", 0, 0.2), catalogChord(key, "DVII", 1, 0.8),
    catalogChord(key, tonic, 2, 1.2, "triad", "passing64"),
    catalogChord(key, "D", 2, 1.05, "triad", "passing64"),
    catalogChord(key, subdominant, 2, 0.8, "triad", "passing64"),
    catalogChord(key, subdominant, 2, 1.7, "triad", "pedal64"),
    catalogChord(key, tonic, 2, 0.7, "triad", "pedal64"),
  );
  for (const inversion of [0, 1, 2, 3] as const) {
    const inverted = inversion !== 0;
    if (inverted) chords.push(catalogChord(key, "D", inversion, expressive ? 3.3 : 1.35, "seventh"));
    chords.push(
      catalogChord(key, "SII", inversion, expressive ? 1.5 : 1.35, "seventh"),
      catalogChord(key, "DVII", inversion, minor || expressive ? 0.85 : 0.4, "seventh"),
    );
  }
  if (minor) {
    chords.push(catalogChord(key, "d", 0, 0.3), catalogChord(key, "d", 1, 0.2),
      catalogChord(key, "dVII", 0, 0.1), catalogChord(key, "dVII", 1, 0.1));
  }

  const matchesMelody = (chord: HarmonizationChord) =>
    chord.chromaticTones.some(tone => melody.some(pitch => pitchClassEquals(tone, pitch)));
  const secondary: HarmonizationChord[] = [];
  const targets: ScaleDegree[] = minor ? [5, 4, 3, 6] : [5, 2, 6, 4];
  for (const target of targets) {
    const triad = ([0, 1, 2] as const).map(inversion =>
      catalogChord(key, "D", inversion, expressive ? 4.7 : -1.5, "triad",
        inversion === 2 ? "passing64" : undefined, target));
    const sevenths = ([0, 1, 2, 3] as const).map(inversion =>
      catalogChord(key, "D", inversion, expressive ? 5.3 : -1.5, "seventh", undefined, target));
    if (expressive || matchesMelody(sevenths[0])) secondary.push(...triad, ...sevenths);
  }
  if (!minor) for (const target of [5, undefined] as const) {
    const diminished = ([0, 1, 2, 3] as const).map(inversion =>
      catalogChord(key, "DVII", inversion, expressive ? 3.6 : -1.5, "seventh", undefined, target, true));
    if (expressive || matchesMelody(diminished[0])) secondary.push(...diminished);
  }
  return chords.concat(secondary);
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
  context: { allowOmittedTonicFifth?: boolean } = {},
): Voicing[] {
  const fixed = { ...lockedVoicePitches, [givenVoice]: givenPitch };
  const pools = VOICE_ORDER.map(voice => {
    const pitch = fixed[voice];
    if (!pitch) return allowedPitches(chord, voice);
    const note = noteFact(pitch, chord);
    const { min, max } = VOICE_CONFIG[voice];
    const compatible = note.tone >= 0 &&
      (voice !== "bass" || pitchClassEquals(pitch, chord.identity.bass));
    // The fixed outer voice can use a slightly wider range without moving the written melody.
    const rangeAllowance = relaxedLevel === 1 && voice === givenVoice ? 3 : 0;
    return ((relaxedLevel === 2 && (!chord.applied || chord.locked)) ||
      (compatible && note.midi >= min - rangeAllowance && note.midi <= max + rangeAllowance)) ? [note] : [];
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
            } else {
              penalty += 22;
            }
            if (note.leading) leadingCount++;
            const { min, max } = VOICE_CONFIG[VOICE_ORDER[index]];
            if (note.midi < min || note.midi > max) penalty += 13;
            penalty += Math.abs(note.midi - (min + max) / 2) * 0.065;
          }
          const missing = (present & required) !== required;
          const wrongBass = !pitchClassEquals(bass.pitch, chord.identity.bass);
          const tendencyDoubling = leadingCount > 1 || (chord.tones.length === 4 && Boolean(doubled & 8));
          const incompleteTonic = (present & 7) === 3;
          const wrongDoubling = triad && (incompleteTonic ? doubled !== 1 : (doubled & doublingMask) === 0);
          if ((!permitConflict || chord.applied) && tendencyDoubling) continue;
          if ((!permitConflict || (chord.applied && !chord.locked)) && (wrongBass || missing)) continue;
          if (relaxedLevel === 0 && wrongDoubling) continue;
          if (missing) penalty += 32;
          if (wrongBass) penalty += 180;
          if (tendencyDoubling) penalty += 180;
          if (wrongDoubling) penalty += 3;
          if (!(present & 4)) penalty += 1;
          if (tenorGap > 19) penalty += (tenorGap - 19) * 0.18;
          if (altoGap === 0 || sopranoGap === 0) penalty += 0.95;
          result.push(makeVoicing(notes, penalty, present));
        }
      }
    }
  }
  return result;
}

export function continueOrnament(
  chord: HarmonizationChord, voicing: Voicing, givenVoice: HarmonizationGivenVoice,
  pitch: SpelledPitch, lockedPitches: Partial<Record<VoiceId, SpelledPitch>>,
  level: HarmonizationRelaxedLevel,
): Voicing | undefined {
  const index = givenVoice === "soprano" ? 0 : 3;
  const note = noteFact(pitch, chord);
  const departure = voicing.notes[index];
  if (note.tone >= 0 || departure.tone < 0 || chord.role ||
      (chord.applied && (departure.leading || departure.tone === 3))) return;
  if (VOICE_ORDER.some((voice, i) => i !== index && lockedPitches[voice] &&
    !spelledPitchEquals(lockedPitches[voice]!, voicing.notes[i].pitch))) return;
  const { min, max } = VOICE_CONFIG[givenVoice];
  const gap = index === 0 ? note.midi - voicing.notes[1].midi : voicing.notes[2].midi - note.midi;
  if (gap < 0 || (index === 0 && gap > (level === 0 ? 12 : 16)) || note.midi < min || note.midi > max) return;
  const notes: VoicedNotes = index === 0
    ? [note, voicing.notes[1], voicing.notes[2], voicing.notes[3]]
    : [voicing.notes[0], voicing.notes[1], voicing.notes[2], note];
  return makeVoicing(notes, voicing.penalty, voicing.present);
}
