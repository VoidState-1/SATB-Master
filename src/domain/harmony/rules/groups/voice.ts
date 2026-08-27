import type { RuleConfig, RuleDiagnostic } from "../../runtime";
import type { VoiceId } from "../../../project/types";
import {
  VOICE_CONFIG,
  VOICE_ORDER,
  defaultVoiceRange,
} from "../../../project/voice";
import { formatSpelledPitch, toMidi } from "../../../pitch";
import { diagnostic, noteEvidence, voiceName } from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

function configuredVoiceRange(config: RuleConfig, voiceId: VoiceId) {
  const fallback = VOICE_CONFIG[voiceId];
  const configured = config[voiceId];
  const minimum =
    configured && typeof configured === "object" && "minMidi" in configured
      ? configured.minMidi
      : fallback.min;
  const maximum =
    configured && typeof configured === "object" && "maxMidi" in configured
      ? configured.maxMidi
      : fallback.max;
  return { minimum, maximum };
}

export function voiceRangeRule(context: HarmonyRuleContext, config: RuleConfig) {
  return context
    .notes()
    .select((candidate) => ({
      candidate,
      midi: toMidi(candidate.note.pitch),
      ...configuredVoiceRange(config, candidate.voiceId),
    }))
    .where(
      ({ midi, minimum, maximum }) => midi < minimum || midi > maximum,
    )
    .select(({ candidate, midi, minimum, maximum }) =>
      context.diagnostics.forNotes({
        ruleId: "voice.range",
        notes: [candidate],
        title: "超出建议音域",
        message: `${voiceName(context.analysis, candidate.voiceId)}建议使用 MIDI ${minimum}-${maximum}，当前音高为 ${formatSpelledPitch(candidate.note.pitch)}（MIDI ${midi}）。`,
        params: { midi, minimum, maximum },
      }),
    )
    .toArray();
}

export function noteOverlapRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  VOICE_ORDER.forEach((voiceId) => {
    const active: HarmonyRuleContext["analysis"]["notesByVoice"][typeof voiceId][number][] = [];
    for (const { note: current } of context.notes({ voiceId })) {
      for (let index = active.length - 1; index >= 0; index -= 1) {
        const previous = active[index];
        if (previous.startTick + previous.durationTicks <= current.startTick)
          active.splice(index, 1);
      }
      active.forEach((previous) => {
        diagnostics.push(
          diagnostic(
            "voice.polyphonic-overlap",
            current.startTick,
            Math.min(
              previous.startTick + previous.durationTicks,
              current.startTick + current.durationTicks,
            ),
            [voiceId],
            [previous, current],
            "同声部音符重叠",
            `${voiceName(context.analysis, voiceId)}中存在时间上互相重叠的音符。`,
            {
              evidence: [
                noteEvidence(previous, "先开始的音"),
                noteEvidence(current, "后开始的音"),
              ],
            },
          ),
        );
      });
      active.push(current);
    }
  });
  return diagnostics;
}

interface AdjacentVoicePairFact {
  upperId: VoiceId;
  lowerId: VoiceId;
  upper: NonNullable<
    HarmonyRuleContext["analysis"]["slices"][number]["notes"][VoiceId]
  >;
  lower: NonNullable<
    HarmonyRuleContext["analysis"]["slices"][number]["notes"][VoiceId]
  >;
  tick: number;
  endTick: number;
  distance: number;
}

function adjacentVoicePairFacts(context: HarmonyRuleContext) {
  const facts: AdjacentVoicePairFact[] = [];
  const adjacent: Array<[VoiceId, VoiceId]> = [
    ["soprano", "alto"],
    ["alto", "tenor"],
    ["tenor", "bass"],
  ];
  for (const slice of context.slices()) {
    adjacent.forEach(([upperId, lowerId]) => {
      const upper = slice.notes[upperId];
      const lower = slice.notes[lowerId];
      if (!upper || !lower) return;
      facts.push({
        upperId,
        lowerId,
        upper,
        lower,
        tick: slice.tick,
        endTick: slice.endTick,
        distance: toMidi(upper.pitch) - toMidi(lower.pitch),
      });
    });
  }
  return facts;
}

function verticalDiagnostic(
  analysis: HarmonyRuleContext["analysis"],
  fact: AdjacentVoicePairFact,
  ruleId: "voice.crossing" | "voice.upper-spacing",
  title: string,
  message: string,
) {
  return diagnostic(
    ruleId,
    fact.tick,
    fact.endTick,
    [fact.upperId, fact.lowerId],
    [fact.upper, fact.lower],
    title,
    message,
    {
      params: { semitones: Math.abs(fact.distance) },
      evidence: [
        noteEvidence(fact.upper, voiceName(analysis, fact.upperId)),
        noteEvidence(fact.lower, voiceName(analysis, fact.lowerId)),
        {
          kind: "interval",
          label: "垂直间距",
          value: `${Math.abs(fact.distance)} 个半音`,
        },
      ],
    },
  );
}

