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
export type ChordToneDegree = 1 | 3 | 5 | 7 | 9 | 11 | 13;
export type AugmentedSixthVariant = "italian" | "french" | "german" | "doubleAugmented43";

export interface ChordToneAlteration {
  degree: 5 | 9 | 11 | 13;
  alter: Alteration;
  /** 由编辑语义明确声明，规则检查器不得只根据升降号猜测解决方向。 */
  tendency?: "up" | "down";
}

export interface TertianChordStructure {
  kind: "tertian";
  quality: ChordQuality;
  extensions: readonly ChordExtension[];
  alterations: readonly ChordToneAlteration[];
}

export interface AugmentedSixthChordStructure {
  kind: "augmented-sixth";
  variant: AugmentedSixthVariant;
}

export type ChordStructure =
  TertianChordStructure | AugmentedSixthChordStructure;

export interface KeyReference {
  tonic: SpelledPitchClass;
  mode: KeyMode;
}

export type ScaleDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const ROMAN_DEGREE_LABELS: Readonly<Record<ScaleDegree, string>> =
  Object.freeze({
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
    6: "VI",
    7: "VII",
  });

export function romanDegreeLabel(degree: ScaleDegree) {
  return ROMAN_DEGREE_LABELS[degree];
}

export type SemanticConfidence =
  "certain" | "probable" | "ambiguous" | "unknown";

export type FunctionalFamily = "tonic" | "subdominant" | "dominant";

export type FunctionalDesignationKind =
  | "primary"
  | "side-degree"
  | "applied-dominant"
  | "applied-leading-tone"
  | "double-dominant"
  | "double-dominant-leading-tone"
  | "cadential64"
  | "neapolitan"
  | "augmented-sixth"
  | "altered-dominant";

export interface FunctionalTarget {
  degree: ScaleDegree;
  primaryFunction: FunctionalFamily;
  secondaryFunction?: FunctionalFamily;
}

export interface FunctionalDesignation {
  notationSystem: "spasobin";
  kind: FunctionalDesignationKind;
  primaryFunction?: FunctionalFamily;
  secondaryFunction?: FunctionalFamily;
  specialRole?: "neapolitan" | "italian6" | "french6" | "german6" | "doubleAugmented43";
}

export interface HarmonyInterpretation {
  id: string;
  localKey?: KeyReference;
  degree: ScaleDegree;
  degreeAlteration: Alteration;
  appliedTarget?: FunctionalTarget;
  designation?: FunctionalDesignation;
  source: "manual" | "inferred" | "confirmed";
  confidence: SemanticConfidence;
}

export interface HarmonySemantics {
  interpretations: readonly HarmonyInterpretation[];
  primaryInterpretationId: string;
  alternatives?: readonly HarmonyInterpretation[];
  mixture?: "parallel-major" | "parallel-minor" | "modal";
  cadenceRole?: "cadential64" | "passing64" | "pedal64" | "deceptive";
  pedalContext?: {
    pitch: SpelledPitchClass;
    role: "start" | "continue" | "end";
  };
}

export interface ChordIdentity {
  root: SpelledPitchClass;
  structure: ChordStructure;
  bass: SpelledPitchClass;
}

// 调色盘草稿是编辑态配方；持久化时必须拆为 identity + semantics。
export interface ChordDraft {
  degree: ScaleDegree;
  degreeAlteration: Alteration;
  quality: ChordQuality;
  extensions?: ChordExtension[];
  alterations?: ChordToneAlteration[];
  augmentedSixthVariant?: AugmentedSixthVariant;
  inversion: 0 | 1 | 2 | 3;
  appliedTarget?: ScaleDegree;
  appliedTargetFunction?: Pick<
    FunctionalTarget,
    "primaryFunction" | "secondaryFunction"
  >;
  designation?: FunctionalDesignation;
  interpretationId?: string;
  localKey?: KeyReference;
  secondaryInterpretation?: HarmonyInterpretation;
  alternatives?: readonly HarmonyInterpretation[];
  mixture?: HarmonySemantics["mixture"];
  cadenceRole?: HarmonySemantics["cadenceRole"];
  pedalContext?: HarmonySemantics["pedalContext"];
  source: HarmonyInterpretation["source"];
  confidence: SemanticConfidence;
}

