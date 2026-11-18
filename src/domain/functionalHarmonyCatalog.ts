import {
  chordIdentityEquals,
  chordIdentityInversion,
  chordStructureQuality,
  functionalTargetForDegree,
  isSeventhChord,
  maximumInversionForDraft,
  primaryHarmonyInterpretation,
  resolveChordIdentity,
  semanticsFromChordDraft,
  type ChordDraft,
  type ChordIdentity,
  type ChordQuality,
  type FunctionalDesignation,
  type FunctionalFamily,
  type FunctionalTarget,
  type HarmonyInterpretation,
  type HarmonySemantics,
  type ScaleDegree,
} from "./chordModel";
import type { KeyMode } from "./pitch";
import { keyTonicOptions, serializePitchClass } from "./pitch";

export type FunctionalScope = "A" | "B" | "C";
export type FunctionalChordForm = "triad" | "seventh" | "ninth";
export type FunctionalBaseId =
  | "T"
  | "t"
  | "S"
  | "s"
  | "D"
  | "d"
  | "SII"
  | "DTIII"
  | "dtIII"
  | "TSVI"
  | "DVII"
  | "dVII"
  | "K46"
  | "DD"
  | "DDVII"
  | "N6"
  | "It+6"
  | "Fr+6"
  | "Ger+6";

export interface FunctionalBaseDefinition {
  id: FunctionalBaseId;
  label: string;
  title: string;
  scope: FunctionalScope;
  formScopes?: Partial<Record<FunctionalChordForm, FunctionalScope>>;
  degree: ScaleDegree;
  degreeAlteration: ChordDraft["degreeAlteration"];
  minorDegreeAlteration?: ChordDraft["degreeAlteration"];
  forms: readonly FunctionalChordForm[];
  fixedInversion?: ChordDraft["inversion"];
  designation: FunctionalDesignation;
  quality(mode: KeyMode, form: FunctionalChordForm): ChordQuality;
  augmentedSixthVariant?: ChordDraft["augmentedSixthVariant"];
  fixedTarget?: FunctionalTarget;
}

function primary(family: FunctionalFamily): FunctionalDesignation {
  return {
    notationSystem: "spasobin",
    kind: "primary",
    primaryFunction: family,
  };
}

function sideDegree(
  primaryFunction: FunctionalFamily,
  secondaryFunction?: FunctionalFamily,
): FunctionalDesignation {
  return {
    notationSystem: "spasobin",
    kind: "side-degree",
    primaryFunction,
    secondaryFunction,
  };
}

function triadOrSeventh(triad: ChordQuality, seventh: ChordQuality) {
  return (_mode: KeyMode, form: FunctionalChordForm) =>
    form === "triad" ? triad : seventh;
}

