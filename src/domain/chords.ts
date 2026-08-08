import {
  QUALITY_INTERVALS,
  chordDraftFromIdentity,
  chordIdentityInversion,
  chordIdentityToneSpellings,
  chordStructureQuality,
  isSeventhChord,
  isSeventhStructure,
  legacyHarmonyProjection,
  primaryHarmonyInterpretation,
  resolveChordIdentity,
  semanticsFromChordDraft,
} from "./chordModel";
import {
  chordFormFromDraft,
  functionalDefinition,
  inferredFunctionalDefinition,
  inversionFigures,
  targetFunctionalLabel,
} from "./functionalHarmonyCatalog";
import {
  type ChordDraft,
  type ChordIdentity,
  type ChordQuality,
  type ChordRegion,
  type HarmonySemantics,
  type KeyEvent,
  type ProjectDocument,
} from "./project";
import {
  accidentalSymbol,
  formatPitchClass,
  pitchClassValue,
} from "./pitch";
import { keyAtTick } from "./time";

export { QUALITY_INTERVALS, isSeventhChord } from "./chordModel";

const ROMAN_DEGREES = ["I", "II", "III", "IV", "V", "VI", "VII"];

export type ChordFunction = "tonic" | "subdominant" | "dominant" | "other";

export interface FormattedChordName {
  functional: string;
  roman: string;
  absolute: string;
  semanticSummary: string;
  spokenDescription: string;
}

export function chordRootPitchClass(draft: ChordDraft, key: KeyEvent) {
  return pitchClassValue(resolveChordIdentity(draft, key).root);
}

export function chordPitchClasses(draft: ChordDraft, key: KeyEvent) {
  return chordIdentityPitchClasses(resolveChordIdentity(draft, key));
}

export function chordIdentityPitchClasses(identity: ChordIdentity) {
  return chordIdentityToneSpellings(identity).map(pitchClassValue);
}

// 仅供旧检查器维持既有行为；新功能体系不消费此粗粒度分类。
export function chordFunction(semantics: HarmonySemantics): ChordFunction {
  const legacy = legacyHarmonyProjection(semantics);
  if (legacy.appliedTarget && [5, 7].includes(legacy.degree))
    return "dominant";
  if ([1, 3, 6].includes(legacy.degree)) return "tonic";
  if ([2, 4].includes(legacy.degree)) return "subdominant";
  if ([5, 7].includes(legacy.degree)) return "dominant";
  return "other";
}

function semanticsForInterpretation(
  semantics: HarmonySemantics,
  interpretation: HarmonySemantics["interpretations"][number],
): HarmonySemantics {
  return {
    ...semantics,
    interpretations: [interpretation],
    primaryInterpretationId: interpretation.id,
  };
}

function romanNameSingle(identity: ChordIdentity, semantics: HarmonySemantics) {
  const interpretation = primaryHarmonyInterpretation(semantics);
  const quality = chordStructureQuality(identity);
  if (!quality) return "+6";
  const uppercase = ["major", "augmented", "dominant7", "major7"].includes(
    quality,
  );
  const numeral = uppercase
    ? ROMAN_DEGREES[interpretation.degree - 1]
    : ROMAN_DEGREES[interpretation.degree - 1].toLowerCase();
  const qualityMark =
    quality === "augmented"
      ? "+"
      : quality === "diminished" || quality === "diminished7"
        ? "°"
        : quality === "halfDiminished7"
          ? "ø"
          : "";
  const inversion = chordIdentityInversion(identity);
  const figures = isSeventhStructure(identity.structure)
    ? ["7", "6/5", "4/3", "4/2"][inversion]
    : ["", "6", "6/4"][inversion];
  const extension =
    identity.structure.kind === "tertian" &&
    identity.structure.extensions.includes(9)
      ? "9"
      : figures;
  const target = interpretation.appliedTarget
    ? `/${ROMAN_DEGREES[interpretation.appliedTarget.degree - 1]}`
    : "";
  return `${accidentalSymbol(interpretation.degreeAlteration)}${numeral}${qualityMark}${extension}${target}`;
}

function alterationSuffix(identity: ChordIdentity) {
  if (
    identity.structure.kind !== "tertian" ||
    identity.structure.alterations.length === 0
  )
    return "";
  return `(${identity.structure.alterations
    .map(
      (alteration) =>
        `${accidentalSymbol(alteration.alter)}${alteration.degree}`,
    )
    .join(",")})`;
}

function absoluteName(identity: ChordIdentity) {
  if (identity.structure.kind === "augmented-sixth")
    return chordIdentityToneSpellings(identity).map(formatPitchClass).join("-");

  const suffix: Record<ChordQuality, string> = {
    major: "",
    minor: "m",
    diminished: "°",
    augmented: "+",
    dominant7: "7",
    major7: "maj7",
    minor7: "m7",
    halfDiminished7: "ø7",
    diminished7: "°7",
  };
  const root = formatPitchClass(identity.root);
  const extension = identity.structure.extensions.includes(9) ? "9" : "";
  const baseSuffix = extension || suffix[identity.structure.quality];
  const bass =
    identity.root.step === identity.bass.step &&
    identity.root.alter === identity.bass.alter
      ? ""
      : `/${formatPitchClass(identity.bass)}`;
  return `${root}${baseSuffix}${alterationSuffix(identity)}${bass}`;
}

