import { GENERATED_RULE_CATALOG } from "./catalog.generated";
import type {
  HarmonyRuleDefinition,
  HarmonyRuleGroupId,
  HarmonyRuleSeverity,
  RuleConfig,
  RuleDependencyScope,
  RuleExceptionContext,
  RuleExceptionPolicy,
  RuleOptionDefinition,
  RuleRequirement,
} from "./types";

export type HarmonyRuleId = (typeof GENERATED_RULE_CATALOG)[number]["id"];
export type HarmonyRuleSeverities = Record<HarmonyRuleId, HarmonyRuleSeverity>;

// 目录修订号只描述规则配置快照，不等同于工程 schema 版本。
export const HARMONY_RULE_CATALOG_REVISION = 2;

export const HARMONY_RULE_GROUPS: readonly {
  id: HarmonyRuleGroupId;
  label: string;
}[] = [
  { id: "voice", label: "声部与纵向织体" },
  { id: "melody", label: "旋律进行" },
  { id: "voiceLeading", label: "声部间进行" },
  { id: "chord", label: "和弦构成与配置" },
  { id: "resolution", label: "倾向音与解决" },
  { id: "nonchord", label: "非和弦音" },
  { id: "function", label: "功能语义" },
  { id: "connection", label: "和弦连接" },
  { id: "rhythm", label: "节奏与切分" },
  { id: "cadence", label: "终止" },
  { id: "tonality", label: "调性与转调" },
] as const;

const IMPLEMENTED_RULE_IDS = new Set<HarmonyRuleId>(
  GENERATED_RULE_CATALOG.map((entry) => entry.id),
);

const COVERED_RULE_IDS: Partial<
  Record<HarmonyRuleId, readonly HarmonyRuleId[]>
> = {
  "melody.tritone": ["melody.augmented-interval", "melody.diminished-interval"],
  "connection.dominant-seventh": [
    "resolution.leading-tone",
    "resolution.chord-seventh",
  ],
  "connection.dominant-ninth": [
    "resolution.leading-tone",
    "resolution.chord-seventh",
    "resolution.dominant-ninth",
  ],
  "connection.italian-augmented-sixth": ["resolution.augmented-sixth"],
  "connection.french-augmented-sixth": ["resolution.augmented-sixth"],
  "connection.german-augmented-sixth": ["resolution.augmented-sixth"],
  "connection.deceptive-voice-leading": ["function.deceptive-cadence-target"],
};

const RULE_OPTIONS: Partial<
  Record<HarmonyRuleId, readonly RuleOptionDefinition[]>
> = {
  "voice.range": [
    {
      kind: "pitch-range",
      key: "soprano",
      label: "女高音域",
      description: "女高声部的建议音域上下界。",
      section: "threshold",
      required: true,
      defaultValue: { minMidi: 60, maxMidi: 81 },
    },
    {
      kind: "pitch-range",
      key: "alto",
      label: "女低音域",
      description: "女低声部的建议音域上下界。",
      section: "threshold",
      required: true,
      defaultValue: { minMidi: 55, maxMidi: 74 },
    },
    {
      kind: "pitch-range",
      key: "tenor",
      label: "男高音域",
      description: "男高声部的建议音域上下界。",
      section: "threshold",
      required: true,
      defaultValue: { minMidi: 48, maxMidi: 67 },
    },
    {
      kind: "pitch-range",
      key: "bass",
      label: "男低音域",
      description: "男低声部的建议音域上下界。",
      section: "threshold",
      required: true,
      defaultValue: { minMidi: 40, maxMidi: 60 },
    },
  ],
  "voice-leading.cross-relation-successive": [
    {
      kind: "duration",
      key: "window",
      label: "先后对斜窗口",
      description: "两个起奏之间允许关联为先后对斜的最长音乐时值。",
      section: "threshold",
      required: true,
      defaultValue: { value: 1, unit: "beats" },
      min: 0.25,
      max: 8,
      step: 0.25,
    },
  ],
};

const EXCEPTION_CONTEXTS: Partial<
  Record<HarmonyRuleId, readonly RuleExceptionContext[]>
> = {
  "melody.large-leap": ["same-harmony", "arpeggiation"],
  "melody.augmented-interval": ["same-harmony", "arpeggiation"],
  "melody.diminished-interval": ["same-harmony", "arpeggiation"],
  "melody.tritone": ["same-harmony", "arpeggiation"],
  "melody.leap-recovery": ["same-harmony", "arpeggiation"],
  "melody.consecutive-leaps": ["same-harmony", "arpeggiation"],
  "voice-leading.overlap": ["same-harmony", "voice-exchange"],
  "voice-leading.unequal-fifths-perfect-to-diminished": [
    "same-harmony",
    "voice-exchange",
  ],
  "voice-leading.unequal-fifths-inner-diminished-to-perfect": ["bass-step-up"],
  "voice-leading.hidden-fifth": ["same-harmony"],
  "voice-leading.hidden-octave": ["same-harmony"],
  "voice-leading.cross-relation-simultaneous": [
    "modulation",
    "ambiguous-semantics",
  ],
  "voice-leading.cross-relation-successive": [
    "modulation",
    "ambiguous-semantics",
  ],
  "chord.unclassified-nonchord-tone": ["nonchord-tone", "pedal-point"],
  "resolution.leading-tone": [
    "same-harmony",
    "voice-exchange",
    "insufficient-context",
  ],
  "resolution.chord-seventh": ["same-harmony", "insufficient-context"],
  "function.retrogression": [
    "pedal-point",
    "modulation",
    "ambiguous-semantics",
  ],
  "function.double-dominant-target": ["modulation", "ambiguous-semantics"],
  "connection.common-tone-fourth-fifth": ["voice-exchange"],
  "connection.common-tone-third": ["voice-exchange"],
  "connection.nonparsimonious-motion": [
    "same-harmony",
    "voice-exchange",
    "pedal-point",
  ],
};

