import type { HarmonyAnalysis } from "../../analysis";
import type { RuleConfig, RuleDiagnostic } from "../../runtime";
import type { VoiceId } from "../../../project/types";
import { VOICE_CONFIG, VOICE_ORDER } from "../../../project/voice";
import { formatSpelledPitch, toMidi } from "../../../pitch";
import { diagnostic, noteEvidence, voiceName } from "../helpers/core";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

export function voiceRangeRule(analysis: HarmonyAnalysis, config: RuleConfig = {}) {
  const diagnostics: RuleDiagnostic[] = [];
  VOICE_ORDER.forEach((voiceId) =>
    analysis.notesByVoice[voiceId].forEach((note) => {
      const range = VOICE_CONFIG[voiceId];
      const configuredRange = config[voiceId];
      const configuredMin =
        configuredRange &&
        typeof configuredRange === "object" &&
        "minMidi" in configuredRange
          ? configuredRange.minMidi
          : undefined;
      const configuredMax =
        configuredRange &&
        typeof configuredRange === "object" &&
        "maxMidi" in configuredRange
          ? configuredRange.maxMidi
          : undefined;
      const minimum =
        typeof configuredMin === "number" && Number.isFinite(configuredMin)
          ? configuredMin
          : range.min;
      const maximum =
        typeof configuredMax === "number" && Number.isFinite(configuredMax)
          ? configuredMax
          : range.max;
      const midi = toMidi(note.pitch);
      if (midi < minimum || midi > maximum) {
        diagnostics.push(
          diagnostic(
            "voice.range",
            note.startTick,
            note.startTick + note.durationTicks,
            [voiceId],
            [note],
            "超出建议音域",
            `${voiceName(analysis, voiceId)}建议使用 MIDI ${minimum}-${maximum}，当前音高为 ${formatSpelledPitch(note.pitch)}（MIDI ${midi}）。`,
            {
              params: { midi, minimum, maximum },
              evidence: [noteEvidence(note)],
            },
          ),
        );
      }
    }),
  );
  return diagnostics;
}

export function noteOverlapRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  VOICE_ORDER.forEach((voiceId) => {
    const active: typeof analysis.notesByVoice[typeof voiceId][number][] = [];
    analysis.notesByVoice[voiceId].forEach((current) => {
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
            `${voiceName(analysis, voiceId)}中存在时间上互相重叠的音符。`,
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
    });
  });
  return diagnostics;
}

export function verticalRule(
  analysis: HarmonyAnalysis,
  ruleId: "voice.crossing" | "voice.upper-spacing",
) {
  const diagnostics: RuleDiagnostic[] = [];
  const adjacent: Array<[VoiceId, VoiceId]> = [
    ["soprano", "alto"],
    ["alto", "tenor"],
    ["tenor", "bass"],
  ];
  analysis.slices.forEach((slice) => {
    adjacent.forEach(([upperId, lowerId], index) => {
      const upper = slice.notes[upperId];
      const lower = slice.notes[lowerId];
      if (!upper || !lower) return;
      const distance = toMidi(upper.pitch) - toMidi(lower.pitch);
      const matches =
        ruleId === "voice.crossing" ? distance < 0 : index < 2 && distance > 12;
      if (!matches) return;
      diagnostics.push(
        diagnostic(
          ruleId,
          slice.tick,
          slice.endTick,
          [upperId, lowerId],
          [upper, lower],
          ruleId === "voice.crossing" ? "声部交叉" : "上三声部间距过宽",
          ruleId === "voice.crossing"
            ? "较高声部低于相邻的较低声部。"
            : "S-A 与 A-T 的相邻声部间距通常不应超过八度。",
          {
            params: { semitones: Math.abs(distance) },
            evidence: [
              noteEvidence(upper, voiceName(analysis, upperId)),
              noteEvidence(lower, voiceName(analysis, lowerId)),
              {
                kind: "interval",
                label: "垂直间距",
                value: `${Math.abs(distance)} 个半音`,
              },
            ],
          },
        ),
      );
    });
  });
  return diagnostics;
}

export const VOICE_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "voice.range",
    catalogNumber: "A.1",
    label: "超出建议音域",
    description: "SATB 音符低于或高于对应声部 profile 的建议音域时触发；按实际 MIDI 音高判断，书写等音不改变结果。",
    rationale: "辅助轨不参与；完整钢琴卷帘音域不等于各声部建议音域。",
    group: "voice",
    defaultSeverity: "warning",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "note",
    options: [
      {
        "kind": "pitch-range",
        "key": "soprano",
        "label": "女高音域",
        "description": "女高声部的建议音域上下界。",
        "section": "threshold",
        "required": true,
        "defaultValue": {
          "minMidi": 60,
          "maxMidi": 81
        }
      },
      {
        "kind": "pitch-range",
        "key": "alto",
        "label": "女低音域",
        "description": "女低声部的建议音域上下界。",
        "section": "threshold",
        "required": true,
        "defaultValue": {
          "minMidi": 55,
          "maxMidi": 74
        }
      },
      {
        "kind": "pitch-range",
        "key": "tenor",
        "label": "男高音域",
        "description": "男高声部的建议音域上下界。",
        "section": "threshold",
        "required": true,
        "defaultValue": {
          "minMidi": 48,
          "maxMidi": 67
        }
      },
      {
        "kind": "pitch-range",
        "key": "bass",
        "label": "男低音域",
        "description": "男低声部的建议音域上下界。",
        "section": "threshold",
        "required": true,
        "defaultValue": {
          "minMidi": 40,
          "maxMidi": 60
        }
      }
    ],
    evaluate: voiceRangeRule,
  }),
  defineStatelessRule({
    id: "voice.polyphonic-overlap",
    catalogNumber: "A.2",
    label: "同声部音符重叠",
    description: "同一声部两个不同音符的半开时间区间相交，且不是同一音高的合法连音表达时触发。",
    rationale: "辅助轨允许复调；相邻音符 `endTick === startTick` 不算重叠。",
    group: "voice",
    defaultSeverity: "error",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "note",
    evaluate: noteOverlapRule,
  }),
  defineStatelessRule({
    id: "voice.crossing",
    catalogNumber: "A.3",
    label: "声部交叉",
    description: "同一有效切片中，较高声部低于相邻的较低声部时触发；分别检查 S/A、A/T、T/B。",
    rationale: "相邻声部同音不算交叉；同和弦转换不豁免。",
    group: "voice",
    defaultSeverity: "error",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "slice",
    evaluate: (analysis) =>
    verticalRule(analysis, "voice.crossing"),
  }),
  defineStatelessRule({
    id: "voice.upper-spacing",
    catalogNumber: "A.4",
    label: "上三声部间距过宽",
    description: "同一切片中 S-A 或 A-T 的实际音高距离大于 12 半音时触发。",
    rationale: "T-B 不设八度上限；同和弦转换不豁免。",
    group: "voice",
    defaultSeverity: "warning",
    requires: [
      "written-pitches"
    ],
    dependencyScope: "slice",
    evaluate: (analysis) =>
    verticalRule(analysis, "voice.upper-spacing"),
  }),
);
