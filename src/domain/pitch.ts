export type DiatonicStep = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Alteration = -2 | -1 | 0 | 1 | 2;
export type KeyMode = "major" | "minor";

export interface SpelledPitchClass {
  step: DiatonicStep;
  alter: Alteration;
}

export interface SpelledPitch extends SpelledPitchClass {
  octave: number;
}

export interface KeyLike {
  tonic: SpelledPitchClass;
  mode: KeyMode;
}

export interface WrittenInterval {
  diatonicSteps: number;
  semitones: number;
}

const STEPS: DiatonicStep[] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const;
const SCALE_INTERVALS: Record<KeyMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const SHARP_SPELLINGS: SpelledPitchClass[] = [
  { step: "C", alter: 0 },
  { step: "C", alter: 1 },
  { step: "D", alter: 0 },
  { step: "D", alter: 1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: 0 },
  { step: "G", alter: 1 },
  { step: "A", alter: 0 },
  { step: "A", alter: 1 },
  { step: "B", alter: 0 },
];

const FLAT_SPELLINGS: SpelledPitchClass[] = [
  { step: "C", alter: 0 },
  { step: "D", alter: -1 },
  { step: "D", alter: 0 },
  { step: "E", alter: -1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "G", alter: -1 },
  { step: "G", alter: 0 },
  { step: "A", alter: -1 },
  { step: "A", alter: 0 },
  { step: "B", alter: -1 },
  { step: "B", alter: 0 },
];

export const LEGACY_TONIC_SPELLINGS: readonly SpelledPitchClass[] = [
  { step: "C", alter: 0 },
  { step: "D", alter: -1 },
  { step: "D", alter: 0 },
  { step: "E", alter: -1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: 0 },
  { step: "A", alter: -1 },
  { step: "A", alter: 0 },
  { step: "B", alter: -1 },
  { step: "B", alter: 0 },
];

const LEGACY_MINOR_TONIC_SPELLINGS: readonly SpelledPitchClass[] = [
  { step: "C", alter: 0 },
  { step: "C", alter: 1 },
  { step: "D", alter: 0 },
  { step: "E", alter: -1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: 0 },
  { step: "G", alter: 1 },
  { step: "A", alter: 0 },
  { step: "B", alter: -1 },
  { step: "B", alter: 0 },
];

export const KEY_TONIC_OPTIONS: readonly SpelledPitchClass[] = [
  { step: "C", alter: -1 },
  { step: "C", alter: 0 },
  { step: "C", alter: 1 },
  { step: "D", alter: -1 },
  { step: "D", alter: 0 },
  { step: "D", alter: 1 },
  { step: "E", alter: -1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: -1 },
  { step: "G", alter: 0 },
  { step: "G", alter: 1 },
  { step: "A", alter: -1 },
  { step: "A", alter: 0 },
  { step: "A", alter: 1 },
  { step: "B", alter: -1 },
  { step: "B", alter: 0 },
];

export function legacyTonicSpelling(
  pitchClass: number,
  mode: KeyMode,
): SpelledPitchClass {
  const source =
    mode === "minor" ? LEGACY_MINOR_TONIC_SPELLINGS : LEGACY_TONIC_SPELLINGS;
  return { ...source[modulo(pitchClass, 12)] };
}

function modulo(value: number, base: number) {
  return ((value % base) + base) % base;
}

function signedPitchDifference(target: number, natural: number) {
  let difference = modulo(target - natural, 12);
  if (difference > 6) difference -= 12;
  return difference;
}

export function stepIndex(step: DiatonicStep) {
  return STEPS.indexOf(step);
}

export function pitchClassValue(pitch: SpelledPitchClass) {
  return modulo(NATURAL_PITCH_CLASSES[stepIndex(pitch.step)] + pitch.alter, 12);
}

export function toMidi(pitch: SpelledPitch) {
  return (
    (pitch.octave + 1) * 12 +
    NATURAL_PITCH_CLASSES[stepIndex(pitch.step)] +
    pitch.alter
  );
}

export function accidentalSymbol(alter: number) {
  if (alter === -2) return "♭♭";
  if (alter === -1) return "♭";
  if (alter === 1) return "♯";
  if (alter === 2) return "𝄪";
  return "";
}

export function formatPitchClass(pitch: SpelledPitchClass) {
  return `${pitch.step}${accidentalSymbol(pitch.alter)}`;
}

export function formatSpelledPitch(pitch: SpelledPitch) {
  return `${formatPitchClass(pitch)}${pitch.octave}`;
}

export function serializePitchClass(pitch: SpelledPitchClass) {
  return `${pitch.step}:${pitch.alter}`;
}

export function parsePitchClass(value: string): SpelledPitchClass | undefined {
  const [step, rawAlter] = value.split(":");
  const alter = Number(rawAlter);
  if (!STEPS.includes(step as DiatonicStep)) return undefined;
  if (!Number.isInteger(alter) || alter < -2 || alter > 2) return undefined;
  return { step: step as DiatonicStep, alter: alter as Alteration };
}