export function voiceCrossingRule(context: HarmonyRuleContext) {
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  adjacentVoicePairFacts(context).forEach((fact) => {
    if (fact.distance >= 0) return;
    diagnostics.push(
      verticalDiagnostic(
        analysis,
        fact,
        "voice.crossing",
        "声部交叉",
        "较高声部低于相邻的较低声部。",
      ),
    );
  });
  return diagnostics;
}

export function upperVoiceSpacingRule(context: HarmonyRuleContext) {
  const { analysis } = context;
  const diagnostics: RuleDiagnostic[] = [];
  adjacentVoicePairFacts(context).forEach((fact) => {
    if (fact.lowerId === "bass" || fact.distance <= 12) return;
    diagnostics.push(
      verticalDiagnostic(
        analysis,
        fact,
        "voice.upper-spacing",
        "上三声部间距过宽",
        "S-A 与 A-T 的相邻声部间距通常不应超过八度。",
      ),
    );
  });
  return diagnostics;
}

export const VOICE_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "voice.range",
    catalogNumber: "A.1",
    label: "超出建议音域",
    description:
      "检查 SATB 各声部音符是否落在人声合唱的常规建议音域之内。",
    rationale:
      "四部和声源自人声合唱织体。各声部音域受人声生理发声极限与最佳共鸣区限制（女高 c1-a2、女低 g-d2、男高 c-a1、男低 E-d1）。超出常规音域会导致演唱困难、音色干瘪或发声失衡；低音过低易模糊浑浊，高音过高则破坏织体平衡。",
    group: "voice",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "note",
    options: [
      {
        kind: "pitch-range",
        key: "soprano",
        label: "女高音域",
        description: "女高声部的建议音域上下界。",
        section: "threshold",
        required: true,
        defaultValue: defaultVoiceRange("soprano"),
      },
      {
        kind: "pitch-range",
        key: "alto",
        label: "女低音域",
        description: "女低声部的建议音域上下界。",
        section: "threshold",
        required: true,
        defaultValue: defaultVoiceRange("alto"),
      },
      {
        kind: "pitch-range",
        key: "tenor",
        label: "男高音域",
        description: "男高声部的建议音域上下界。",
        section: "threshold",
        required: true,
        defaultValue: defaultVoiceRange("tenor"),
      },
      {
        kind: "pitch-range",
        key: "bass",
        label: "男低音域",
        description: "男低声部的建议音域上下界。",
        section: "threshold",
        required: true,
        defaultValue: defaultVoiceRange("bass"),
      },
    ],
    evaluate: voiceRangeRule,
  }),
  defineStatelessRule({
    id: "voice.polyphonic-overlap",
    catalogNumber: "A.2",
    label: "同声部音符重叠",
    description: "检查同一单音声部内是否存在时间重叠的多个音符。",
    rationale:
      "在标准四部和声写作中，SATB 各声部均为严格的单旋律线条（Monophonic），同一声部在同一时刻只能发出一处音高。同声部出现发音重叠破坏了单声部线条的独立性与歌唱逻辑。",
    group: "voice",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "note",
    evaluate: noteOverlapRule,
  }),
  defineStatelessRule({
    id: "voice.crossing",
    catalogNumber: "A.3",
    label: "声部交叉",
    description:
      "检查较高声部的音高是否低于相邻的较低声部（如女高音低于女低音）。",
    rationale:
      "古典和声要求各声部在纵向上保持清晰的音高层级（S > A > T > B）。声部交叉会使各声部的音色、旋律线条和功能听觉产生混淆，破坏四部合唱织体原本清晰通透的层次感。",
    group: "voice",
    defaultSeverity: "error",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    evaluate: voiceCrossingRule,
  }),
  defineStatelessRule({
    id: "voice.upper-spacing",
    catalogNumber: "A.4",
    label: "上三声部间距过宽",
    description:
      "检查相邻上三声部（S-A、A-T）之间的纵向音程是否超过八度。",
    rationale:
      "传统四部和声采用密集排列法（相邻上三声部距离为三、四度）或开放排列法（距离为五、六、八度）。无论何种排列，S-A 与 A-T 之间的距离均不得超过纯八度，否则会在纵向上产生声部空洞（织体裂痕）；男高音与男低音（T-B）之间因低音声部的支撑作用则允许超过八度。",
    group: "voice",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    evaluate: upperVoiceSpacingRule,
  }),
);
