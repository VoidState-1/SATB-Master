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
export type HarmonyRuleSeverities = Record<
  HarmonyRuleId,
  HarmonyRuleSeverity
>;

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

const IMPLEMENTED_RULE_IDS = new Set<HarmonyRuleId>([
  "voice.range",
  "voice.polyphonic-overlap",
  "voice.crossing",
  "voice.upper-spacing",
  "melody.leap-over-octave",
  "melody.large-leap",
  "melody.augmented-interval",
  "melody.diminished-interval",
  "melody.tritone",
  "voice-leading.overlap",
  "voice-leading.parallel-fifths",
  "voice-leading.parallel-octaves",
  "voice-leading.unequal-fifths-perfect-to-diminished",
  "voice-leading.unequal-fifths-outer-diminished-to-perfect",
  "voice-leading.unequal-fifths-inner-diminished-to-perfect",
  "voice-leading.hidden-fifth",
  "voice-leading.hidden-octave",
  "voice-leading.cross-relation-simultaneous",
  "voice-leading.cross-relation-successive",
  "chord.unclassified-nonchord-tone",
  "chord.incomplete-members",
  "chord.inversion-bass",
  "chord.interpretation-identity-conflict",
  "chord.doubled-leading-tone",
  "chord.doubled-seventh",
  "chord.doubled-altered-tendency-tone",
  "chord.dominant-ninth-voicing",
  "chord.dominant-ninth-root-spacing",
  "chord.augmented-sixth-voicing",
  "resolution.leading-tone",
  "resolution.chord-seventh",
  "resolution.dominant-ninth",
  "resolution.altered-tone",
  "resolution.augmented-sixth",
  "connection.italian-augmented-sixth",
  "connection.french-augmented-sixth",
  "connection.german-augmented-sixth",
  "function.retrogression",
  "function.applied-dominant-target",
  "function.double-dominant-target",
  "function.cadential64-target",
  "function.deceptive-cadence-target",
  "connection.deceptive-voice-leading",
  "tonality.mixture-source",
]);

const PARENT_RULE_IDS: Partial<Record<HarmonyRuleId, HarmonyRuleId>> = {
  "melody.tritone": "melody.augmented-interval",
  "connection.dominant-seventh": "resolution.chord-seventh",
  "connection.dominant-ninth": "resolution.dominant-ninth",
  "connection.italian-augmented-sixth": "resolution.augmented-sixth",
  "connection.french-augmented-sixth": "resolution.augmented-sixth",
  "connection.german-augmented-sixth": "resolution.augmented-sixth",
  "connection.deceptive-voice-leading": "function.deceptive-cadence-target",
};

const RULE_OPTIONS: Partial<Record<HarmonyRuleId, readonly RuleOptionDefinition[]>> = {
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
  "voice-leading.overlap": ["same-harmony", "voice-exchange"],
  "voice-leading.unequal-fifths-perfect-to-diminished": [
    "same-harmony",
    "voice-exchange",
  ],
  "voice-leading.unequal-fifths-inner-diminished-to-perfect": [
    "bass-step-up",
  ],
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
  "resolution.chord-seventh": [
    "same-harmony",
    "insufficient-context",
  ],
  "function.retrogression": [
    "sequence",
    "pedal-point",
    "modulation",
    "ambiguous-semantics",
  ],
  "function.double-dominant-target": [
    "modulation",
    "ambiguous-semantics",
  ],
};

const DEFAULT_EXCEPTION_POLICIES: Partial<
  Record<HarmonyRuleId, RuleExceptionPolicy>
> = {
  "melody.large-leap": { "same-harmony": "exempt" },
  "melody.augmented-interval": { "same-harmony": "exempt" },
  "melody.diminished-interval": { "same-harmony": "exempt" },
  "melody.tritone": { "same-harmony": "exempt" },
  "voice-leading.overlap": {
    "same-harmony": "exempt",
    "voice-exchange": "exempt",
  },
  "voice-leading.unequal-fifths-inner-diminished-to-perfect": {
    "bass-step-up": "exempt",
  },
  "voice-leading.hidden-fifth": { "same-harmony": "exempt" },
  "voice-leading.hidden-octave": { "same-harmony": "exempt" },
  "function.double-dominant-target": { modulation: "exempt" },
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
      parentRuleId: PARENT_RULE_IDS[entry.id],
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
