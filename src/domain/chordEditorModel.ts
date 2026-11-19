import {
  chordIdentityInversion,
  maximumInversionForDraft,
  primaryHarmonyInterpretation,
  resolveChordIdentity,
  semanticsFromChordDraft,
  type ChordDraft,
  type HarmonyInterpretation,
  type KeyReference,
} from "./chordModel";
import {
  FUNCTIONAL_BASE_DEFINITIONS,
  FUNCTIONAL_TARGET_OPTIONS,
  applyFunctionalDefinition,
  applyFunctionalForm,
  applyFunctionalTarget,
  applyCadenceRole,
  chordFormFromDraft,
  compatibleFunctionalInterpretations,
  functionalBaseIdFromDraft,
  functionalDefinition,
  functionalDefinitionSupportsMode,
  type CompatibleFunctionalInterpretation,
  type FunctionalBaseDefinition,
  type FunctionalBaseId,
  type FunctionalChordForm,
} from "./functionalHarmonyCatalog";
import type { KeyEvent } from "./project/types";
import { serializePitchClass } from "./pitch";

export interface ChordToneAlterationChoice {
  readonly label: string;
  readonly degree?: 5 | 9;
  readonly alter?: -1 | 1;
  readonly tendency?: "up" | "down";
}

export const CHORD_TONE_ALTERATIONS: readonly ChordToneAlterationChoice[] = [
  { label: "无" },
  { label: "♭5", degree: 5, alter: -1, tendency: "down" },
  { label: "♯5", degree: 5, alter: 1, tendency: "up" },
  { label: "♭9", degree: 9, alter: -1, tendency: "down" },
  { label: "♯9", degree: 9, alter: 1, tendency: "up" },
] as const;

export type ChordEditorAction =
  | { type: "select-functional-definition"; id: FunctionalBaseId }
  | { type: "select-functional-form"; form: FunctionalChordForm }
  | { type: "set-inversion"; inversion: ChordDraft["inversion"] }
  | { type: "set-applied-target"; degree?: number }
  | { type: "set-structural-applied-target"; degree?: ChordDraft["appliedTarget"] }
  | { type: "set-tone-alteration"; choice: ChordToneAlterationChoice }
  | { type: "set-alteration-tendency"; tendency?: "up" | "down" }
  | { type: "set-quality"; quality: ChordDraft["quality"] }
  | { type: "set-degree"; degree: ChordDraft["degree"] }
  | { type: "set-degree-alteration"; alteration: ChordDraft["degreeAlteration"] }
  | { type: "set-mixture"; mixture?: ChordDraft["mixture"] }
  | { type: "set-cadence-role"; cadenceRole?: ChordDraft["cadenceRole"] }
  | {
      type: "set-pedal-role";
      role?: NonNullable<ChordDraft["pedalContext"]>["role"];
    }
  | { type: "set-pedal-pitch"; pitch: NonNullable<ChordDraft["pedalContext"]>["pitch"] }
  | { type: "set-secondary-enabled"; enabled: boolean }
  | { type: "select-secondary"; candidateId: string };

function fallbackKey(keyEvent: KeyEvent): KeyReference {
  return { tonic: keyEvent.tonic, mode: keyEvent.mode };
}

/** 比较音乐语义，而不依赖 UI 产生的临时 interpretation id。 */
export function harmonyInterpretationEquals(
  left: HarmonyInterpretation,
  right: HarmonyInterpretation,
  fallback: KeyReference,
) {
  const leftKey = left.localKey ?? fallback;
  const rightKey = right.localKey ?? fallback;
  return (
    serializePitchClass(leftKey.tonic) === serializePitchClass(rightKey.tonic) &&
    leftKey.mode === rightKey.mode &&
    left.degree === right.degree &&
    left.degreeAlteration === right.degreeAlteration &&
    JSON.stringify(left.appliedTarget) === JSON.stringify(right.appliedTarget) &&
    JSON.stringify(left.designation) === JSON.stringify(right.designation)
  );
}

export interface ChordEditorModel {
  readonly draft: ChordDraft;
  readonly baseId?: FunctionalBaseId;
  readonly baseDefinition?: FunctionalBaseDefinition;
  readonly availableDefinitions: readonly FunctionalBaseDefinition[];
  readonly form: FunctionalChordForm;
  readonly maximumInversion: ChordDraft["inversion"];
  readonly canApplyTarget: boolean;
  readonly canAlterTone: boolean;
  readonly identityInversion: ChordDraft["inversion"];
  readonly compatibleCandidates: readonly CompatibleFunctionalInterpretation[];
  readonly secondaryCandidates: readonly CompatibleFunctionalInterpretation[];
  readonly secondaryKeyOptions: readonly CompatibleFunctionalInterpretation[];
  readonly selectedSecondaryCandidate?: CompatibleFunctionalInterpretation;
}

