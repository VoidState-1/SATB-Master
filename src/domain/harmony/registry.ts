import type { HarmonyAnalysis } from "./analysis";
import {
  RuleScheduler,
  runRulesSynchronously,
  type HarmonyCheckResult,
  type RuleConfig,
  type RuleDefinition,
  type RuleDiagnostic,
  type RuleStateEnvelope,
  type RuleStepContext,
} from "./runtime";
import {
  HARMONY_RULE_DEFINITIONS,
  defaultHarmonyRuleSeverities,
  type HarmonyRuleId,
  type HarmonyRuleSeverities,
  type RuleExceptionPolicy,
} from "./ruleTypes";
import type { ProjectDocument } from "../project";
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
  melodicContourRule,
  melodicLeapRule,
} from "./rules/groups/melody";
import {
  allVoicesSimilarRule,
  basicConnectionRule,
  incompleteSatbRule,
  triadVoicingRule,
} from "./rules/groups/basicTeaching";
import { nonchordRoleRule } from "./rules/groups/nonchord";
import {
  ambiguousConnectionRule,
  secondInversionContextRule,
  specializedConnectionRule,
} from "./rules/groups/specializedConnections";
import {
  cadenceRule,
  cadential64MetricRule,
  harmonicSyncopationRule,
  pivotReinterpretationRule,
  tonicizationModulationConflictRule,
  unmarkedKeyChangeRule,
} from "./rules/groups/rhythmCadenceTonality";
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
  | "voice.incomplete-satb"
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
  | "voice-leading.all-voices-similar"
  | "melody.leap-over-octave"
  | "melody.large-leap"
  | "melody.tritone"
  | "melody.augmented-interval"
  | "melody.diminished-interval"
  | "melody.leap-recovery"
  | "melody.consecutive-leaps"
  | "chord.unclassified-nonchord-tone"
  | "chord.incomplete-members"
  | "chord.inversion-bass"
  | "chord.interpretation-identity-conflict"
  | "chord.triad-root-position-doubling"
  | "chord.first-inversion-doubling"
  | "chord.second-inversion-voicing"
  | "chord.doubled-leading-tone"
  | "chord.doubled-seventh"
  | "chord.doubled-altered-tendency-tone"
  | "chord.dominant-ninth-voicing"
  | "chord.dominant-ninth-root-spacing"
  | "chord.augmented-sixth-voicing"
  | "nonchord.passing-tone"
  | "nonchord.neighbor-tone"
  | "nonchord.suspension-preparation"
  | "nonchord.suspension-resolution"
  | "nonchord.retardation"
  | "nonchord.appoggiatura"
  | "nonchord.anticipation"
  | "nonchord.pedal-point"
  | "function.retrogression"
  | "function.double-dominant-target"
  | "function.cadential64-target"
  | "function.deceptive-cadence-target"
  | "function.ambiguous-connection"
  | "connection.dominant-seventh"
  | "connection.dominant-ninth"
  | "connection.leading-tone-seventh"
  | "connection.supertonic-seventh"
  | "connection.subdominant-seventh"
  | "connection.double-dominant-seventh"
  | "connection.double-dominant-leading-tone"
  | "connection.neapolitan-sixth"
  | "connection.deceptive-voice-leading"
  | "connection.italian-augmented-sixth"
  | "connection.french-augmented-sixth"
  | "connection.german-augmented-sixth"
  | "connection.second-inversion-context"
  | "connection.common-tone-fourth-fifth"
  | "connection.second-relation-contrary-motion"
  | "connection.common-tone-third"
  | "connection.nonparsimonious-motion"
  | "rhythm.harmonic-syncopation"
  | "cadence.cadential64-metric-position"
  | "cadence.bass-formula"
  | "cadence.perfect-authentic-soprano"
  | "cadence.unstable-ending"
  | "tonality.unmarked-key-change"
  | "tonality.pivot-reinterpretation"
  | "tonality.tonicization-modulation-conflict"
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
  "voice.incomplete-satb": (analysis) => incompleteSatbRule(analysis),
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
  "melody.leap-recovery": (analysis) =>
    melodicContourRule(analysis, "melody.leap-recovery"),
  "melody.consecutive-leaps": (analysis) =>
    melodicContourRule(analysis, "melody.consecutive-leaps"),
  "voice-leading.all-voices-similar": (analysis) =>
    allVoicesSimilarRule(analysis),
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
  "chord.triad-root-position-doubling": (analysis) =>
    triadVoicingRule(analysis, "chord.triad-root-position-doubling"),
  "chord.first-inversion-doubling": (analysis) =>
    triadVoicingRule(analysis, "chord.first-inversion-doubling"),
  "chord.second-inversion-voicing": (analysis) =>
    triadVoicingRule(analysis, "chord.second-inversion-voicing"),
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
  "nonchord.passing-tone": (analysis) =>
    nonchordRoleRule(analysis, "nonchord.passing-tone"),
  "nonchord.neighbor-tone": (analysis) =>
    nonchordRoleRule(analysis, "nonchord.neighbor-tone"),
  "nonchord.suspension-preparation": (analysis) =>
    nonchordRoleRule(analysis, "nonchord.suspension-preparation"),
  "nonchord.suspension-resolution": (analysis) =>
    nonchordRoleRule(analysis, "nonchord.suspension-resolution"),
  "nonchord.retardation": (analysis) =>
    nonchordRoleRule(analysis, "nonchord.retardation"),
  "nonchord.appoggiatura": (analysis) =>
    nonchordRoleRule(analysis, "nonchord.appoggiatura"),
  "nonchord.anticipation": (analysis) =>
    nonchordRoleRule(analysis, "nonchord.anticipation"),
  "nonchord.pedal-point": (analysis) =>
    nonchordRoleRule(analysis, "nonchord.pedal-point"),
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
  "function.ambiguous-connection": (analysis) =>
    ambiguousConnectionRule(analysis),
  "connection.dominant-seventh": (analysis) =>
    specializedConnectionRule(analysis, "connection.dominant-seventh"),
  "connection.dominant-ninth": (analysis) =>
    specializedConnectionRule(analysis, "connection.dominant-ninth"),
  "connection.leading-tone-seventh": (analysis) =>
    specializedConnectionRule(analysis, "connection.leading-tone-seventh"),
  "connection.supertonic-seventh": (analysis) =>
    specializedConnectionRule(analysis, "connection.supertonic-seventh"),
  "connection.subdominant-seventh": (analysis) =>
    specializedConnectionRule(analysis, "connection.subdominant-seventh"),
  "connection.double-dominant-seventh": (analysis) =>
    specializedConnectionRule(analysis, "connection.double-dominant-seventh"),
  "connection.double-dominant-leading-tone": (analysis) =>
    specializedConnectionRule(
      analysis,
      "connection.double-dominant-leading-tone",
    ),
  "connection.neapolitan-sixth": (analysis) =>
    specializedConnectionRule(analysis, "connection.neapolitan-sixth"),
  "connection.deceptive-voice-leading": (analysis) =>
    deceptiveVoiceLeadingRule(analysis),
  "connection.second-inversion-context": (analysis) =>
    secondInversionContextRule(analysis),
  "connection.common-tone-fourth-fifth": (analysis) =>
    basicConnectionRule(analysis, "connection.common-tone-fourth-fifth"),
  "connection.second-relation-contrary-motion": (analysis) =>
    basicConnectionRule(analysis, "connection.second-relation-contrary-motion"),
  "connection.common-tone-third": (analysis) =>
    basicConnectionRule(analysis, "connection.common-tone-third"),
  "connection.nonparsimonious-motion": (analysis) =>
    basicConnectionRule(analysis, "connection.nonparsimonious-motion"),
  "rhythm.harmonic-syncopation": (analysis) =>
    harmonicSyncopationRule(analysis),
  "cadence.cadential64-metric-position": (analysis) =>
    cadential64MetricRule(analysis),
  "cadence.bass-formula": (analysis) =>
    cadenceRule(analysis, "cadence.bass-formula"),
  "cadence.perfect-authentic-soprano": (analysis) =>
    cadenceRule(analysis, "cadence.perfect-authentic-soprano"),
  "cadence.unstable-ending": (analysis) =>
    cadenceRule(analysis, "cadence.unstable-ending"),
  "tonality.unmarked-key-change": (analysis) =>
    unmarkedKeyChangeRule(analysis),
  "tonality.pivot-reinterpretation": (analysis) =>
    pivotReinterpretationRule(analysis),
  "tonality.tonicization-modulation-conflict": (analysis) =>
    tonicizationModulationConflictRule(analysis),
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