const DEFAULT_EXCEPTION_POLICIES: Partial<
  Record<HarmonyRuleId, RuleExceptionPolicy>
> = {
  "melody.large-leap": { "same-harmony": "exempt" },
  "melody.augmented-interval": { "same-harmony": "exempt" },
  "melody.diminished-interval": { "same-harmony": "exempt" },
  "melody.tritone": { "same-harmony": "exempt" },
  "melody.leap-recovery": { "same-harmony": "exempt" },
  "melody.consecutive-leaps": { "same-harmony": "exempt" },
  "voice-leading.overlap": {
    "same-harmony": "exempt",
    "voice-exchange": "exempt",
  },
  "voice-leading.unequal-fifths-inner-diminished-to-perfect": {
    "bass-step-up": "exempt",
  },
  "voice-leading.hidden-fifth": { "same-harmony": "exempt" },
  "voice-leading.hidden-octave": { "same-harmony": "exempt" },
  "voice-leading.cross-relation-simultaneous": {
    modulation: "exempt",
    "ambiguous-semantics": "exempt",
  },
  "voice-leading.cross-relation-successive": {
    modulation: "exempt",
    "ambiguous-semantics": "exempt",
  },
  "function.double-dominant-target": { modulation: "exempt" },
  "connection.common-tone-fourth-fifth": { "voice-exchange": "exempt" },
  "connection.common-tone-third": { "voice-exchange": "exempt" },
  "connection.nonparsimonious-motion": {
    "same-harmony": "exempt",
    "voice-exchange": "exempt",
    "pedal-point": "exempt",
  },
};

function groupOf(id: HarmonyRuleId): HarmonyRuleGroupId {
  const prefix = id.split(".")[0];
  if (prefix === "voice-leading") return "voiceLeading";
  if (prefix === "cadence") return "cadence";
  if (
    prefix === "voice" ||
    prefix === "melody" ||
    prefix === "chord" ||
    prefix === "resolution" ||
    prefix === "nonchord" ||
    prefix === "function" ||
    prefix === "connection" ||
    prefix === "rhythm" ||
    prefix === "tonality"
  )
    return prefix;
  throw new Error(`未知规则分组：${id}`);
}

function requirementsOf(id: HarmonyRuleId): readonly RuleRequirement[] {
  if (id === "resolution.leading-tone") return ["written-pitches"];
  if (id === "function.ambiguous-connection") return ["chords"];
  if (id === "chord.interpretation-identity-conflict")
    return ["chords", "semantics"];
  if (id.startsWith("function.")) return ["chords", "semantics"];
  if (id.startsWith("tonality.")) return ["chords", "semantics"];
  if (id.startsWith("connection."))
    return ["written-pitches", "chords", "semantics"];
  if (id.startsWith("rhythm.") || id.startsWith("cadence."))
    return ["chords", "semantics"];
  if (id.startsWith("chord.")) return ["written-pitches", "chords"];
  if (id.startsWith("resolution.") || id.startsWith("nonchord."))
    return ["written-pitches", "chords"];
  return ["written-pitches"];
}

function dependencyScopeOf(id: HarmonyRuleId): RuleDependencyScope {
  if (id === "voice.range" || id === "voice.polyphonic-overlap") return "note";
  if (id.startsWith("melody.")) return "note";
  if (id.startsWith("voice.") || id.startsWith("voice-leading."))
    return "slice";
  if (id.startsWith("chord.")) return "chord";
  if (id.startsWith("tonality.")) return "project";
  return "phrase";
}

export const HARMONY_RULE_DEFINITIONS: readonly (HarmonyRuleDefinition & {
  id: HarmonyRuleId;
})[] = GENERATED_RULE_CATALOG.map((entry) => {
  const options = RULE_OPTIONS[entry.id] ?? [];
  const defaultConfig = Object.fromEntries(
    options.map((option) => [option.key, structuredClone(option.defaultValue)]),
  ) as RuleConfig;
  return {
    ...entry,
    coveredRuleIds: COVERED_RULE_IDS[entry.id] ?? [],
    group: groupOf(entry.id),
    requires: requirementsOf(entry.id),
    dependencyScope: dependencyScopeOf(entry.id),
    configVersion: 1,
    defaultConfig,
    options,
    supportedExceptionContexts: EXCEPTION_CONTEXTS[entry.id] ?? [],
    defaultExceptionPolicies: DEFAULT_EXCEPTION_POLICIES[entry.id] ?? {},
    implemented: IMPLEMENTED_RULE_IDS.has(entry.id),
  };
});

export const HARMONY_RULE_DEFINITION_BY_ID = new Map(
  HARMONY_RULE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const HARMONY_RULE_SEVERITY_OPTIONS: readonly {
  value: HarmonyRuleSeverity;
  label: string;
}[] = [
  { value: "error", label: "错误" },
  { value: "warning", label: "警告" },
  { value: "suggestion", label: "建议" },
  { value: "off", label: "无" },
];

export function defaultHarmonyRuleSeverities(): HarmonyRuleSeverities {
  return Object.fromEntries(
    HARMONY_RULE_DEFINITIONS.map((definition) => [
      definition.id,
      definition.defaultSeverity,
    ]),
  ) as HarmonyRuleSeverities;
}

export function chordDependentRuleIds() {
  return HARMONY_RULE_DEFINITIONS.filter((definition) =>
    definition.requires.includes("chords"),
  ).map((definition) => definition.id as HarmonyRuleId);
}
