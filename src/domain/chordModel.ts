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

export type ScaleDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SemanticConfidence =
  | "certain"
  | "probable"
  | "ambiguous"
  | "unknown";

export interface HarmonySemantics {
  localKey?: KeyReference;
  degree: ScaleDegree;
  degreeAlteration: Alteration;
  appliedTarget?: ScaleDegree;
  mixture?: "parallel-major" | "parallel-minor" | "modal";
  cadenceRole?: "cadential64" | "passing64" | "pedal64";
  source: "manual" | "inferred" | "confirmed";
  confidence: SemanticConfidence;
}

export interface ChordIdentity {
  root: SpelledPitchClass;
  quality: ChordQuality;
  extensions: ChordExtension[];
  alterations: ChordToneAlteration[];
  bass: SpelledPitchClass;
}

// 编辑器草稿同时携带实体参数和语义；持久化时必须拆回 identity + semantics。
export interface ChordDraft extends HarmonySemantics {
  quality: ChordQuality;
  inversion: 0 | 1 | 2 | 3;
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

function appliedContext(semantics: HarmonySemantics, key: KeyLike): KeyLike {
  const baseKey = semantics.localKey ?? key;
  if (!semantics.appliedTarget) return baseKey;
  return {
    tonic: scaleDegreePitchClass(baseKey, semantics.appliedTarget),
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
  draft: ChordDraft,
  key: KeyLike,
): ChordIdentity {
  const context = appliedContext(draft, key);
  const root = scaleDegreePitchClass(
    context,
    draft.degree,
    draft.degreeAlteration,
  );
  const tones = chordToneSpellings(root, draft.quality);
  return {
    root,
    quality: draft.quality,
    extensions: [],
    alterations: [],
    bass: tones[Math.min(draft.inversion, tones.length - 1)],
  };
}

export function semanticsFromChordDraft(draft: ChordDraft): HarmonySemantics {
  return {
    localKey: draft.localKey,
    degree: draft.degree,
    degreeAlteration: draft.degreeAlteration,
    appliedTarget: draft.appliedTarget,
    mixture: draft.mixture,
    cadenceRole: draft.cadenceRole,
    source: draft.source,
    confidence: draft.confidence,
  };
}

export function chordIdentityInversion(identity: ChordIdentity) {
  const tones = chordToneSpellings(identity.root, identity.quality);
  const index = tones.findIndex((tone) => pitchClassEquals(tone, identity.bass));
  return Math.max(0, Math.min(index < 0 ? 0 : index, tones.length - 1)) as
    | 0
    | 1
    | 2
    | 3;
}

export function chordDraftFromIdentity(
  identity: ChordIdentity,
  semantics: HarmonySemantics,
): ChordDraft {
  return {
    ...semantics,
    quality: identity.quality,
    inversion: chordIdentityInversion(identity),
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
