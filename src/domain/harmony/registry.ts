import type { HarmonyAnalysis } from "../harmonyAnalysis";
import {
  RuleScheduler,
  runRulesSynchronously,
  type HarmonyCheckResult,
  type RuleConfig,
  type RuleDefinition,
  type RuleDiagnostic,
  type RuleStateEnvelope,
  type RuleStepContext,
} from "../harmonyRuntime";
import {
  HARMONY_RULE_DEFINITIONS,
  defaultHarmonyRuleSeverities,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
  type RuleExceptionPolicy,
} from "../harmonyRules";
import type { ProjectDocument } from "../model";
import { evaluation } from "./rules/helpers/core";
import {
  chordInterpretationIdentityRule,
  chordSliceRule,
} from "./rules/groups/chord";
import {
  augmentedSixthResolutionRule,
  deceptiveCadenceTargetRule,
  deceptiveVoiceLeadingRule,
} from "./rules/groups/connection";
import {
  cadential64ResolutionRule,
  doubleDominantTargetRule,
  functionalRetrogressionRule,
  mixtureSourceRule,
} from "./rules/groups/function";
import {
  augmentedDiminishedIntervalRule,
  melodicLeapRule,
} from "./rules/groups/melody";
import {
  alteredToneStateStep,
  dominantNinthStateStep,
  leadingToneStateStep,
  secondaryDominantStateStep,
  seventhStateStep,
} from "./rules/groups/stateful";
import {
  noteOverlapRule,
  verticalRule,
  voiceRangeRule,
} from "./rules/groups/voice";
import {
  crossRelationRule,
  voiceLeadingRule,
} from "./rules/groups/voiceLeading";

type StatefulHarmonyRuleId =
  | "resolution.leading-tone"
  | "resolution.chord-seventh"
  | "resolution.dominant-ninth"
  | "resolution.altered-tone"
  | "function.applied-dominant-target";
type StatelessHarmonyRuleId =
  | "voice.range"
  | "voice.polyphonic-overlap"
  | "voice.crossing"
  | "voice.upper-spacing"
  | "voice-leading.overlap"
  | "voice-leading.unequal-fifths-perfect-to-diminished"
  | "voice-leading.unequal-fifths-outer-diminished-to-perfect"
  | "voice-leading.unequal-fifths-inner-diminished-to-perfect"
  | "voice-leading.parallel-fifths"
  | "voice-leading.parallel-octaves"
  | "voice-leading.hidden-fifth"
  | "voice-leading.hidden-octave"
  | "voice-leading.cross-relation-simultaneous"
  | "voice-leading.cross-relation-successive"
  | "melody.leap-over-octave"
  | "melody.large-leap"
  | "melody.tritone"
  | "melody.augmented-interval"
  | "melody.diminished-interval"
  | "chord.unclassified-nonchord-tone"
  | "chord.incomplete-members"
  | "chord.inversion-bass"
  | "chord.interpretation-identity-conflict"
  | "chord.doubled-leading-tone"
  | "chord.doubled-seventh"
  | "chord.doubled-altered-tendency-tone"
  | "chord.dominant-ninth-voicing"
  | "chord.dominant-ninth-root-spacing"
  | "chord.augmented-sixth-voicing"
  | "function.retrogression"
  | "function.double-dominant-target"
  | "function.cadential64-target"
  | "function.deceptive-cadence-target"
  | "connection.deceptive-voice-leading"
  | "connection.italian-augmented-sixth"
  | "connection.french-augmented-sixth"
  | "connection.german-augmented-sixth"
  | "tonality.mixture-source"
  | "resolution.augmented-sixth";

const evaluators: Record<
  StatelessHarmonyRuleId,
  (analysis: HarmonyAnalysis, config: RuleConfig) => RuleDiagnostic[]
