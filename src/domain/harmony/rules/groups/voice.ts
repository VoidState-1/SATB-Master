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
      "SATB 音符低于或高于对应声部 profile 的建议音域时触发；按实际 MIDI 音高判断，书写等音不改变结果。",
    rationale: "辅助轨不参与；完整钢琴卷帘音域不等于各声部建议音域。",
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
    description:
      "同一声部两个不同音符的半开时间区间相交，且不是同一音高的合法连音表达时触发。",
    rationale: "辅助轨允许复调；相邻音符 `endTick === startTick` 不算重叠。",
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
      "同一有效切片中，较高声部低于相邻的较低声部时触发；分别检查 S/A、A/T、T/B。",
    rationale: "相邻声部同音不算交叉；同和弦转换不豁免。",
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
    description: "同一切片中 S-A 或 A-T 的实际音高距离大于 12 半音时触发。",
    rationale: "T-B 不设八度上限；同和弦转换不豁免。",
    group: "voice",
    defaultSeverity: "warning",
    requires: ["written-pitches"],
    dependencyScope: "slice",
    evaluate: upperVoiceSpacingRule,
  }),
);