export function spellPitchClassForStep(
  midiPitchClass: number,
  targetStepIndex: number,
): SpelledPitchClass {
  const normalizedStep = modulo(targetStepIndex, 7);
  const alter = signedPitchDifference(
    midiPitchClass,
    NATURAL_PITCH_CLASSES[normalizedStep],
  );
  if (alter < -2 || alter > 2) {
    return SHARP_SPELLINGS[modulo(midiPitchClass, 12)];
  }
  return { step: STEPS[normalizedStep], alter: alter as Alteration };
}

export function scaleDegreePitchClass(
  key: KeyLike,
  degree: number,
  alteration = 0,
) {
  const degreeIndex = degree - 1;
  const targetPitchClass = modulo(
    pitchClassValue(key.tonic) +
      SCALE_INTERVALS[key.mode][degreeIndex] +
      alteration,
    12,
  );
  return spellPitchClassForStep(
    targetPitchClass,
    stepIndex(key.tonic.step) + degreeIndex,
  );
}

const KEY_FIFTHS: Record<string, number> = {
  "major:Cb": -7,
  "major:Gb": -6,
  "major:Db": -5,
  "major:Ab": -4,
  "major:Eb": -3,
  "major:Bb": -2,
  "major:F": -1,
  "major:C": 0,
  "major:G": 1,
  "major:D": 2,
  "major:A": 3,
  "major:E": 4,
  "major:B": 5,
  "major:F#": 6,
  "major:C#": 7,
  "minor:Ab": -7,
  "minor:Eb": -6,
  "minor:Bb": -5,
  "minor:F": -4,
  "minor:C": -3,
  "minor:G": -2,
  "minor:D": -1,
  "minor:A": 0,
  "minor:E": 1,
  "minor:B": 2,
  "minor:F#": 3,
  "minor:C#": 4,
  "minor:G#": 5,
  "minor:D#": 6,
  "minor:A#": 7,
};

function asciiPitchClass(pitch: SpelledPitchClass) {
  const accidental = pitch.alter < 0 ? "b".repeat(-pitch.alter) : "#".repeat(pitch.alter);
  return `${pitch.step}${accidental}`;
}

export function keySignatureFifths(key: KeyLike) {
  const fifths = KEY_FIFTHS[`${key.mode}:${asciiPitchClass(key.tonic)}`];
  if (fifths === undefined) {
    throw new Error(`${formatPitchClass(key.tonic)} ${key.mode} 不是受支持的调号`);
  }
  return fifths;
}

export function isSupportedKeySignature(key: KeyLike) {
  return KEY_FIFTHS[`${key.mode}:${asciiPitchClass(key.tonic)}`] !== undefined;
}

export function keyTonicOptions(mode: KeyMode) {
  return KEY_TONIC_OPTIONS.filter((tonic) =>
    isSupportedKeySignature({ tonic, mode }),
  );
}

export function coerceKeyTonicForMode(
  tonic: SpelledPitchClass,
  mode: KeyMode,
) {
  if (isSupportedKeySignature({ tonic, mode })) return tonic;
  return (
    keyTonicOptions(mode).find(
      (candidate) => pitchClassValue(candidate) === pitchClassValue(tonic),
    ) ?? { step: "C", alter: 0 }
  );
}

export function spellMidi(midiNote: number, key?: KeyLike): SpelledPitch {
  const midiPitchClass = modulo(midiNote, 12);
  let spelling: SpelledPitchClass | undefined;
  if (key) {
    for (let degree = 1; degree <= 7; degree += 1) {
      const candidate = scaleDegreePitchClass(key, degree);
      if (pitchClassValue(candidate) === midiPitchClass) {
        spelling = candidate;
        break;
      }
    }
  }
  spelling ??=
    (key && keySignatureFifths(key) < 0 ? FLAT_SPELLINGS : SHARP_SPELLINGS)[
      midiPitchClass
    ];
  const natural = NATURAL_PITCH_CLASSES[stepIndex(spelling.step)];
  const octave = Math.floor((midiNote - natural - spelling.alter) / 12) - 1;
  return { ...spelling, octave };
}

export function transposeSpelledPitch(
  pitch: SpelledPitch,
  semitones: number,
  key?: KeyLike,
) {
  if (semitones % 12 === 0) {
    return { ...pitch, octave: pitch.octave + semitones / 12 };
  }
  return spellMidi(toMidi(pitch) + semitones, key);
}

export function writtenInterval(
  from: SpelledPitch,
  to: SpelledPitch,
): WrittenInterval {
  const fromDiatonic = from.octave * 7 + stepIndex(from.step);
  const toDiatonic = to.octave * 7 + stepIndex(to.step);
  return {
    diatonicSteps: toDiatonic - fromDiatonic,
    semitones: toMidi(to) - toMidi(from),
  };
}

export function pitchClassEquals(
  left: SpelledPitchClass,
  right: SpelledPitchClass,
) {
  return left.step === right.step && left.alter === right.alter;
}