export const FUNCTIONAL_BASE_DEFINITIONS: readonly FunctionalBaseDefinition[] =
  [
    {
      id: "T",
      label: "T",
      title: "大主功能",
      scope: "A",
      degree: 1,
      degreeAlteration: 0,
      forms: ["triad"],
      designation: primary("tonic"),
      quality: () => "major",
    },
    {
      id: "t",
      label: "t",
      title: "小主功能",
      scope: "A",
      degree: 1,
      degreeAlteration: 0,
      forms: ["triad"],
      designation: primary("tonic"),
      quality: () => "minor",
    },
    {
      id: "S",
      label: "S",
      title: "大下属功能",
      scope: "A",
      degree: 4,
      degreeAlteration: 0,
      forms: ["triad", "seventh"],
      formScopes: { seventh: "C" },
      designation: primary("subdominant"),
      quality: triadOrSeventh("major", "major7"),
    },
    {
      id: "s",
      label: "s",
      title: "小下属功能",
      scope: "A",
      degree: 4,
      degreeAlteration: 0,
      forms: ["triad", "seventh"],
      formScopes: { seventh: "C" },
      designation: primary("subdominant"),
      quality: triadOrSeventh("minor", "minor7"),
    },
    {
      id: "D",
      label: "D",
      title: "大属功能",
      scope: "A",
      degree: 5,
      degreeAlteration: 0,
      forms: ["triad", "seventh", "ninth"],
      formScopes: { ninth: "C" },
      designation: primary("dominant"),
      quality: (_mode, form) => (form === "triad" ? "major" : "dominant7"),
    },
    {
      id: "d",
      label: "d",
      title: "小属功能",
      scope: "C",
      degree: 5,
      degreeAlteration: 0,
      forms: ["triad"],
      designation: primary("dominant"),
      quality: () => "minor",
    },
    {
      id: "SII",
      label: "SII",
      title: "II 级下属功能",
      scope: "A",
      degree: 2,
      degreeAlteration: 0,
      forms: ["triad", "seventh"],
      designation: sideDegree("subdominant"),
      quality: (mode, form) =>
        form === "triad"
          ? mode === "major"
            ? "minor"
            : "diminished"
          : mode === "major"
            ? "minor7"
            : "halfDiminished7",
    },
    {
      id: "DTIII",
      label: "DTIII",
      title: "III 级属-主复合功能",
      scope: "A",
      degree: 3,
      degreeAlteration: 0,
      forms: ["triad"],
      designation: sideDegree("dominant", "tonic"),
      quality: (mode) => (mode === "major" ? "minor" : "augmented"),
    },
    {
      id: "TSVI",
      label: "TSVI",
      title: "VI 级主-下属复合功能",
      scope: "A",
      degree: 6,
      degreeAlteration: 0,
      forms: ["triad"],
      designation: sideDegree("tonic", "subdominant"),
      quality: (mode) => (mode === "major" ? "minor" : "major"),
    },
    {
      id: "DVII",
      label: "DVII",
      title: "VII 级导音功能",
      scope: "A",
      degree: 7,
      degreeAlteration: 0,
      minorDegreeAlteration: 1,
      forms: ["triad", "seventh"],
      designation: sideDegree("dominant"),
      quality: (mode, form) =>
        form === "triad"
          ? "diminished"
          : mode === "major"
            ? "halfDiminished7"
            : "diminished7",
    },
    {
      id: "dtIII",
      label: "dtIII",
      title: "自然小调 III 级大三和弦",
      scope: "C",
      degree: 3,
      degreeAlteration: -1,
      minorDegreeAlteration: 0,
      forms: ["triad"],
      designation: sideDegree("dominant", "tonic"),
      quality: () => "major",
    },
    {
      id: "dVII",
      label: "dVII",
      title: "自然小调 VII 级大三和弦",
      scope: "C",
      degree: 7,
      degreeAlteration: -1,
      minorDegreeAlteration: 0,
      forms: ["triad"],
      designation: sideDegree("dominant"),
      quality: () => "major",
    },
    {
      id: "K46",
      label: "K46",
      title: "终止四六和弦",
      scope: "A",
      degree: 1,
      degreeAlteration: 0,
      forms: ["triad"],
      fixedInversion: 2,
      designation: {
        notationSystem: "spasobin",
        kind: "cadential64",
        primaryFunction: "dominant",
      },
      quality: (mode) => (mode === "major" ? "major" : "minor"),
    },
    {
      id: "DD",
      label: "DD",
      title: "重属功能",
      scope: "A",
      degree: 5,
      degreeAlteration: 0,
      forms: ["triad", "seventh"],
      designation: {
        notationSystem: "spasobin",
        kind: "double-dominant",
        primaryFunction: "dominant",
      },
      fixedTarget: functionalTargetForDegree(5),
      quality: (_mode, form) => (form === "triad" ? "major" : "dominant7"),
    },
    {
      id: "DDVII",
      label: "DDVII",
      title: "重属导音功能",
      scope: "A",
      degree: 7,
      degreeAlteration: 0,
      forms: ["triad", "seventh"],
      designation: {
        notationSystem: "spasobin",
        kind: "double-dominant-leading-tone",
        primaryFunction: "dominant",
      },
      fixedTarget: functionalTargetForDegree(5),
      quality: (_mode, form) =>
        form === "triad" ? "diminished" : "diminished7",
    },
    {
      id: "N6",
      label: "N6",
      title: "那不勒斯六和弦",
      scope: "C",
      degree: 2,
      degreeAlteration: -1,
      forms: ["triad"],
      fixedInversion: 1,
      designation: {
        notationSystem: "spasobin",
        kind: "neapolitan",
        primaryFunction: "subdominant",
        specialRole: "neapolitan",
      },
      quality: () => "major",
    },
    ...(["italian", "french", "german"] as const).map(
      (variant): FunctionalBaseDefinition => ({
        id:
          variant === "italian"
            ? "It+6"
            : variant === "french"
              ? "Fr+6"
              : "Ger+6",
        label:
          variant === "italian"
            ? "It+6"
            : variant === "french"
              ? "Fr+6"
              : "Ger+6",
        title:
          variant === "italian"
            ? "意大利增六和弦"
            : variant === "french"
              ? "法国增六和弦"
              : "德国增六和弦",
        scope: "C",
        degree: 6,
        degreeAlteration: -1,
        minorDegreeAlteration: 0,
        forms: ["triad"],
        fixedInversion: 0,
        designation: {
          notationSystem: "spasobin",
          kind: "augmented-sixth",
          primaryFunction: "subdominant",
          specialRole:
            variant === "italian"
              ? "italian6"
              : variant === "french"
                ? "french6"
                : "german6",
        },
        quality: () => "major",
        augmentedSixthVariant: variant,
      }),
    ),
  ];

