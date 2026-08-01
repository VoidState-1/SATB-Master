import {
  pitchClassEquals,
  pitchClassValue,
  scaleDegreePitchClass,
  spellPitchClassForStep,
  stepIndex,
  type Alteration,
  type KeyLike,
  type KeyMode,
  type SpelledPitchClass,
} from "./pitch";

export type ChordQuality =
  | "major"
  | "minor"
  | "diminished"
  | "augmented"
  | "dominant7"
  | "major7"
  | "minor7"
  | "halfDiminished7"
  | "diminished7";

export type ChordExtension = 6 | 7 | 9 | 11 | 13;

export interface ChordToneAlteration {
  degree: 5 | 9 | 11 | 13;
  alter: Alteration;
}

export interface KeyReference {
  tonic: SpelledPitchClass;
  mode: KeyMode;
}

export interface AppliedFunction {
  targetDegree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export interface FunctionalAnalysis {
  localKey?: KeyReference;
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  degreeAlteration: Alteration;
  quality: ChordQuality;
  inversion: 0 | 1 | 2 | 3;
  applied?: AppliedFunction;
  mixture?: "parallel-major" | "parallel-minor" | "modal";
  cadenceRole?: "cadential64" | "passing64" | "pedal64";
  source: "manual" | "inferred" | "confirmed";
}

export interface ChordIdentity {
  root: SpelledPitchClass;
  quality: ChordQuality;
  extensions: ChordExtension[];
  alterations: ChordToneAlteration[];
  bass: SpelledPitchClass;
}

export const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
};

function appliedContext(analysis: FunctionalAnalysis, key: KeyLike): KeyLike {
  const baseKey = analysis.localKey ?? key;
  if (!analysis.applied) return baseKey;
  return {
    tonic: scaleDegreePitchClass(baseKey, analysis.applied.targetDegree),
    mode: "major",
  };
}

export function isSeventhChord(quality: ChordQuality) {
  return QUALITY_INTERVALS[quality].length === 4;
}

export function chordToneSpellings(
  root: SpelledPitchClass,
  quality: ChordQuality,
) {
  const rootPitchClass = pitchClassValue(root);
  const rootStep = stepIndex(root.step);
  return QUALITY_INTERVALS[quality].map((interval, index) =>
    spellPitchClassForStep(rootPitchClass + interval, rootStep + index * 2),
  );
}

const EXTENSION_INTERVALS: Record<ChordExtension, number> = {
  6: 9,
  7: 10,
  9: 14,
  11: 17,
  13: 21,
};

export function chordIdentityToneSpellings(
  identity: Readonly<Omit<ChordIdentity, "extensions" | "alterations">> & {
    readonly extensions: readonly ChordExtension[];
    readonly alterations: readonly ChordToneAlteration[];
  },
) {
  const rootPitchClass = pitchClassValue(identity.root);
  const rootStep = stepIndex(identity.root.step);
  const tones = chordToneSpellings(identity.root, identity.quality);
  const degreeByToneIndex = [1, 3, 5, 7] as const;

  // 和弦拼写必须保留字母级数；不能把 F♯ 与 G♭ 仅因 MIDI 音级相同而视作同一构成音。
  const alteredBase = tones.map((tone, index) => {
    const degree = degreeByToneIndex[index];
    const alteration = identity.alterations.find(
      (candidate) => candidate.degree === degree,
    );
    if (!alteration) return tone;
    return spellPitchClassForStep(
      pitchClassValue(tone) + alteration.alter,
      stepIndex(tone.step),
    );
  });

  for (const extension of identity.extensions) {
    const degree = extension;
    const alteration = identity.alterations.find(
      (candidate) => candidate.degree === degree,
    );
    alteredBase.push(
      spellPitchClassForStep(
        rootPitchClass +
          EXTENSION_INTERVALS[extension] +
          (alteration?.alter ?? 0),
        rootStep + extension - 1,
      ),
    );
  }

  return alteredBase.filter(
    (tone, index, source) =>
      source.findIndex((candidate) => pitchClassEquals(candidate, tone)) ===
      index,
  );
}

export function resolveChordIdentity(
  analysis: FunctionalAnalysis,
  key: KeyLike,
): ChordIdentity {
  const context = appliedContext(analysis, key);
  const root = scaleDegreePitchClass(
    context,
    analysis.degree,
    analysis.degreeAlteration,
  );
  const tones = chordToneSpellings(root, analysis.quality);
  return {
    root,
    quality: analysis.quality,
    extensions: [],
    alterations: [],
    bass: tones[Math.min(analysis.inversion, tones.length - 1)],
  };
}

export function chordIdentityEquals(left: ChordIdentity, right: ChordIdentity) {
  return (
    left.quality === right.quality &&
    pitchClassEquals(left.root, right.root) &&
    pitchClassEquals(left.bass, right.bass) &&
    left.extensions.join(",") === right.extensions.join(",") &&
    JSON.stringify(left.alterations) === JSON.stringify(right.alterations)
  );
}
