import {
  applyFunctionalDefinition,
  applyFunctionalTarget,
  FUNCTIONAL_BASE_DEFINITIONS,
  type FunctionalBaseDefinition,
  type FunctionalBaseId,
  type FunctionalChordForm,
} from "../../functionalHarmonyCatalog";
import {
  resolveChordIdentity,
  functionalTargetForDegree,
  semanticsFromChordDraft,
  type ChordDraft,
  type ChordIdentity,
  type HarmonySemantics,
  type KeyReference,
} from "../../chordModel";
import type { KeyEvent } from "../../project";
import type { FunctionalChordTemplate } from "./types";

function inversionsFor(
  definition: FunctionalBaseDefinition,
  form: FunctionalChordForm,
) {
  if (definition.fixedInversion !== undefined)
    return [definition.fixedInversion] as const;
  const maximum =
    form === "ninth"
      ? 0
      : form === "seventh"
        ? 3
        : 2;
  return Array.from({ length: maximum + 1 }, (_, index) =>
    index as 0 | 1 | 2 | 3,
  );
}

export function buildFunctionalTemplates(
  key: KeyEvent,
): readonly FunctionalChordTemplate[] {
  return Object.freeze(
    FUNCTIONAL_BASE_DEFINITIONS.filter((definition) =>
      definition.id !== "DD++43" &&
      (key.mode === "minor" || (definition.id !== "dtIII" && definition.id !== "dVII")),
    ).flatMap((definition) =>
      definition.forms.flatMap((form) =>
        inversionsFor(definition, form).map((expectedInversion) => ({
          baseId: definition.id,
          definition,
          form,
          localKeyPolicy: "current-key" as const,
          expectedInversion,
        })),
      ),
    ),
  );
}

export function draftForFunctionalTemplate(
  template: FunctionalChordTemplate,
  key: KeyEvent,
): ChordDraft {
  const { definition, form, expectedInversion } = template;
  const quality = definition.quality(key.mode, form);
  const draft = applyFunctionalDefinition(
    {
      degree: 1,
      degreeAlteration: 0,
      quality,
      extensions: form === "ninth" ? [9] : [],
      alterations: [],
      inversion: expectedInversion,
      source: "inferred",
      confidence: "probable",
    },
    definition,
    key.mode,
  );
  return {
    ...(template.appliedTarget
      ? applyFunctionalTarget(draft, functionalTargetForDegree(template.appliedTarget), key.mode)
      : draft),
    interpretationId: `inferred:${definition.id}:${form}:${expectedInversion}${template.appliedTarget ? "/" + template.appliedTarget : ""}`,
    source: "inferred",
    confidence: "probable",
  };
}

export function identityForFunctionalTemplate(
  template: FunctionalChordTemplate,
  key: KeyEvent,
  localKey?: KeyReference,
) {
  const draft = { ...draftForFunctionalTemplate(template, key), localKey };
  return {
    draft,
    identity: resolveChordIdentity(draft, key),
    semantics: semanticsFromChordDraft(draft),
  } satisfies {
    draft: ChordDraft;
    identity: ChordIdentity;
    semantics: HarmonySemantics;
  };
}

export function functionalTier(baseId: FunctionalBaseId): 0 | 1 | 2 {
  if (baseId === "DD" || baseId === "DDVII") return 1;
  if (
    baseId === "K46" ||
    baseId === "N6" ||
    baseId === "It+6" ||
    baseId === "Fr+6" ||
    baseId === "Ger+6" ||
    baseId === "DD++43"
  )
    return 2;
  return 0;
}

export function functionalTemplateKey(
  template: FunctionalChordTemplate,
  key: KeyReference,
) {
  const target = template.appliedTarget ? `/${template.appliedTarget}` : "";
  return `${key.tonic.step}:${key.tonic.alter}:${key.mode}:${template.baseId}:${template.form}:${template.expectedInversion}${target}`;
}