const DEFINITION_BY_ID = new Map(
  FUNCTIONAL_BASE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const FUNCTIONAL_TARGET_OPTIONS: ReadonlyArray<{
  id: "SII" | "DTIII" | "S" | "TSVI";
  label: string;
  target: FunctionalTarget;
}> = [
  { id: "SII", label: "SII", target: functionalTargetForDegree(2) },
  { id: "DTIII", label: "DTIII", target: functionalTargetForDegree(3) },
  { id: "S", label: "S", target: functionalTargetForDegree(4) },
  { id: "TSVI", label: "TSVI", target: functionalTargetForDegree(6) },
];

export function functionalDefinition(id: FunctionalBaseId) {
  return DEFINITION_BY_ID.get(id)!;
}

export function functionalScopeForForm(
  definition: FunctionalBaseDefinition,
  form: FunctionalChordForm,
) {
  return definition.formScopes?.[form] ?? definition.scope;
}

export function chordFormFromDraft(draft: ChordDraft): FunctionalChordForm {
  if (draft.extensions?.includes(9)) return "ninth";
  return isSeventhChord(draft.quality) ? "seventh" : "triad";
}

export function applyFunctionalDefinition(
  draft: ChordDraft,
  definition: FunctionalBaseDefinition,
  mode: KeyMode,
): ChordDraft {
  const form = definition.forms.includes(chordFormFromDraft(draft))
    ? chordFormFromDraft(draft)
    : definition.forms[0];
  const quality = definition.quality(mode, form);
  return {
    ...draft,
    degree: definition.degree,
    degreeAlteration: mode === "minor"
      ? definition.minorDegreeAlteration ?? definition.degreeAlteration
      : definition.degreeAlteration,
    quality,
    extensions: form === "ninth" ? [9] : [],
    alterations: [],
    augmentedSixthVariant: definition.augmentedSixthVariant,
    inversion: (definition.fixedInversion ??
      Math.min(
        draft.inversion,
        maximumInversionForDraft({
          ...draft,
          quality,
          extensions: form === "ninth" ? [9] : [],
          augmentedSixthVariant: definition.augmentedSixthVariant,
        }),
      )) as ChordDraft["inversion"],
    appliedTarget: definition.fixedTarget?.degree,
    appliedTargetFunction: definition.fixedTarget
      ? {
          primaryFunction: definition.fixedTarget.primaryFunction,
          secondaryFunction: definition.fixedTarget.secondaryFunction,
        }
      : undefined,
    designation: definition.designation,
    cadenceRole:
      definition.designation.kind === "cadential64" ? "cadential64" : undefined,
    mixture: undefined,
    secondaryInterpretation: undefined,
    alternatives: undefined,
  };
}

export function applyCadenceRole(
  draft: ChordDraft,
  cadenceRole: HarmonySemantics["cadenceRole"],
  mode: KeyMode,
): ChordDraft {
  if (cadenceRole === "cadential64")
    return applyFunctionalDefinition(draft, functionalDefinition("K46"), mode);

  if (
    draft.cadenceRole === "cadential64" ||
    draft.designation?.kind === "cadential64"
  ) {
    const tonic = applyFunctionalDefinition(
      draft,
      functionalDefinition(mode === "major" ? "T" : "t"),
      mode,
    );
    return { ...tonic, cadenceRole };
  }

  return {
    ...draft,
    cadenceRole,
    secondaryInterpretation: undefined,
    alternatives: undefined,
  };
}

export function applyFunctionalForm(
  draft: ChordDraft,
  definition: FunctionalBaseDefinition,
  form: FunctionalChordForm,
  mode: KeyMode,
): ChordDraft {
  if (!definition.forms.includes(form)) return draft;
  const quality = definition.quality(mode, form);
  return {
    ...draft,
    quality,
    extensions: form === "ninth" ? [9] : [],
    secondaryInterpretation: undefined,
    alternatives: undefined,
    inversion: (definition.fixedInversion ??
      Math.min(
        draft.inversion,
        maximumInversionForDraft({
          ...draft,
          quality,
          extensions: form === "ninth" ? [9] : [],
          augmentedSixthVariant: definition.augmentedSixthVariant,
        }),
      )) as ChordDraft["inversion"],
  };
}

export function applyFunctionalTarget(
  draft: ChordDraft,
  target: FunctionalTarget | undefined,
  functionalMode?: KeyMode,
): ChordDraft {
  const designation = draft.designation;
  if (!designation) return draft;
  const leadingTone = draft.degree === 7;
  // The applied-target context uses that target's major scale for root lookup.
  // Explicit Roman-numeral input supplies its own alteration.
  let degreeAlteration = draft.degreeAlteration;
  if (leadingTone && functionalMode)
    degreeAlteration = !target && functionalMode === "minor" ? 1 : 0;
  if (!target) {
    const nextKind =
      draft.degree === 7
        ? "side-degree"
        : draft.degree === 5
          ? "primary"
          : designation.kind;
    return {
      ...draft,
      degreeAlteration,
      appliedTarget: undefined,
      appliedTargetFunction: undefined,
      designation: { ...designation, kind: nextKind },
      secondaryInterpretation: undefined,
      alternatives: undefined,
    };
  }
  return {
    ...draft,
    degreeAlteration,
    appliedTarget: target.degree,
    appliedTargetFunction: {
      primaryFunction: target.primaryFunction,
      secondaryFunction: target.secondaryFunction,
    },
    designation: {
      ...designation,
      kind: leadingTone ? "applied-leading-tone" : "applied-dominant",
      primaryFunction: "dominant",
      secondaryFunction: undefined,
    },
    secondaryInterpretation: undefined,
    alternatives: undefined,
  };
}

export function functionalBaseIdFromDraft(
  draft: ChordDraft,
  keyMode?: KeyMode,
): FunctionalBaseId | undefined {
  if (draft.augmentedSixthVariant)
    return draft.augmentedSixthVariant === "italian"
      ? "It+6"
      : draft.augmentedSixthVariant === "french"
        ? "Fr+6"
        : "Ger+6";
  switch (draft.designation?.kind) {
    case "cadential64":
      return "K46";
    case "neapolitan":
      return "N6";
    case "double-dominant":
      return "DD";
    case "double-dominant-leading-tone":
      return "DDVII";
  }
  const primary = draft.designation?.primaryFunction;
  const secondary = draft.designation?.secondaryFunction;
  const mode = draft.localKey?.mode ?? keyMode;
  const naturalMinorTriad = draft.quality === "major" && !draft.appliedTarget && (
    (mode === "minor" && draft.degreeAlteration === 0) ||
    (mode !== "minor" && draft.degreeAlteration === -1) ||
    (!mode && draft.degreeAlteration === 0 && /^inferred:(dtIII|dVII):/.test(draft.interpretationId ?? ""))
  );
  if (draft.degree === 2 && primary === "subdominant") return "SII";
  if (draft.degree === 3 && primary === "dominant" && secondary === "tonic")
    return naturalMinorTriad ? "dtIII" : "DTIII";
  if (draft.degree === 6 && primary === "tonic" && secondary === "subdominant")
    return "TSVI";
  if (draft.degree === 7 && primary === "dominant")
    return naturalMinorTriad ? "dVII" : "DVII";
  if (draft.degree === 1 && primary === "tonic")
    return draft.quality === "minor" ? "t" : "T";
  if (draft.degree === 4 && primary === "subdominant")
    return ["minor", "minor7"].includes(draft.quality) ? "s" : "S";
  if (draft.degree === 5 && primary === "dominant")
    return draft.quality === "minor" ? "d" : "D";
  return undefined;
}

export function inferredFunctionalDefinition(
  semantics: HarmonySemantics,
  quality: ChordQuality | undefined,
  keyMode?: KeyMode,
): FunctionalBaseDefinition | undefined {
  if (semantics.cadenceRole === "cadential64")
    return functionalDefinition("K46");

  const primary = primaryHarmonyInterpretation(semantics);
  const explicitDraft = {
    degree: primary.degree,
    degreeAlteration: primary.degreeAlteration,
    interpretationId: primary.id,
    localKey: primary.localKey,
    appliedTarget: primary.appliedTarget?.degree,
    quality: quality ?? "major",
    inversion: 0,
    designation: primary.designation,
    augmentedSixthVariant:
      primary.designation?.specialRole === "italian6"
        ? "italian"
        : primary.designation?.specialRole === "french6"
          ? "french"
          : primary.designation?.specialRole === "german6"
            ? "german"
            : undefined,
    source: primary.source,
    confidence: primary.confidence,
  } satisfies ChordDraft;
  const explicitId = functionalBaseIdFromDraft(explicitDraft, keyMode);
  if (explicitId) return functionalDefinition(explicitId);

  if (primary.degreeAlteration === -1 && primary.degree === 2)
    return functionalDefinition("N6");
  if (primary.appliedTarget?.degree === 5)
    return functionalDefinition(primary.degree === 7 ? "DDVII" : "DD");
  if (primary.appliedTarget)
    return functionalDefinition(primary.degree === 7 ? "DVII" : "D");
  if (primary.degree === 1)
    return functionalDefinition(quality === "minor" ? "t" : "T");
  if (primary.degree === 2) return functionalDefinition("SII");
  if (primary.degree === 3) return functionalDefinition("DTIII");
  if (primary.degree === 4)
    return functionalDefinition(
      quality === "minor" || quality === "minor7" ? "s" : "S",
    );
  if (primary.degree === 5)
    return functionalDefinition(quality === "minor" ? "d" : "D");
  if (primary.degree === 6) return functionalDefinition("TSVI");
  if (primary.degree === 7) return functionalDefinition("DVII");
  return undefined;
}

export function effectiveFunctionalDesignation(
  semantics: HarmonySemantics,
  quality: ChordQuality | undefined,
): FunctionalDesignation | undefined {
  if (semantics.cadenceRole === "cadential64")
    return functionalDefinition("K46").designation;
  const primary = primaryHarmonyInterpretation(semantics);
  return (
    primary.designation ??
    inferredFunctionalDefinition(semantics, quality)?.designation
  );
}

export function targetFunctionalLabel(target: FunctionalTarget) {
  const familyLetter = (family: FunctionalFamily) =>
    family === "tonic" ? "T" : family === "subdominant" ? "S" : "D";
  const prefix = `${familyLetter(target.primaryFunction)}${
    target.secondaryFunction ? familyLetter(target.secondaryFunction) : ""
  }`;
  if (
    (target.degree === 1 && prefix === "T") ||
    (target.degree === 4 && prefix === "S") ||
    (target.degree === 5 && prefix === "D")
  )
    return prefix;
  return `${prefix}${["I", "II", "III", "IV", "V", "VI", "VII"][target.degree - 1]}`;
}

export function inversionFigures(
  form: FunctionalChordForm,
  inversion: ReturnType<typeof chordIdentityInversion>,
) {
  if (form === "ninth") return "9";
  return form === "seventh"
    ? ["7", "56", "34", "2"][inversion]
    : ["", "6", "46"][inversion];
}

export interface CompatibleFunctionalInterpretation {
  id: string;
  baseId: FunctionalBaseId;
  form: FunctionalChordForm;
  localKey: NonNullable<HarmonyInterpretation["localKey"]>;
  interpretation: HarmonyInterpretation;
}

export function compatibleFunctionalInterpretations(
  identity: ChordIdentity,
): readonly CompatibleFunctionalInterpretation[] {
  const inversion = chordIdentityInversion(identity);
  const candidates: CompatibleFunctionalInterpretation[] = [];
  for (const mode of ["major", "minor"] as const) {
    for (const tonic of keyTonicOptions(mode)) {
      const localKey = { tonic, mode };
      for (const definition of FUNCTIONAL_BASE_DEFINITIONS) {
        for (const form of definition.forms) {
          if (
            (definition.fixedInversion !== undefined &&
              definition.fixedInversion !== inversion) ||
            (form === "ninth" && inversion !== 0) ||
            (form === "triad" && inversion > 2)
          )
            continue;
          let draft = applyFunctionalDefinition(
            {
              degree: 1,
              degreeAlteration: 0,
              quality: chordStructureQuality(identity) ?? "major",
              extensions: [],
              alterations: [],
              inversion,
              localKey,
              source: "confirmed",
              confidence: "ambiguous",
            },
            definition,
            mode,
          );
          draft = {
            ...applyFunctionalForm(draft, definition, form, mode),
            inversion,
          };
          if (
            !chordIdentityEquals(
              resolveChordIdentity(draft, localKey),
              identity,
            )
          )
            continue;
          const interpretation = primaryHarmonyInterpretation(
            semanticsFromChordDraft(draft),
          );
          const id = `${serializePitchClass(tonic)}:${mode}:${definition.id}:${form}`;
          candidates.push({
            id,
            baseId: definition.id,
            form,
            localKey,
            interpretation: {
              ...interpretation,
              id,
              localKey,
              source: "confirmed",
              confidence: "ambiguous",
            },
          });
        }
      }
    }
  }
  return candidates;
}
