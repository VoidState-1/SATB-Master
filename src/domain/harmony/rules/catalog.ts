import { BUILTIN_HARMONY_RULES } from "./groups";
import type { HarmonyRuleGroupId, HarmonyRuleSeverity } from "./types";

export type HarmonyRuleId = (typeof BUILTIN_HARMONY_RULES)[number]["id"];
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

export const HARMONY_RULE_DEFINITIONS = BUILTIN_HARMONY_RULES;

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
  { value: "off", label: "关" },
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
  ).map((definition) => definition.id);
}