export function createChordEditorModel(
  draft: ChordDraft,
  keyEvent: KeyEvent,
): ChordEditorModel {
  const baseId = functionalBaseIdFromDraft(draft, keyEvent.mode);
  const baseDefinition = baseId ? functionalDefinition(baseId) : undefined;
  const identity = resolveChordIdentity(draft, keyEvent);
  const mode = draft.localKey?.mode ?? keyEvent.mode;
  const primary = primaryHarmonyInterpretation(semanticsFromChordDraft(draft));
  const fallback = primary.localKey ?? fallbackKey(keyEvent);
  const compatibleCandidates = compatibleFunctionalInterpretations(identity);
  const secondaryCandidates = compatibleCandidates.filter(
    (candidate) => !harmonyInterpretationEquals(candidate.interpretation, primary, fallback),
  );
  const selectedSecondaryCandidate = draft.secondaryInterpretation
    ? secondaryCandidates.find((candidate) =>
        harmonyInterpretationEquals(
          candidate.interpretation,
          draft.secondaryInterpretation!,
          fallback,
        ),
      )
    : undefined;
  const secondaryKeyOptions = [
    ...new Map(
      secondaryCandidates.map((candidate) => [
        `${serializePitchClass(candidate.localKey.tonic)}:${candidate.localKey.mode}`,
        candidate,
      ]),
    ).values(),
  ];
  return Object.freeze({
    draft,
    baseId,
    baseDefinition,
    availableDefinitions: FUNCTIONAL_BASE_DEFINITIONS.filter(definition => functionalDefinitionSupportsMode(definition, mode)),
    form: chordFormFromDraft(draft),
    maximumInversion: maximumInversionForDraft(draft),
    canApplyTarget: baseId === "D" || baseId === "DVII",
    canAlterTone: baseId === "D" || baseId === "DD",
    identityInversion: chordIdentityInversion(identity),
    compatibleCandidates,
    secondaryCandidates,
    secondaryKeyOptions,
    selectedSecondaryCandidate,
  });
}

/**
 * 所有需要清除共同和弦第二解释的领域编辑动作集中在这里。两个 UI 只负责
 * 选择 action 和呈现控件，不能各自决定如何修正 draft。
 */
export function applyChordEditorAction(
  draft: ChordDraft,
  keyEvent: KeyEvent,
  action: ChordEditorAction,
): ChordDraft {
  const model = createChordEditorModel(draft, keyEvent);
  const mode = draft.localKey?.mode ?? keyEvent.mode;
  switch (action.type) {
    case "select-functional-definition": {
      const definition = functionalDefinition(action.id);
      return functionalDefinitionSupportsMode(definition, mode)
        ? applyFunctionalDefinition(draft, definition, mode) : draft;
    }
    case "select-functional-form":
      return model.baseDefinition
        ? applyFunctionalForm(
            draft,
            model.baseDefinition,
            action.form,
            mode,
          )
        : draft;
    case "set-inversion":
      return {
        ...draft,
        inversion: Math.min(action.inversion, model.maximumInversion) as ChordDraft["inversion"],
        secondaryInterpretation: undefined,
      };
    case "set-applied-target":
      return applyFunctionalTarget(
        draft,
        FUNCTIONAL_TARGET_OPTIONS.find((item) => item.target.degree === action.degree)
          ?.target,
        mode,
      );
    case "set-structural-applied-target":
      return {
        ...draft,
        appliedTarget: action.degree,
        appliedTargetFunction: undefined,
        designation: undefined,
        secondaryInterpretation: undefined,
      };
    case "set-tone-alteration": {
      const altered = Boolean(action.choice.degree && action.choice.alter);
      return {
        ...draft,
        alterations: altered
          ? [
              {
                degree: action.choice.degree!,
                alter: action.choice.alter!,
                tendency: action.choice.tendency!,
              },
            ]
          : [],
        designation:
          model.baseId === "D" && draft.designation
            ? {
                ...draft.designation,
                kind: altered
                  ? "altered-dominant"
                  : draft.appliedTarget
                    ? "applied-dominant"
                    : "primary",
              }
            : draft.designation,
        secondaryInterpretation: undefined,
      };
    }
    case "set-alteration-tendency": {
      const alteration = draft.alterations?.[0];
      if (!alteration) return draft;
      return {
        ...draft,
        alterations: [{ ...alteration, tendency: action.tendency }],
        secondaryInterpretation: undefined,
      };
    }
    case "set-quality": {
      const next = {
        ...draft,
        quality: action.quality,
        extensions: [],
        augmentedSixthVariant: undefined,
      };
      return {
        ...next,
        inversion: Math.min(
          next.inversion,
          maximumInversionForDraft(next),
        ) as ChordDraft["inversion"],
        designation: undefined,
        secondaryInterpretation: undefined,
      };
    }
    case "set-degree":
      return {
        ...draft,
        degree: action.degree,
        designation: undefined,
        secondaryInterpretation: undefined,
      };
    case "set-degree-alteration":
      return {
        ...draft,
        degreeAlteration: action.alteration,
        designation: undefined,
        secondaryInterpretation: undefined,
      };
    case "set-mixture":
      return {
        ...draft,
        mixture: action.mixture,
      };
    case "set-cadence-role":
      return applyCadenceRole(draft, action.cadenceRole, keyEvent.mode);
    case "set-pedal-role":
      return {
        ...draft,
        pedalContext: action.role
          ? {
              pitch: draft.pedalContext?.pitch ?? resolveChordIdentity(draft, keyEvent).bass,
              role: action.role,
            }
          : undefined,
      };
    case "set-pedal-pitch":
      return draft.pedalContext
        ? {
            ...draft,
            pedalContext: { ...draft.pedalContext, pitch: action.pitch },
          }
        : draft;
    case "set-secondary-enabled":
      return {
        ...draft,
        secondaryInterpretation: action.enabled
          ? model.secondaryCandidates[0]?.interpretation
          : undefined,
      };
    case "select-secondary":
      return {
        ...draft,
        secondaryInterpretation: model.secondaryCandidates.find(
          (candidate) => candidate.id === action.candidateId,
        )?.interpretation,
      };
  }
}
