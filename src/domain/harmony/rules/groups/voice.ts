import type { HarmonyAnalysis } from "../../analysis";
import type { RuleConfig, RuleDiagnostic } from "../../runtime";
import { VOICE_CONFIG, VOICE_ORDER, type VoiceId } from "../../../project";
import { formatSpelledPitch, toMidi } from "../../../pitch";
import { diagnostic, noteEvidence, voiceName } from "../helpers/core";
import { defineRuleBindings, statelessRule } from "../binding";

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

export const VOICE_RULE_BINDINGS = defineRuleBindings({
  "voice.range": statelessRule(voiceRangeRule),
  "voice.polyphonic-overlap": statelessRule(noteOverlapRule),
  "voice.crossing": statelessRule((analysis) =>
    verticalRule(analysis, "voice.crossing"),
  ),
  "voice.upper-spacing": statelessRule((analysis) =>
    verticalRule(analysis, "voice.upper-spacing"),
  ),
});
