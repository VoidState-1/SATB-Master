export type DiagnosticSeverity = "error" | "warning" | "suggestion";
export type HarmonyRuleSeverity = DiagnosticSeverity | "off";
export type HarmonyRuleGroupId = "voice" | "melody" | "voiceLeading" | "chord";
export type RuleRequirement =
  "written-pitches" | "chords" | "functions" | "complete-satb";
export type RuleDependencyScope =
  "note" | "slice" | "chord" | "phrase" | "project";

export interface HarmonyRuleDefinition {
  id: string;
  label: string;
  description: string;
  group: HarmonyRuleGroupId;
  defaultSeverity: DiagnosticSeverity;
  requires: readonly RuleRequirement[];
  dependencyScope: RuleDependencyScope;
}

export const HARMONY_RULE_GROUPS: Array<{
  id: HarmonyRuleGroupId;
  label: string;
}> = [
  { id: "voice", label: "声部与音域" },
  { id: "melody", label: "旋律进行" },
  { id: "voiceLeading", label: "声部间进行" },
  { id: "chord", label: "和弦与功能" },
];

export const HARMONY_RULE_DEFINITIONS = [
  {
    id: "voice-range",
    label: "超出建议音域",
    group: "voice",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "note",
    description: "检查各声部音符是否超出当前建议音域。",
  },
  {
    id: "voice-note-overlap",
    label: "同声部音符重叠",
    group: "voice",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "note",
    description: "检查同一声部是否在同一时间发出多个音高。",
  },
  {
    id: "voice-crossing",
    label: "声部交叉",
    group: "voice",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    description: "检查较高声部是否低于相邻的较低声部。",
  },
  {
    id: "upper-spacing",
    label: "上三声部间距过宽",
    group: "voice",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    description: "检查女高-女低与女低-男高的间距是否超过八度。",
  },
  {
    id: "voice-overlap",
    label: "声部重叠",
    group: "voice",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    description:
      "检查当前声部是否进入相邻声部前一位置的音域；同和弦转换允许声部超越。",
  },
  {
    id: "melodic-leap-over-octave",
    label: "超过八度的旋律跳进",
    group: "melody",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "note",
    description: "检查单一声部相邻音符是否出现超过八度的跳进。",
  },
  {
    id: "melodic-large-leap",
    label: "较大旋律跳进",
    group: "melody",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "note",
    description: "检查不同和弦间是否出现大于纯五度、不超过八度的跳进。",
  },
  {
    id: "melodic-tritone",
    label: "旋律三全音",
    group: "melody",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "note",
    description: "检查不同和弦间的相邻音符是否构成三全音跳进。",
  },
  {
    id: "leading-tone-resolution",
    label: "导音未上行解决",
    group: "melody",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "note",
    description: "检查导音离开同和弦延续后是否上行解决到主音。",
  },
  {
    id: "augmented-diminished-interval",
    label: "旋律增减音程",
    group: "melody",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "note",
    description:
      "按书写字母距离与升降号检查增音程、减音程；同和弦转换中的分解和弦跳进予以放宽。",
  },
  {
    id: "cross-relation",
    label: "对斜",
    group: "voiceLeading",
    defaultSeverity: "suggestion",
    requires: ["written-pitches"],
    dependencyScope: "phrase",
    description:
      "检查相邻时间窗口内不同声部出现的同字母、不同升降号拼写，并区分同时与先后对斜。",
  },
  {
    id: "parallel-fifths",
    label: "平行纯五度",
    group: "voiceLeading",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    description: "检查两个声部是否同向进行并连续形成纯五度。",
  },
  {
    id: "parallel-octaves",
    label: "平行八度或同度",
    group: "voiceLeading",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    description: "检查两个声部是否同向进行并连续形成八度或同度。",
  },
  {
    id: "hidden-perfect-interval",
    label: "外声部隐伏完全协和音程",
    group: "voiceLeading",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    description: "检查不同和弦间外声部是否同向跳进到纯五度或八度。",
  },
  {
    id: "chord-membership",
    label: "未标注的和弦外音",
    group: "chord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    description: "检查和弦区间内是否存在既非构成音、又未人工标注角色的音符。",
  },
  {
    id: "chord-completeness",
    label: "和弦构成音不完整",
    group: "chord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "complete-satb"],
    dependencyScope: "chord",
    description: "检查同和弦转换结束时是否缺少已标注和弦的构成音。",
  },
  {
    id: "chord-inversion",
    label: "低音与转位不一致",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords"],
    dependencyScope: "chord",
    description: "检查男低音的音级是否符合和弦轨上的转位标记。",
  },
  {
    id: "leading-tone-doubling",
    label: "重复导音",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords", "complete-satb"],
    dependencyScope: "chord",
    description: "检查同和弦转换结束时是否仍重复调内导音。",
  },
  {
    id: "chord-seventh-resolution",
    label: "七音未级进下行解决",
    group: "chord",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords"],
    dependencyScope: "phrase",
    description: "检查七音离开同和弦延续后是否以半音或全音级进下行解决。",
  },
  {
    id: "chord-seventh-doubling",
    label: "重复和弦七音",
    group: "chord",
    defaultSeverity: "error",
    requires: ["written-pitches", "chords", "complete-satb"],
    dependencyScope: "chord",
    description: "检查同和弦转换结束时，七和弦的七音是否仍被重复。",
  },
  {
    id: "functional-retrogression",
    label: "逆功能进行",
    group: "chord",
    defaultSeverity: "warning",
    requires: ["chords", "functions"],
    dependencyScope: "phrase",
    description: "检查相邻和弦是否出现斯波索宾基础序进中的属功能到下属功能。",
  },
  {
    id: "secondary-dominant-resolution",
    label: "副属和弦未进入目标",
    group: "chord",
    defaultSeverity: "warning",
    requires: ["chords", "functions"],
    dependencyScope: "phrase",
    description: "检查副属和弦是否进入其标注指向的目标级和弦。",
  },
  {
    id: "cadential64-resolution",
    label: "终止四六未进入属和弦",
    group: "chord",
    defaultSeverity: "warning",
    requires: ["chords", "functions"],
    dependencyScope: "phrase",
    description: "检查标记为终止四六的和弦是否连续进入属功能和弦。",
  },
] as const satisfies readonly HarmonyRuleDefinition[];

export type HarmonyRuleId = (typeof HARMONY_RULE_DEFINITIONS)[number]["id"];
export type HarmonyRuleSeverities = Record<HarmonyRuleId, HarmonyRuleSeverity>;

export const HARMONY_RULE_SEVERITY_OPTIONS: Array<{
  value: HarmonyRuleSeverity;
  label: string;
}> = [
  { value: "error", label: "错误" },
  { value: "warning", label: "警告" },
  { value: "suggestion", label: "建议" },
  { value: "off", label: "无" },
];

export function defaultHarmonyRuleSeverities(): HarmonyRuleSeverities {
  return Object.fromEntries(
    HARMONY_RULE_DEFINITIONS.map((rule) => [rule.id, rule.defaultSeverity]),
  ) as HarmonyRuleSeverities;
}

export function chordDependentRuleIds() {
  return HARMONY_RULE_DEFINITIONS.filter((rule) =>
    (rule.requires as readonly RuleRequirement[]).includes("chords"),
  ).map((rule) => rule.id);
}