> = {
  "voice.range": (analysis, config) => voiceRangeRule(analysis, config),
  "voice.polyphonic-overlap": (analysis) => noteOverlapRule(analysis),
  "voice.crossing": (analysis) => verticalRule(analysis, "voice.crossing"),
  "voice.upper-spacing": (analysis) => verticalRule(analysis, "voice.upper-spacing"),
  "voice-leading.overlap": (analysis) => voiceLeadingRule(analysis, "voice-leading.overlap"),
  "voice-leading.unequal-fifths-perfect-to-diminished": (analysis, config) =>
    voiceLeadingRule(
      analysis,
      "voice-leading.unequal-fifths-perfect-to-diminished",
      config,
    ),
  "voice-leading.unequal-fifths-outer-diminished-to-perfect": (
    analysis,
    config,
  ) =>
    voiceLeadingRule(
      analysis,
      "voice-leading.unequal-fifths-outer-diminished-to-perfect",
      config,
    ),
  "voice-leading.unequal-fifths-inner-diminished-to-perfect": (
    analysis,
    config,
  ) =>
    voiceLeadingRule(
      analysis,
      "voice-leading.unequal-fifths-inner-diminished-to-perfect",
      config,
    ),
  "melody.leap-over-octave": (analysis) =>
    melodicLeapRule(analysis, "melody.leap-over-octave"),
  "melody.large-leap": (analysis) =>
    melodicLeapRule(analysis, "melody.large-leap"),
  "melody.tritone": (analysis) => melodicLeapRule(analysis, "melody.tritone"),
  "melody.augmented-interval": (analysis) =>
    augmentedDiminishedIntervalRule(analysis, "melody.augmented-interval"),
  "melody.diminished-interval": (analysis) =>
    augmentedDiminishedIntervalRule(analysis, "melody.diminished-interval"),
  "voice-leading.cross-relation-simultaneous": (analysis, config) =>
    crossRelationRule(
      analysis,
      "voice-leading.cross-relation-simultaneous",
      config,
    ),
  "voice-leading.cross-relation-successive": (analysis, config) =>
    crossRelationRule(
      analysis,
      "voice-leading.cross-relation-successive",
      config,
    ),
  "voice-leading.parallel-fifths": (analysis) =>
    voiceLeadingRule(analysis, "voice-leading.parallel-fifths"),
  "voice-leading.parallel-octaves": (analysis) =>
    voiceLeadingRule(analysis, "voice-leading.parallel-octaves"),
  "voice-leading.hidden-fifth": (analysis) =>
    voiceLeadingRule(analysis, "voice-leading.hidden-fifth"),
  "voice-leading.hidden-octave": (analysis) =>
    voiceLeadingRule(analysis, "voice-leading.hidden-octave"),
  "chord.unclassified-nonchord-tone": (analysis) =>
    chordSliceRule(analysis, "chord.unclassified-nonchord-tone"),
  "chord.incomplete-members": (analysis) =>
    chordSliceRule(analysis, "chord.incomplete-members"),
  "chord.inversion-bass": (analysis) => chordSliceRule(analysis, "chord.inversion-bass"),
  "chord.interpretation-identity-conflict": (analysis) =>
    chordInterpretationIdentityRule(analysis),
  "chord.doubled-leading-tone": (analysis) =>
    chordSliceRule(analysis, "chord.doubled-leading-tone"),
  "chord.doubled-seventh": (analysis) =>
    chordSliceRule(analysis, "chord.doubled-seventh"),
  "chord.doubled-altered-tendency-tone": (analysis) =>
    chordSliceRule(analysis, "chord.doubled-altered-tendency-tone"),
  "chord.dominant-ninth-voicing": (analysis, config) =>
    chordSliceRule(analysis, "chord.dominant-ninth-voicing", config),
  "chord.dominant-ninth-root-spacing": (analysis, config) =>
    chordSliceRule(analysis, "chord.dominant-ninth-root-spacing", config),
  "chord.augmented-sixth-voicing": (analysis, config) =>
    chordSliceRule(analysis, "chord.augmented-sixth-voicing", config),
  "resolution.augmented-sixth": (analysis) =>
    augmentedSixthResolutionRule(analysis),
  "connection.italian-augmented-sixth": (analysis) =>
    augmentedSixthResolutionRule(
      analysis,
      "connection.italian-augmented-sixth",
    ),
  "connection.french-augmented-sixth": (analysis) =>
    augmentedSixthResolutionRule(
      analysis,
      "connection.french-augmented-sixth",
    ),
  "connection.german-augmented-sixth": (analysis) =>
    augmentedSixthResolutionRule(
      analysis,
      "connection.german-augmented-sixth",
    ),
  "function.retrogression": (analysis) =>
    functionalRetrogressionRule(analysis),
  "function.double-dominant-target": (analysis) =>
    doubleDominantTargetRule(analysis),
  "function.cadential64-target": (analysis) => cadential64ResolutionRule(analysis),
  "function.deceptive-cadence-target": (analysis) =>
    deceptiveCadenceTargetRule(analysis),
  "connection.deceptive-voice-leading": (analysis) =>
    deceptiveVoiceLeadingRule(analysis),
  "tonality.mixture-source": (analysis) => mixtureSourceRule(analysis),
};

export const BUILTIN_HARMONY_RULES: readonly RuleDefinition[] =
  HARMONY_RULE_DEFINITIONS.filter((definition) => definition.implemented).map((definition) => {
    if (definition.id === "resolution.leading-tone") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => leadingToneStateStep(context, incoming),
      };
    }
    if (definition.id === "resolution.chord-seventh") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => seventhStateStep(context, incoming),
      };
    }
    if (definition.id === "resolution.dominant-ninth") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => dominantNinthStateStep(context, incoming),
      };
    }
    if (definition.id === "resolution.altered-tone") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => alteredToneStateStep(context, incoming),
      };
    }
    if (definition.id === "function.applied-dominant-target") {
      return {
        ...definition,
        process: (
          context: RuleStepContext,
          incoming: readonly RuleStateEnvelope[],
        ) => secondaryDominantStateStep(context, incoming),
      };
    }
    return {
      ...definition,
      evaluate: ({ analysis }: { analysis: HarmonyAnalysis }, config: RuleConfig) =>
        evaluation(
          evaluators[definition.id as StatelessHarmonyRuleId](analysis, config),
        ),
    };
  });

export function createHarmonyRuleScheduler() {
  return new RuleScheduler(BUILTIN_HARMONY_RULES);
}

export function checkHarmony(
  project: ProjectDocument,
  ruleSeverities: HarmonyRuleSeverities = defaultHarmonyRuleSeverities(),
  configs: Partial<Record<HarmonyRuleId, RuleConfig>> = {},
  exceptions: Partial<Record<HarmonyRuleId, RuleExceptionPolicy>> = {},
): HarmonyCheckResult {
  return runRulesSynchronously(
    BUILTIN_HARMONY_RULES,
    project,
    ruleSeverities,
    0,
    configs,
    exceptions,
  );
}