function semanticSummary(semantics?: HarmonySemantics) {
  if (!semantics) return "未解释";
  const interpretation = primaryHarmonyInterpretation(semantics);
  const designation = interpretation.designation;
  const familyName = (family: NonNullable<typeof designation>["primaryFunction"]) =>
    family === "tonic"
      ? "主功能"
      : family === "subdominant"
        ? "下属功能"
        : family === "dominant"
          ? "属功能"
          : "未指定功能";
  const primary = designation?.primaryFunction
    ? familyName(designation.primaryFunction)
    : "未指定功能";
  const secondary = designation?.secondaryFunction
    ? `，兼具${familyName(designation.secondaryFunction)}`
    : "";
  const target = interpretation.appliedTarget
    ? `，指向 ${targetFunctionalLabel(interpretation.appliedTarget)}`
    : "";
  const multiple =
    semantics.interpretations.length > 1
      ? `，共 ${semantics.interpretations.length} 个调性解释`
      : "";
  return `${primary}${secondary}${target}${multiple}`;
}

function functionalNameSingle(
  identity: ChordIdentity,
  semantics?: HarmonySemantics,
) {
  if (!semantics) return "?";
  const interpretation = primaryHarmonyInterpretation(semantics);
  const quality = chordStructureQuality(identity);
  const definition = inferredFunctionalDefinition(semantics, quality);
  if (!definition) return "?";
  if (["K46", "N6", "It+6", "Fr+6", "Ger+6"].includes(definition.id))
    return definition.label;

  const draft = chordDraftFromIdentity(identity, semantics);
  const form = chordFormFromDraft(draft);
  const figures = inversionFigures(form, chordIdentityInversion(identity));
  const base = `${definition.label}${figures}${alterationSuffix(identity)}`;
  if (
    interpretation.appliedTarget &&
    interpretation.appliedTarget.degree !== 5
  )
    return `${base}->${targetFunctionalLabel(interpretation.appliedTarget)}`;
  return base;
}

export function formatChord(
  draft: ChordDraft,
  key: KeyEvent,
): FormattedChordName {
  return formatChordIdentity(
    resolveChordIdentity(draft, key),
    semanticsFromChordDraft(draft),
  );
}

export function formatChordIdentity(
  identity: ChordIdentity,
  semantics?: HarmonySemantics,
): FormattedChordName {
  const roman = semantics
    ? semantics.interpretations
        .map((interpretation) =>
          romanNameSingle(
            identity,
            semanticsForInterpretation(semantics, interpretation),
          ),
        )
        .join(" = ")
    : "?";
  const absolute = absoluteName(identity);
  const functional = semantics
    ? semantics.interpretations
        .map((interpretation) =>
          functionalNameSingle(
            identity,
            semanticsForInterpretation(semantics, interpretation),
          ),
        )
        .join(" = ")
    : "?";
  const summary = semanticSummary(semantics);
  return {
    functional,
    roman,
    absolute,
    semanticSummary: summary,
    spokenDescription: `${functional}，${roman}，${absolute}，${summary}`,
  };
}

export function formatChordRegion(
  _project: ProjectDocument,
  region: ChordRegion,
) {
  return formatChordIdentity(region.identity, region.semantics);
}

export function chordAtTick(project: ProjectDocument, tick: number) {
  return project.chordTrack.regions.find(
    (region) =>
      region.startTick <= tick &&
      region.startTick + region.durationTicks > tick,
  );
}

export function defaultChordDraftAtTick(
  project: ProjectDocument,
  tick: number,
): ChordDraft {
  const key = keyAtTick(project.keyEvents, tick);
  const definition = functionalDefinition(key.mode === "major" ? "T" : "t");
  return {
    degree: 1,
    degreeAlteration: 0,
    quality: key.mode === "major" ? "major" : "minor",
    extensions: [],
    alterations: [],
    inversion: 0,
    designation: definition.designation,
    source: "manual",
    confidence: "certain",
  };
}

export function chordDraftFromRegion(region: ChordRegion): ChordDraft | undefined {
  return region.semantics
    ? chordDraftFromIdentity(region.identity, region.semantics)
    : undefined;
}

export function createChordRegion(
  project: ProjectDocument,
  startTick: number,
  durationTicks: number,
  draft: ChordDraft,
  id: string,
): ChordRegion {
  const key = keyAtTick(project.keyEvents, startTick);
  return {
    id,
    startTick,
    durationTicks,
    identity: resolveChordIdentity(draft, key),
    semantics: semanticsFromChordDraft(draft),
    locked: false,
  };
}

export function updateChordDraftIdentity(
  project: ProjectDocument,
  region: ChordRegion,
  draft: ChordDraft,
) {
  return {
    ...region,
    semantics: semanticsFromChordDraft(draft),
    identity: resolveChordIdentity(
      draft,
      keyAtTick(project.keyEvents, region.startTick),
    ),
  };
}