export interface LegacyHarmonyProjection {
  localKey?: KeyReference;
  degree: ScaleDegree;
  degreeAlteration: Alteration;
  appliedTarget?: ScaleDegree;
  mixture?: HarmonySemantics["mixture"];
  cadenceRole?: HarmonySemantics["cadenceRole"];
  source: HarmonyInterpretation["source"];
  confidence: SemanticConfidence;
}

export interface ChordVoicingPolicy {
  requiredDegrees: ChordToneDegree[];
  permittedDegrees: ChordToneDegree[];
  forbiddenDegrees: ChordToneDegree[];
  doublingHints: Array<{
    degree: ChordToneDegree;
    policy: "allowed" | "avoid" | "required";
  }>;
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

const EXTENSION_INTERVALS: Record<ChordExtension, number> = {
  6: 9,
  7: 10,
  9: 14,
  11: 17,
  13: 21,
};

const DEFAULT_TARGET_FUNCTIONS: Record<
  ScaleDegree,
  Pick<FunctionalTarget, "primaryFunction" | "secondaryFunction">
> = {
  1: { primaryFunction: "tonic" },
  2: { primaryFunction: "subdominant" },
  3: { primaryFunction: "dominant", secondaryFunction: "tonic" },
  4: { primaryFunction: "subdominant" },
  5: { primaryFunction: "dominant" },
  6: { primaryFunction: "tonic", secondaryFunction: "subdominant" },
  7: { primaryFunction: "dominant" },
};

export function functionalTargetForDegree(
  degree: ScaleDegree,
  override?: ChordDraft["appliedTargetFunction"],
): FunctionalTarget {
  return { degree, ...(override ?? DEFAULT_TARGET_FUNCTIONS[degree]) };
}

export function primaryHarmonyInterpretation(
  semantics: HarmonySemantics,
): HarmonyInterpretation {
  return (
    semantics.interpretations.find(
      (candidate) => candidate.id === semantics.primaryInterpretationId,
    ) ?? semantics.interpretations[0]
  );
}

/**
 * 返回当前和声语义能否作为确定结论使用。
 * `interpretations` 可以包含已经确认的共同和弦双重解释；未决候选放在
 * `alternatives` 中，因此只要 alternatives 非空，依赖唯一解释的分析就应暂停。
 */
export function harmonySemanticsConfidence(
  semantics: HarmonySemantics,
): SemanticConfidence {
  if ((semantics.alternatives?.length ?? 0) > 0) return "ambiguous";
  return primaryHarmonyInterpretation(semantics).confidence;
}

export function legacyHarmonyProjection(
  semantics: HarmonySemantics,
): LegacyHarmonyProjection {
  const primary = primaryHarmonyInterpretation(semantics);
  return {
    localKey: primary.localKey,
    degree: primary.degree,
    degreeAlteration: primary.degreeAlteration,
    appliedTarget: primary.appliedTarget?.degree,
    mixture: semantics.mixture,
    cadenceRole: semantics.cadenceRole,
    source: primary.source,
    confidence: primary.confidence,
  };
}

function draftTarget(draft: ChordDraft) {
  return draft.appliedTarget
    ? functionalTargetForDegree(
        draft.appliedTarget,
        draft.appliedTargetFunction,
      )
    : undefined;
}

function appliedContext(draft: ChordDraft, key: KeyLike): KeyLike {
  const baseKey = draft.localKey ?? key;
  const target = draftTarget(draft);
  if (!target) return baseKey;
  return {
    tonic: scaleDegreePitchClass(baseKey, target.degree),
    mode: "major",
  };
}

export function isSeventhChord(quality: ChordQuality) {
  return QUALITY_INTERVALS[quality].length === 4;
}

export function isSeventhStructure(structure: ChordStructure) {
  return structure.kind === "tertian" && isSeventhChord(structure.quality);
}

export function maximumInversionForDraft(draft: ChordDraft) {
  if (draft.augmentedSixthVariant || draft.extensions?.includes(9)) return 0;
  return isSeventhChord(draft.quality) ? 3 : 2;
}

export function maximumInversionForStructure(structure: ChordStructure) {
  if (structure.kind === "augmented-sixth") return 0;
  if (structure.extensions.includes(9)) return 0;
  return isSeventhChord(structure.quality) ? 3 : 2;
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

function tertianToneSpellings(
  root: SpelledPitchClass,
  structure: TertianChordStructure,
) {
  const rootPitchClass = pitchClassValue(root);
  const rootStep = stepIndex(root.step);
  const tones = chordToneSpellings(root, structure.quality);
  const degreeByToneIndex = [1, 3, 5, 7] as const;
  const alteredBase = tones.map((tone, index) => {
    const degree = degreeByToneIndex[index];
    const alteration = structure.alterations.find(
      (candidate) => candidate.degree === degree,
    );
    if (!alteration) return tone;
    return spellPitchClassForStep(
      pitchClassValue(tone) + alteration.alter,
      stepIndex(tone.step),
    );
  });

  for (const extension of structure.extensions) {
    const existingIndex = degreeByToneIndex.indexOf(
      extension as (typeof degreeByToneIndex)[number],
    );
    if (existingIndex >= 0) continue;
    const alteration = structure.alterations.find(
      (candidate) => candidate.degree === extension,
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

function augmentedSixthToneSpellings(
  root: SpelledPitchClass,
  variant: AugmentedSixthVariant,
) {
  const rootPitchClass = pitchClassValue(root);
  const rootStep = stepIndex(root.step);
  const specifications =
    variant === "italian"
      ? [
          { semitones: 0, steps: 0 },
          { semitones: 4, steps: 2 },
          { semitones: 10, steps: 5 },
        ]
      : variant === "french"
        ? [
            { semitones: 0, steps: 0 },
            { semitones: 4, steps: 2 },
            { semitones: 6, steps: 3 },
            { semitones: 10, steps: 5 },
          ]
        : [
            { semitones: 0, steps: 0 },
            { semitones: 4, steps: 2 },
            { semitones: 7, steps: variant === "doubleAugmented43" ? 3 : 4 },
            { semitones: 10, steps: 5 },
          ];
  return specifications.map((item) =>
    spellPitchClassForStep(
      rootPitchClass + item.semitones,
      rootStep + item.steps,
    ),
  );
}

export function chordIdentityToneSpellings(identity: ChordIdentity) {
  return identity.structure.kind === "tertian"
    ? tertianToneSpellings(identity.root, identity.structure)
    : augmentedSixthToneSpellings(identity.root, identity.structure.variant);
}

/** Returns whether a pitch uses one of the chord's written spellings. */
export function identityContainsWrittenPitchClass(
  identity: ChordIdentity,
  pitch: SpelledPitchClass,
) {
  return chordIdentityToneSpellings(identity).some((tone) =>
    pitchClassEquals(pitch, tone),
  );
}

/** Returns whether a pitch has one of the chord's sounding pitch classes. */
export function identityContainsPitchClass(
  identity: ChordIdentity,
  pitch: SpelledPitchClass,
) {
  const pitchClass = pitchClassValue(pitch);
  return chordIdentityToneSpellings(identity).some(
    (tone) => pitchClassValue(tone) === pitchClass,
  );
}

export function chordIdentityToneSpellingForDegree(
  identity: ChordIdentity,
  degree: ChordToneDegree,
) {
  if (identity.structure.kind !== "tertian") return undefined;
  const targetStep = (stepIndex(identity.root.step) + degree - 1) % 7;
  return chordIdentityToneSpellings(identity).find(
    (tone) => stepIndex(tone.step) === targetStep,
  );
}

export function chordStructureQuality(
  identity: ChordIdentity,
): ChordQuality | undefined {
  return identity.structure.kind === "tertian"
    ? identity.structure.quality
    : undefined;
}

export function chordVoicingPolicy(
  identity: ChordIdentity,
): ChordVoicingPolicy {
  if (
    identity.structure.kind === "tertian" &&
    identity.structure.quality === "dominant7" &&
    identity.structure.extensions.includes(9)
  ) {
    return {
      requiredDegrees: [1, 3, 7, 9],
      permittedDegrees: [1, 3, 7, 9],
      forbiddenDegrees: [5],
      doublingHints: [],
    };
  }
  if (
    identity.structure.kind === "tertian" &&
    identity.structure.quality === "dominant7" &&
    chordIdentityInversion(identity) === 0
  ) {
    return {
      requiredDegrees: [1, 3, 7],
      permittedDegrees: [1, 3, 5, 7],
      forbiddenDegrees: [],
      doublingHints: [],
    };
  }
  if (identity.structure.kind === "augmented-sixth") {
    return {
      requiredDegrees: [],
      permittedDegrees: [],
      forbiddenDegrees: [],
      doublingHints: [],
    };
  }
  const degrees = [1, 3, 5] as ChordToneDegree[];
  if (isSeventhChord(identity.structure.quality)) degrees.push(7);
  for (const extension of identity.structure.extensions) {
    if (extension !== 6 && !degrees.includes(extension))
      degrees.push(extension);
  }
  return {
    requiredDegrees: degrees,
    permittedDegrees: degrees,
    forbiddenDegrees: [],
    doublingHints: [],
  };
}

export function resolveChordIdentity(
  draft: ChordDraft,
  key: KeyLike,
): ChordIdentity {
  if (draft.augmentedSixthVariant) {
    const baseKey = draft.localKey ?? key;
    const root = scaleDegreePitchClass(baseKey, 6, baseKey.mode === "minor" ? 0 : -1);
    return {
      root,
      structure: {
        kind: "augmented-sixth",
        variant: draft.augmentedSixthVariant,
      },
      bass: root,
    };
  }

  const context = appliedContext(draft, key);
  const root = scaleDegreePitchClass(
    context,
    draft.degree,
    draft.degreeAlteration,
  );
  const structure: TertianChordStructure = {
    kind: "tertian",
    quality: draft.quality,
    extensions: [...(draft.extensions ?? [])],
    alterations: [...(draft.alterations ?? [])],
  };
  const tones = tertianToneSpellings(root, structure);
  return {
    root,
    structure,
    bass: tones[Math.min(draft.inversion, tones.length - 1)],
  };
}

export function semanticsFromChordDraft(draft: ChordDraft): HarmonySemantics {
  const primaryId = draft.interpretationId ?? "primary";
  const primary: HarmonyInterpretation = {
    id: primaryId,
    localKey: draft.localKey,
    degree: draft.degree,
    degreeAlteration: draft.degreeAlteration,
    appliedTarget: draftTarget(draft),
    designation: draft.designation,
    source: draft.source,
    confidence: draft.confidence,
  };
  return {
    interpretations: [
      primary,
      ...(draft.secondaryInterpretation ? [draft.secondaryInterpretation] : []),
    ],
    primaryInterpretationId: primaryId,
    alternatives: draft.alternatives,
    mixture: draft.mixture,
    cadenceRole: draft.cadenceRole,
    pedalContext: draft.pedalContext,
  };
}

export function inversionBassOptions(identity: ChordIdentity) {
  return chordIdentityToneSpellings(identity).slice(0, maximumInversionForStructure(identity.structure) + 1);
}

export function chordIdentityInversion(identity: ChordIdentity) {
  const maximum = maximumInversionForStructure(identity.structure);
  if (maximum === 0) return 0;
  const tones = chordIdentityToneSpellings(identity);
  const index = tones.findIndex((tone) =>
    pitchClassEquals(tone, identity.bass),
  );
  return Math.max(0, Math.min(index < 0 ? 0 : index, maximum)) as 0 | 1 | 2 | 3;
}

export function chordDraftFromIdentity(
  identity: ChordIdentity,
  semantics: HarmonySemantics,
): ChordDraft {
  const primary = primaryHarmonyInterpretation(semantics);
  const quality =
    identity.structure.kind === "tertian"
      ? identity.structure.quality
      : "major";
  return {
    degree: primary.degree,
    degreeAlteration: primary.degreeAlteration,
    quality,
    extensions:
      identity.structure.kind === "tertian"
        ? [...identity.structure.extensions]
        : [],
    alterations:
      identity.structure.kind === "tertian"
        ? [...identity.structure.alterations]
        : [],
    augmentedSixthVariant:
      identity.structure.kind === "augmented-sixth"
        ? identity.structure.variant
        : undefined,
    inversion: chordIdentityInversion(identity),
    appliedTarget: primary.appliedTarget?.degree,
    appliedTargetFunction: primary.appliedTarget
      ? {
          primaryFunction: primary.appliedTarget.primaryFunction,
          secondaryFunction: primary.appliedTarget.secondaryFunction,
        }
      : undefined,
    designation: primary.designation,
    interpretationId: primary.id,
    localKey: primary.localKey,
    secondaryInterpretation: semantics.interpretations.find(
      (candidate) => candidate.id !== primary.id,
    ),
    alternatives: semantics.alternatives,
    mixture: semantics.mixture,
    cadenceRole: semantics.cadenceRole,
    pedalContext: semantics.pedalContext,
    source: primary.source,
    confidence: primary.confidence,
  };
}

/** Project the written structure in display order, keeping the member arrays ordered. */
function writtenChordStructure(structure: ChordStructure): ChordStructure {
  if (structure.kind === "augmented-sixth") {
    return { kind: structure.kind, variant: structure.variant };
  }
  const { kind, quality, extensions, alterations } = structure;
  return {
    kind,
    quality,
    extensions,
    alterations: alterations.map(({ degree, alter, tendency }) => ({ degree, alter, tendency })),
  };
}

export function chordIdentityEqualsWithoutBass(left: ChordIdentity, right: ChordIdentity) {
  return pitchClassEquals(left.root, right.root) &&
    (left.structure === right.structure ||
      (left.structure.kind === right.structure.kind &&
        JSON.stringify(writtenChordStructure(left.structure)) === JSON.stringify(writtenChordStructure(right.structure))));
}

export function chordIdentityEquals(left: ChordIdentity, right: ChordIdentity) {
  return pitchClassEquals(left.bass, right.bass) &&
    chordIdentityEqualsWithoutBass(left, right);
}

/** Written identity used by spans and connections, with the traditional debug field order. */
export function chordIdentityKeyWithoutBass(identity: ChordIdentity) {
  const { step, alter } = identity.root;
  return JSON.stringify({
    root: { step, alter },
    structure: writtenChordStructure(identity.structure),
    tones: chordIdentityToneSpellings(identity),
  });
}

export function harmonySemanticsCompatibleWithIdentity(
  identity: ChordIdentity,
  semantics: HarmonySemantics,
  projectKey: KeyLike,
) {
  const signatures = new Set<string>();
  for (const interpretation of semantics.interpretations) {
    if (identity.structure.kind === "augmented-sixth" && identity.structure.variant === "doubleAugmented43" &&
        (interpretation.localKey ?? projectKey).mode !== "major") return false;
    const single: HarmonySemantics = {
      ...semantics,
      interpretations: [interpretation],
      primaryInterpretationId: interpretation.id,
    };
    const draft = chordDraftFromIdentity(identity, single);
    if (!chordIdentityEquals(resolveChordIdentity(draft, projectKey), identity))
      return false;
    const localKey = interpretation.localKey ?? {
      tonic: projectKey.tonic,
      mode: projectKey.mode,
    };
    const signature = JSON.stringify({
      localKey,
      degree: interpretation.degree,
      degreeAlteration: interpretation.degreeAlteration,
      appliedTarget: interpretation.appliedTarget,
      designation: interpretation.designation,
    });
    if (signatures.has(signature)) return false;
    signatures.add(signature);
  }
  return true;
}
